// (1) インポート — なし
//
// ノート1枚＝1つの.md（app_data/note/<ID>_<作成時の題名>.md）。先頭のFront Matter（JSON、bookなどと同じ形）に属性を持つ。
//   ---
//   {"id":"n0474","title":"…","category":"仕事","tags":["連絡先"],"created":"2026/09/13 10:20","updated":"2026/11/06 21:05"}
//   ---
//   本文（Markdown）
// 題名はFront Matterのtitleが正。ファイル名は作成時に決めて、題名を変えても変えない（GitHub上の改名＝削除＋作成を避けるため）。
// Front Matterが無い・壊れている.mdも、本文だけのノートとして読めるようにする。

export const NOTE_DIR = 'note';
export const CATEGORIES = ['仕事', '自分'];
const META_ORDER = ['id', 'title', 'category', 'tags', 'created', 'updated'];

/**
 * ファイル全文をFront Matterと本文に分ける。
 * (2) インプット: text（ファイル全文）
 * (4) アウトプット: { meta: object, body: string }
 */
export function parseNote(text) {
    const match = (text || '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) return { meta: {}, body: text || '' };
    try {
        const meta = JSON.parse(match[1]);
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { meta: {}, body: text };
        return { meta, body: text.slice(match[0].length) };
    } catch (_) {
        return { meta: {}, body: text };
    }
}

/**
 * 属性と本文からファイル全文を組み立てる（保存用）。キーは決まった順に並べ、知らないキーも後ろに残す。
 * (4) アウトプット: string
 */
export function stringifyNote(meta, body) {
    const ordered = {};
    META_ORDER.forEach(k => { if (meta[k] !== undefined && meta[k] !== '') ordered[k] = meta[k]; });
    Object.keys(meta).forEach(k => { if (!(k in ordered) && meta[k] !== undefined) ordered[k] = meta[k]; });
    if (Array.isArray(ordered.tags) && ordered.tags.length === 0) delete ordered.tags;
    return '---\n' + JSON.stringify(ordered) + '\n---\n' + String(body || '').replace(/\s+$/, '') + '\n';
}

/** ファイル名（パス）から題名の代わりを作る（titleが無いノート用）。「n0474_題名.md」→「題名」 */
export function titleFromPath(path) {
    const name = path.split('/').pop().replace(/\.md$/i, '');
    return name.replace(/^n\d+_/, '') || name;
}

/** ノートの表示用の題名。 */
export function noteTitle(note) {
    return (note.meta.title || '').trim() || titleFromPath(note.path);
}

/** ノートのタグ（文字列の配列）。 */
export function noteTags(note) {
    return Array.isArray(note.meta.tags) ? note.meta.tags.filter(t => typeof t === 'string' && t) : [];
}

/** 「手順, コマンド」→ ['手順','コマンド']（読点・空白区切りも可、重複は除く） */
export function parseTagInput(text) {
    return [...new Set(String(text || '').split(/[,、，\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean))];
}

/** 現在時刻を 'YYYY/MM/DD HH:MM'（brain・bookと同じ書き方）で返す。 */
export function nowStamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** 新しいノートのID（'n' + yymmddHHMMSS）。 */
export function newNoteId(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `n${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * IDと題名からファイルのパスを作る。WindowsとGitHubで問題になる文字だけを「_」にし、題名部分は30文字で切る。
 * (4) アウトプット: 'note/<ID>_<題名>.md'
 */
export function makeNotePath(id, title) {
    const safe = [...String(title || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim()]
        .slice(0, 30).join('').replace(/[ .]+$/, '') || '無題';
    return `${NOTE_DIR}/${id}_${safe}.md`;
}

/** 検索用に文字をそろえる（全角／半角・大文字／小文字・カタカナ／ひらがなを同一視）。 */
export function normalizeForSearch(text) {
    return String(text || '').normalize('NFKC').toLowerCase()
        .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 検索語（空白区切りでAND）に合うかを返す。題名・タグ・本文が対象。
 * (2) インプット: note, terms（normalizeForSearch済みの語の配列）
 */
export function matchesSearch(note, terms) {
    if (terms.length === 0) return true;
    const hay = note.searchText ?? (note.searchText = normalizeForSearch(`${noteTitle(note)}\n${noteTags(note).join(' ')}\n${note.body}`));
    return terms.every(t => hay.includes(t));
}

/** 本文の最初の空でない行（一覧の2行目に出す）。 */
export function firstLine(body) {
    const line = String(body || '').split('\n').map(l => l.trim()).find(l => l && !/^```/.test(l));
    return (line || '').replace(/^#+\s*/, '').slice(0, 80);
}

/** 検索語が本文に出てくるあたりを切り出す（無ければ最初の行）。 */
export function snippetFor(body, rawTerm) {
    if (!rawTerm) return firstLine(body);
    const text = String(body || '').replace(/\s+/g, ' ');
    const pos = text.toLowerCase().indexOf(rawTerm.toLowerCase());
    if (pos < 0) return firstLine(body);
    const start = Math.max(0, pos - 20);
    return (start > 0 ? '…' : '') + text.slice(start, pos + 60);
}
