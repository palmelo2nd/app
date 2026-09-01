// (1) インポート — なし（純粋なデータ変換のみ）

// 開発者用レビュー機能（例文・対象級のチェック）で使う定数。
// dev-tools/review.js（旧・スタンドアロン版）と同じ4値・級順序をアプリ内タブに統合したもの。
export const REVIEW_STATUSES = ['未確認', '承認', '保留', '却下'];
export const KYU_ORDER = ['10級', '9級', '8級', '7級', '6級', '5級', '4級', '3級', '準2級', '2級', '準1級', '1級'];

/**
 * レビューモードに対応する熟語データのフィールド名を返す。
 *
 * (2) インプット: mode（'example'|'kyu'|'kousei'）
 * (3) メイン: モードごとに「確認状態フィールド」「編集対象フィールド」を対応付け
 * (4) アウトプット: { reviewField: string, contentField: string }
 */
export function reviewFieldNames(mode) {
    if (mode === 'kyu') return { reviewField: '対象級_確認状態', contentField: '対象級' };
    if (mode === 'kousei') return { reviewField: '構成_確認状態', contentField: '構成' };
    return { reviewField: '例文_確認状態', contentField: '例文' };
}

/**
 * ローカルに保存された編集差分（storage.jsのloadDevReviewEdits）を熟語配列にマージする。
 *
 * (2) インプット: entries — jukugoData配列, edits — ID→変更フィールドのオブジェクト
 * (3) メイン: IDが一致する行にeditsの内容を上書き適用する浅いマージ（元の配列・要素は変更しない）
 * (4) アウトプット: マージ後の新しい配列
 */
export function mergeReviewEdits(entries, edits) {
    if (!edits || Object.keys(edits).length === 0) return entries;
    return entries.map(entry => (edits[entry.ID] ? { ...entry, ...edits[entry.ID] } : entry));
}

/**
 * レビューモードとフィルタ条件（ステータス・級・種別・キーワード、'kousei'モードのみ確信度も）で熟語配列を絞り込む。
 *
 * (2) インプット: entries, mode（'example'|'kyu'|'kousei'）, filters（status/kyu/type/keyword/confidence）
 * (3) メイン: 各条件をAND条件で順に適用。'kousei'モードは三字熟語・四字熟語など`構成`が対象外の
 *             エントリを常に除外したうえで、確信度（confidence: 'all'|'高'|'中'|'低'）でも絞り込む
 * (4) アウトプット: 絞り込み後の配列
 */
