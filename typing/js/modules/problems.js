// (1) インポート — レベル定義（levels.js）、専用キーボードの押す回数（kbCore.js）
import { LEVEL_DEFS } from './levels.js?v=58';
import { buildDict, countSoftOps } from './kbCore.js?v=58';

// 出題・ランクの仕組み。お題の中身とレベルの追加は levels.js 側で行う。

// 予定している全レベル数（レベル一覧のマスの数。未作成のレベルは「準備中」と表示）
export const PLANNED_LEVELS = 100;

export const QUESTION_COUNT = 10; // 標準の問題数（参考値。実際の問題数は各レベルのお題の個数）

// 目安秒数を自動計算するときの、1操作あたりの秒数。実際のプレイ感に合わせて調整する。
// SSSは慣れた人でも厳しめ、合格のAは1操作1秒のイメージ（2026-11-03見直し）。Dを超えるとE。
const SECONDS_PER_OP = { SSS: 0.45, SS: 0.6, S: 0.8, A: 1.0, B: 1.3, C: 1.6, D: 2.0 };

// 操作の回数：清音1／濁音2（か＋゛）／半濁音3（は＋゛゜2回）／小さい文字2（つ＋小）／句読点「、」「。」1.5（操作1回＋キーを探す時間0.5）。1問ごとに確定（↵）の+0.5を足す。
// カタカナは読みのひらがなに直して数え（長音「ー」は1.5＝操作1回＋探す時間0.5）、ひと続きのカタカナごとに変換の2（候補を選ぶ1回＋探す時間）を足す。
// 漢字のお題は読み（yomi）で数え、ひと続きの漢字ごとに変換の2を足す。同じ読みの漢字を選ぶレベルは opsPerConversion: 3（候補を探す時間を見込む）。
// 全角数字は、確定前に候補から選ぶので変換の2を足す（iPhoneは数字を打って確定すると半角になる）。
// 数字は1字1、ひと続きの数字ごとに画面の切り替え2（かな→「ABC」→「☆123」→「あいう」）を足す。
// 記号（： ／ ～ ・ - 「」（））は1つ2（フリック1回＋キーを探す時間）。「」以外は数字と同じ「☆123」の画面で打つので、数字・記号のひと続きで切り替え2を1回足す。
// 「」はかなの画面の「や」を左右にはらって打てる（iPhoneで確認、2026-11-03）ので、画面の切り替えは足さない。
// 英字は小文字1.5（操作1回＋キーを探す時間0.5）・大文字2.5（文字1.5＋「a/A」1）。ひと続きの英字ごとに画面の切り替え2（かな→「ABC」、戻りは「☆123」→「あいう」）を足す。
// ＠と「.」は英字の画面で打つ記号（1つ2）。英字のひと続きに含め、画面の切り替えは増やさない。
// ％・♪・☆も記号として1つ2（♪☆は☆123の「1」のキー）。※はキーに無いので「こめ」と打って変換する（読みは yomi に「こめ」と書き、※ごとに変換の2を足す）。
const DAKUTEN = String.fromCharCode(0x3099);    // 「゛」（文字を分解したときの濁点）
const HANDAKUTEN = String.fromCharCode(0x309A); // 「゜」
const SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎ';
const PUNCT = '、。';
const SYMBOLS = ':/～・-「」（）%☆♪@.';
function opsOfChar(c) {
    if (PUNCT.includes(c) || c === 'ー') return 1.5;
    if (/[A-Z]/.test(c)) return 2.5; // 英字の大文字（文字1.5＋「a/A」1）
    if (/[a-z]/.test(c)) return 1.5; // 英字の小文字（操作1回＋キーを探す時間0.5）
    if (SMALL_KANA.includes(c) || SYMBOLS.includes(c)) return 2;
    const mark = c.normalize('NFD').slice(1);
    if (mark === '\u3099') return 2; // 濁音
    if (mark === '\u309A') return 3; // 半濁音
    return 1;
}

const OPS_PER_CONVERSION = 2;
const KATAKANA_RUN = /[ァ-ヶー]+/g; // 長音「ー」もカタカナの続きとして扱う（ー＝わを右へ、1操作）
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

const KANJI_RUN = /[一-鿿々]+/g;     // 漢字もひと続きごとに変換1回
const DIGIT_RUN = /[0-9０-９:/～・（）%☆♪-]+/g; // 数字と記号（☆123の画面で打つもの）のひと続き
const OPS_PER_NUMBER_SWITCH = 2;
const OPS_PER_ENTER = 0.5; // 確定（↵）
const FULLWIDTH_DIGIT_RUN = /[０-９]+/g;
const ALPHA_RUN = /[A-Za-z@.]+/g; // 英字のひと続き（英字の画面で打つ＠と「.」を含む）
const OPS_PER_ALPHA_SWITCH = 2;
const CONVERTED_SYMBOL = /※/g; // 変換で出す記号

/** お題の答え（画面に出す文字列）。漢字のお題は { text, yomi }、それ以外は文字列。 */
export const textOf = (p) => (typeof p === 'string' ? p : p.text);
/** お題の読み（実際に打つかな）。漢字のお題は yomi、それ以外は答えそのもの。 */
export const yomiOf = (p) => (typeof p === 'string' ? p : p.yomi);

