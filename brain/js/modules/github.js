// (1) インポート — なし（Web標準 fetch API のみ使用）

const API_BASE = 'https://api.github.com';

/**
 * GitHub上のファイルを取得し、デコード済みテキストとSHAを返す。
 *
 * (2) インプット: token, owner, repo, path
 * (3) メイン: GET /repos/{owner}/{repo}/contents/{path}
 * (4) アウトプット: { content: string, sha: string }
 *
 * 注意：Contents APIはレスポンスJSON内にbase64埋め込みで返せるのが1MBまでで、
 * それを超えるファイルは`content`が空になる（shaなど他の項目は入る）。
 * その場合はAcceptをrawメディアタイプに変えて同じURLに再リクエストし、本文をそのまま受け取る（100MBまで）。
 * 同一URLにAcceptだけ変えて2回取得するため、ブラウザの通信キャッシュ（304）がJSONとrawを取り違える
 * 不具合を避けるため、cache: 'no-store'を付ける（bookで2026-10-19に発生した件の予防的対応）。
 */
export async function fetchFile(token, owner, repo, path) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;

    const response = await fetch(url, {
        cache: 'no-store',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) throw new Error(`取得失敗 (${response.status})`);

    const data = await response.json();

    if (data.content) {
        const content = decodeURIComponent(escape(atob(data.content)));
        return { content, sha: data.sha };
    }

    // 1MB超のファイル：rawメディアタイプで本文のみ再取得する
    const rawResponse = await fetch(url, {
        cache: 'no-store',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.raw+json'
        }
    });

    if (!rawResponse.ok) throw new Error(`取得失敗 (${rawResponse.status})`);

    const content = await rawResponse.text();

    if (content.startsWith('{"name"') || content.startsWith('{"type"')) throw new Error('本文を取得できませんでした（応答が管理情報）');

    return { content, sha: data.sha };
}

/**
 * GitHub上のファイルを上書き保存し、新しいSHAを返す。
 *
 * (2) インプット: token, owner, repo, path, markdownContent, sha
 * (3) メイン: PUT /repos/{owner}/{repo}/contents/{path}
 * (4) アウトプット: { newSha: string }
 */
export async function saveFile(token, owner, repo, path, markdownContent, sha) {
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
            message: 'docs: HTMLアプリからタスクを更新',
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
