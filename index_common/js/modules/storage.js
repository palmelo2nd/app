// (1) インポート — なし（Web標準APIのみ使用）

// 用途別INDEX（index_my／index_fam／index_save、2026-11-02）。トークンは用途（データリポジトリ）ごとに保存し、
// INDEXを開くたびにその用途のトークンと「読むデータリポジトリ」を各アプリ用のキーへ書き込む。
// 同一オリジンのlocalStorageは全アプリ共通なので、同じ端末で用途を切り替えても、INDEXを開き直せば戻る。
const LEGACY_TOKEN_KEY = 'index_pat_token'; // 用途別にする前の保存値（自分用＝app_dataの初期値として流用）

// 各アプリが「読むデータリポジトリ」を参照するキー（stock・cook・diary・typingが対応。未設定ならapp_data）
export const DATA_REPO_KEY = 'app_data_repo';

// 各アプリがトークンをlocalStorageに保存しているキー（同一オリジンのため、ここへ書けば引き継がれる）。
// chatはbrainと同じ brain_pat_token を使うため別掲しない。
export const APP_TOKEN_KEYS = [
    'brain_pat_token', 'stock_token', 'cook_pat_token', 'book_pat_token',
    'dream_pat_token', 'memory_pat_token', 'kanzi_pat_token', 'diary_pat_token', 'typing_pat_token'
];

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* 保存できない環境では何もしない */ } }

const tokenKey = dataRepo => `index_pat_token_${dataRepo}`;

// (2) インプット: dataRepo  (4) アウトプット — その用途の保存済みトークン or null
export function loadToken(dataRepo) {
    const own = safeGet(tokenKey(dataRepo));
    if (own) return own;
    return dataRepo === 'app_data' ? safeGet(LEGACY_TOKEN_KEY) : null;
}

// (2) インプット: dataRepo, token  (3) メイン — 用途別キーへ保存し、各アプリへ引き継ぐ
export function saveToken(dataRepo, token) {
    safeSet(tokenKey(dataRepo), token);
    activate(dataRepo, token);
}

// (3) メイン — この用途を「現在の用途」にする（データリポジトリ名と、あればトークンを各アプリ用キーへ）
export function activate(dataRepo, token) {
    safeSet(DATA_REPO_KEY, dataRepo);
    if (token) APP_TOKEN_KEYS.forEach(key => safeSet(key, token));
}
