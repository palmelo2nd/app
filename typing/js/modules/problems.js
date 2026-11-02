// (1) インポート — レベル定義（levels.js）
import { LEVEL_DEFS } from './levels.js?v=36';

// 出題・ランクの仕組み。お題の中身とレベルの追加は levels.js 側で行う。

// 予定している全レベル数（レベル一覧のマスの数。未作成のレベルは「準備中」と表示）
export const PLANNED_LEVELS = 100;

export const QUESTION_COUNT = 10; // 標準の問題数（参考値。実際の問題数は各レベルのお題の個数）

// 目安秒数を自動計算するときの、1操作あたりの秒数。実際のプレイ感に合わせて調整する。
const SECONDS_PER_OP = { SSS: 0.5, SS: 0.8, S: 1.0, A: 1.5, B: 2.0 };

// 操作の回数：清音1／濁音2（か＋゛）／半濁音3（は＋゛゜2回）／小さい文字2（つ＋小）／句読点「、」「。」2（操作は1回だが、キーを探す時間を見込む）。1問ごとに確定（↵）の+1を足す。
// カタカナは読みのひらがなに直して数え（長音「ー」は1）、ひと続きのカタカナごとに変換の2（候補を選ぶ1回＋探す時間）を足す。
// 漢字のお題は読み（yomi）で数え、ひと続きの漢字ごとに変換の2を足す。同じ読みの漢字を選ぶレベルは opsPerConversion: 3（候補を探す時間を見込む）。
// 全角数字は、確定前に候補から選ぶので変換の2を足す（iPhoneは数字を打って確定すると半角になる）。
// 数字は1字1、ひと続きの数字ごとに画面の切り替え3（かな→「ABC」→「☆123」の2回＋戻る「あいう」1回）を足す。
const DAKUTEN = String.fromCharCode(0x3099);    // 「゛」（文字を分解したときの濁点）
const HANDAKUTEN = String.fromCharCode(0x309A); // 「゜」
const SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎ';
const PUNCT = '、。';
function opsOfChar(c) {
    if (SMALL_KANA.includes(c) || PUNCT.includes(c)) return 2;
    const mark = c.normalize('NFD').slice(1);
    if (mark === '\u3099') return 2; // 濁音
    if (mark === '\u309A') return 3; // 半濁音
    return 1;
}

const OPS_PER_CONVERSION = 2;
const KATAKANA_RUN = /[ァ-ヶー]+/g; // 長音「ー」もカタカナの続きとして扱う（ー＝わを右へ、1操作）
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

const KANJI_RUN = /[一-鿿々]+/g;     // 漢字もひと続きごとに変換1回
const DIGIT_RUN = /[0-9０-９]+/g;
const OPS_PER_NUMBER_SWITCH = 3;
const FULLWIDTH_DIGIT_RUN = /[０-９]+/g;

/** お題の答え（画面に出す文字列）。漢字のお題は { text, yomi }、それ以外は文字列。 */
export const textOf = (p) => (typeof p === 'string' ? p : p.text);
/** お題の読み（実際に打つかな）。漢字のお題は yomi、それ以外は答えそのもの。 */
export const yomiOf = (p) => (typeof p === 'string' ? p : p.yomi);

/** 1問を打ち切るまでの操作の回数（確定・変換を含む）。読みで数え、カタカナ・漢字のひと続きごとに変換を足す。 */
export function opsOf(p, opsPerConversion = OPS_PER_CONVERSION) {
    const text = textOf(p);
    const conversions = (text.match(KATAKANA_RUN) || []).length + (text.match(KANJI_RUN) || []).length
        + (text.match(FULLWIDTH_DIGIT_RUN) || []).length;
    const numberRuns = (yomiOf(p).match(DIGIT_RUN) || []).length;
    return [...toHiragana(yomiOf(p))].reduce((sum, c) => sum + opsOfChar(c), 0) + 1 + conversions * opsPerConversion
        + numberRuns * OPS_PER_NUMBER_SWITCH;
}

