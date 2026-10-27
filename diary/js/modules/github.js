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
export async function saveFile(token, owner, repo, path, content, sha, message) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const body = {
        message: message || 'docs: 日記アプリから更新',
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

// ===== 写真（バイナリ）用 =====

/**
 * Base64済みのバイナリ（写真）を新規保存する。
 * (2) インプット: token, owner, repo, path, base64（data:の接頭辞なし）, message
 * (4) アウトプット: { sha: string }
 */
export async function saveBinary(token, owner, repo, path, base64, message) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message || 'docs: 日記アプリから写真を追加', content: base64 })
    });
    if (!response.ok) {
        const error = new Error(`写真の保存失敗 (${response.status})`);
        error.status = response.status;
        throw error;
    }
    const result = await response.json();
    return { sha: result.content.sha };
}

/**
 * ファイルをBlobとして取得する（非公開リポジトリの写真表示用）。
 * (4) アウトプット: Blob。失敗時は error.status を持つ
 */
export async function fetchBlob(token, owner, repo, path) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers: authHeaders(token, 'application/vnd.github.raw') });
    if (!response.ok) {
        const error = new Error(`写真の取得失敗 (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return await response.blob();
}

/**
 * ファイルを削除する（shaは内部で取得）。すでに無い（404）場合は何もしない。
 */
export async function deleteFile(token, owner, repo, path, message) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const meta = await fetch(url, { headers: authHeaders(token) });
    if (meta.status === 404) return;
    if (!meta.ok) {
        const error = new Error(`削除失敗 (${meta.status})`);
        error.status = meta.status;
        throw error;
    }
    const { sha } = await meta.json();
    const response = await fetch(url, {
        method: 'DELETE',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message || 'docs: 日記アプリから写真を削除', sha })
    });
    if (!response.ok && response.status !== 404) {
        const error = new Error(`削除失敗 (${response.status})`);
        error.status = response.status;
        throw error;
    }
}
