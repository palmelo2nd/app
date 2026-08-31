// (1) インポート — なし（Web標準APIのみ使用）

// past/(chk済)_C06_2_(R5)保有銘柄分析.ipynbのcell1（投資金額別のポートフォリオ）・cell3（配当銘柄分析）を
// 移植したもの。旧notebookとの主な違い：
// - ディフェンシブ判定：旧実装は`L_def_score>=60`で二値化してからその配当額シェアで採点していたが、
//   その二値しきい値自体が今回のSIM移行で廃止した「旧・手動しきい値ベースの判定」の名残だったため、
//   `stock/scores.csv`の連続値`defensive_score`（SIM由来）をそのまま配当金額加重平均し、0-100点を
//   0-40点へ線形変換する方式に変更した（good/bad相当の追加閾値は導入せず、SIMの0-100点スケールをそのまま使う）。
// - 実現損益の反映：旧実装は`Data/jyouto/summary.csv`（コード単位の合算、所有者「T」限定のハードコード）を
//   参照していたが、新実装は`stock/realized_gains.csv`が`owner`列を持つため、所有者×コード単位で集計し、
//   特定の所有者名にハードコードしない汎用的な形にした。
// - 対象口座（所有者・証券会社・口座区分）は旧実装のハードコードをやめ、呼び出し側からマルチセレクトの
//   選択値（カテゴリごとの配列。matchesAccountSelection参照）として渡す。2026-08-24、当初の
//   「所有者,証券会社,口座区分」の組み合わせを1行ずつ複数指定する方式（wildcardは空文字）から、
//   所有者・証券会社・口座区分をそれぞれ独立に複数選択できるチェックボックスUIに変更した
//   （3カテゴリの組み合わせをタプルで指定する必要はなく、カテゴリごとに選んだ値のAND条件で十分なため）。

/**
 * 個別コードの配当行（複数年分）から、採用する年間配当を選ぶ。
 * ルール：予想（is_forecast）があれば最新の予想年度を採用、無ければ最新の実績年度を採用（旧notebookと同じ）。
 *
 * (2) インプット: codeDividendRows — 同一コードの配当行の配列（stock/dividends.csvのparseCsv結果の一部。
 *                 各要素は{ year, amount, is_forecast }。is_forecastは'True'/'False'の文字列を想定）
 * (3) メイン: 予想・実績それぞれで最新年度を求め、予想があれば予想を優先する
 * (4) アウトプット: { amount: number, year: number, label: '予想'|'実績' } または該当なしならnull
 */
export function pickAdoptedDividend(codeDividendRows) {
    let latestForecast = null;
    let latestActual = null;

    (codeDividendRows || []).forEach(r => {
        const year = Number(r.year);
        const amount = Number(r.amount);
        if (!Number.isFinite(year) || !Number.isFinite(amount)) return;
        const isForecast = r.is_forecast === 'True' || r.is_forecast === true;
        if (isForecast) {
            if (!latestForecast || year > latestForecast.year) latestForecast = { year, amount };
        } else {
            if (!latestActual || year > latestActual.year) latestActual = { year, amount };
        }
    });

    if (latestForecast) return { amount: latestForecast.amount, year: latestForecast.year, label: '予想' };
    if (latestActual) return { amount: latestActual.amount, year: latestActual.year, label: '実績' };
    return null;
}

/**
 * stock/dividends.csv全体（parseCsvの結果）から、証券コード→採用配当のMapを作る。
 *
 * (2) インプット: dividendRows — stock/dividends.csvのparseCsv結果（全コード分）
 * (3) メイン: コードごとにグループ化し、pickAdoptedDividendを適用する
 * (4) アウトプット: Map<code, { amount, year, label }>（採用配当が無いコードはキー自体を持たない）
 */
export function buildDividendPickMap(dividendRows) {
    const byCode = new Map();
    (dividendRows || []).forEach(r => {
        if (!byCode.has(r.code)) byCode.set(r.code, []);
        byCode.get(r.code).push(r);
    });

    const result = new Map();
    byCode.forEach((rows, code) => {
        const picked = pickAdoptedDividend(rows);
        if (picked) result.set(code, picked);
    });
    return result;
}

