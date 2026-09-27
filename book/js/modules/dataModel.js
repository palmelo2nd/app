// (1) インポート — なし

/**
 * data.mdのFront Matter（JSON）をパースする。
 * (2) インプット: markdown — data.mdの全文
 * (3) メイン: 最初の「---」〜次の「---」間のJSONをパース
 * (4) アウトプット: { bookData: Array, chapterData: Array }
 */
export function parseMarkdown(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { bookData: [], chapterData: [] };
    const parsed = JSON.parse(match[1]);
    return {
        bookData: parsed.bookData || [],
        chapterData: parsed.chapterData || [],
    };
}

/**
 * 本IDに属する章データを順序順に返す。
 * (2) インプット: chapterData, bookId
 * (3) メイン: 本ID一致でフィルタし、順序昇順ソート
 * (4) アウトプット: Array
 */
export function getChaptersForBook(chapterData, bookId) {
    return chapterData
        .filter(c => c['本ID'] === bookId)
        .sort((a, b) => (a['順序'] || 0) - (b['順序'] || 0));
}
