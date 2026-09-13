// (1) インポート — なし（Web標準APIのみ使用）
// brainアプリのjs/modules/storage.jsと同じ構造。GitHub Pagesでは同一オリジン配下に複数アプリが
// 同居するためlocalStorageキーが衝突しうる。他アプリ（brain/kanzi/stock）と被らないよう、
// キー名には必ず「memory_」プレフィックスを付けている。

const TOKEN_KEY = 'memory_pat_token';
const DATA_KEY  = 'memory_cached_data';
const SHA_KEY   = 'memory_cached_sha';

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — { content, sha } or null
export function loadCache() {
    const content = localStorage.getItem(DATA_KEY);
    const sha     = localStorage.getItem(SHA_KEY);
    if (!content) return null;
    return { content, sha };
}

// (2) インプット: content, sha  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveCache(content, sha) {
    localStorage.setItem(DATA_KEY, content);
    localStorage.setItem(SHA_KEY,  sha);
}