/**
 * stock/realized_gains.csv全体から、「所有者×コード」単位の実現損益合計のMapを作る。
 * 旧notebookはコード単位（所有者「T」限定のハードコード）だったが、realized_gains.csvが
 * owner列を持つため所有者ごとに正しく分離できる。
 *
 * (2) インプット: realizedGainsRows — stock/realized_gains.csvのparseCsv結果
 * (3) メイン: 「owner|code」をキーにpnlを合算する
 * (4) アウトプット: Map<"owner|code", number>
 */
export function buildRealizedPnlMap(realizedGainsRows) {
    const map = new Map();
    (realizedGainsRows || []).forEach(r => {
        const pnl = Number(r.pnl);
        if (!Number.isFinite(pnl)) return;
        const key = `${r.owner}|${r.code}`;
        map.set(key, (map.get(key) || 0) + pnl);
    });
    return map;
}

/**
 * 対象口座（所有者・証券会社・口座区分をそれぞれ複数選択したセット）にマッチするかどうか。
 * カテゴリ内はOR（配列に含まれていれば一致）、カテゴリ間はAND。各カテゴリはnullなら絞り込み無し
 * （ワイルドカード）、配列（0件を含む）ならその配列に含まれる値だけを対象にする（0件なら何も一致しない）。
 */
export function matchesAccountSelection(row, selection) {
    const matches = (value, list) => list == null || list.includes(value);
    return matches(row.owner, selection.owners)
        && matches(row.broker, selection.brokers)
        && matches(row.account, selection.accounts);
}

/**
 * 保有銘柄一覧を、スコアリング対象として整形する（銘柄情報・配当・実現損益補正を反映）。
 *
 * (2) インプット:
 *   holdingsRows — stock/holdings.csvのparseCsv結果
 *   context — {
 *     nameMap,             // code -> 銘柄名（master.csv優先、無ければstock/asset_info.csv）
 *     industryMap,         // code -> 業種（同上）
 *     dividendPickMap,     // buildDividendPickMapの結果
 *     realizedPnlMap,      // buildRealizedPnlMapの結果
 *     defensiveScoreMap,   // code -> stock/scores.csvのdefensive_score（数値）
 *   }
 *   params — {
 *     targetSelection,     // { owners, brokers, accounts }（matchesAccountSelection参照。
 *                          // 各カテゴリnull＝全口座対象、配列＝その値だけを対象）
 *     dividendYearWindow,  // 配当年度として許容する年の配列（js/app.jsのgetDividendYearWindowで
 *                          // [昨年, 今年, 来年]を渡す想定。決算期の終わる暦年で配当年度を表記する
 *                          // 企業が多く、進行中の期の予想配当が「来年」表記になりうるため）
 *   }
 * (3) メイン: 対象口座に一致し、業種が判明していて、配当年度が許容範囲内の行だけに絞り、
 *            投資金額・年間配当金額・実現損益補正後投資金額（正の実現益のみ控除）・配当利回りを計算する
 * (4) アウトプット: Array<{ ...holdingsRow, name, industry, dividendPerShare, dividendYear, dividendLabel,
 *                    investAmount, investAmountAdj, dividendAmount, yieldPct, yieldAdjPct,
 *                    realizedPnl, defensiveScore }>
 */
