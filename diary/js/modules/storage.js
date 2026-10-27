// (1) インポート — なし（Web標準APIのみ使用）
// キーは年一覧用（id='years'）／年ごとのファイル用（id=西暦4桁）で共用できるよう汎用化している。

const TOKEN_KEY     = 'diary_pat_token';
const NAME_KEY      = 'diary_my_name';
const OLD_NAME_KEY  = 'diary_last_author'; // v1の「前回の投稿者名」。設定の名前の初期値として引き継ぐ
const LAST_SEEN_KEY = 'diary_last_seen';
const DRAFT_KEY     = 'diary_draft';

function contentKey(id) { return `diary_cache_content_${id}`; }
function shaKey(id)     { return `diary_cache_sha_${id}`; }

function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { console.warn('端末への保存に失敗しました', key, error); }
}
function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* 何もしない */ }
}

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return safeGet(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveToken(token) {
    safeSet(TOKEN_KEY, token);
}

// (2) インプット: id  (3) メイン — localStorage読み取り  (4) アウトプット — { content, sha } or null
export function loadCache(id) {
    const content = safeGet(contentKey(id));
    const sha     = safeGet(shaKey(id));
    if (!content) return null;
    return { content, sha };
}

// (2) インプット: id, content, sha  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveCache(id, content, sha) {
    safeSet(contentKey(id), content);
    safeSet(shaKey(id),     sha || '');
}

// ===== 設定：自分の名前（この端末で記憶） =====

export function loadMyName() {
    return safeGet(NAME_KEY) || safeGet(OLD_NAME_KEY) || '';
}

export function saveMyName(name) {
    safeSet(NAME_KEY, name);
}

// ===== 新着の印：前回開いた時刻（'YYYY/MM/DD HH:MM:SS'）。未保存なら '' =====

export function loadLastSeen() {
    return safeGet(LAST_SEEN_KEY) || '';
}

export function saveLastSeen(stamp) {
    safeSet(LAST_SEEN_KEY, stamp);
}

// ===== 下書き：新しく書く記事（{ date, body }）とコメント（記事IDごと） =====

function loadDrafts() {
    try { return JSON.parse(safeGet(DRAFT_KEY)) || {}; } catch (_) { return {}; }
}

/** key: 'post'（新しい記事）または 'comment:<記事ID>'。値は文字列またはオブジェクト。 */
export function loadDraft(key) {
    return loadDrafts()[key] ?? null;
}

export function saveDraft(key, value) {
    const drafts = loadDrafts();
    if (value === null || value === '' || (typeof value === 'object' && !value.body)) delete drafts[key];
    else drafts[key] = value;
    if (Object.keys(drafts).length === 0) safeRemove(DRAFT_KEY);
    else safeSet(DRAFT_KEY, JSON.stringify(drafts));
}
