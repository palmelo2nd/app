// (1) インポート — なし（Web標準APIのみ使用）

const TOKEN_KEY = 'index_pat_token';

// 各アプリがトークンをlocalStorageに保存しているキー（同一オリジンのため、ここへ書けば引き継がれる）。
// chatはbrainと同じ brain_pat_token を使うため別掲しない。
export const APP_TOKEN_KEYS = [
    'brain_pat_token', 'stock_token', 'cook_pat_token', 'book_pat_token',
    'dream_pat_token', 'memory_pat_token', 'kanzi_pat_token'
];

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
// indexの保存値が無ければ、既に入力済みのアプリのトークンを流用する。
export function loadToken() {
    const own = localStorage.getItem(TOKEN_KEY);
    if (own) return own;
    for (const key of APP_TOKEN_KEYS) {
        const v = localStorage.getItem(key);
        if (v) return v;
    }
    return null;
}

// (2) インプット: token  (3) メイン — index用キーと全アプリ用キーへ書き込み  (4) アウトプット — なし
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
    APP_TOKEN_KEYS.forEach(key => localStorage.setItem(key, token));
}
