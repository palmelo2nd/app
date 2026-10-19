// (1) インポート — なし（Web標準APIのみ使用）

const TOKEN_KEY   = 'typing_pat_token';
const RECORDS_KEY = 'typing_records';
const HISTORY_MAX = 20; // レベルごとに保持するプレイ履歴の件数

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

// (2) インプット — なし  (3) メイン — localStorage読み取り
// (4) アウトプット — { [level]: { best: {ms, misses, date}|null, history: [{ms, misses, date}] } }
export function loadRecords() {
    try {
        return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {};
    } catch (_) {
        return {};
    }
}

// (2) インプット: level, ms（クリアタイム）, misses  (3) メイン — 履歴に追加しベストを更新して保存
// (4) アウトプット — { isBest: boolean, previousBest: {ms, misses, date}|null }
export function addRecord(level, ms, misses) {
    const records = loadRecords();
    const rec = records[level] || { best: null, history: [] };
    const entry = { ms, misses, date: new Date().toISOString() };
    const previousBest = rec.best;
    const isBest = !previousBest || ms < previousBest.ms;
    if (isBest) rec.best = entry;
    rec.history = [entry, ...rec.history].slice(0, HISTORY_MAX);
    records[level] = rec;
    try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    } catch (error) {
        console.warn('記録の保存に失敗しました', error);
    }
    return { isBest, previousBest };
}
