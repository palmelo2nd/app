// (1) インポート — なし

/**
 * Front Matter（JSON）をパースする。
 * (4) アウトプット: { data: object, tail: string }（tailは2つ目の「---」以降）
 */
export function parseFrontMatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { data: {}, tail: '' };
    return { data: JSON.parse(match[1]), tail: markdown.slice(match[0].length) };
}

/** 年ファイル（diaryData）をMarkdown文字列に組み立て直す（保存用）。 */
export function stringifyDiaryFile(diaryData, tail) {
    return '---\n' + JSON.stringify({ diaryData }, null, 2) + '\n---' + (tail || '\n');
}

/** 日付（YYYY/MM/DD）→ 投稿日時の順に並べる。 */
export function getSortedEntries(diaryData) {
    return [...(diaryData || [])].sort((a, b) =>
        (a['日付'] || '').localeCompare(b['日付'] || '') || (a['投稿日時'] || '').localeCompare(b['投稿日時'] || ''));
}

/** 文字数（改行を含む全体 / 改行・空白を除いた実質）を返す。 */
export function countChars(text) {
    const s = text || '';
    return { all: [...s].length, plain: [...s.replace(/\s/g, '')].length };
}

/** 日付ごとにまとめた「ページ」（1日＝1ページ）を日付順で返す。[{ date, entries }] */
export function getDayPages(diaryData) {
    const map = new Map();
    for (const e of getSortedEntries(diaryData)) {
        const d = e['日付'] || '';
        if (!map.has(d)) map.set(d, []);
        map.get(d).push(e);
    }
    return [...map.entries()].map(([date, entries]) => ({ date, entries }));
}

/** 年全体・月別・投稿者別の集計。 */
export function computeStats(diaryData) {
    const total = { entries: 0, days: new Set(), chars: 0 };
    const months = {};  // 'MM' -> { entries, days:Set, chars }
    const authors = {}; // name -> { entries, chars }
    for (const e of diaryData || []) {
        const chars = countChars(e['本文']).plain;
        const month = (e['日付'] || '').slice(5, 7);
        const author = e['投稿者'] || '(不明)';
        total.entries++; total.days.add(e['日付']); total.chars += chars;
        const m = months[month] = months[month] || { entries: 0, days: new Set(), chars: 0 };
        m.entries++; m.days.add(e['日付']); m.chars += chars;
        const a = authors[author] = authors[author] || { entries: 0, chars: 0 };
        a.entries++; a.chars += chars;
    }
    return { total: { entries: total.entries, days: total.days.size, chars: total.chars },
             months: Object.fromEntries(Object.entries(months).map(([k, v]) => [k, { entries: v.entries, days: v.days.size, chars: v.chars }])),
             authors };
}