export function buildScoreTargetRows(holdingsRows, context, params) {
    const { nameMap, industryMap, dividendPickMap, realizedPnlMap, defensiveScoreMap } = context;
    const targetSelection = params.targetSelection || { owners: null, brokers: null, accounts: null };
    const dividendYears = new Set(params.dividendYearWindow || []);

    return (holdingsRows || [])
        .filter(row => matchesAccountSelection(row, targetSelection))
        .map(row => {
            const industry = industryMap.get(row.code) || null;
            const picked = dividendPickMap.get(row.code) || null;
            const name = nameMap.get(row.code) || row.code;

            const shares = Number(row.shares);
            const avgCost = Number(row.avg_cost);
            const investAmount = Number.isFinite(shares) && Number.isFinite(avgCost) ? shares * avgCost : NaN;

            const dividendPerShare = picked ? picked.amount : NaN;
            const dividendAmount = Number.isFinite(shares) && Number.isFinite(dividendPerShare) ? shares * dividendPerShare : 0;

            const realizedPnl = realizedPnlMap.get(`${row.owner}|${row.code}`) || 0;
            const investAmountAdj = Number.isFinite(investAmount) ? investAmount - Math.max(0, realizedPnl) : NaN;

            const yieldPct = Number.isFinite(investAmount) && investAmount > 0 ? (dividendAmount / investAmount) * 100 : null;
            const yieldAdjPct = Number.isFinite(investAmountAdj) && investAmountAdj > 0 ? (dividendAmount / investAmountAdj) * 100 : null;

            const defensiveScoreRaw = defensiveScoreMap.get(row.code);
            const defensiveScore = Number.isFinite(Number(defensiveScoreRaw)) ? Number(defensiveScoreRaw) : null;

            return {
                ...row,
                name, industry,
                dividendPerShare: Number.isFinite(dividendPerShare) ? dividendPerShare : null,
                dividendYear: picked ? picked.year : null,
                dividendLabel: picked ? picked.label : null,
                investAmount, investAmountAdj, dividendAmount,
                yieldPct, yieldAdjPct,
                realizedPnl,
                defensiveScore,
            };
        })
        .filter(row => row.industry && !['', '-', '0'].includes(row.industry))
        .filter(row => row.dividendYear !== null && dividendYears.has(row.dividendYear));
}

// ===== 2026-08-29、スコア体系を「推進系（実質利回り＋目標配当達成率）／防衛系（業種分散＋銘柄集中＋DEF）」の
// 2軸に再設計。目標配当達成率（年間配当/目標年間配当）に応じて、推進系140→60点・防衛系60→140点の配点予算を
// 線形補間でスライドさせる（ゴールに近づくほど守り重視にシフトする設計）。各下位指標は「達成比率（0〜1）」を
// 返す関数に変更し、それに動的な配点予算（budgetGrowth/budgetRisk）を掛けて最終得点にする二層構造にした。
// 比率を先に正規化しておくことで、レーダーチャートでの時系列比較（配点予算が変わっても指標の実力を公正に比較
// できる）にもそのまま使える（calcPortfolioScoreのradarMetrics参照）。

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

const GROWTH_YIELD_SHARE = 0.5; // 推進系内の配点比率：実質利回り:達成率＝5:5固定
const RISK_PARTS = { industry: 1, stock: 1, defensive: 2 }; // 防衛系内の配点比率：業種分散:銘柄集中:DEF＝1:1:2固定
const RISK_TOTAL_PARTS = RISK_PARTS.industry + RISK_PARTS.stock + RISK_PARTS.defensive;

/** 目標配当達成率（0〜1）。年間配当をtargetAnnualDividendで割り、100%でクリップする。 */
export function calcAchievementRate(totalDividend, targetAnnualDividend) {
    if (!(targetAnnualDividend > 0)) return 0;
    return clamp01(totalDividend / targetAnnualDividend);
}

/**
 * 達成率に応じた推進系・防衛系の配点予算（常に合計200点）。達成率0%でgrowth=growthMax（既定140）・
 * risk=200-growthMax（既定60）、達成率100%でgrowth=growthMin（既定60）・risk=200-growthMin（既定140）に
 * 線形補間する。
 */
export function calcAxisBudgets(achievementRate, { growthMax = 140, growthMin = 60 } = {}) {
    const growth = growthMax - (growthMax - growthMin) * clamp01(achievementRate);
    return { growth, risk: 200 - growth };
}

/** 配当利回りの達成比率（0〜1）。yieldBad%以下=0、yieldGood%以上=1、間は線形補間（閾値ロジックは旧実装のまま）。 */
export function scoreDividendYieldRatio(totalInvest, totalDividend, { yieldGood, yieldBad }) {
    if (!(totalInvest > 0)) return { yieldPct: 0, ratio: 0 };
    const yieldPct = (totalDividend / totalInvest) * 100;
    return { yieldPct, ratio: clamp01((yieldPct - yieldBad) / (yieldGood - yieldBad)) };
}