/** 1問を打ち切るまでの操作の回数（確定・変換を含む）。読みで数え、カタカナ・漢字のひと続きごとに変換を足す。 */
export function opsOf(p, opsPerConversion = OPS_PER_CONVERSION) {
    const text = textOf(p);
    const conversions = (text.match(KATAKANA_RUN) || []).length + (text.match(KANJI_RUN) || []).length
        + (text.match(FULLWIDTH_DIGIT_RUN) || []).length + (text.match(CONVERTED_SYMBOL) || []).length;
    const numberRuns = (yomiOf(p).match(DIGIT_RUN) || []).length;
    const alphaRuns = (yomiOf(p).match(ALPHA_RUN) || []).length;
    return [...toHiragana(yomiOf(p))].reduce((sum, c) => sum + opsOfChar(c), 0) + OPS_PER_ENTER + conversions * opsPerConversion
        + numberRuns * OPS_PER_NUMBER_SWITCH + alphaRuns * OPS_PER_ALPHA_SWITCH;
}

const toHalfWidthDigits = (s) => s.replace(/[０-９：／－％Ａ-Ｚａ-ｚ＠．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const toSymbolForms = (s) => s.replace(/[~〜]/g, '～').replace(/･/g, '・').replace(/[‐−]/g, '-')
    .replaceAll('(', '（').replaceAll(')', '）').replace(/｢/g, '「').replace(/｣/g, '」');
// 〜・~は「～」、半角の･は「・」、‐（ハイフン）・−（マイナス）は「-」、半角の()｢｣は全角の（）「」と同じとみなす

/** 判定用に、打った文字列をそろえる。anyWidth のレベルは全角の数字・記号・英字を半角に直す（お題は半角で書く。～・「」（）は全角で書く）。 */
export function normalizeTyped(level, value) {
    return defOf(level)?.anyWidth ? toSymbolForms(toHalfWidthDigits(value)) : value;
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

// ランクは上位から SSS > SS > S > A > B > C > D > E。Dの目安を超えると E。
export const RANK_ORDER = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D'];

const timesOf = (base) => Object.fromEntries(RANK_ORDER.map(r => [r, Math.round(base * SECONDS_PER_OP[r])]));

/** レベルごとの目安秒数 { SSS, SS, S, A, B, C, D }（そのレベルの全問を打ち切るまでの秒数）。ストア版では useSoftKeyboardRankTimes で専用キーボード用に置きかえる。 */
export const RANK_TIMES = Object.fromEntries(LEVEL_DEFS.map(def => [def.level, def.rank || timesOf(totalOps(def))]));

// ===== 専用キーボード用の目安（2026-11-14） =====
// 専用キーボードは確定（↵）が要らず、変換は候補を1回押すだけ、画面の切り替えは実際に押す回数になる。
// そこで「実際に押す回数（kbCore の countSoftOps）＋キーや候補を探す時間」で数える。探す時間は自分のキーボードの目安と同じ決まり：
// 句読点・「ー」・英字は1字0.5、記号は1字1、候補を選ぶのは1回につき（変換の操作数−1）＝ふつう1、同じ読みの漢字を選ぶレベルは2。
const SEARCH_HALF = /[、。ーA-Za-z]/;
function softOpsOf(p, def, dict) {
    const { taps, picks } = countSoftOps(p, dict, (v) => normalizeTyped(def.level, v));
    let search = picks * ((def.opsPerConversion || OPS_PER_CONVERSION) - 1);
    for (const c of yomiOf(p)) {
        if (SEARCH_HALF.test(c)) search += 0.5;
        else if (SYMBOLS.includes(c)) search += 1;
    }
    return taps + search;
}

/** 専用キーボードで1レベルを打ち切るまでの操作の回数（探す時間を含む）。 */
export function softTotalOps(def, dict) {
    return def.problems.reduce((sum, p) => sum + softOpsOf(p, def, dict), 0);
}

/** ストア版（専用キーボードだけ）で、目安秒数を専用キーボード用に置きかえる。rank を明示したレベルはそのまま。 */
export function useSoftKeyboardRankTimes() {
    const dict = buildDict(LEVEL_DEFS.flatMap(d => d.problems));
    for (const def of LEVEL_DEFS) if (!def.rank) RANK_TIMES[def.level] = timesOf(softTotalOps(def, dict));
}

/**
 * 指定レベルの出題。固定のお題（10語や15語、文のレベルは3〜5文）を、毎回ランダムな順番に並べて返す（語は変わらず順番だけが変わる）。
 * 操作の回数の合計は毎回同じなので、タイムの公平さは保たれる。
 * (2) インプット: level  (4) アウトプット: string[]
 */
export function pickQuestions(level) {
    return pickProblems(level).map(textOf);
}

/** pickQuestions と同じ並べ方で、お題をそのまま（漢字のお題は { text, yomi } のまま）返す。専用キーボードは読みを使うため。 */
export function pickProblems(level) {
    const words = [...(defOf(level)?.problems || [])];
    for (let i = words.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [words[i], words[j]] = [words[j], words[i]];
    }
    return words;
}

/** タイム（ミリ秒）からランク（SSS〜E）を返す。 */
export function rankFor(level, ms) {
    const t = RANK_TIMES[level];
    if (!t) return '';
    for (const r of RANK_ORDER) if (ms / 1000 <= t[r]) return r;
    return 'E';
}

// 次のレベルが開くのに必要なランク（前のレベルの自己ベストがこのランク以上であること）
export const UNLOCK_RANK = 'A';

/** タイム（ミリ秒）が、指定ランク（minRank）以上かどうか。 */
export function isRankAtLeast(level, ms, minRank) {
    const r = rankFor(level, ms);
    const idx = RANK_ORDER.indexOf(r);
    return idx >= 0 && idx <= RANK_ORDER.indexOf(minRank);
}

/** 経過ミリ秒に対して、次に狙えるランクと残り秒数を返す。D内に収まらなくなったら null。 */
export function nextRankTarget(level, elapsedMs) {
    const t = RANK_TIMES[level];
    if (!t) return null;
    for (const r of RANK_ORDER) {
        const remain = t[r] - elapsedMs / 1000;
        if (remain >= 0) return { rank: r, remain };
    }
    return null;
}
