// (1) インポート — なし（Web標準 fetch API のみ使用）
// diary／bookのgithub.jsと同系統。ノート1枚＝1ファイルのため、フォルダ一覧（SHA付き）とファイル単位の取得・保存を持つ。

const API_BASE = 'https://api.github.com';

function authHeaders(token, accept) {
    return { 'Authorization': `Bearer ${token}`, 'Accept': accept || 'application/vnd.github.v3+json' };
}

// 日本語・空白・#などを含むファイル名でもURLが壊れないよう、パスの区切りごとにエンコードする
function contentsUrl(owner, repo, path) {
    return `${API_BASE}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function httpError(prefix, status) {
    const error = new Error(`${prefix} (${status})`);
    error.status = status;
    return error;
}

/**
 * フォルダ直下のファイル一覧をSHA付きで返す。フォルダが無い（404）場合は空配列。
 * Contents APIのフォルダ一覧は1,000件まで（ノートがそれを超えたらGit Trees APIへ切り替える）。
 * (2) インプット: token, owner, repo, dirPath
 * (3) メイン: GET /repos/{owner}/{repo}/contents/{dirPath}
 * (4) アウトプット: Array<{ name, path, sha }>（ファイルのみ）。失敗時は error.status を持つ（通信できない場合は持たない）
 */
export async function listFiles(token, owner, repo, dirPath) {
    const response = await fetch(contentsUrl(owner, repo, dirPath), { cache: 'no-store', headers: authHeaders(token) });
    if (response.status === 404) return [];
    if (!response.ok) throw httpError('一覧取得失敗', response.status);
    const data = await response.json();
    return Array.isArray(data)
        ? data.filter(f => f.type === 'file').map(f => ({ name: f.name, path: f.path, sha: f.sha }))
        : [];
}

/**
 * GitHub上のファイルを取得し、デコード済みテキストとSHAを返す。
 * (2) インプット: token, owner, repo, path
 * (3) メイン: GET /repos/{owner}/{repo}/contents/{path}（1MB超はrawで再取得）
 * (4) アウトプット: { content: string, sha: string }。失敗時は error.status を持つ
 */
export async function fetchFile(token, owner, repo, path) {
    const url = contentsUrl(owner, repo, path);
    const response = await fetch(url, { cache: 'no-store', headers: authHeaders(token) });
    if (!response.ok) throw httpError('取得失敗', response.status);
    const data = await response.json();

    if (data.content) {
        return { content: decodeURIComponent(escape(atob(data.content))), sha: data.sha };
    }

    const rawResponse = await fetch(url, { cache: 'no-store', headers: authHeaders(token, 'application/vnd.github.raw+json') });
    if (!rawResponse.ok) throw httpError('取得失敗', rawResponse.status);
    return { content: await rawResponse.text(), sha: data.sha };
}

/**
 * GitHub上のファイルを保存し、新しいSHAを返す。shaを省略すると新規作成になる。
 * (2) インプット: token, owner, repo, path, content, sha（新規作成時はnull）, message
 * (3) メイン: PUT /repos/{owner}/{repo}/contents/{path}
 * (4) アウトプット: { newSha: string }。409（SHA不一致）・422（新規なのに既にある）は他端末との衝突（error.status）
 */
export async function saveFile(token, owner, repo, path, content, sha, message) {
    const body = {
        message: message || 'docs: ナレッジアプリから更新',
        content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;

    const response = await fetch(contentsUrl(owner, repo, path), {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw httpError('保存失敗', response.status);
    const result = await response.json();
    return { newSha: result.content.sha };
}