/**
 * 業種分散の達成比率（0〜1）。配当金額ベースの業種シェアを、業種ごとに1/業種数の配分で採点する
 * （旧実装は40点満点だったが、閾値ロジックは変更せず満点を1.0に変えただけ）。
 * シェアがlowerPct%未満は線形で0→満点、lowerPct〜upperPct%は満点、upperPct〜decayUpperPct%は線形減点、
 * decayUpperPct%以上は0点。noPenaltyIndustriesに含まれる業種はupperPct%を超えても満点を維持する。
 */
export function scoreIndustryDiversificationRatio(rows, allCategories, { lowerPct, upperPct, decayUpperPct, noPenaltyIndustries }) {
    const totalDividend = rows.reduce((s, r) => s + (r.dividendAmount || 0), 0);
    const shareByIndustry = new Map();
    if (totalDividend <= 0) return { ratio: 0, shareByIndustry };

    const byIndustry = new Map();
    rows.forEach(r => {
        byIndustry.set(r.industry, (byIndustry.get(r.industry) || 0) + (r.dividendAmount || 0));
    });

    const categories = allCategories && allCategories.length ? allCategories : [...byIndustry.keys()];
    const perMax = 1 / categories.length;
    const noPenaltySet = new Set(noPenaltyIndustries || []);

    let ratio = 0;
    categories.forEach(cat => {
        const share = ((byIndustry.get(cat) || 0) / totalDividend) * 100;
        shareByIndustry.set(cat, share);

        let points;
        if (share <= 0) points = 0;
        else if (share < lowerPct) points = perMax * (share / lowerPct);
        else if (noPenaltySet.has(cat)) points = perMax;
        else if (share <= upperPct) points = perMax;
        else if (share < decayUpperPct) points = perMax * (1 - (share - upperPct) / (decayUpperPct - upperPct));
        else points = 0;

        ratio += points;
    });

    return { ratio: clamp01(ratio), shareByIndustry };
}

/**
 * 銘柄集中の達成比率（0〜1）。実現損益補正後投資金額の比率がcapPct%を超えた分（%）を、旧実装の
 * 20点満点基準（1%超過＝1点減点）の強さのまま比率化する（ratio = 1 - penalty/20）。防衛系の配点予算が
 * 変動しても「1%超過の効き方」の体感を変えないよう、20という基準値は固定にしている。
 */
export function scoreStockConcentrationRatio(rows, { capPct }) {
    const totalInvest = rows.reduce((s, r) => s + (Number.isFinite(r.investAmountAdj) ? r.investAmountAdj : 0), 0);
    if (totalInvest <= 0) return 0;

    const byCode = new Map();
    rows.forEach(r => {
        const amount = Number.isFinite(r.investAmountAdj) ? r.investAmountAdj : 0;
        byCode.set(r.code, (byCode.get(r.code) || 0) + amount);
    });

    let penalty = 0;
    byCode.forEach(amount => {
        const sharePct = (amount / totalInvest) * 100;
        penalty += Math.max(0, sharePct - capPct);
    });

    return clamp01(1 - penalty / 20);
}

/**
 * ディフェンシブの達成比率（0〜1）。defensive_scoreが判明している銘柄（かつ配当金額>0）だけを対象に、
 * 配当金額で加重平均したdefensive_score（0-100）を、そのまま/100して比率化する
 * （旧notebookのL_def_score>=60二値化とは異なり、連続値をそのまま使う）。
 */
export function scoreDefensiveRatio(rows) {
    const scored = rows.filter(r => Number.isFinite(r.defensiveScore) && (r.dividendAmount || 0) > 0);
    const totalDividend = scored.reduce((s, r) => s + r.dividendAmount, 0);
    if (totalDividend <= 0) return { weightedAvg: null, ratio: 0 };

    const weightedAvg = scored.reduce((s, r) => s + r.defensiveScore * r.dividendAmount, 0) / totalDividend;
    return { weightedAvg, ratio: clamp01(weightedAvg / 100) };
}

