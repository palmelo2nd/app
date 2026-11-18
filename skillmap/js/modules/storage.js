// (1) インポート — なし（Web標準APIのみ使用）
// スキルマップの端末内の保存（localStorage）。キーはすべて skillmap_ で始める。

const TOKEN_KEY = 'skillmap_pat_token';
const NAME_KEY  = 'skillmap_my_name';
const CACHE_CONTENT_KEY = 'skillmap_cache_content';
const CACHE_SHA_KEY     = 'skillmap_cache_sha';

function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { console.warn('端末への保存に失敗しました', key, error); }
}

// トークンはIndexが用途ごとに書き込む。無ければ日記のトークンを使う（同じ人が同じ端末で使うため）
export function loadToken() {
    return safeGet(TOKEN_KEY) || safeGet('diary_pat_token');
}

export function saveToken(token) {
    safeSet(TOKEN_KEY, token);
}

// 書いた人の名前。未設定なら日記アプリで設定した名前を使う
export function loadMyName() {
    return safeGet(NAME_KEY) || safeGet('diary_my_name') || '';
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