const toHalfWidthDigits = (s) => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

/** 判定用に、打った文字列をそろえる。anyWidth のレベルは全角数字を半角に直す（お題は半角で書く）。 */
export function normalizeTyped(level, value) {
    return defOf(level)?.anyWidth ? toHalfWidthDigits(value) : value;
}

/** widthLabel のレベルで、お題の下に出す「半角」「全角」（数字を含まないお題や他のレベルは空文字）。 */
export function widthLabelOf(level, answer) {
    if (!defOf(level)?.widthLabel) return '';
    if (/[０-９]/.test(answer)) return '全角';
    return /[0-9]/.test(answer) ? '半角' : '';
}

/** 画面表示用のレベル一覧。chars は累積の全体、addedChars は前のレベルからの追加分。 */
export const LEVELS = LEVEL_DEFS.map((def, i) => {
    const prev = i > 0 ? new Set([...LEVEL_DEFS[i - 1].chars]) : new Set();
    return {
        level: def.level,
        label: 'レベル' + def.level,
        desc: def.name,
        chars: def.chars,
        addedChars: [...def.chars].filter(c => !prev.has(c)).join(''),
    };
});

function defOf(level) {
    return LEVEL_DEFS.find(d => d.level === level);
}

function totalOps(def) {
    return def.problems.reduce((sum, p) => sum + opsOf(p, def.opsPerConversion), 0);
}

// ランクは上位から SSS > SS > S > A > B > C。目標を達成しなければ C。
export const RANK_ORDER = ['SSS', 'SS', 'S', 'A', 'B'];

/** レベルごとの目安秒数 { SSS, SS, S, A, B }（そのレベルの全問を打ち切るまでの秒数）。 */
export const RANK_TIMES = Object.fromEntries(LEVEL_DEFS.map(def => {
    if (def.rank) return [def.level, def.rank];
    const base = totalOps(def);
    return [def.level, Object.fromEntries(RANK_ORDER.map(r => [r, Math.round(base * SECONDS_PER_OP[r])]))];
}));

/**
 * 指定レベルの出題。固定のお題（10語や15語、文のレベルは3〜5文）を、毎回ランダムな順番に並べて返す（語は変わらず順番だけが変わる）。
 * 操作の回数の合計は毎回同じなので、タイムの公平さは保たれる。
 * (2) インプット: level  (4) アウトプット: string[]
 */
export function pickQuestions(level) {
    const words = (defOf(level)?.problems || []).map(textOf);
    for (let i = words.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [words[i], words[j]] = [words[j], words[i]];
    }
    return words;
}

/** タイム（ミリ秒）からランク（S/A/B/C）を返す。 */
export function rankFor(level, ms) {
    const t = RANK_TIMES[level];
    if (!t) return '';
    for (const r of RANK_ORDER) if (ms / 1000 <= t[r]) return r;
    return 'C';
}

// 次のレベルが開くのに必要なランク（前のレベルの自己ベストがこのランク以上であること）
export const UNLOCK_RANK = 'A';

/** タイム（ミリ秒）が、指定ランク（minRank）以上かどうか。 */
export function isRankAtLeast(level, ms, minRank) {
    const r = rankFor(level, ms);
    const idx = RANK_ORDER.indexOf(r);
    return idx >= 0 && idx <= RANK_ORDER.indexOf(minRank);
}

/** 経過ミリ秒に対して、次に狙えるランクと残り秒数を返す。B内に収まらなくなったら null。 */
export function nextRankTarget(level, elapsedMs) {
    const t = RANK_TIMES[level];
    if (!t) return null;
    for (const r of RANK_ORDER) {
        const remain = t[r] - elapsedMs / 1000;
        if (remain >= 0) return { rank: r, remain };
    }
    return null;
}
