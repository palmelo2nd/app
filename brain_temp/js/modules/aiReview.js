// (1) インポート — なし（純粋なデータ判定・比較のみ）

// ===== AI確認（AI秘書が仮登録した行のレビュー） =====
// AI秘書がdata.mdへ直接登録した行は、登録時点の値を `AI原案` 列（JSON文字列）に保持する。アプリ側では書き換えない。
// `AI確認` 列は空欄＝未確認、'確認済 yyyy/mm/dd'＝ユーザーが確認済み。
// 「修正あり」は保存せず、現在の値と AI原案 の比較で都度判定する（編集経路が多数あるため、各所でフラグを立てる方式は漏れが出るため）。

/** AI原案に保存し、比較対象とする列。 */
export const AI_DRAFT_FIELDS = ['親ID', 'タイトル', 'カテゴリ', 'ステータス', '優先度', '開始予定', '終了予定'];

/**
 * 行の AI原案 をオブジェクトとして返す。
 *
 * (2) インプット: row — mainDataの1行
 * (3) メイン: `AI原案` 列のJSON文字列をパースする
 * (4) アウトプット: 原案オブジェクト。AI登録行でない／パース不可なら null
 */
export function parseAiDraft(row) {
    const raw = row && row['AI原案'];
    if (!raw) return null;
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

/** 行が確認済みかどうか。 */
export function isAiReviewed(row) {
    return String(row['AI確認'] || '').startsWith('確認済');
}

/**
 * AI確認タブに表示する行を返す。
 *
 * (2) インプット: mainData — 全行, mode — 'unreviewed' | 'reviewed' | 'all'
 * (3) メイン: AI原案を持つ行を抽出し、modeで絞り込む。未確認→確認済、各グループ内はID降順（新しい順）
 * (4) アウトプット: 行の配列（元配列の要素への参照。元配列自体は変更しない）
 */
export function getAiReviewRows(mainData, mode) {
    const rows = mainData.filter(r => parseAiDraft(r));
    const filtered = rows.filter(r =>
        mode === 'unreviewed' ? !isAiReviewed(r) :
        mode === 'reviewed'   ?  isAiReviewed(r) : true
    );
    return filtered.sort((a, b) =>
        (isAiReviewed(a) - isAiReviewed(b)) || (Number(b['ID']) - Number(a['ID']))
    );
}
