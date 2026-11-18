// (1) インポート — なし（Web標準 fetch API のみ使用）
// diaryのgithub.jsから、ファイルの取得・保存だけを持ってきた（2026-11-18）。saveFileはshaを省略すると新規作成になる。

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
 * GitHub上のファイルを保存し、新しいSHAを返す。shaを省略すると新規作成になる。
 * (2) インプット: token, owner, repo, path, content, sha（新規作成時はundefined）
 * (4) アウトプット: { newSha: string }。409は他端末との更新競合（error.status）
 */
export async function saveFile(token, owner, repo, path, content, sha, message) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const body = {
        message: message || 'docs: スキルマップアプリから更新',
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