export function filterForReview(entries, mode, filters) {
    const { reviewField } = reviewFieldNames(mode);
    const { status, kyu, type, keyword, confidence } = filters;

    return entries.filter(e => {
        if (mode === 'kousei' && !e['構成']) return false;
        if (status !== 'all' && (e[reviewField] || '未確認') !== status) return false;
        if (kyu !== 'all' && e['対象級'] !== kyu) return false;
        if (type !== 'all' && e['種別'] !== type) return false;
        if (mode === 'kousei' && confidence && confidence !== 'all' && e['構成_確信度'] !== confidence) return false;
        if (keyword) {
            const haystack = `${e['語'] || ''}${e['読み'] || ''}${e['意味'] || ''}${e['例文'] || ''}`;
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });
}

/**
 * レビューモードに対応するkanjiMasterデータのフィールド名を返す（'reading'|'writing'|'stroke'）。
 *
 * (2) インプット: mode
 * (3) メイン: モードごとに確認状態フィールドを対応付け
 * (4) アウトプット: { reviewField: string }
 */
export function kanjiReviewFieldName(mode) {
    if (mode === 'writing') return '書き_確認状態';
    if (mode === 'stroke') return '筆順_確認状態';
    return '読み_確認状態';
}

/**
 * ローカルに保存された編集差分をkanjiMaster配列にマージする（読み・書きレビュー用、漢字1字単位）。
 *
 * (2) インプット: kanjiData配列, edits — ID→変更フィールドのオブジェクト
 * (3) メイン: IDが一致する行にeditsの内容を上書き適用する浅いマージ
 * (4) アウトプット: マージ後の新しい配列
 */
export function mergeKanjiReviewEdits(kanjiData, edits) {
    if (!edits || Object.keys(edits).length === 0) return kanjiData;
    return kanjiData.map(k => (edits[k.ID] ? { ...k, ...edits[k.ID] } : k));
}

/**
 * kanjiMaster配列を読み・書きレビューのモードとフィルタ条件で絞り込む。
 *
 * (2) インプット: kanjiData, mode（'reading'|'writing'）, filters（status/kyu/keyword）
 * (3) メイン: 各条件をAND条件で順に適用（種別フィルタは無し、キーワードは漢字・音読み・訓読みで検索）
 * (4) アウトプット: 絞り込み後の配列
 */
export function filterKanjiForReview(kanjiData, mode, filters) {
    const reviewField = kanjiReviewFieldName(mode);
    const { status, kyu, keyword } = filters;

    return kanjiData.filter(k => {
        if (status !== 'all' && (k[reviewField] || '未確認') !== status) return false;
        if (kyu !== 'all' && k['級'] !== kyu) return false;
        if (keyword) {
            const haystack = `${k['漢字'] || ''}${(k['音読み'] || []).join('')}${(k['訓読み'] || []).join('')}`;
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });
}

/**
 * kanjiMasterの送り仮名例（1字につき0〜数件）を、1行=1例のフラットな配列に変換する。
 *
 * (2) インプット: kanjiData配列
 * (3) メイン: 各字の送り仮名例をkanjiId・exampleIndexつきの行へ展開する
 * (4) アウトプット: { kanjiId, 漢字, 級, exampleIndex, 語, 読み, 確認状態 } の配列
 */
export function flattenOkuriganaEntries(kanjiData) {
    const rows = [];
    kanjiData.forEach(k => {
        (k['送り仮名例'] || []).forEach((ex, exampleIndex) => {
            rows.push({
                kanjiId: k.ID,
                漢字: k['漢字'],
                級: k['級'],
                exampleIndex,
                語: ex['語'],
                読み: ex['読み'],
                確認状態: ex['確認状態'] || '未確認'
            });
        });
    });
    return rows;
}

/**
 * 送り仮名レビュー用のフラット行をフィルタ条件で絞り込む。
 *
 * (2) インプット: rows（flattenOkuriganaEntriesの戻り値）, filters（status/kyu/keyword）
 * (3) メイン: 各条件をAND条件で順に適用
 * (4) アウトプット: 絞り込み後の配列
 */
export function filterOkuriganaForReview(rows, filters) {
    const { status, kyu, keyword } = filters;
    return rows.filter(r => {
        if (status !== 'all' && r['確認状態'] !== status) return false;
        if (kyu !== 'all' && r['級'] !== kyu) return false;
        if (keyword) {
            const haystack = `${r['漢字']}${r['語']}${r['読み']}`;
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });
}

/**
 * ローカルに保存された編集差分をkanjiMaster配列の送り仮名例（配列の特定要素）にマージする。
 *
 * (2) インプット: kanjiData配列, edits — "kanjiId:exampleIndex"→変更フィールドのオブジェクト
 * (3) メイン: 該当する字の送り仮名例配列のうち、該当indexの要素だけを上書き適用する
 * (4) アウトプット: マージ後の新しい配列
 */
export function mergeOkuriganaReviewEdits(kanjiData, edits) {
    if (!edits || Object.keys(edits).length === 0) return kanjiData;
    return kanjiData.map(k => {
        const hasEdit = Object.keys(edits).some(key => key.startsWith(`${k.ID}:`));
        if (!hasEdit) return k;
        const newExamples = (k['送り仮名例'] || []).map((ex, exampleIndex) => {
            const editKey = `${k.ID}:${exampleIndex}`;
            return edits[editKey] ? { ...ex, ...edits[editKey] } : ex;
        });
        return { ...k, '送り仮名例': newExamples };
    });
}