/**
 * ポートフォリオスコア（200点満点）を算出する。buildScoreTargetRowsの出力（対象銘柄一覧）を受け取り、
 * 推進系（実質利回り＋目標配当達成率）・防衛系（業種分散＋銘柄集中＋DEF）の内訳と合計を返す。
 * 達成率に応じて推進系140→60点・防衛系60→140点の配点予算が線形にスライドする（calcAxisBudgets）。
 *
 * (2) インプット: rows — buildScoreTargetRowsの出力、allCategories — 業種分散の分母に使う全業種一覧、
 *                params — { yieldGood, yieldBad, lowerPct, upperPct, decayUpperPct, noPenaltyIndustries,
 *                capPct, targetAnnualDividend }
 * (3) メイン: 各下位指標の達成比率（0〜1）を計算し、達成率から求めた動的な配点予算を掛けて得点化する
 * (4) アウトプット: { totalInvest, totalInvestAdj, totalDividend, yieldPct, yieldAdjPct,
 *                    achievementRate, achievementPct, budgetGrowth, budgetRisk,
 *                    scoreYield, scoreYieldRatio, scoreYieldMax,
 *                    scoreAchievement, scoreAchievementMax,
 *                    scoreIndustry, scoreIndustryRatio, scoreIndustryMax, shareByIndustry,
 *                    scoreStock, scoreStockRatio, scoreStockMax,
 *                    scoreDefensive, scoreDefensiveRatio, scoreDefensiveMax, defensiveWeightedAvg,
 *                    scoreGrowthTotal, scoreRiskTotal, scoreTotal, scoreMax, radarMetrics }
 */
export function calcPortfolioScore(rows, allCategories, params) {
    const totalInvest = rows.reduce((s, r) => s + (Number.isFinite(r.investAmount) ? r.investAmount : 0), 0);
    const totalInvestAdj = rows.reduce((s, r) => s + (Number.isFinite(r.investAmountAdj) ? r.investAmountAdj : 0), 0);
    const totalDividend = rows.reduce((s, r) => s + (r.dividendAmount || 0), 0);

    const yieldRaw = totalInvest > 0 ? (totalDividend / totalInvest) * 100 : 0;
    const yieldResult = scoreDividendYieldRatio(totalInvestAdj, totalDividend, params);
    const industryResult = scoreIndustryDiversificationRatio(rows, allCategories, params);
    const stockRatio = scoreStockConcentrationRatio(rows, params);
    const defensiveResult = scoreDefensiveRatio(rows);

    const achievementRate = calcAchievementRate(totalDividend, params.targetAnnualDividend);
    const { growth: budgetGrowth, risk: budgetRisk } = calcAxisBudgets(achievementRate);

    const scoreYieldMax = budgetGrowth * GROWTH_YIELD_SHARE;
    const scoreAchievementMax = budgetGrowth * (1 - GROWTH_YIELD_SHARE);
    const scoreIndustryMax = budgetRisk * (RISK_PARTS.industry / RISK_TOTAL_PARTS);
    const scoreStockMax = budgetRisk * (RISK_PARTS.stock / RISK_TOTAL_PARTS);
    const scoreDefensiveMax = budgetRisk * (RISK_PARTS.defensive / RISK_TOTAL_PARTS);

    const scoreYield = yieldResult.ratio * scoreYieldMax;
    const scoreAchievement = achievementRate * scoreAchievementMax;
    const scoreIndustry = industryResult.ratio * scoreIndustryMax;
    const scoreStock = stockRatio * scoreStockMax;
    const scoreDefensive = defensiveResult.ratio * scoreDefensiveMax;

    const scoreGrowthTotal = scoreYield + scoreAchievement;
    const scoreRiskTotal = scoreIndustry + scoreStock + scoreDefensive;
    const scoreTotal = scoreGrowthTotal + scoreRiskTotal;

    return {
        totalInvest, totalInvestAdj, totalDividend,
        yieldPct: yieldRaw,
        yieldAdjPct: yieldResult.yieldPct,
        achievementRate, achievementPct: achievementRate * 100,
        budgetGrowth, budgetRisk,
        scoreYield, scoreYieldRatio: yieldResult.ratio, scoreYieldMax,
        scoreAchievement, scoreAchievementMax,
        scoreIndustry, scoreIndustryRatio: industryResult.ratio, scoreIndustryMax,
        shareByIndustry: industryResult.shareByIndustry,
        scoreStock, scoreStockRatio: stockRatio, scoreStockMax,
        scoreDefensive, scoreDefensiveRatio: defensiveResult.ratio, scoreDefensiveMax,
        defensiveWeightedAvg: defensiveResult.weightedAvg,
        scoreGrowthTotal, scoreRiskTotal,
        scoreTotal, scoreMax: 200,
        radarMetrics: [
            { key: 'yield', label: '実質利回り', pct: yieldResult.ratio * 100 },
            { key: 'achievement', label: '達成率', pct: achievementRate * 100 },
            { key: 'industry', label: '業種分散', pct: industryResult.ratio * 100 },
            { key: 'defensive', label: 'DEF', pct: defensiveResult.ratio * 100 },
            { key: 'stock', label: '銘柄集中', pct: stockRatio * 100 },
        ],
    };
}

