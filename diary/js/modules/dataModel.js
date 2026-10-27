// (1) インポート — なし
//
// 記事（diaryDataの1件）の形：
//   { ID, 日付:'YYYY/MM/DD', 投稿者, 本文, 投稿日時, 更新日時, 写真:'diary/photos/xxx.jpg'|'' ,
//     コメント:[{ ID, 投稿者, 本文, 投稿日時, 更新日時 }], リアクション:{ '👍':[名前...], ... } }
// 投稿日時＝最初に投稿した日時（編集しても変えない）、更新日時＝最後に編集した日時。
// v1で作った記事には 更新日時・写真・コメント・リアクション が無いことがあるので、読むときは無い前提でも動くようにする。

/**
 * Front Matter（JSON）をパースする。
 * (4) アウトプット: { data: object, tail: string }（tailは2つ目の「---」以降）
 */
export function parseFrontMatter(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { data: {}, tail: '' };
    return { data: JSON.parse(match[1]), tail: markdown.slice(match[0].length) };
}

/** 年ファイル（diaryData）をMarkdown文字列に組み立て直す（保存用）。 */
export function stringifyDiaryFile(diaryData, tail) {
    return '---\n' + JSON.stringify({ diaryData }, null, 2) + '\n---' + (tail || '\n');
}

/** 文字数（改行を含む全体 / 改行・空白を除いた実質）を返す。 */
export function countChars(text) {
    const s = text || '';
    return { all: [...s].length, plain: [...s.replace(/\s/g, '')].length };
}

/** 現在時刻を 'YYYY/MM/DD HH:MM:SS' で返す（文字列のまま大小比較できる形）。 */
export function nowStamp() {
    const t = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/** 記録用のID（日付＋時刻＋乱数）。 */
export function newId() {
    const t = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 新しい順（日付 → 投稿日時 の降順）に並べる。 */
export function sortNewestFirst(entries) {
    return [...entries].sort((a, b) =>
        (b['日付'] || '').localeCompare(a['日付'] || '') || (b['投稿日時'] || '').localeCompare(a['投稿日時'] || ''));
}

/** 記事・コメントの「最後に動いた時刻」（更新日時が無ければ投稿日時）。 */
export function lastTouched(item) {
    return item['更新日時'] || item['投稿日時'] || '';
}

/** 全記事の投稿者名（記事・コメント・リアクションに出てくる名前）を重複なしで返す。 */
export function collectAuthors(entries) {
    const set = new Set();
    for (const e of entries) {
        if (e['投稿者']) set.add(e['投稿者']);
        for (const c of e['コメント'] || []) if (c['投稿者']) set.add(c['投稿者']);
    }
    return [...set];
}
