// キーはdreams.md用（id='dreams'）／マップ集ごとのファイル用（id=マップ集ID）で共用できるよう汎用化している。

const TOKEN_KEY = 'dream_pat_token';
// 同じ端末でbookアプリのトークンを入力済みなら、初回だけそれを流用する（同一オリジンのlocalStorageのため）
const FALLBACK_TOKEN_KEY = 'book_pat_token';

function contentKey(id) { return `dream_cache_content_${id}`; }
function shaKey(id)     { return `dream_cache_sha_${id}`; }

export function loadToken() {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(FALLBACK_TOKEN_KEY);
}

export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function loadCache(id) {
    const content = localStorage.getItem(contentKey(id));
    const sha     = localStorage.getItem(shaKey(id));
    if (!content) return null;
    return { content, sha };
}

export function saveCache(id, content, sha) {
    localStorage.setItem(contentKey(id), content);
    localStorage.setItem(shaKey(id),     sha);
}