// ===== ここから銘柄提案（past/(chk済)_C06_2_(R5)保有銘柄分析.ipynbのcell5「推奨銘柄提案」・
// cell9「銘柄詳細」相当）。旧notebookが依存していた`_find_latest_kabuka_file`等の株価参照関数は
// notebook内のどこにも定義が無く（保存時に失われたと見られる）、コメントから挙動を推測して
// stock/prices/{code}.csvベースで作り直した。 =====

/**
 * 候補銘柄プール（証券コードの配列）を、選択されたラベル条件（OR）に基づいて組み立てる。
 * 2026-08-29追加：銘柄提案の候補を「高配当ラベルのみ」から、高配当・優待・米国ETF・その他
 * （いずれのラベルも付いていない銘柄）を選択式にする改修の一部。
 *
 * (2) インプット:
 *   labelsRows — stock/labels.csvのparseCsv結果（{ code, 'L_高配当', 'L_優待', 'L_米国ETF' }の配列）
 *   masterCodes — 「その他」の母集団として使う証券コードの配列（呼び出し側でmaster.csvのstatus=listedに
 *                 絞り込んだものを渡す想定）
 *   selection — { highDiv, perk, usEtf, other }（真偽値。ONにした項目をOR条件で候補プールに加える）
 * (3) メイン: 高配当・優待・米国ETFはlabelsRowsから該当ラベルが立っている行のコードを集め、
 *            その他はmasterCodesのうち三ラベルのいずれも立っていないコードを集める。すべてSetで統合して重複除去する
 * (4) アウトプット: 証券コードの配列（重複なし。順序は保証しない）
 */
export function buildLabelCandidatePool(labelsRows, masterCodes, selection) {
    const codes = new Set();
    const rows = labelsRows || [];

    if (selection.highDiv) rows.forEach(r => { if (r['L_高配当'] === '1') codes.add(r.code); });
    if (selection.perk) rows.forEach(r => { if (r['L_優待'] === '1') codes.add(r.code); });
    if (selection.usEtf) rows.forEach(r => { if (r['L_米国ETF'] === '1') codes.add(r.code); });

    if (selection.other) {
        const labelMap = new Map(rows.map(r => [r.code, r]));
        (masterCodes || []).forEach(code => {
            const row = labelMap.get(code);
            const isLabeled = row && (row['L_高配当'] === '1' || row['L_優待'] === '1' || row['L_米国ETF'] === '1');
            if (!isLabeled) codes.add(code);
        });
    }

    return [...codes];
}

/**
 * 購入株数を計算する（100株単位。100株分の投資金額がminInvestAmount以下なら、
 * minInvestAmountを超える最小の100株単位まで切り上げる。旧notebookのコメントに基づく再実装）。
 */
