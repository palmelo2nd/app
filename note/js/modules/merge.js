// (1) インポート — noteModel.js（Front Matterの読み書き）
import { parseNote, noteTags } from './noteModel.js?v=6';
//
// 他の端末と同じノートを直していたときの3方向マージ（行単位）。
//   base   … 編集を始めたときの版（GitHub上の版）
//   mine   … この端末で保存しようとした版
//   theirs … 今のGitHub上の版（他の端末が保存したもの）
// 重ならない変更は両方とも取り込む。同じ所を両方が変えていたら、その部分だけ両方を並べた印（<<<<<<< ／ ======= ／ >>>>>>>）を入れる。

export const MARK_MINE   = '<<<<<<< この端末';
export const MARK_SEP    = '=======';
export const MARK_THEIRS = '>>>>>>> 他の端末（GitHub）';
const MAX_CELLS = 4_000_000; // 行数の積がこれを超える大きな差分は自動でまとめない（端末の負担を避ける）

/**
 * baseからotherへの変更を、まとまり（hunk）の配列で返す（最長共通部分列による行の差分）。
 * (4) アウトプット: [{ start, end, lines }]（base[start:end]をlinesに置き換える）。大きすぎるときはnull
 */
function diffHunks(base, other) {
    const n = base.length, m = other.length;
    if ((n + 1) * (m + 1) > MAX_CELLS) return null;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = base[i] === other[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const hunks = [];
    let i = 0, j = 0, cur = null;
    const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
    while (i < n || j < m) {
        if (i < n && j < m && base[i] === other[j]) { flush(); i++; j++; continue; }
        if (!cur) cur = { start: i, end: i, lines: [] };
        if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { cur.lines.push(other[j]); j++; }
        else { i++; cur.end = i; }
    }
    flush();
    return hunks;
}

/** base[from:to]に、その範囲のhunksを当てた行の配列。 */
function applyHunks(base, from, to, hunks) {
    const out = [];
    let k = from;
    hunks.forEach(h => { out.push(...base.slice(k, h.start), ...h.lines); k = h.end; });
    out.push(...base.slice(k, to));
    return out;
}

/**
 * 行の配列どうしの3方向マージ。
 * (4) アウトプット: { lines, conflicts }（conflictsは両方を並べた箇所の数。nullは差分が大きすぎて調べられない）
 */
export function merge3(base, mine, theirs) {
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (same(mine, theirs) || same(theirs, base)) return { lines: mine, conflicts: 0 };
    if (same(mine, base)) return { lines: theirs, conflicts: 0 };
    const A = diffHunks(base, mine), B = diffHunks(base, theirs);
    if (!A || !B) return { lines: null, conflicts: null };

    const all = [...A.map(h => ({ ...h, side: 'A' })), ...B.map(h => ({ ...h, side: 'B' }))]
        .sort((x, y) => x.start - y.start || x.end - y.end);
    const out = [];
    let pos = 0, conflicts = 0, idx = 0;
    while (idx < all.length) {
        // 重なる（接する）変更をひとまとまりの範囲にする
        const region = [all[idx]];
        let rStart = all[idx].start, rEnd = all[idx].end;
        idx++;
        while (idx < all.length && all[idx].start <= rEnd) {
            region.push(all[idx]);
            rEnd = Math.max(rEnd, all[idx].end);
            idx++;
        }
        out.push(...base.slice(pos, rStart));
        const a = region.filter(h => h.side === 'A'), b = region.filter(h => h.side === 'B');
        const aLines = applyHunks(base, rStart, rEnd, a);
        const bLines = applyHunks(base, rStart, rEnd, b);
        if (b.length === 0) out.push(...aLines);
        else if (a.length === 0) out.push(...bLines);
        else if (same(aLines, bLines)) out.push(...aLines);
        else {
            conflicts++;
            out.push(MARK_MINE, ...aLines, MARK_SEP, ...bLines, MARK_THEIRS);
        }
        pos = rEnd;
    }
    out.push(...base.slice(pos));
    return { lines: out, conflicts };
}

/**
 * ノート（ファイル全文）どうしの3方向マージ。属性は「他の端末の版」を土台に、この端末で変えた題名・分類・タグを上書きする。
 * (2) インプット: baseText, mineText, theirsText（いずれもファイル全文）
 * (4) アウトプット: { meta, body, conflicts }（conflicts: 0＝自動でまとまった、1以上＝並べた箇所の数、null＝調べられない）
 */
export function mergeNoteTexts(baseText, mineText, theirsText) {
    const base = parseNote(baseText), mine = parseNote(mineText), theirs = parseNote(theirsText);
    const meta = { ...theirs.meta };
    const changed = (k) => JSON.stringify(k === 'tags' ? noteTags(mine) : mine.meta[k] ?? '') !== JSON.stringify(k === 'tags' ? noteTags(base) : base.meta[k] ?? '');
    ['title', 'category', 'tags'].forEach(k => { if (changed(k)) meta[k] = mine.meta[k]; });
    const split = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
    const { lines, conflicts } = merge3(split(base.body), split(mine.body), split(theirs.body));
    return { meta, body: lines ? lines.join('\n') : null, conflicts };
}

/** 本文に並べた印が残っているか（保存の前の確認用）。 */
export function hasConflictMarks(body) {
    return String(body || '').split('\n').some(l => l === MARK_MINE || l === MARK_THEIRS);
}
