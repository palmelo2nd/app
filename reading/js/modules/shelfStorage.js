// readingの「dream」「rules」「log」用のLocalStorageキャッシュ（旧dreamアプリのstorage.jsを移した）。
// idには機能ごとの接頭辞（dream_・rules_・log_）を付けて渡す。キーの頭は reading_ で、旧dreamのキャッシュとは混ざらない。
// トークンはbookと共通（book_pat_token）。旧dreamだけで入力していた端末は、初回だけ dream_pat_token を流用する。

const TOKEN_KEY = 'book_pat_token';
const FALLBACK_TOKEN_KEY = 'dream_pat_token';

function contentKey(id) { return `reading_cache_content_${id}`; }
function shaKey(id)     { return `reading_cache_sha_${id}`; }

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
