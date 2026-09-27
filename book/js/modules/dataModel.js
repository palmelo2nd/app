// (1) インポート — なし

/**
 * Front Matter（JSON）をパースする（books.md・本ごとのファイル共通）。
 * (2) インプット: markdown
 * (3) メイン: 最初の「---」〜次の「---」間のJSONをパース
 * (4) アウトプット: パース済みオブジェクト（無ければ空オブジェクト）
 */
export function parseFrontMatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    return JSON.parse(match[1]);
}

/**
 * 章（ジャンプ用アンカー）を開始順序順に返す。
 * (2) インプット: chapterData
 * (3) メイン: 開始順序の昇順ソート
 * (4) アウトプット: Array
 */
export function getSortedChapters(chapterData) {
    return [...(chapterData || [])].sort((a, b) => (a['開始順序'] || 0) - (b['開始順序'] || 0));
}

/**
 * ページをページ送り用に順序順で返す。
 * (2) インプット: pageData
 * (3) メイン: 順序の昇順ソート
 * (4) アウトプット: Array
 */
export function getSortedPages(pageData) {
    return [...(pageData || [])].sort((a, b) => (a['順序'] || 0) - (b['順序'] || 0));
}
