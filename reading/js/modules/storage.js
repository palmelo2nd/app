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
    try {
        localStorage.setItem(contentKey(id), content);
        localStorage.setItem(shaKey(id),     sha);
    } catch (error) {
        // 容量超過（全アプリで約5MBを共有）。ここで失敗しても読込そのものは成功扱いにする（端末に保存した本はCache Storage側にある）
        localStorage.removeItem(contentKey(id));
        localStorage.removeItem(shaKey(id));
        console.warn('本文の一時キャッシュを保存できませんでした（容量超過の可能性）', error);
    }
}

// ===== 暗号化版（book_data）の鍵・本棚の進捗 =====
// 鍵はパスフレーズから導出したAES鍵のbase64（パスフレーズそのものは保存しない）。トークンと同じ扱い。
// 進捗は本棚カード用の{total, read}だけを平文で持つ（本文キャッシュを復号せずに本棚を出すため）。

const ENC_KEY_KEY = 'book_enc_key';
function progressKey(id) { return `book_progress_${id}`; }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 鍵のbase64 or null
export function loadEncKey() {
    return localStorage.getItem(ENC_KEY_KEY);
}

// (2) インプット: keyB64  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveEncKey(keyB64) {
    localStorage.setItem(ENC_KEY_KEY, keyB64);
}

// (2) インプット: 書籍ID  (3) メイン — localStorage読み取り  (4) アウトプット — {total, read} or null
export function loadProgress(id) {
    try {
        return JSON.parse(localStorage.getItem(progressKey(id)));
    } catch (error) {
        return null;
    }
}

// (2) インプット: 書籍ID, {total, read}  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveProgress(id, overall) {
    localStorage.setItem(progressKey(id), JSON.stringify({ total: overall.total, read: overall.read }));
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

// 図版はSHA等の差分検知をしないため、GitHub側で同じファイル名のまま画像を差し替えた場合
// （切り出し直しなど）、デバイス内に残った古いキャッシュが更新されない。
// 「キャッシュ更新」ボタンから呼び、画像キャッシュだけをまとめて消せるようにしておく。
// (2) インプット — なし  (3) メイン — localStorageから book_cache_image_ 接頭辞のキーを削除  (4) アウトプット — なし
export function clearImageCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('book_cache_image_')) keys.push(key);
    }
    keys.forEach(k => localStorage.removeItem(k));
}
