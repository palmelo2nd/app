// (1) インポート — なし（Web標準 fetch API のみ使用）
// brainのgithub.jsのfetchFileのみ（dreamは読み取り専用）。

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
 * その場合はAcceptをrawメディアタイプに変えて同じURLに再リクエストし、
 * レスポンスボディをそのままテキストとして受け取る（100MBまで対応）。
 */
export async function fetchFile(token, owner, repo, path) {
    const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;

    const response = await fetch(url, {
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
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.raw+json'
        }
    });

    if (!rawResponse.ok) throw new Error(`取得失敗 (${rawResponse.status})`);

    const content = await rawResponse.text();

    return { content, sha: data.sha };
}
