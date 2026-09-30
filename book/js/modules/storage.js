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

// ===== 図版（ページ画像）のキャッシュ =====
// キーはGitHub上のパス（例: book/b01_論理学/images/p0231.png）そのもの。
// 本文と違いSHAでの差分比較はせず、一度取得したdata URLをそのまま使い回す（図版は転記後に変更されない前提のため）。

function imageKey(path) { return `book_cache_image_${path}`; }

// (2) インプット: path  (3) メイン — localStorage読み取り  (4) アウトプット — data URL文字列 or null
export function loadImageCache(path) {
    return localStorage.getItem(imageKey(path));
}

// (2) インプット: path, dataUrl  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveImageCache(path, dataUrl) {
    try {
        localStorage.setItem(imageKey(path), dataUrl);
    } catch (error) {
        // 容量超過（QuotaExceededError）時は画像キャッシュを諦める。本文・既読データの保存を妨げないよう握りつぶす
        console.warn('画像キャッシュの保存に失敗しました（容量超過の可能性）', error);
    }
}
