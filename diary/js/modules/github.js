// (1) インポート — なし（Web標準 fetch API のみ使用）
// book/brainのgithub.jsと同系統。新規ファイル作成（sha省略）とディレクトリ一覧（年ファイルの検出用）に対応する。

const API_BASE = 'https://api.github.com';

function authHeaders(token, accept) {
    return { 'Authorization': `Bearer ${token}`, 'Accept': accept || 'application/vnd.github.v3+json' };
}

/**
 * GitHub上のファイルを取得し、デコード済みテキストとSHAを返す。
 * (2) インプット: token, owner, repo, path
 * (3) メイン: GET /repos/{owner}/{repo}/contents/{path}（1MB超はrawで再取得）
 * (4) アウトプット: { content: string, sha: string }。失敗時は error.status にHTTPステータスを持つ
 */
export async function fetchFile(token, owner, repo, path) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers: authHeaders(token) });
    if (!response.ok) {
        const error = new Error(`取得失敗 (${response.status})`);
        error.status = response.status;
        throw error;
    }
    const data = await response.json();

    if (data.content) {
        return { content: decodeURIComponent(escape(atob(data.content))), sha: data.sha };
    }

    const rawResponse = await fetch(url, { headers: authHeaders(token, 'application/vnd.github.raw+json') });
    if (!rawResponse.ok) {
        const error = new Error(`取得失敗 (${rawResponse.status})`);
        error.status = rawResponse.status;
        throw error;
    }
    return { content: await rawResponse.text(), sha: data.sha };
}

/**
 * ディレクトリ直下のファイル名一覧を返す。ディレクトリが無い（404）場合は空配列。
 * (2) インプット: token, owner, repo, dirPath
 * (4) アウトプット: string[]（ファイル名のみ）
 */
export async function listFileNames(token, owner, repo, dirPath) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${dirPath}`;
    const response = await fetch(url, { headers: authHeaders(token) });
    if (response.status === 404) return [];
    if (!response.ok) {
        const error = new Error(`一覧取得失敗 (${response.status})`);
        error.status = response.status;
        throw error;
    }
    const data = await response.json();
    return Array.isArray(data) ? data.filter(f => f.type === 'file').map(f => f.name) : [];
}

/**
 * GitHub上のファイルを保存し、新しいSHAを返す。shaを省略すると新規作成になる。
 * (2) インプット: token, owner, repo, path, content, sha（新規作成時はundefined）
 * (4) アウトプット: { newSha: string }。409は他端末との更新競合（error.status）
 */
export async function saveFile(token, owner, repo, path, content, sha) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const body = {
        message: 'docs: 日記アプリから投稿',
        content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;

    const response = await fetch(url, {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = new Error(`保存失敗 (${response.status})`);
        error.status = response.status;
        throw error;
    }
    const result = await response.json();
    return { newSha: result.content.sha };
}
