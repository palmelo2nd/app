// (1) インポート — なし（Web標準APIのみ使用）

// スコアタブの計算条件（対象口座・候補ラベル・各種閾値・目標配当などのパラメータ一式）を、
// stock/score_conditions.csv（個人依存データ）へ保存・復元するための純粋関数群。
// DOM操作は一切行わない（読み書き・GitHub通信・フォームへの反映は呼び出し側＝js/app.js側の責務）。

/** owners/brokers/accountsの1フィールドをCSVセル用の文字列にする（null→空文字、配列→JSON文字列）。 */
function serializeSelectionField(list) {
    return list == null ? '' : JSON.stringify(list);
}

/** serializeSelectionFieldの逆変換（空文字→null、それ以外→JSON.parseした配列）。 */
function deserializeSelectionField(text) {
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * 対象口座選択（{ owners, brokers, accounts }）から、履歴のnote列や条件の自動名に使う短い説明文を作る
 * （js/app.jsのdescribeTargetSelectionと同じロジック。DOM非依存のためこちらにも複製している）。
 */
function describeTargetSelectionText(selection) {
    const describe = (label, list) => `${label}:${list == null ? '全' : (list.length ? list.join('・') : 'なし')}`;
    return [
        describe('所有者', selection.owners),
        describe('証券会社', selection.brokers),
        describe('口座区分', selection.accounts),
    ].join(' / ');
}

/**
 * 計算条件の自動名（保存時に名前が未入力の場合に使う）を組み立てる。
 *
 * (2) インプット: params — getSuggestParams()と同じ形のオブジェクト
 * (3) メイン: 対象口座の説明文に目標配当を付記する
 * (4) アウトプット: 文字列（例:「所有者:全 / 証券会社:全 / 口座区分:全（目標420万円）」）
 */
export function describeConditionAuto(params) {
    const manYen = Math.round(params.targetAnnualDividend / 10000);
    return `${describeTargetSelectionText(params.targetSelection)}（目標${manYen.toLocaleString('ja-JP')}万円）`;
}

/**
 * 計算条件1件分のパラメータ（getSuggestParams()と同じ形）とメタ情報から、
 * stock/score_conditions.csvの1行（CSV列に対応するオブジェクト）を組み立てる。
 *
 * (2) インプット:
 *   meta — { id, name, createdAt, updatedAt, useCount, lastUsedAt }（すべて文字列化済みでよい）
 *   params — { targetSelection: {owners,brokers,accounts}, candidateLabels: {highDiv,perk,usEtf,other},
 *              yieldGood, yieldBad, industryCapPct, industryLowerPct, capPct, targetAnnualDividend,
 *              excludedCandidateIndustries, minInvestAmount, topN }
 * (3) メイン: 各フィールドをCSVセルに収まる文字列へ変換する（配列はJSON文字列化、真偽値は'1'/''）
 * (4) アウトプット: SCORE_CONDITIONS_HEADERSの列名をキーに持つオブジェクト
 */
export function conditionRowFromParams(meta, params) {
    return {
        id: String(meta.id),
        name: meta.name || describeConditionAuto(params),
        created_at: meta.createdAt,
        updated_at: meta.updatedAt,
        use_count: String(meta.useCount || 0),
        last_used_at: meta.lastUsedAt || '',
        owners: serializeSelectionField(params.targetSelection.owners),
        brokers: serializeSelectionField(params.targetSelection.brokers),
        accounts: serializeSelectionField(params.targetSelection.accounts),
        label_high_div: params.candidateLabels.highDiv ? '1' : '',
        label_perk: params.candidateLabels.perk ? '1' : '',
        label_us_etf: params.candidateLabels.usEtf ? '1' : '',
        label_other: params.candidateLabels.other ? '1' : '',
        yield_good: String(params.yieldGood),
        yield_bad: String(params.yieldBad),
        industry_cap: String(params.industryCapPct),
        industry_lower: String(params.industryLowerPct),
        stock_cap: String(params.capPct),
        target_dividend: String(params.targetAnnualDividend),
        excluded_industries: (params.excludedCandidateIndustries || []).join(', '),
        min_invest: String(params.minInvestAmount),
        top_n: String(params.topN),
    };
}

/**
 * stock/score_conditions.csvの1行（parseCsv結果）を、getSuggestParams()と同じ形のパラメータへ復元する。
 *
 * (2) インプット: row — conditionRowFromParamsが出力した形のオブジェクト（parseCsv経由で文字列のみ）
 * (3) メイン: 数値・真偽値・配列を元の型に戻す
 * (4) アウトプット: params（conditionRowFromParamsのparams引数と同じ形）
 */
export function paramsFromConditionRow(row) {
    return {
        targetSelection: {
            owners: deserializeSelectionField(row.owners),
            brokers: deserializeSelectionField(row.brokers),
            accounts: deserializeSelectionField(row.accounts),
        },
        candidateLabels: {
            highDiv: row.label_high_div === '1',
            perk: row.label_perk === '1',
            usEtf: row.label_us_etf === '1',
            other: row.label_other === '1',
        },
        yieldGood: Number(row.yield_good),
        yieldBad: Number(row.yield_bad),
        industryCapPct: Number(row.industry_cap),
        // 2026-09-09追加のため、それ以前に保存された行はこの列を持たない。未保有業種を含む下限ペナルティが
        // ゼロ扱い（無効）になるとratio計算がNaN化するため、既定値0.5にフォールバックする。
        industryLowerPct: Number.isFinite(Number(row.industry_lower)) ? Number(row.industry_lower) : 0.5,
        capPct: Number(row.stock_cap),
        targetAnnualDividend: Number(row.target_dividend),
        excludedCandidateIndustries: (row.excluded_industries || '').split(',').map(s => s.trim()).filter(Boolean),
        minInvestAmount: Number(row.min_invest),
        topN: Number(row.top_n),
    };
}

/**
 * 保存済み計算条件のうち、最も使用回数が多いものを返す（同数ならlast_used_atが新しい方を優先）。
 *
 * (2) インプット: rows — stock/score_conditions.csvのparseCsv結果
 * (3) メイン: use_count降順、同数はlast_used_at降順でソートして先頭を選ぶ
 * (4) アウトプット: 該当行、または0件ならnull
 */
export function pickMostUsedConditionRow(rows) {
    if (!rows || rows.length === 0) return null;
    return [...rows].sort((a, b) => {
        const byCount = (Number(b.use_count) || 0) - (Number(a.use_count) || 0);
        if (byCount !== 0) return byCount;
        return (b.last_used_at || '') < (a.last_used_at || '') ? -1 : (b.last_used_at || '') > (a.last_used_at || '') ? 1 : 0;
    })[0];
}
