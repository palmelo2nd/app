// (1) インポート — なし（Web標準 fetch API のみ使用）
// diaryのgithub.jsと同系統（取得・新規作成を含む保存）。

const API_BASE = 'https://api.github.com';

function authHeaders(token, accept) {
    return { 'Authorization': `Bearer ${token}`, 'Accept': accept || 'application/vnd.github.v3+json' };
}

/**
 * GitHub上のファイルを取得し、デコード済みテキストとSHAを返す。
 * (2) インプット: token, owner, repo, path
 * (4) アウトプット: { content, sha }。失敗時は error.status にHTTPステータス（404＝ファイル無し）
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
    const raw = await fetch(url, { headers: authHeaders(token, 'application/vnd.github.raw+json') });
    if (!raw.ok) {
        const error = new Error(`取得失敗 (${raw.status})`);
        error.status = raw.status;
        throw error;
    }
    return { content: await raw.text(), sha: data.sha };
}

/**
 * GitHub上のファイルを保存し、新しいSHAを返す。shaを省略すると新規作成。
 * (4) アウトプット: { newSha }。409は他の人の更新との競合（error.status）
 */
export async function saveFile(token, owner, repo, path, content, sha) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const body = {
        message: 'docs: タイピングアプリからプレイ記録を追加',
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
