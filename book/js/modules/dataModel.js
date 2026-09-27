// (1) インポート — なし

/**
 * Front Matter（JSON）をパースする（books.md・本ごとのファイル共通）。
 * (2) インプット: markdown
 * (3) メイン: 最初の「---」〜次の「---」間のJSONをパース
 * (4) アウトプット: { data: object, tail: string }（tailは2つ目の「---」以降の全文。書き戻し時に使う）
 */
export function parseFrontMatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { data: {}, tail: '' };
    return {
        data: JSON.parse(match[1]),
        tail: markdown.slice(match[0].length),
    };
}

/**
 * 本ごとのファイル（chapterData・pageData）をMarkdown文字列に組み立て直す（保存用）。
 * (2) インプット: chapterData, pageData, tail（元ファイルの2つ目の「---」以降の文字列）
 * (3) メイン: JSON化してFront Matterに戻す
 * (4) アウトプット: string
 */
export function stringifyBookFile(chapterData, pageData, tail) {
    const front = JSON.stringify({ chapterData, pageData }, null, 2);
    return '---\n' + front + '\n---' + tail;
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

/**
 * 全体・章ごとの既読進捗を計算する。
 * (2) インプット: chapterData, pageData
 * (3) メイン: 章は開始順序〜次の章の開始順序未満の範囲でページ数・既読数を集計。全体は全ページで集計
 * (4) アウトプット: { overall: {total, read}, chapters: [{chapter, total, read}] }
 */
export function computeProgress(chapterData, pageData) {
    const pages = getSortedPages(pageData);
    const chapters = getSortedChapters(chapterData);

    const overall = {
        total: pages.length,
        read: pages.filter(p => p['既読']).length,
    };

    const chapterStats = chapters.map((chapter, idx) => {
        const start = chapter['開始順序'] || 0;
        const nextStart = idx + 1 < chapters.length ? (chapters[idx + 1]['開始順序'] || Infinity) : Infinity;
        const pagesInChapter = pages.filter(p => (p['順序'] || 0) >= start && (p['順序'] || 0) < nextStart);
        return {
            chapter,
            total: pagesInChapter.length,
            read: pagesInChapter.filter(p => p['既読']).length,
        };
    });

    return { overall, chapters: chapterStats };
}
