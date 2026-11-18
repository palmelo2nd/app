// (1) インポート — なし（Web標準APIのみ使用）
// 操作ノートの端末内の保存（localStorage）。キーはすべて opnote_ で始める。

const TOKEN_KEY = 'opnote_pat_token';
const NAME_KEY  = 'opnote_my_name';
const CACHE_CONTENT_KEY = 'opnote_cache_content';
const CACHE_SHA_KEY     = 'opnote_cache_sha';
const LAST_KEY = 'opnote_last';   // 最後に開いていた分類と項目（次に開いたとき続きから）

function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { console.warn('端末への保存に失敗しました', key, error); }
}

// トークンはIndexが用途ごとに書き込む。無ければ日記のトークンを使う
export function loadToken() {
    return safeGet(TOKEN_KEY) || safeGet('diary_pat_token');
}

export function saveToken(token) {
    safeSet(TOKEN_KEY, token);
}

// 書いた人の名前。未設定ならスキルマップ・日記で設定した名前を使う
export function loadMyName() {
    return safeGet(NAME_KEY) || safeGet('skillmap_my_name') || safeGet('diary_my_name') || '';
}

export function saveMyName(name) {
    safeSet(NAME_KEY, name);
}

export function loadCache() {
    const content = safeGet(CACHE_CONTENT_KEY);
    return content ? { content, sha: safeGet(CACHE_SHA_KEY) || '' } : null;
}

export function saveCache(content, sha) {
    safeSet(CACHE_CONTENT_KEY, content);
    safeSet(CACHE_SHA_KEY, sha || '');
}

export function loadLast() {
    try { return JSON.parse(safeGet(LAST_KEY)) || {}; } catch (_) { return {}; }
}

export function saveLast(value) {
    safeSet(LAST_KEY, JSON.stringify(value));
}
