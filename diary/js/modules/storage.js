// (1) インポート — なし（Web標準APIのみ使用）
// キーは年一覧用（id='years'）／年ごとのファイル用（id=西暦4桁）で共用できるよう汎用化している。

const TOKEN_KEY  = 'diary_pat_token';
const AUTHOR_KEY = 'diary_last_author';

function contentKey(id) { return `diary_cache_content_${id}`; }
function shaKey(id)     { return `diary_cache_sha_${id}`; }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

// (2) インプット: id  (3) メイン — localStorage読み取り  (4) アウトプット — { content, sha } or null
export function loadCache(id) {
    const content = localStorage.getItem(contentKey(id));
    const sha     = localStorage.getItem(shaKey(id));
    if (!content) return null;
    return { content, sha };
}

// (2) インプット: id, content, sha  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveCache(id, content, sha) {
    localStorage.setItem(contentKey(id), content);
    localStorage.setItem(shaKey(id),     sha || '');
}

// 前回の投稿者名（入力欄の初期値）
export function loadLastAuthor() {
    return localStorage.getItem(AUTHOR_KEY) || '';
}

export function saveLastAuthor(name) {
    localStorage.setItem(AUTHOR_KEY, name);
}
