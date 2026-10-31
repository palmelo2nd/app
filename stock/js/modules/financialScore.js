// (1) インポート — なし（Web標準APIのみ使用）

// 業績スコア（高配当ラベル判定用。2026-10-31追加）。
// 旧実装（#Python/250811_株式投資自動化/Python/01_Code/03_スコア化R1.ipynb）の「主要8項目」スコアを、
// ルールから見直して作り直したもの。旧実装からの主な変更点：
//   - 各項目0〜100点・合計も0〜100点（重み付き平均）に統一した（旧実装は単純合計で最大約750点）。
//   - 注意すべき条件（営業CF赤字・減配・配当性向100%超・自己資本比率30%未満）は合計スコアからの「減点」にする。
//     当初は点数とは別の「NGフラグ」にしたが、10年のうち1回でも該当すると付くため全銘柄の約半数に付き、
//     絞り込みに使えなかったので、回数に応じた減点に変えた（2026-10-31）。減点理由はngに入れて一覧に表示する。
//   - 予想値も「未来を見る」ために計算に含める（入力データの最新年が予想値でもそのまま使う）。
//   - 配当性向は低いほど高得点（20%以下＝100点。高配当で配当性向が低いのは余力がある証拠という判断）。
//   - コロナの影響は売上高に混ぜず、独立した「異常時耐性」項目にした（営業利益率の落ち込み幅＋回復の早さ）。
//   - 配当利回りは評価しない（実際に買うときに別途スクリーニングする方針のため）。

/** 項目キーと表示名。合計スコアの重み（weight）もここで定義する。 */
export const FIN_ITEMS = [
    { key: 'revenue',  label: '売上高',       weight: 1 },
    { key: 'eps',      label: 'EPS',          weight: 1.5 },
    { key: 'margin',   label: '利益率',       weight: 1 },
    { key: 'equity',   label: '自己資本比率', weight: 1 },
    { key: 'opcf',     label: '営業CF',       weight: 1 },
    { key: 'cash',     label: '現金等',       weight: 1 },
    { key: 'dividend', label: '配当',         weight: 1 },
    { key: 'payout',   label: '配当性向',     weight: 1 },
    { key: 'crisis',   label: '異常時耐性',   weight: 1 },
];

/** 採点基準の既定値。xs→ysの折れ線（区間ごとの線形補間。範囲外は端の値）で点数に変換する。 */
export const DEFAULT_FIN_PARAMS = {
    windowYears: 10,  // 傾向・減配判定に使う直近年数（予想年を含む）
    avgYears: 5,      // 平均を取る項目（利益率・自己資本比率・配当性向）の直近年数
    // 1. 売上高／2. EPS：年率の成長率（回帰の傾き÷平均）→点数。安定性（R²）で×(0.7+0.3×R²)補正
    growthCurve:   { xs: [-0.05, 0, 0.05, 0.10], ys: [0, 40, 80, 100] },
    stabilityBase: 0.7,
    // 3. 利益率：5年平均（%）。銀行・保険（営業利益率が無い銘柄）はROEで代用
    marginCurve:   { xs: [0, 5, 10, 20], ys: [0, 30, 70, 100] },
    roeCurve:      { xs: [0, 5, 8, 12],  ys: [0, 30, 70, 100] },
    // 4. 自己資本比率：5年平均（%）。銀行・保険は別の基準
    equityCurve:     { xs: [30, 40, 50, 80, 100], ys: [0, 50, 70, 90, 100] },
    equityBankCurve: { xs: [5, 10, 15, 20, 25, 30], ys: [0, 50, 70, 85, 95, 100] },
    equityNgBelow: 30, // 一般企業のみ。これ未満は減点（penaltyEquityLow）
    // 5. 営業CF／6. 現金等：年率の傾向→点数
    opcfCurve: { xs: [-0.10, 0, 0.05, 0.10], ys: [0, 60, 80, 100] },
    cashCurve: { xs: [-0.05, 0, 0.05, 0.10], ys: [0, 60, 80, 100] },
    // 7. 配当：減配していない年数（最大windowYears-1年で満点）×0.6＋成長率×0.4
    dividendStreakShare: 0.6,
    dividendGrowthCurve: { xs: [-0.05, 0, 0.05, 0.10], ys: [0, 60, 80, 100] },
    dividendCutTolerance: 0.001, // 前年比でこの割合を超えて下がったら減配とみなす（端数の表記揺れ対策）
    // 8. 配当性向：5年平均（%）。低いほど高得点。1年だけの外れ値（IQR法）は平均から除く
    payoutCurve: { xs: [20, 30, 50, 70, 100], ys: [100, 90, 70, 40, 0] },
    payoutNgAbove: 100, // これを超えると減点（penaltyPayoutOver）
    payoutOutlierIqrK: 1.5,
    // 9. 異常時耐性（コロナ）：基準年の利益率に対する、危機年（2年のうち悪い方）の落ち込み幅と回復の早さ
    crisisBaseYear: 2019,
    crisisYears: [2020, 2021],
    crisisDropCurve:     { xs: [0, 2, 5, 10], ys: [100, 70, 40, 0] }, // 落ち込み幅（%ポイント）
    crisisRecoveryScore: [100, 70, 40], // 危機年の翌年・2年後・3年後に基準年の水準へ戻った場合の点数（それ以降・未回復は0）
    crisisDropShare: 0.5,
    // 減点（合計スコアから引く点数。合計は0未満にしない）。回数で数えるものは直近windowYears年（予想年を含む）の回数
    penaltyOpcfDeficitPerYear: 5,  // 営業CF赤字1年ごと
    penaltyOpcfDeficitMax: 15,
    penaltyDividendCutPerTime: 5,  // 減配1回ごと（予想年の減配を含む）
    penaltyDividendCutMax: 15,
    penaltyPayoutOver: 10,         // 配当性向（5年平均）がpayoutNgAboveを超える
    penaltyEquityLow: 10,          // 自己資本比率（5年平均）がequityNgBelow未満（銀行・保険を除く）
};

