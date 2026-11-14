// ふりっくふろっく：アプリ内キーボードの中身（配列・入力の状態・判定・お手本）。画面（softKeyboard.js・tools/kb-proto.html）とは切り離し、Nodeでも試せるようにする。
// 配列はiPhoneの「日本語かな」キーボード（フリック）に合わせる（2026-11-11 ユーザー決定）。見た目は自前のデザインにする。
// 入力は「確定した文字（committed）」と「まだ確定していない文字（pending）」に分けて持つ。変換の候補は pending から作る。
// 予測の候補（打ちかけの語を1回で入れる）は出さない（タイムの公平さのため）。

// ===== 配列。各フリックキーは [まん中, 左, 上, 右, 下]、空文字は「その向きに文字なし」 =====
// 画面は5列×4行：左の列（画面切り替え）、まん中の3列（文字）、右の列（消す・空白・確定）
export const LAYOUTS = {
    kana: [
        { id: 'a', f: ['あ', 'い', 'う', 'え', 'お'] }, { id: 'ka', f: ['か', 'き', 'く', 'け', 'こ'] }, { id: 'sa', f: ['さ', 'し', 'す', 'せ', 'そ'] },
        { id: 'ta', f: ['た', 'ち', 'つ', 'て', 'と'] }, { id: 'na', f: ['な', 'に', 'ぬ', 'ね', 'の'] }, { id: 'ha', f: ['は', 'ひ', 'ふ', 'へ', 'ほ'] },
        { id: 'ma', f: ['ま', 'み', 'む', 'め', 'も'] }, { id: 'ya', f: ['や', '「', 'ゆ', '」', 'よ'] }, { id: 'ra', f: ['ら', 'り', 'る', 'れ', 'ろ'] },
        { id: 'dk', fn: 'dk', label: '小゛゜' }, { id: 'wa', f: ['わ', 'を', 'ん', 'ー', ''] }, { id: 'pu', f: ['、', '。', '？', '！', ''] },
    ],
    abc: [
        { id: 'at', f: ['@', '#', '/', '&', '_'] }, { id: 'abc', f: ['a', 'b', 'c', '', ''] }, { id: 'def', f: ['d', 'e', 'f', '', ''] },
        { id: 'ghi', f: ['g', 'h', 'i', '', ''] }, { id: 'jkl', f: ['j', 'k', 'l', '', ''] }, { id: 'mno', f: ['m', 'n', 'o', '', ''] },
        { id: 'pqrs', f: ['p', 'q', 'r', 's', ''] }, { id: 'tuv', f: ['t', 'u', 'v', '', ''] }, { id: 'wxyz', f: ['w', 'x', 'y', 'z', ''] },
        { id: 'case', fn: 'case', label: 'a/A' }, { id: 'quo', f: ["'", '"', '(', ')', ''] }, { id: 'dot', f: ['.', ',', '?', '!', ''] },
    ],
    num: [
        { id: 'n1', f: ['1', '☆', '♪', '→', ''] }, { id: 'n2', f: ['2', '¥', '$', '€', ''] }, { id: 'n3', f: ['3', '%', '°', '#', ''] },
        { id: 'n4', f: ['4', '○', '*', '・', ''] }, { id: 'n5', f: ['5', '+', '×', '÷', ''] }, { id: 'n6', f: ['6', '<', '=', '>', ''] },
        { id: 'n7', f: ['7', '「', '」', ':', ''] }, { id: 'n8', f: ['8', '〒', '々', '〆', ''] }, { id: 'n9', f: ['9', '^', '|', '\\', ''] },
        { id: 'par', f: ['(', ')', '[', ']', ''] }, { id: 'n0', f: ['0', '~', '…', '', ''] }, { id: 'sym', f: ['.', ',', '-', '/', ''] },
    ],
};
export const DIRS = ['c', 'l', 'u', 'r', 'd'];
// 左の列の「画面切り替え」キー：かな→ABC→☆123→かな の順に回る（iPhoneと同じ順番。キーの文字は「次の画面」の名前）
export const MODE_ORDER = ['kana', 'abc', 'num'];
export const MODE_LABEL = { kana: 'ABC', abc: '☆123', num: 'あいう' };
export const nextMode = (m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length];

