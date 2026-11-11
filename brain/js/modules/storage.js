// (1) インポート — なし（Web標準APIのみ使用）

const TOKEN_KEY = 'brain_pat_token';
const TASKS_KEY = 'brain_cached_tasks';
const SHA_KEY   = 'brain_cached_sha';
const BASE_KEY  = 'brain_cached_base'; // 未保存の変更があるときだけ持つ、同期済みの基準（GitHubと最後に一致していた内容）

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み（書けなくても、呼び出し元の保存・読込は続ける）  (4) アウトプット — なし
export function saveToken(token) {
    try {
        localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
        console.error(error);
    }
}

// (2) インプット — なし  (3) メイン — localStorage読み取り
// (4) アウトプット — { content, sha, base } or null。baseは同期済みの基準（未保存の変更が無ければcontentと同じ）
export function loadCache() {
    const content = localStorage.getItem(TASKS_KEY);
    const sha     = localStorage.getItem(SHA_KEY);
    if (!content) return null;
    return { content, sha, base: localStorage.getItem(BASE_KEY) ?? content };
}

// (2) インプット: content, sha, base（同期済みの基準。未保存の変更が無いときはnull）
// (3) メイン — localStorage書き込み。未保存の変更があるときは基準も残す（次に開いたとき、基準と比べて未保存分を
//     GitHubの最新内容とマージできるようにするため。基準が無いと未保存分がGitHubの内容で上書きされる）。
//     基準を先に書く（内容だけ書けて基準が書けないと、未保存分が「同期済み」に見えてしまうため）
// (4) アウトプット — 書き込めたらtrue（容量不足などで書けなければfalse）
export function saveCache(content, sha, base = null) {
    try {
        if (base === null || base === content) localStorage.removeItem(BASE_KEY);
        else if (localStorage.getItem(BASE_KEY) !== base) localStorage.setItem(BASE_KEY, base);
        localStorage.setItem(TASKS_KEY, content);
        if (sha) localStorage.setItem(SHA_KEY, sha);
        else localStorage.removeItem(SHA_KEY);
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}