// (2) インプット
//   seriesByMetric — { revenue, eps, op_margin, roe, equity_ratio, op_cf, cash, payout } の各値が
//                    [{ year: number, value: number }]（年昇順でなくてもよい。予想年を含んでよい）
//   dividends      — [{ year: number, amount: number }]（stock/dividends.csvの該当銘柄分。予想年を含んでよい）
//   params         — DEFAULT_FIN_PARAMSの一部を上書きするオブジェクト（省略可）

// (3) メイン機能

/** xs→ysの折れ線で点数に変換する（xsは昇順。範囲外は端の値）。 */
export function piecewise(x, { xs, ys }) {
    if (!Number.isFinite(x)) return null;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 0; i < xs.length - 1; i++) {
        if (x <= xs[i + 1]) {
            const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
            return ys[i] + t * (ys[i + 1] - ys[i]);
        }
    }
    return ys[ys.length - 1];
}

/** 年昇順・数値化・重複年除去（後勝ち）した系列を返す。 */
function cleanSeries(series) {
    const map = new Map();
    (series || []).forEach(p => {
        const year = Number(p.year);
        const value = Number(p.value ?? p.amount);
        if (Number.isInteger(year) && Number.isFinite(value)) map.set(year, value);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value }));
}

/** 直近n年分（最新年から数えてn年の範囲）に絞る。 */
function lastYears(series, n) {
    if (series.length === 0) return series;
    const lastYear = series[series.length - 1].year;
    return series.filter(p => p.year > lastYear - n);
}

function mean(values) {
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/**
 * 年率の傾向（最小二乗法の傾き÷平均の絶対値）とR²を返す。2点未満はnull。
 * 平均の絶対値で割るのは、EPS・営業CFのように負の値を取りうる系列でも符号が反転しないようにするため（旧実装のabs_mean方式）。
 */
export function trendRate(series) {
    if (series.length < 2) return { rate: null, r2: null };
    const xs = series.map(p => p.year);
    const ys = series.map(p => p.value);
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const base = mean(ys.map(Math.abs));
    const rate = base > 0 ? slope / base : null;
    const r2 = syy > 1e-12 ? Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy))) : 1;
    return { rate, r2 };
}

