// (1) インポート — なし（Web標準APIのみ使用）
// キーはbooks.md用（id='books'）／本ごとのファイル用（id=書籍ID）で共用できるよう汎用化している。

const TOKEN_KEY = 'book_pat_token';

function contentKey(id) { return `book_cache_content_${id}`; }
function shaKey(id)     { return `book_cache_sha_${id}`; }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

// (2) インプット: id（'books' または 書籍ID）  (3) メイン — localStorage読み取り  (4) アウトプット — { content, sha } or null
export function loadCache(id) {
    const content = localStorage.getItem(contentKey(id));
    const sha     = localStorage.getItem(shaKey(id));
    if (!content) return null;
    return { content, sha };
}

// (2) インプット: id, content, sha  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveCache(id, content, sha) {
    localStorage.setItem(contentKey(id), content);
    localStorage.setItem(shaKey(id),     sha);
}