// 濁点キー（小゛゜）で、最後の文字を順に変える（例：は→ば→ぱ→は、つ→っ→づ→つ）
const CYCLES = ['あぁ', 'いぃ', 'うぅゔ', 'えぇ', 'おぉ', 'かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ',
    'ただ', 'ちぢ', 'つっづ', 'てで', 'とど', 'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ', 'やゃ', 'ゆゅ', 'よょ', 'わゎ'].map(s => [...s]);
export const cycleOf = (c) => CYCLES.find(cy => cy.includes(c));
const nextInCycle = (c) => { const cy = cycleOf(c); return cy ? cy[(cy.indexOf(c) + 1) % cy.length] : c; };
const toggleCase = (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
// 最後の1文字が、濁点キー・a/Aキーで目当ての文字に変えられるか
const reachable = (t, g) => t === g || (cycleOf(g)?.includes(t) ?? false) || (/[a-z]/i.test(t) && t.toLowerCase() === g.toLowerCase());

// ===== お題を「そのまま打つ所」と「変換する所」に分ける =====
const KANJI = /[一-鿿々〆]/;
const KATAKANA = /[ァ-ヶ]/;
const FULL_DIGIT = /[０-９]/;
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHalfDigits = (s) => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const toFullDigits = (s) => s.replace(/[0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 文字の種類：漢字（K）・カタカナ（長音を含む。C）・全角数字（Z）・※（M）・それ以外（P＝そのまま打つ）
function kindOf(c, prev) {
    if (KANJI.test(c)) return 'K';
    if (KATAKANA.test(c) || (c === 'ー' && prev === 'C')) return 'C';
    if (FULL_DIGIT.test(c)) return 'Z';
    if (c === '※') return 'M';
    return 'P';
}

/**
 * お題を区切る。返り値は [{ text, reading, conv }]。conv は「読みを打ってから候補で変換する所」。
 * 漢字の読みはお題の yomi から取る（お題の漢字以外の所を手がかりに、漢字のひと続きごとの読みを割り出す）。
 */
export function segmentize(problem) {
    const text = typeof problem === 'string' ? problem : problem.text;
    const runs = [];
    let prev = '';
    for (const c of text) {
        const k = kindOf(c, prev);
        if (runs.length && runs[runs.length - 1].kind === k) runs[runs.length - 1].text += c;
        else runs.push({ kind: k, text: c });
        prev = k;
    }
    let kanjiReadings = [];
    if (runs.some(r => r.kind === 'K')) {
        const yomi = toHiragana(problem.yomi);
        const re = new RegExp('^' + runs.map(r => r.kind === 'K' ? '(.+?)' : escapeRe(r.kind === 'C' ? toHiragana(r.text) : r.kind === 'M' ? 'こめ' : r.text)).join('') + '$');
        const m = yomi.match(re);
        if (!m) throw new Error('読みが合わない: ' + text + ' / ' + problem.yomi);
        kanjiReadings = m.slice(1);
    }
    let ki = 0;
    return runs.map(r => {
        if (r.kind === 'K') return { text: r.text, reading: kanjiReadings[ki++], conv: true };
        if (r.kind === 'C') return { text: r.text, reading: toHiragana(r.text), conv: true };
        if (r.kind === 'Z') return { text: r.text, reading: toHalfDigits(r.text), conv: true };
        if (r.kind === 'M') return { text: r.text, reading: 'こめ', conv: true };
        return { text: r.text, reading: r.text, conv: false };
    });
}

/** 変換の辞書（読み → 漢字・カタカナ語・※の候補）。アプリの全お題から作る（同じ読みの漢字がある所は、どれも候補に並ぶ）。 */
export function buildDict(problems) {
    const dict = new Map();
    for (const p of problems) {
        for (const s of segmentize(p)) {
            if (!s.conv || FULL_DIGIT.test(s.text[0])) continue;
            if (!dict.has(s.reading)) dict.set(s.reading, new Set());
            dict.get(s.reading).add(s.text);
        }
    }
    return dict;
}

// ===== 入力の状態 =====
export const newState = (mode = 'kana') => ({ mode, committed: '', pending: '' });

/** キーを押した（はらった）ときの状態の変化。dir は 'c'|'l'|'u'|'r'|'d'。返り値は新しい状態。 */
export function pressKey(state, keyId, dir = 'c') {
    const s = { ...state };
    if (keyId === 'mode') { s.mode = nextMode(s.mode); return s; }
    if (keyId === 'del') {
        if (s.pending) s.pending = [...s.pending].slice(0, -1).join('');
        else s.committed = [...s.committed].slice(0, -1).join('');
        return s;
    }
    if (keyId === 'enter') { s.committed += s.pending; s.pending = ''; return s; }
    const p = [...s.pending];
    if (keyId === 'dk' || keyId === 'case') {
        if (p.length) { const i = p.length - 1; p[i] = keyId === 'dk' ? nextInCycle(p[i]) : toggleCase(p[i]); s.pending = p.join(''); }
        return s;
    }
    const key = LAYOUTS[s.mode].find(k => k.id === keyId);
    const ch = key?.f?.[DIRS.indexOf(dir)];
    if (ch) s.pending += ch;
    return s;
}

/**
 * 変換の候補。並びは pending の全体→後ろの部分（長い順）→頭の部分（長い順）。
 * 部分の候補は辞書にある語だけ。全体はカタカナにもでき、末尾の数字のひと続きは全角にもできる。
 * 返り値は [{ text, start, end }]（pending の start〜end を text に置きかえる）。
 */
export function candidatesOf(pending, dict) {
    const chars = [...pending];
    const n = chars.length;
    if (!n) return [];
    const out = [];
    const seen = new Set();
    const add = (text, start, end) => { const k = text + '|' + start + '|' + end; if (!seen.has(k)) { seen.add(k); out.push({ text, start, end }); } };
    const forSpan = (start, end) => {
        const r = chars.slice(start, end).join('');
        for (const t of dict.get(r) || []) add(t, start, end);
    };
    forSpan(0, n);
    const all = chars.join('');
    if (/^[ぁ-ゖー]+$/.test(all) && /[ぁ-ゖ]/.test(all)) add(toKatakana(all), 0, n);
    const digits = all.match(/[0-9]+$/);
    if (digits) add(toFullDigits(digits[0]), n - [...digits[0]].length, n);
    for (let b = 1; b < n; b++) forSpan(b, n);       // 後ろの部分（長い順）
    for (let e = n - 1; e >= 1; e--) forSpan(0, e);  // 頭の部分（長い順）
    return out;
}

/** 候補を選んだときの状態の変化（選んだ所より前は確定、後ろは pending に残す）。 */
export function pickCandidate(state, cand) {
    const chars = [...state.pending];
    return { ...state, committed: state.committed + chars.slice(0, cand.start).join('') + cand.text, pending: chars.slice(cand.end).join('') };
}

// ===== 判定 =====
/**
 * 今の入力が、お題に向かって正しく進んでいるか。
 * 返り値：{ result: 'done'|'prefix'|'ng', rest }。rest は「確定済みの所より後ろ」の区切り（お手本で使う）。
 * norm は判定用に文字をそろえる関数（半角・全角を区別しないレベル用）。確定済みの所はお題の表記と、pending は読みと比べる。
 * pending の最後の1文字は、濁点キー・a/Aキーで目当ての文字にできるなら「途中」とみなす。
 */
export function judge(segs, state, norm = (s) => s) {
    const committed = [...norm(state.committed)];
    const rest = [];  // 確定済みの所より後ろの区切り [{ text, reading, conv }]（途中まで確定した区切りは残りだけ）
    let i = 0;
    for (const seg of segs) {
        const t = [...norm(seg.text)];
        if (i >= committed.length) { rest.push({ ...seg, text: t.join(''), reading: norm(seg.reading) }); continue; }
        const part = committed.slice(i, i + t.length);
        const isPrefix = part.every((c, j) => c === t[j]);
        if (!isPrefix) return { result: 'ng', rest };
        if (part.length === t.length) { i += t.length; continue; }
        // 区切りの途中まで確定：そのまま打つ所なら残りを続ける。変換する所を途中まで確定していたら食い違い
        if (seg.conv) return { result: 'ng', rest };
        rest.push({ ...seg, text: t.slice(part.length).join(''), reading: t.slice(part.length).join('') });
        i += part.length;
    }
    if (i < committed.length) return { result: 'ng', rest };
    const reading = [...rest.map(s => s.reading).join('')];
    const p = [...norm(state.pending)];
    if (p.length > reading.length) return { result: 'ng', rest };
    for (let j = 0; j < p.length - 1; j++) if (p[j] !== reading[j]) return { result: 'ng', rest };
    if (p.length) {
        const last = p.length - 1;
        if (!reachable(p[last], reading[last])) return { result: 'ng', rest };
        if (p[last] !== reading[last]) return { result: 'prefix', rest };
    }
    if (p.length === reading.length && rest.every(s => !s.conv)) return { result: 'done', rest };
    return { result: 'prefix', rest };
}

// ===== お手本（次にすること） =====
// 2026-11-14にアプリの画面からは外した（ユーザー決定）。試作 tools/kb-proto.html と、目安タイムの操作の回数の計算に使うため残す。
// 文字を打てる画面：今の画面にあればそのまま。なければ かな→☆123→ABC の順に探す
const MODE_PREF = ['kana', 'num', 'abc'];
function findKey(mode, ch, norm) {
    for (const k of LAYOUTS[mode]) {
        if (!k.f) continue;
        const i = k.f.findIndex(x => x && (x === ch || norm(x) === ch));
        if (i >= 0) return { keyId: k.id, dir: DIRS[i], base: k.f[0] };
    }
    return null;
}
function baseCharOf(g) {
    const cy = cycleOf(g);
    if (cy) return cy[0];
    if (/[A-Z]/.test(g)) return g.toLowerCase();
    return g;
}

/**
 * 次にすることを1つ返す。{ type: 'key', keyId, dir, need } | { type: 'cand', cand } | { type: 'mode' } | null（打ち終わり）。
 * need は、押したあと濁点キー・a/Aキーで直す必要がある目当ての文字（ないときは空）。
 */
export function nextAction(segs, state, dict, norm = (s) => s) {
    const j = judge(segs, state, norm);
    if (j.result === 'done') return null;
    if (j.result === 'ng') return { type: 'key', keyId: 'del' };
    const reading = [...j.rest.map(s => s.reading).join('')];
    const p = [...norm(state.pending)];
    // 最後の文字を濁点キー・a/Aキーで直す
    if (p.length && p[p.length - 1] !== reading[p.length - 1]) {
        return { type: 'key', keyId: cycleOf(reading[p.length - 1]) ? 'dk' : 'case' };
    }
    // 変換する所を読みの最後まで打ったら、候補から選ぶ
    let pos = 0;
    for (const s of j.rest) {
        const len = [...s.reading].length;
        if (s.conv && pos + len === p.length) {
            const cands = candidatesOf(state.pending, dict);
            const cand = cands.find(c => c.end === p.length && norm(c.text) === s.text && c.start === [...state.pending].length - len);
            return cand ? { type: 'cand', cand } : null;
        }
        pos += len;
        if (pos > p.length) break;
    }
    // 次の文字を打つ
    const g = reading[p.length];
    const base = baseCharOf(g);
    let found = findKey(state.mode, base, norm);
    if (!found) {
        const m = MODE_PREF.find(m => findKey(m, base, norm));
        if (!m) return null;
        return { type: 'mode', to: m };
    }
    return { type: 'key', keyId: found.keyId, dir: found.dir, need: base !== g ? g : '' };
}

/**
 * 専用キーボードで1問を打ち切るまでに押す回数（目安タイムの計算用。2026-11-14）。
 * nextAction のとおりに打ったときの、キー・画面切り替え・候補を押した回数と、候補を選んだ回数を返す。
 * 画面はかなから始める（実際は前の問題の画面のまま続くが、出る順番が毎回変わるので、かなを基準にする）。
 * 返り値：{ taps, picks }
 */
export function countSoftOps(problem, dict, norm = (s) => s) {
    const segs = segmentize(problem);
    let st = newState('kana');
    let taps = 0, picks = 0;
    for (let guard = 0; guard < 1000; guard++) {
        const a = nextAction(segs, st, dict, norm);
        if (!a) break;
        taps++;
        if (a.type === 'mode') st = pressKey(st, 'mode');
        else if (a.type === 'cand') { picks++; st = pickCandidate(st, a.cand); }
        else st = pressKey(st, a.keyId, a.dir);
    }
    return { taps, picks };
}