/** 直近n件の平均。ちょうどn件そろっていて、IQR法で外れ値が1件だけ見つかった場合はそれを除いて平均する（旧実装の配当性向ルール）。 */
function meanWithOneOutlierRule(values, k) {
    if (values.length === 0) return { avg: null, outlierRemoved: false };
    const sorted = [...values].sort((a, b) => a - b);
    const q = p => {
        const pos = (sorted.length - 1) * p;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
    const isOut = v => v < q1 - k * iqr || v > q3 + k * iqr;
    const outCount = values.filter(isOut).length;
    if (values.length >= 4 && outCount === 1) return { avg: mean(values.filter(v => !isOut(v))), outlierRemoved: true };
    return { avg: mean(values), outlierRemoved: false };
}

/** 成長系（売上高・EPS）：成長率の点数×安定性補正。 */
function scoreGrowth(series, p) {
    const { rate, r2 } = trendRate(series);
    if (rate === null) return { score: null, rate: null, r2: null };
    const base = piecewise(rate, p.growthCurve);
    const score = base * (p.stabilityBase + (1 - p.stabilityBase) * r2);
    return { score, rate, r2 };
}

/** 配当：直近から遡って減配していない年数と成長率。cutCountは期間内の減配回数（予想年の減配を含む）。 */
function scoreDividend(series, p) {
    if (series.length === 0) return { score: null, streak: null, cutCount: 0, rate: null };
    const isCut = i => series[i].value < series[i - 1].value * (1 - p.dividendCutTolerance);
    let streak = 0;
    for (let i = series.length - 1; i >= 1 && !isCut(i); i--) streak++;
    let cutCount = 0;
    for (let i = 1; i < series.length; i++) if (isCut(i)) cutCount++;
    // ループを抜けずに最古年まで到達した場合も、windowの範囲より前の減配は見ない（seriesはwindowで絞り込み済み）
    const maxStreak = Math.max(1, p.windowYears - 1);
    const streakScore = Math.min(streak, maxStreak) / maxStreak * 100;
    const { rate } = trendRate(series);
    const growthScore = rate === null ? 0 : piecewise(rate, p.dividendGrowthCurve);
    const allZero = series.every(pt => pt.value <= 0);
    const score = allZero ? 0 : p.dividendStreakShare * streakScore + (1 - p.dividendStreakShare) * growthScore;
    return { score, streak, cutCount, rate };
}

/** 異常時耐性：基準年の利益率（銀行はROE）に対する危機年の落ち込み幅と、基準年の水準へ戻るまでの年数。 */
function scoreCrisis(series, p) {
    const byYear = new Map(series.map(pt => [pt.year, pt.value]));
    const base = byYear.get(p.crisisBaseYear);
    const crisisPoints = p.crisisYears.filter(y => byYear.has(y)).map(y => ({ year: y, value: byYear.get(y) }));
    if (!Number.isFinite(base) || crisisPoints.length === 0) return { score: null, drop: null, recoveryYears: null };

    const low = crisisPoints.reduce((a, b) => (b.value < a.value ? b : a));
    const drop = base - low.value;
    if (drop <= 0) return { score: 100, drop, recoveryYears: 0 };

    const dropScore = piecewise(drop, p.crisisDropCurve);
    const recovered = series.find(pt => pt.year > low.year && pt.value >= base);
    const recoveryYears = recovered ? recovered.year - low.year : null;
    const recoveryScore = recoveryYears !== null && recoveryYears <= p.crisisRecoveryScore.length
        ? p.crisisRecoveryScore[recoveryYears - 1] : 0;
    const score = p.crisisDropShare * dropScore + (1 - p.crisisDropShare) * recoveryScore;
    return { score, drop, recoveryYears };
}

/**
 * 1銘柄分の業績スコアを計算する。
 * 項目の点数が算出できない（データが無い）場合はnullとし、合計は算出できた項目だけの重み付き平均にする
 * （データが無い項目を0点扱いにすると、上場年数が短いだけで不当に低くなるため）。
 */
export function calcFinancialScore(seriesByMetric, dividends, params = {}) {
    const p = { ...DEFAULT_FIN_PARAMS, ...params };
    const get = key => cleanSeries(seriesByMetric?.[key]);
    const win = key => lastYears(get(key), p.windowYears);
    const recentAvg = key => mean(lastYears(get(key), p.avgYears).map(pt => pt.value));

    // 営業利益率が無く、ROEがある銘柄は銀行・保険等とみなす（旧実装と同じ判定）
    const isBank = get('op_margin').length === 0 && get('roe').length > 0;
    const ng = [];      // 減点理由（表示用）
    let penalty = 0;    // 減点の合計
    const items = {};
    const details = { isBank };

    const revenue = scoreGrowth(win('revenue'), p);
    items.revenue = revenue.score;
    details.revenueRate = revenue.rate;

    const eps = scoreGrowth(win('eps'), p);
    items.eps = eps.score;
    details.epsRate = eps.rate;

    const marginAvg = recentAvg(isBank ? 'roe' : 'op_margin');
    items.margin = marginAvg === null ? null : piecewise(marginAvg, isBank ? p.roeCurve : p.marginCurve);
    details.marginAvg = marginAvg;

    const equityAvg = recentAvg('equity_ratio');
    items.equity = equityAvg === null ? null : piecewise(equityAvg, isBank ? p.equityBankCurve : p.equityCurve);
    details.equityAvg = equityAvg;
    if (!isBank && equityAvg !== null && equityAvg < p.equityNgBelow) {
        ng.push(`自己資本比率${p.equityNgBelow}%未満`);
        penalty += p.penaltyEquityLow;
    }

    // 銀行・保険は預金・保険料の出入りで営業CFが大きくマイナスになるのが通常のため、営業CFは評価しない
    if (!isBank) {
        const opcf = win('op_cf');
        const { rate } = trendRate(opcf);
        items.opcf = rate === null ? null : piecewise(rate, p.opcfCurve);
        const deficitYears = opcf.filter(pt => pt.value < 0).length;
        if (deficitYears > 0) {
            ng.push(`営業CF赤字${deficitYears}年`);
            penalty += Math.min(deficitYears * p.penaltyOpcfDeficitPerYear, p.penaltyOpcfDeficitMax);
        }
    } else {
        items.opcf = null;
    }

    const { rate: cashRate } = trendRate(win('cash'));
    items.cash = cashRate === null ? null : piecewise(cashRate, p.cashCurve);

    const dividend = scoreDividend(lastYears(cleanSeries(dividends), p.windowYears), p);
    // 配当データが無い（無配・未取得）銘柄は、他の項目と違い「データが無いので合計から除く」とせず0点にする
    // （除くと無配の銘柄が業績だけで上位に来てしまい、高配当ラベル判定の目的に合わないため）
    items.dividend = dividend.score ?? 0;
    details.dividendStreak = dividend.streak;
    // 配当データなしは配当項目が0点になっているため、追加の減点はせず理由の表示だけ行う
    if (dividend.score === null) ng.push('配当データなし');
    else if (dividend.cutCount > 0) {
        ng.push(`減配${dividend.cutCount}回`);
        penalty += Math.min(dividend.cutCount * p.penaltyDividendCutPerTime, p.penaltyDividendCutMax);
    }

    // 配当性向は赤字年（0以下）を平均から除く（意味のある比率にならないため）
    const payoutValues = lastYears(get('payout'), p.avgYears).map(pt => pt.value).filter(v => v > 0);
    const payout = meanWithOneOutlierRule(payoutValues, p.payoutOutlierIqrK);
    items.payout = payout.avg === null ? null : piecewise(payout.avg, p.payoutCurve);
    details.payoutAvg = payout.avg;
    if (payout.avg !== null && payout.avg > p.payoutNgAbove) {
        ng.push(`配当性向${p.payoutNgAbove}%超`);
        penalty += p.penaltyPayoutOver;
    }

    const crisis = scoreCrisis(get(isBank ? 'roe' : 'op_margin'), p);
    items.crisis = crisis.score;
    details.crisisDrop = crisis.drop;
    details.crisisRecoveryYears = crisis.recoveryYears;

    let weighted = 0, weightSum = 0, itemCount = 0;
    FIN_ITEMS.forEach(({ key, weight }) => {
        if (Number.isFinite(items[key])) {
            weighted += items[key] * weight;
            weightSum += weight;
            itemCount++;
        }
    });
    // baseTotal＝9項目の重み付き平均、total＝そこから減点を引いたもの（0未満にしない）
    const baseTotal = weightSum > 0 ? weighted / weightSum : null;
    const total = baseTotal === null ? null : Math.max(0, baseTotal - penalty);

    // (4) アウトプット
    return { total, baseTotal, penalty, items, ng, itemCount, details };
}