export function calcBuyShares(price, minInvestAmount) {
    if (!(price > 0)) return NaN;
    if (100 * price > minInvestAmount) return 100;
    const lots = Math.floor(minInvestAmount / (price * 100)) + 1;
    return lots * 100;
}

/**
 * 候補銘柄を1つ追加した場合の仮想的な保有行を作る（calcPortfolioScoreにそのまま渡せる形）。
 * 実現損益補正の対象外（新規購入のため）。
 *
 * (2) インプット: code, info — { name, industry, price, dividendPerShare, defensiveScore }、
 *                minInvestAmount — 最低投資金額
 * (3) メイン: calcBuySharesで購入株数を決め、投資金額・配当金額を計算する
 * (4) アウトプット: 仮想保有行オブジェクト、または価格が無効ならnull
 */
export function buildCandidateRow(code, info, minInvestAmount) {
    const shares = calcBuyShares(info.price, minInvestAmount);
    if (!Number.isFinite(shares)) return null;

    const investAmount = shares * info.price;
    const dividendPerShare = Number.isFinite(info.dividendPerShare) ? info.dividendPerShare : 0;
    const dividendAmount = shares * dividendPerShare;

    return {
        code, owner: 'ADD', broker: '', account: '',
        name: info.name, industry: info.industry,
        shares, avg_cost: info.price,
        investAmount, investAmountAdj: investAmount,
        dividendAmount, dividendPerShare,
        yieldPct: info.price > 0 ? (dividendPerShare / info.price) * 100 : null,
        defensiveScore: info.defensiveScore,
    };
}

/**
 * 候補銘柄一覧について、現状ポートフォリオ（baselineRows）に1銘柄ずつ追加した場合の
 * スコア差分を計算し、差分が大きい順に並べて返す。
 *
 * (2) インプット:
 *   baselineRows — buildScoreTargetRowsの出力（現状ポートフォリオ）
 *   candidates — [{ code, name, industry, price, dividendPerShare, defensiveScore }]（価格取得済みの候補）
 *   allCategories, params — calcPortfolioScoreと同じ
 *   minInvestAmount — 購入株数計算に使う最低投資金額
 * (3) メイン: baselineのスコアを計算し、候補ごとに1銘柄追加した仮想ポートフォリオのスコアと比較する
 * (4) アウトプット: { baseline, ranked: [{ ...candidateRow, scoreAfter, deltaTotal, deltaGrowthTotal,
 *                    deltaRiskTotal, deltaYield, deltaAchievement, deltaIndustry, deltaStock,
 *                    deltaDefensive }] }（ranked はdeltaTotal降順）
 */
export function rankCandidates(baselineRows, candidates, allCategories, params, minInvestAmount) {
    const baseline = calcPortfolioScore(baselineRows, allCategories, params);

    const ranked = candidates
        .map(c => buildCandidateRow(c.code, c, minInvestAmount))
        .filter(Boolean)
        .map(candidateRow => {
            const scoreAfter = calcPortfolioScore([...baselineRows, candidateRow], allCategories, params);
            return {
                ...candidateRow,
                scoreAfter,
                deltaTotal: scoreAfter.scoreTotal - baseline.scoreTotal,
                deltaGrowthTotal: scoreAfter.scoreGrowthTotal - baseline.scoreGrowthTotal,
                deltaRiskTotal: scoreAfter.scoreRiskTotal - baseline.scoreRiskTotal,
                deltaYield: scoreAfter.scoreYield - baseline.scoreYield,
                deltaAchievement: scoreAfter.scoreAchievement - baseline.scoreAchievement,
                deltaIndustry: scoreAfter.scoreIndustry - baseline.scoreIndustry,
                deltaStock: scoreAfter.scoreStock - baseline.scoreStock,
                deltaDefensive: scoreAfter.scoreDefensive - baseline.scoreDefensive,
            };
        })
        .sort((a, b) => b.deltaTotal - a.deltaTotal);

    return { baseline, ranked };
}
