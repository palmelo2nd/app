// (1) インポート（純粋なデータ判定・比較のみ）
// キャッシュバスティング用の「?v=N」はjs/app.js冒頭のコメント参照。値を変更する際はそちらと揃えること。
import { getSystemInfo, setSystemField } from './task.js?v=79';

// ===== AI確認（AI秘書が仮登録した行のレビュー） =====
// AI秘書がdata.mdへ直接登録した行は、登録時点の値をシステム列の `AI原案`（オブジェクト）に保持する。アプリ側では書き換えない。
// システム列の `AI確認` は無し＝未確認、'確認済 yyyy/mm/dd'＝ユーザーが確認済み。
// （2026-10-28までは、それぞれ独立した `AI原案` 列（JSON文字列）・`AI確認` 列だった）
// 「修正あり」は保存せず、現在の値と AI原案 の比較で都度判定する（編集経路が多数あるため、各所でフラグを立てる方式は漏れが出るため）。

// システム列の項目名
export const AI_KEY_DRAFT  = 'AI原案';
export const AI_KEY_REVIEW = 'AI確認';

// ===== 投稿者・最終更新者（2026-11-15、brain #1635） =====
// brainはタスクと計画の一元管理の場で、各スレッド（秘書・app・book・research・study・lab）が直接書く
// （labのwork「秘書と他スレッドの付き合い方」論点6）。だれが書いたかをシステム列に残す。
//   投稿者     : 行を作ったスレッド（例 { "投稿者": "book" }）。無い行は本人が作ったもの
//   最終更新者 : 最後に書き換えたスレッド。スレッドが書いた行を本人がアプリで直したら「本人」になる（app.jsの保存時）
//   担当スレッド : プロジェクトの根元の行に付ける目印（例 アプリ（#760）に { "担当スレッド": "app" }。複数ならカンマ区切り）。
//                その行と子孫が、そのスレッドの「自分のプロジェクト」
// 各スレッドが自分のプロジェクトの下に書いた行は、AI確認に回さない（投稿者の記録で済ませる）。それ以外の場所に書いた行だけAI確認に回す。
// これらの項目はアプリが知らないキーとして捨てないこと（システム列は setSystemField で他の項目を保ったまま書き換える）。
export const AUTHOR_KEY       = '投稿者';
export const LAST_EDITOR_KEY  = '最終更新者';
export const OWNER_THREAD_KEY = '担当スレッド';
export const OWNER_SELF       = '本人';
export const THREADS = ['秘書', 'app', 'book', 'research', 'study', 'lab'];

/** 行の投稿者（無ければ空文字＝本人）。 */
export function getAuthor(row) {
    return String(getSystemInfo(row)[AUTHOR_KEY] || '');
}

/** 行の最終更新者（無ければ空文字）。 */
export function getLastEditor(row) {
    return String(getSystemInfo(row)[LAST_EDITOR_KEY] || '');
}

/** スレッドが書いた行か（投稿者か最終更新者があり、本人ではない）。本人がアプリで直したときに最終更新者を「本人」にする対象。 */
export function isThreadWrittenRow(row) {
    const a = getAuthor(row), e = getLastEditor(row);
    return (a !== '' && a !== OWNER_SELF) || (e !== '' && e !== OWNER_SELF);
}

/** 行の担当スレッド（カンマ・読点区切りを配列にする）。 */
function ownerThreadsOf(row) {
    return String(getSystemInfo(row)[OWNER_THREAD_KEY] || '').split(/[,、\s]+/).filter(Boolean);
}

/**
 * 行が、そのスレッドの「自分のプロジェクト」の中にあるか。
 *
 * (2) インプット: row, thread（スレッド名）, rowsById（ID→行のMap）
 * (3) メイン: 親IDをたどり、担当スレッドにそのスレッドを含む行（行そのもの、または祖先）があるかを見る
 * (4) アウトプット: boolean
 */
