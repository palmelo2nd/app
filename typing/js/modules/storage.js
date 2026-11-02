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

// 端末内の記録は、選んでいるプレイ名ごとに分けて保存する（1台を複数人で使い分けても混ざらないように。v23〜）。
// v22までの名前なしの記録（typing_records）は、最初に読み込んだときの名前の記録として1回だけ引き継ぐ。
function recordsKey() {
    const name = loadPlayerName();
    if (!name) return RECORDS_KEY;
    const key = RECORDS_KEY + ':' + name;
    try {
        const legacy = localStorage.getItem(RECORDS_KEY);
        if (legacy && localStorage.getItem(key) === null) {
            localStorage.setItem(key, legacy);
            localStorage.removeItem(RECORDS_KEY);
        }
    } catch (_) { /* 引き継げなくても新しい記録は保存できる */ }
    return key;
}

// (2) インプット — なし  (3) メイン — localStorage読み取り（選んでいるプレイ名の記録）
// (4) アウトプット — { [level]: { best: {ms, misses, date}|null, history: [{ms, misses, date}] } }
export function loadRecords() {
    try {
        return JSON.parse(localStorage.getItem(recordsKey())) || {};
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
        localStorage.setItem(recordsKey(), JSON.stringify(records));
    } catch (error) {
        console.warn('記録の保存に失敗しました', error);
    }
    return { isBest, previousBest };
}

// ===== プレイ名・未送信の記録・共有記録のキャッシュ =====

const NAME_KEY    = 'typing_player_name';
const PENDING_KEY = 'typing_pending_plays';
const SHARED_KEY  = 'typing_cache_records';

export function loadPlayerName() {
    return localStorage.getItem(NAME_KEY) || '';
}

export function savePlayerName(name) {
    localStorage.setItem(NAME_KEY, name);
    if (name) addPlayerName(name);
}

// この端末で登録した名前の一覧（2回目以降はボタンで選べるように）
const NAMES_KEY = 'typing_player_names';

export function loadPlayerNames() {
    try {
        return JSON.parse(localStorage.getItem(NAMES_KEY)) || [];
    } catch (_) {
        return [];
    }
}

function addPlayerName(name) {
    const names = loadPlayerNames();
    if (names.includes(name)) return;
    try { localStorage.setItem(NAMES_KEY, JSON.stringify([...names, name])); } catch (_) { /* 一覧に残せなくても遊べる */ }
}

// 解説の既読（読んだ解説のID）。名前ごとではなく端末ごと
const GUIDE_READ_KEY = 'typing_guides_read';

export function loadGuidesRead() {
    try {
        return JSON.parse(localStorage.getItem(GUIDE_READ_KEY)) || [];
    } catch (_) {
        return [];
    }
}

export function markGuideRead(id) {
    const read = loadGuidesRead();
    if (read.includes(id)) return;
    try { localStorage.setItem(GUIDE_READ_KEY, JSON.stringify([...read, id])); } catch (_) { /* 既読にできなくても読める */ }
}

// 通信できず共有に送れなかったプレイ（次の「読込」や次のプレイ後に再送する）
export function loadPending() {
    try {
        return JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
    } catch (_) {
        return [];
    }
}

export function savePending(list) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

// 共有記録（playData配列）の端末内キャッシュ。オフライン時のランキング表示用
export function loadSharedCache() {
    try {
        return JSON.parse(localStorage.getItem(SHARED_KEY)) || [];
    } catch (_) {
        return [];
    }
}

export function saveSharedCache(playData) {
    try {
        localStorage.setItem(SHARED_KEY, JSON.stringify(playData));
    } catch (error) {
        console.warn('共有記録のキャッシュに失敗しました', error);
    }
}

// レベル一覧の表示切替（'me'＝自分の記録／'all'＝みんなのベスト）。端末ごとに覚えておくだけ
const VIEW_KEY = 'typing_grid_view';

export function loadGridView() {
    try { return localStorage.getItem(VIEW_KEY) === 'all' ? 'all' : 'me'; } catch (_) { return 'me'; }
}

export function saveGridView(view) {
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) { /* 保存できなくても表示は切り替わる */ }
}

// (3) メイン — この端末内のプレイ記録・未送信・共有キャッシュを消す（トークンとプレイ名は残す）
export function clearLocalRecords() {
    const recordKeys = Object.keys(localStorage).filter(k => k === RECORDS_KEY || k.startsWith(RECORDS_KEY + ':'));
    [...recordKeys, PENDING_KEY, SHARED_KEY].forEach(k => localStorage.removeItem(k));
}
