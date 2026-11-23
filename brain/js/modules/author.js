// (1) インポート（純粋なデータ判定のみ）
// キャッシュバスティング用の「?v=N」はjs/app.js冒頭のコメント参照。値を変更する際はそちらと揃えること。
import { getSystemInfo } from './task.js?v=86';

// ===== 投稿者・最終更新者（2026-11-15、brain #1635） =====
// brainはタスクと計画の一元管理の場で、各スレッド（myself・app・book・research・study・lab・idea）が直接書く。
// だれが書いたかをシステム列に残す。
//   投稿者     : 行を作ったスレッド（例 { "投稿者": "book" }）。無い行は本人が作ったもの
//   最終更新者 : 最後に書き換えたスレッド。スレッドが書いた行を本人がアプリで直したら「本人」になる（app.jsの保存時）
// 編集フォームの下にシステム列をそのまま表示して、だれが書いたかを見る（2026-11-23、brain #-23）。
// 2026-11-23（brain #-23）に、AI確認タブと、その判定に使っていたAI原案・AI確認・担当スレッドをやめた
// （このファイルは旧aiReview.js。経緯：office/lab/works/261123_アプリのタスクを目的ベースで置く.md）。
// これらの項目はアプリが知らないキーとして捨てないこと（システム列は setSystemField で他の項目を保ったまま書き換える）。
export const AUTHOR_KEY      = '投稿者';
export const LAST_EDITOR_KEY = '最終更新者';
export const OWNER_SELF      = '本人';

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
