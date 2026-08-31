// (1) インポート — なし（Web標準 fetch API のみ使用）

const API_BASE = 'https://api.github.com';

/**
 * GitHub上のファイルを取得し、デコード済みテキストとSHAを返す。
 *
 * (2) インプット: token, owner, repo, path
 * (3) メイン: GET /repos/{owner}/{repo}/contents/{path}。
 *     Contents APIは1MBを超えるファイルではcontentを省略して返す仕様のため、
 *     その場合はGit Blob API（100MBまで対応）から取り直す。
 * (4) アウトプット: { content: string, sha: string }
 */
export async function fetchFile(token, owner, repo, path) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`取得失敗 (${response.status})`);

    const data = await response.json();
    let base64Content = data.content;

    // 1MBを超えるファイルはcontentが空文字列で返るため、その場合のみフォールバックする
    if (!base64Content) {
        const blobResponse = await fetch(`${API_BASE}/repos/${owner}/${repo}/git/blobs/${data.sha}`, { headers });
        if (!blobResponse.ok) throw new Error(`取得失敗 (${blobResponse.status})`);
        base64Content = (await blobResponse.json()).content;
    }

    const content = decodeURIComponent(escape(atob(base64Content)));

    return { content, sha: data.sha };
}

/**
 * GitHub上のファイルを上書き保存し、新しいSHAを返す。
 *
 * (2) インプット: token, owner, repo, path, markdownContent, sha, message（省略時は進捗保存用の既定文言）
 * (3) メイン: PUT /repos/{owner}/{repo}/contents/{path}
 * (4) アウトプット: { newSha: string }
 */
export async function saveFile(token, owner, repo, path, markdownContent, sha, message = 'docs: HTMLアプリから漢字学習の進捗を更新') {
    const url            = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const encodedContent = btoa(unescape(encodeURIComponent(markdownContent)));

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message,
            content: encodedContent,
            sha
        })
    });

    if (!response.ok) {
        const error = new Error(`保存失敗 (${response.status})`);
        error.status = response.status; // 409の場合は他端末との更新競合を意味する
        throw error;
    }

    const result = await response.json();

    return { newSha: result.content.sha };
}
