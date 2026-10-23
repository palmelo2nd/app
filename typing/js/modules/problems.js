// (1) インポート — レベル定義（levels.js）
import { LEVEL_DEFS } from './levels.js?v=18';

// 出題・ランクの仕組み。お題の中身とレベルの追加は levels.js 側で行う。

export const QUESTION_COUNT = 10; // 1回のタイムアタックの問題数（固定。各レベルのお題もこの数ちょうど）

// 目安秒数を自動計算するときの、1文字あたりの秒数（S/A/B）。実際のプレイ感に合わせて調整する。
const SECONDS_PER_CHAR = { SSS: 0.5, SS: 0.8, S: 1.0, A: 1.5, B: 2.0 };

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

function averageLength(def) {
    const total = def.problems.reduce((sum, p) => sum + [...p].length, 0);
    return total / def.problems.length;
}

// ランクは上位から SSS > SS > S > A > B > C。目標を達成しなければ C。
export const RANK_ORDER = ['SSS', 'SS', 'S', 'A', 'B'];

/** レベルごとの目安秒数 { SSS, SS, S, A, B }（10問を打ち切るまでの秒数）。 */
export const RANK_TIMES = Object.fromEntries(LEVEL_DEFS.map(def => {
    if (def.rank) return [def.level, def.rank];
    const base = averageLength(def) * QUESTION_COUNT;
    return [def.level, Object.fromEntries(RANK_ORDER.map(r => [r, Math.round(base * SECONDS_PER_CHAR[r])]))];
}));

/**
 * 指定レベルの出題。固定の10語を、毎回ランダムな順番に並べて返す（語は変わらず順番だけが変わる）。
 * 10語の文字数の合計は毎回同じなので、タイムの公平さは保たれる。
 * (2) インプット: level  (4) アウトプット: string[]
 */
export function pickQuestions(level) {
    const words = [...(defOf(level)?.problems || [])];
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