export function isInThreadProject(row, thread, rowsById) {
    const seen = new Set();
    let cur = row;
    while (cur && !seen.has(String(cur['ID']))) {
        seen.add(String(cur['ID']));
        if (ownerThreadsOf(cur).includes(thread)) return true;
        const pid = String(cur['親ID'] || '');
        cur = pid ? rowsById.get(pid) : null;
    }
    return false;
}

/** スレッドが自分のプロジェクトの下に書いた行か（＝AI確認を省く行）。 */
export function isSelfProjectRow(row, rowsById) {
    const author = getAuthor(row);
    return THREADS.includes(author) && isInThreadProject(row, author, rowsById);
}

/** AI原案に保存し、比較対象とする列。 */
export const AI_DRAFT_FIELDS = ['親ID', 'タイトル', 'カテゴリ', 'ステータス', '優先度', '開始予定', '終了予定'];

/**
 * 行の AI原案 をオブジェクトとして返す。
 *
 * (2) インプット: row — mainDataの1行
 * (3) メイン: システム列の `AI原案` を返す（JSON文字列で書き込まれていた場合はパースする）
 * (4) アウトプット: 原案オブジェクト。AI登録行でない／パース不可なら null
 */
export function parseAiDraft(row) {
    return toDraftObject(getSystemInfo(row)[AI_KEY_DRAFT]);
}

/** AI原案の値（オブジェクトまたはJSON文字列）をオブジェクトにする。空・パース不可なら null。 */
function toDraftObject(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
        const draft = JSON.parse(raw);
        return draft && typeof draft === 'object' ? draft : null;
    } catch {
        return null;
    }
}

/**
 * 現在の値と AI原案 の差分を返す。
 *
 * (2) インプット: row — mainDataの1行
 * (3) メイン: AI_DRAFT_FIELDS のうち、原案に含まれる列だけを文字列として比較する
 * (4) アウトプット: [{ field, before, after }]（差分なし・AI登録行でなければ空配列）
 */
export function diffAiDraft(row) {
    const draft = parseAiDraft(row);
    if (!draft) return [];
    return AI_DRAFT_FIELDS
        .filter(field => field in draft)
        .map(field => ({ field, before: String(draft[field] ?? ''), after: String(row[field] ?? '') }))
        .filter(d => d.before !== d.after);
}

/** 行のAI確認の値（'確認済 yyyy/mm/dd'、未確認なら空文字）を返す。 */
export function getAiReviewMark(row) {
    return String(getSystemInfo(row)[AI_KEY_REVIEW] || '');
}

/** 行が確認済みかどうか。 */
export function isAiReviewed(row) {
    return getAiReviewMark(row).startsWith('確認済');
}

/** 行を確認済みにする（mark: '確認済 yyyy/mm/dd'）。更新日時の書き換え・保存は呼び出し側で行う。 */
export function setAiReviewMark(row, mark) {
    setSystemField(row, AI_KEY_REVIEW, mark);
}

/**
 * AI確認タブに表示する行を返す。
 *
 * (2) インプット: mainData — 全行, mode — 'unreviewed' | 'reviewed' | 'all'
 * (3) メイン: AI原案を持つ行を抽出し（スレッドが自分のプロジェクトの下に書いた行は除く）、modeで絞り込む。未確認→確認済、各グループ内はID降順（新しい順）
 * (4) アウトプット: 行の配列（元配列の要素への参照。元配列自体は変更しない）
 */
export function getAiReviewRows(mainData, mode) {
    const rowsById = new Map(mainData.map(r => [String(r['ID']), r]));
    // スレッドが自分のプロジェクトの下に書いた行は、AI原案があってもAI確認に出さない（投稿者の記録で済ませる）
    const rows = mainData.filter(r => parseAiDraft(r) && !isSelfProjectRow(r, rowsById));
    const filtered = rows.filter(r =>
        mode === 'unreviewed' ? !isAiReviewed(r) :
        mode === 'reviewed'   ?  isAiReviewed(r) : true
    );
    return filtered.sort((a, b) =>
        (isAiReviewed(a) - isAiReviewed(b)) || (Number(b['ID']) - Number(a['ID']))
    );
}

