import { loadToken, saveToken } from './modules/storage.js';
import {
    dispatchWorkflow, fetchFile, fetchFileIfExists, listFilesRecursive, commitFile,
    getLatestWorkflowRun, getWorkflowRun, getLatestCommit
} from './modules/github.js';
import { parseCsv, stringifyCsv } from './modules/csv.js';
import { parseSbiHoldingsCsv, parseRakutenHoldingsCsv } from './modules/brokerCsv.js';
import {
    parseSbiDomesticRealizedGainsCsv, parseSbiForeignRealizedGainsCsv,
    parseSbiFundRealizedGainsCsv, parseRakutenRealizedGainsCsv,
} from './modules/brokerCsv.js';
import { summarizeHoldingsHierarchy } from './modules/holdingsSummary.js';
import { calcDefensiveScore, REFERENCE_LABELS, buildHistogramBins } from './modules/defensiveScore.js';
import {
    buildDividendPickMap, buildRealizedPnlMap, buildScoreTargetRows, calcPortfolioScore, rankCandidates,
    buildLabelCandidatePool,
} from './modules/portfolioScore.js';
import { buildRadarPoints, buildRadarAxisPoints, pointsToSvgAttr, buildLineChartPoints } from './modules/chartGeometry.js';

const OWNER              = 'palmelo2nd';
const CODE_REPO          = 'app';        // ワークフローファイルが置かれているコードリポジトリ
const DATA_REPO          = 'app_data';   // 銘柄マスタ・株価データが置かれているデータリポジトリ
const CODE_REPO_BRANCH   = 'main';
const DATA_REPO_BRANCH   = 'main';
const PRICE_WORKFLOW_FILE      = 'fetch-stock-prices.yml';
const PRICE_BULK_WORKFLOW_FILE = 'fetch-stock-prices-bulk.yml';
const PRICE_ISSUES_WORKFLOW_FILE = 'fetch-stock-prices-by-codes.yml'; // 日付グループ単位の再取得で使う（証券コードを指定して起動）
const VALIDATE_WORKFLOW_FILE   = 'validate-stock-prices.yml';
const FRESHNESS_WORKFLOW_FILE  = 'check-price-freshness.yml';
const MASTER_PATH   = 'stock/master.csv';
const MASTER_COLUMNS = [
    'id', 'code', 'name', 'market', 'segment', 'asset_type',
    'industry33_code', 'industry33_name', 'industry17_code', 'industry17_name',
    'scale_code', 'scale_name', 'status', 'source', 'as_of',
]; // scripts/build_stock_master.pyのOUTPUT_COLUMNSと揃える
const PRICES_DIR    = 'stock/prices';
const VALIDATION_REPORT_PATH = 'stock/validation_report.json';
const FRESHNESS_REPORT_PATH  = 'stock/freshness_report.json';
const README_PATH   = 'stock/README.md'; // コードリポジトリ側（アプリ概要ドキュメント）
const HOLDINGS_PATH = 'stock/holdings.csv';
const HOLDINGS_HEADERS = ['id', 'owner', 'broker', 'account', 'code', 'shares', 'avg_cost', 'updated_at'];
const HOLDINGS_CODE_DISPLAY_MAX = 10; // 一覧表のコード列・銘柄名列の最大表示文字数（全角10文字相当。超過分は…で省略）
// 売買履歴（実現損益）。past/(chk済)_C05_(R3)譲渡益の記録.ipynbを移植。holdings.csvと異なり「積み上げるデータ」
// （縦持ちの取引ログ）のため、保存は全体洗い替えではなく追記型マージにする
const REALIZED_GAINS_PATH = 'stock/realized_gains.csv';
const REALIZED_GAINS_HEADERS = ['id', 'owner', 'broker', 'asset_type', 'code', 'name', 'date', 'pnl'];
const BULK_ASSET_TYPES = ['内国株式', 'ETF・ETN']; // fetch_prices.pyの--asset-types既定値と揃えている
// 「更新最終日」「データ品質」の内訳を内国株式／その他（ETF等）に分ける分類ラベル（2026-08-18追加）。
// yfinanceはETF側で更新漏れ・欠損が起きやすく、内国株式と混在させると個別株側の問題が埋もれるため区別する。
const DOMESTIC_STOCK_CATEGORY = '内国株式';
const OTHER_ASSET_CATEGORY = 'その他（ETF等）';
const IRBANK_PATH = 'stock/irbank.csv';
const IRBANK_ASSET_TYPE = '内国株式'; // notebooks/C01_IRBANK企業ID取得.ipynbの対象絞り込みと揃えている（ETF・REIT等はIRBANKの個別企業ページを持たない）
// IRBANKに個別企業ページが無い等、手動確認のうえ「未取得（要再挑戦）」対象から除外する銘柄一覧（積み上げるデータ。
// delisted.csv/extra_targets.csvと同じ即時コミット方式）。2026-08-29追加
const IRBANK_EXCLUDED_PATH = 'stock/irbank_excluded.csv';
const IRBANK_EXCLUDED_HEADERS = ['code', 'note', 'updated_at'];
const DIVIDENDS_PATH = 'stock/dividends.csv'; // 年別1株配当（縦持ち）。notebooks/C04_配当情報取得.ipynbが生成
const DIVIDEND_HEADERS = ['code', 'year', 'amount', 'is_forecast', 'updated_at'];
const LABELS_PATH = 'stock/labels.csv';
const LABEL_HEADERS = ['code', 'L_高配当', 'L_優待', 'L_米国ETF', 'updated_at'];
// master.csvに載らない資産（投資信託・海外ETF等、JPX非上場の保有銘柄）の名称・業種を手動登録する
// （積み上げるデータ。past/(chk済)_C06_1_(R4)銘柄情報の手動追記.ipynbのupdate_idmapを移植）
const SCORES_PATH = 'stock/scores.csv'; // 銘柄選定用のスコア一覧。データ更新タブ（DEF）の「適用」で更新（積み上げるデータ。master.csvの再生成では消えない）
const SCORES_HEADERS = ['code', 'defensive_score', 'updated_at'];
// スコア履歴（推進系／防衛系の時系列比較・レーダーチャートの過去スナップショット用）。積み上げるデータ
// （記録のたびに追記するのみで洗い替えしない）。「スコア」タブの「スコアを記録」ボタンから【全体】ブロックの
// 結果のみを記録する（所有者別は組み合わせ爆発を避けるため対象外。2026-08-29追加）
const SCORE_HISTORY_PATH = 'stock/score_history.csv';
const SCORE_HISTORY_HEADERS = [
    'id', 'recorded_at', 'note',
    'total_invest_adj', 'total_dividend', 'achievement_rate',
    'budget_growth', 'budget_risk',
    'score_yield', 'score_achievement', 'score_industry', 'score_stock', 'score_defensive',
    'score_growth_total', 'score_risk_total', 'score_total',
    // レーダーチャートの過去スナップショット比較用（配点予算に左右されない0〜1の達成比率。
    // achievement_rate自体が達成率の比率そのものなので、達成率列以外の4指標分をここに追加する）
    'yield_ratio', 'industry_ratio', 'stock_ratio', 'defensive_ratio',
];
const DELISTED_PATH = 'stock/delisted.csv'; // 上場廃止銘柄一覧。人が確認して登録する（自動判定はしない）
const DELISTED_HEADERS = ['code', 'note', 'updated_at'];
const EXTRA_TARGETS_PATH = 'stock/extra_targets.csv'; // master.csvには無いが継続更新したい追加対象（N225・未反映の新規上場銘柄など）
const EXTRA_TARGETS_HEADERS = ['code', 'yf_ticker', 'note', 'updated_at'];

// ===== GitHub PAT入力欄 =====
// app（コードリポジトリ）・app_data（データリポジトリ）の両方に対して
// Actions・Contentsをread/writeできる単一のPersonal Access Tokenを使う。
// 以前はリポジトリごとにID/PW2つの欄に分けていたが（最小権限の原則を意図したもの）、
// 実運用では1つのトークンに両リポジトリの権限をまとめて付与する運用になったため統合した。
// 一度入力すればlocalStorageに保存され、次回以降は自動的に入力済みの状態になる。
const tokenInput = document.getElementById('token-input');

/** GitHub PATを返す。 */
export function getTokenValue() {
    return tokenInput ? tokenInput.value.trim() : '';
}

window.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved && tokenInput) tokenInput.value = saved;
    // TOPは初期表示タブ（クリック無しで見える）のため、他タブと違いページ読込時点でも自動集計する
    if (saved) loadDashboardSummary();
});

document.getElementById('token-save-btn')?.addEventListener('click', () => {
    saveToken(getTokenValue());
});

// ===== ページ切り替え（タブ） =====
// 2026-08-23：旧「保有・履歴」タブは「データ更新」タブ内のモード切り替え（保有銘柄／売買履歴／株価／企業ID／配当）
// に統合し、旧「銘柄提案」タブは「スコア」タブ内のモード切り替え（現状スコア／銘柄提案）に統合した
// （どちらも「データの入力・取得」「ポートフォリオの分析」という同じ性質の操作をまとめる目的）。
// 2026-08-24：旧「銘柄属性」タブ（ラベル／銘柄情報）、旧「SIM」タブ（DEF）も同じ理由で「データ更新」タブ内の
// モード切り替えに統合した。あわせて旧「ダッシュボード」タブは表示名を「TOP」に変更した（内部id・データ構造は
// dashboardのまま。表示名のみの変更）。

const STOCK_VIEWS = ['dashboard', 'dataupdate', 'score', 'info'];

function renderStockView(view) {
    STOCK_VIEWS.forEach(v => {
        document.getElementById(`tab-${v}`)?.classList.toggle('view-btn--active', v === view);
        const panel = document.getElementById(`view-${v}`);
        if (panel) panel.style.display = v === view ? '' : 'none';
    });
}

STOCK_VIEWS.forEach(v => {
    document.getElementById(`tab-${v}`)?.addEventListener('click', () => renderStockView(v));
});

// ===== データ更新：表示対象の切り替え（保有銘柄／売買履歴／株価／企業ID／配当／ラベル／銘柄情報／DEF） =====
const DATAUPDATE_MODES = ['holdings', 'gains', 'price', 'irbank', 'dividend', 'labels', 'assetinfo', 'def'];

function renderDataupdateMode(mode) {
    DATAUPDATE_MODES.forEach(m => {
        document.getElementById(`dataupdate-mode-${m}`)?.classList.toggle('view-btn--active', m === mode);
        const panel = document.getElementById(`dataupdate-${m}-panel`);
        if (panel) panel.style.display = m === mode ? '' : 'none';
    });
}

/** データ更新タブのモードに応じた自動読み込みを行う（トークン未入力時は何もしない）。DEFは「計算」ボタン
 *  を押すまで何も取得しない試算専用モードのため、自動読み込みの対象にしない。 */
function autoLoadDataupdateMode(mode) {
    if (!getTokenValue()) return;
    if (mode === 'holdings' || mode === 'gains') { loadHoldings(); loadRealizedGains(); }
    else if (mode === 'price')     loadFreshnessStatus();
    else if (mode === 'irbank')    loadIrbankStatus();
    else if (mode === 'dividend')  loadDividendStatus();
    else if (mode === 'labels')    loadLabels();
    else if (mode === 'assetinfo') loadMasterFundList();
}

DATAUPDATE_MODES.forEach(mode => {
    document.getElementById(`dataupdate-mode-${mode}`)?.addEventListener('click', () => {
        renderDataupdateMode(mode);
        autoLoadDataupdateMode(mode);
    });
});

// データ更新タブを開いたとき、トークンが入力済みなら現在のモード（既定：保有銘柄）を自動読み込みする
document.getElementById('tab-dataupdate')?.addEventListener('click', () => {
    const activeMode = DATAUPDATE_MODES.find(m => document.getElementById(`dataupdate-mode-${m}`)?.classList.contains('view-btn--active')) || 'holdings';
    autoLoadDataupdateMode(activeMode);
});

// TOPタブを開いたとき、トークンが入力済みなら資産サマリーを自動集計する
document.getElementById('tab-dashboard')?.addEventListener('click', () => {
    if (getTokenValue()) loadDashboardSummary();
});

// ===== TOP：資産サマリー（所有者 → 口座区分 → 証券会社の階層集計） =====
let dashboardSummaryHierarchy = []; // [{ owner, total, accounts: [{ account, total, brokers: [{ broker, total }] }] }]

/** stock/holdings.csv を読み込み、所有者→口座区分→証券会社の階層で総投資金額を集計して表示する。 */
async function loadDashboardSummary() {
    const statusEl = document.getElementById('dashboard-summary-status');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    statusEl.textContent = '集計中...';

    try {
        const text = await fetchFileIfExists(token, OWNER, DATA_REPO, HOLDINGS_PATH);
        const rows = text ? parseCsv(text) : [];
        dashboardSummaryHierarchy = summarizeHoldingsHierarchy(rows);

        renderDashboardSummaryTable();
        statusEl.textContent = rows.length === 0
            ? '保有銘柄が登録されていません。'
            : `${rows.length}件の保有銘柄から集計しました。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `集計に失敗しました: ${error.message}`;
    }
}

/** 資産サマリーの表に1行追加する（区分ラベル・金額・階層に応じたスタイル用クラス）。 */
function appendDashboardSummaryRow(tbody, label, amount, formatYen, rowClass) {
    const tr = document.createElement('tr');
    tr.className = rowClass;
    const labelTd = document.createElement('td');
    labelTd.textContent = label;
    const amountTd = document.createElement('td');
    amountTd.textContent = formatYen(amount);
    tr.append(labelTd, amountTd);
    tbody.appendChild(tr);
}

/**
 * 資産サマリーの表を描画する。所有者→口座区分→証券会社の順に行を並べ、各階層の小計を表示し、
 * 最後に全体の合計行を追加する。「非表示」チェックボックスがONの間は金額をマスクして表示する。
 */
function renderDashboardSummaryTable() {
    const table = document.getElementById('dashboard-summary-table');
    if (!table) return;

    const hidden = document.getElementById('dashboard-hide-amounts')?.checked ?? true;
    const formatYen = (amount) => hidden ? '●●●●●●' : `${Math.round(amount).toLocaleString('ja-JP')}円`;

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    ['区分', '総投資金額'].forEach(col => { const th = document.createElement('th'); th.textContent = col; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (dashboardSummaryHierarchy.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 2;
        td.className = 'empty-cell';
        td.textContent = '保有銘柄が登録されていません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        let grandTotal = 0;
        dashboardSummaryHierarchy.forEach(ownerEntry => {
            appendDashboardSummaryRow(tbody, ownerEntry.owner, ownerEntry.total, formatYen, 'dashboard-summary-row--owner');
            grandTotal += ownerEntry.total;
            ownerEntry.accounts.forEach(accountEntry => {
                appendDashboardSummaryRow(tbody, accountEntry.account, accountEntry.total, formatYen, 'dashboard-summary-row--account');
                accountEntry.brokers.forEach(brokerEntry => {
                    appendDashboardSummaryRow(tbody, brokerEntry.broker, brokerEntry.total, formatYen, 'dashboard-summary-row--broker');
                });
            });
        });

        appendDashboardSummaryRow(tbody, '合計', grandTotal, formatYen, 'dashboard-summary-total-row');
    }
    table.replaceChildren(thead, tbody);
}

document.getElementById('dashboard-reload-btn')?.addEventListener('click', loadDashboardSummary);
document.getElementById('dashboard-hide-amounts')?.addEventListener('change', renderDashboardSummaryTable);

// ===== Info：コードリポジトリのREADME.md（アプリ概要）を取得しMarkdownとして表示 =====
async function loadInfoReadme() {
    const el = document.getElementById('info-content');
    const token = getTokenValue();
    if (!token) { el.textContent = 'トークンを入力してください。'; return; }

    el.textContent = '読み込み中...';

    try {
        const text = await fetchFile(token, OWNER, CODE_REPO, README_PATH);
        el.innerHTML = window.marked.parse(text);
    } catch (error) {
        console.error(error);
        el.textContent = `読み込みに失敗しました: ${error.message}`;
    }
}

// Infoタブを開いたとき、トークンが入力済みなら自動的に読み込む
document.getElementById('tab-info')?.addEventListener('click', () => {
    if (getTokenValue()) loadInfoReadme();
});

document.getElementById('info-reload-btn')?.addEventListener('click', loadInfoReadme);

// ===== データ更新：株価取得（yfinance）のGitHub Actionsワークフローを起動 =====
document.getElementById('price-update-run-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('price-update-status');
    const codesInput  = document.getElementById('price-update-code');
    const periodInput = document.getElementById('price-update-period');

    const token  = getTokenValue();
    const codes  = codesInput.value.trim();
    const period = periodInput.value.trim(); // 空欄なら2013年以降の全期間（ワークフロー側のデフォルト）

    if (!token) { alert('トークンを入力してください'); return; }
    if (!codes) { alert('証券コードを入力してください'); return; }

    statusEl.textContent = '実行をリクエスト中...';

    try {
        await dispatchWorkflow(token, OWNER, CODE_REPO, PRICE_WORKFLOW_FILE, CODE_REPO_BRANCH, { codes, period });
        statusEl.textContent =
            `実行をリクエストしました（コード: ${codes} / 期間: ${period || '2013年以降の全期間'}）。` +
            `数十秒〜数分後にデータリポジトリの stock/prices/ 配下が更新されます。` +
            `GitHubの Actions タブから進捗を確認できます。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `失敗しました: ${error.message}`;
    }
});

// ===== データ更新：株価の更新（日常運用向け・対象銘柄すべてを差分更新） =====
// 一括取得ワークフロー（fetch-stock-prices-bulk.yml）をoffset=0・mode=updateで起動する。
// limitは毎回master.csvから対象件数（listed×BULK_ASSET_TYPES）を数えて渡す（手動でのoffset/limit指定を不要にするため）。
// 起動後は実行状況とコミット進捗をポーリングし、進捗バー・バナーに反映する（ブラウザを閉じるとポーリングは止まるが、
// ワークフロー自体はGitHub側で継続するので、再度開いて「チェック」を押せば結果は確認できる）。

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let bulkUpdateTrackingGen = 0; // ボタン多重クリック時、古いポーリングを打ち切るための世代カウンタ

function setBulkUpdateBanner(state, text) {
    const el = document.getElementById('price-update-all-status');
    el.textContent = text;
    el.classList.remove('update-banner--running', 'update-banner--success', 'update-banner--failure');
    if (state) el.classList.add(`update-banner--${state}`);
}

function setBulkUpdateProgress(processed, target) {
    const wrap = document.getElementById('price-update-all-progress');
    const bar = document.getElementById('price-update-all-bar');
    const percentEl = document.getElementById('price-update-all-percent');
    const pct = target > 0 ? Math.min(100, Math.round((processed / target) * 100)) : 0;

    wrap.style.display = '';
    bar.value = pct;
    percentEl.textContent = `${pct}%（${Math.min(processed, target)}/${target}）`;
}

// コミットメッセージ「...offset=123, count=20）」からoffset・countを取り出し、処理済み件数（offset+count）を返す
function parseProcessedFromCommitMessage(message) {
    const m = message && message.match(/offset=(\d+),\s*count=(\d+)/);
    return m ? Number(m[1]) + Number(m[2]) : null;
}

// baselineRun/baselineCommit: 起動直前（dispatchWorkflowを呼ぶ前）に取得しておいた「それまでの最新」の状態。
// created_at等の時刻比較ではなく、この基準からid/shaが変化したかどうかで新しい実行・コミットを判定する
// （ブラウザ側の時計がGitHubサーバー側とズレていても正しく動く）。
async function trackBulkUpdateProgress(myGen, baselineRun, baselineCommit, targetCount, btn) {
    const token = getTokenValue();
    const baselineRunId = baselineRun ? baselineRun.id : null;
    const baselineCommitSha = baselineCommit ? baselineCommit.sha : null;

    // (a) 一覧の先頭がbaselineから変わる（＝新しい実行が始まった）まで探す（最大30秒）
    let run = null;
    let lastError = null;
    let lastSeenRunId = null;
    for (let i = 0; i < 10; i++) {
        if (myGen !== bulkUpdateTrackingGen) return; // 別の実行が始まっていたら中断
        try {
            const latest = await getLatestWorkflowRun(token, OWNER, CODE_REPO, PRICE_BULK_WORKFLOW_FILE);
            lastSeenRunId = latest ? latest.id : null;
            lastError = null;
            if (latest && latest.id !== baselineRunId) run = latest;
        } catch (error) {
            console.error(error);
            lastError = error;
        }
        if (run) break;
        await sleep(3000);
    }

    if (!run) {
        // 原因調査用に、最後に何が起きていたか（APIエラー／一覧の先頭が変わらなかった等）をバナーに出す
        const detail = lastError
            ? `直近のエラー: ${lastError.message}`
            : `直近の一覧の先頭run id: ${lastSeenRunId ?? 'なし'}（起動前と同じ: ${lastSeenRunId === baselineRunId}）`;
        setBulkUpdateBanner('failure',
            `実行の自動追跡に失敗しました（一覧に新しい実行が見つかりませんでした）。リクエスト自体は送信済みです。` +
            `GitHubのActionsタブから状況を確認してください。[${detail}]`);
        btn.disabled = false;
        return;
    }

    // (b) 完了するまで、実行状況とコミット進捗を定期的に確認する
    while (myGen === bulkUpdateTrackingGen) {
        try {
            const latestRun = await getWorkflowRun(token, OWNER, CODE_REPO, run.id);

            const commit = await getLatestCommit(token, OWNER, DATA_REPO, DATA_REPO_BRANCH, PRICES_DIR);
            if (commit && commit.sha !== baselineCommitSha) {
                const processed = parseProcessedFromCommitMessage(commit.message);
                if (processed !== null) setBulkUpdateProgress(processed, targetCount);
            }

            if (latestRun.status === 'completed') {
                const ok = latestRun.conclusion === 'success';
                setBulkUpdateProgress(targetCount, targetCount);
                setBulkUpdateBanner(ok ? 'success' : 'failure',
                    ok
                        ? `完了しました（対象 ${targetCount}銘柄・差分更新）。状態パネルを更新します...`
                        : `完了しましたが、一部失敗した可能性があります（結果: ${latestRun.conclusion}）。詳細はGitHubのActionsタブで確認してください。`
                );
                btn.disabled = false;
                loadFreshnessStatus();
                return;
            }

            setBulkUpdateBanner('running',
                latestRun.status === 'queued' ? 'キューに登録されました。開始を待っています...' : '実行中...'
            );
        } catch (error) {
            console.error(error);
        }
        await sleep(15000);
    }
}

document.getElementById('price-update-all-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    // 実行中の多重クリックによる二重起動を防ぐ（GitHub Actions側のconcurrency設定が本丸の対策だが、
    // UI側でも防げるに越したことはない。トラッキングが終わるまで再度押せないようにする）
    btn.disabled = true;

    document.getElementById('price-update-all-progress').style.display = 'none';
    setBulkUpdateBanner('running', '対象銘柄数を確認中...');

    try {
        const [masterText, delistedText] = await Promise.all([
            fetchFile(token, OWNER, DATA_REPO, MASTER_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, DELISTED_PATH),
        ]);
        const allRows = parseCsv(masterText);
        const delistedCodes = new Set((delistedText ? parseCsv(delistedText) : []).map(r => r.code));
        const listedRows = allRows.filter(r => r.status === 'listed' && BULK_ASSET_TYPES.includes(r.asset_type));
        // 上場廃止として登録済みのコードは対象から除く（fetch_prices.py側の--exclude-fileと揃えることで、
        // 進捗バーの分母（targetCount）が実際に処理される件数と一致するようにする）
        const targetCount = listedRows.filter(r => !delistedCodes.has(r.code)).length;

        if (listedRows.length === 0) {
            // master.csvは取得できたが対象銘柄が0件 ＝ 内容が想定と異なる可能性が高い（権限エラーなら例外で分かる）。
            // 開発者ツールを開かなくても原因調査できるよう、実際に取得できた内容をバナーに直接表示する。ワークフローは起動しない。
            const headSnippet = masterText.slice(0, 200).replace(/\s+/g, ' ').trim();
            setBulkUpdateBanner('failure',
                `対象銘柄が0件でした。ワークフローは起動していません。` +
                `[取得文字数: ${masterText.length} / 解析できた行数: ${allRows.length}件 / ` +
                `1行目の解析結果: ${JSON.stringify(allRows[0] ?? null)}] ` +
                `[内容の先頭200文字: "${headSnippet}${masterText.length > 200 ? '...' : ''}"]`);
            btn.disabled = false;
            return;
        }

        setBulkUpdateBanner('running', '実行状況を確認中...');

        // ワークフロー特定・進捗追跡のため、起動直前の「それまでの最新」状態をベースラインとして記録しておく
        // （時刻での比較ではなく、この基準からid/shaが変化したかどうかで新しい実行・コミットを判定する）
        const [baselineRun, baselineCommit] = await Promise.all([
            getLatestWorkflowRun(token, OWNER, CODE_REPO, PRICE_BULK_WORKFLOW_FILE).catch(() => null),
            getLatestCommit(token, OWNER, DATA_REPO, DATA_REPO_BRANCH, PRICES_DIR).catch(() => null),
        ]);

        // 前回の実行がまだ動いている状態でもう一度起動すると、同じディレクトリへ同時にコミット・pushしようとして
        // 競合し、片方が失敗することがある（実際に発生した事例あり）。事前に警告し、続行するか確認する。
        if (baselineRun && (baselineRun.status === 'in_progress' || baselineRun.status === 'queued')) {
            const proceed = confirm(
                '前回の「最新株価取得」がまだ実行中の可能性があります。\n' +
                '同時に実行すると、データリポジトリへのコミットが競合し、片方が失敗する場合があります。\n' +
                'それでも実行しますか？'
            );
            if (!proceed) {
                setBulkUpdateBanner(null, '実行をキャンセルしました。前回の実行が完了してから再度お試しください。');
                btn.disabled = false;
                return;
            }
        }

        setBulkUpdateBanner('running', '実行をリクエスト中...');

        await dispatchWorkflow(token, OWNER, CODE_REPO, PRICE_BULK_WORKFLOW_FILE, CODE_REPO_BRANCH, {
            offset: '0', limit: String(targetCount), mode: 'update'
        });

        setBulkUpdateProgress(0, targetCount);
        setBulkUpdateBanner('running', `実行をリクエストしました（対象 ${targetCount}銘柄・差分更新）。実行状況を確認しています...`);

        bulkUpdateTrackingGen += 1;
        trackBulkUpdateProgress(bulkUpdateTrackingGen, baselineRun, baselineCommit, targetCount, btn);
    } catch (error) {
        console.error(error);
        setBulkUpdateBanner('failure', `失敗しました: ${error.message}`);
        btn.disabled = false;
    }
});

// ===== データ更新：銘柄マスタ（master.csv）から範囲指定して一括取得するワークフローを起動 =====
document.getElementById('bulk-update-run-btn')?.addEventListener('click', async () => {
    const statusEl     = document.getElementById('bulk-update-status');
    const modeInput    = document.getElementById('bulk-update-mode');
    const offsetInput  = document.getElementById('bulk-update-offset');
    const limitInput   = document.getElementById('bulk-update-limit');

    const token  = getTokenValue();
    const mode   = modeInput.value;
    const offset = offsetInput.value.trim() || '0';
    const limit  = limitInput.value.trim();

    if (!token) { alert('トークンを入力してください'); return; }
    if (!limit) { alert('件数を入力してください'); return; }

    const modeLabel = mode === 'update' ? '差分更新' : '初回取得';
    statusEl.textContent = '実行をリクエスト中...';

    try {
        await dispatchWorkflow(token, OWNER, CODE_REPO, PRICE_BULK_WORKFLOW_FILE, CODE_REPO_BRANCH, { offset, limit, mode });
        statusEl.textContent =
            `実行をリクエストしました（モード: ${modeLabel} / 開始位置: ${offset} / 件数: ${limit}）。` +
            `20件処理するごとにデータリポジトリへ自動コミットされます。` +
            `GitHubの Actions タブから進捗を確認できます。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `失敗しました: ${error.message}`;
    }
});

// ===== データ更新：一括取得の進捗確認（銘柄マスタ×既存の保存済みCSVを突き合わせ、次の開始位置を提案） =====
document.getElementById('bulk-update-check-btn')?.addEventListener('click', async () => {
    const progressEl  = document.getElementById('bulk-update-progress');
    const offsetInput = document.getElementById('bulk-update-offset');

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    progressEl.textContent = '確認中...';

    try {
        const masterText = await fetchFile(token, OWNER, DATA_REPO, MASTER_PATH);
        const targetRows = parseCsv(masterText).filter(r =>
            r.status === 'listed' && BULK_ASSET_TYPES.includes(r.asset_type)
        );

        // Contents API（ディレクトリ一覧）は1,000件で打ち切られるため、Git Trees APIで漏れなく列挙する
        // （stock/prices/は数千件規模になるため必須。旧実装のContents API版だと大部分が「未取得」に誤判定されていた）
        const files = await listFilesRecursive(token, OWNER, DATA_REPO, DATA_REPO_BRANCH, PRICES_DIR);
        const existingCodes = new Set(
            files.filter(f => f.name.endsWith('.csv'))
                 .map(f => f.name.replace(/\.csv$/, ''))
        );

        const doneCount   = targetRows.filter(r => existingCodes.has(r.code)).length;
        const remaining   = targetRows.length - doneCount;
        const nextIndex   = targetRows.findIndex(r => !existingCodes.has(r.code));

        if (nextIndex === -1) {
            progressEl.textContent = `対象 ${targetRows.length}件のうち ${doneCount}件取得済み。すべて完了しています。`;
        } else {
            if (offsetInput) offsetInput.value = nextIndex;
            progressEl.textContent =
                `対象 ${targetRows.length}件のうち ${doneCount}件取得済み（残り ${remaining}件）。` +
                `次の開始位置候補: ${nextIndex}（未取得の中で最も番号が小さい位置。自動入力しました。` +
                `途中を何度か再取得している場合、この位置より後にも未取得が飛び飛びで残っている可能性があります）`;
        }
    } catch (error) {
        console.error(error);
        progressEl.textContent = `確認に失敗しました: ${error.message}`;
    }
});

// ===== データ更新：上場廃止銘柄の登録（stock/delisted.csv）。人が確認して登録する方式（自動判定はしない） =====
let delistedRows = [];     // 上場廃止銘柄一覧（メモリ上。読込/登録のたびに最新化）
let delistedLoaded = false; // 一度でも読み込みが済んだか（未読み込みでの登録による取りこぼし上書きを防ぐ）

// ===== データ更新：追加対象銘柄の登録（stock/extra_targets.csv）。master.csvには無いが継続更新したい対象
// （N225のような指数、master.csvにまだ反映されていない新規上場銘柄など）を人が登録する =====
let extraTargetsRows = [];     // 追加対象銘柄一覧（メモリ上。読込/登録のたびに最新化）
let extraTargetsLoaded = false; // 一度でも読み込みが済んだか（未読み込みでの登録による取りこぼし上書きを防ぐ）

// ===== データ更新：現在の状態パネル（freshness_report.json・validation_report.json・delisted.csv・
// extra_targets.csvを読み込んで常時表示用に整形） =====
async function loadFreshnessStatus() {
    const summaryEl = document.getElementById('status-summary');
    const token = getTokenValue();
    if (!token) { summaryEl.textContent = 'トークンを入力し「チェック」を押してください。'; return; }

    summaryEl.textContent = '状態を確認中...';

    try {
        // 品質チェックの結果・上場廃止一覧・追加対象一覧は未実行/未登録だとファイル自体が存在しないため、
        // fetchFileIfExistsでnull許容にする。asset_typeのMap取得も失敗時はnullにフォールバックし
        // （分類無しの旧表示に戻すだけで）状態パネル全体は表示できるようにする
        const [reportText, validationText, delistedText, extraTargetsText, assetTypeMap] = await Promise.all([
            fetchFile(token, OWNER, DATA_REPO, FRESHNESS_REPORT_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, VALIDATION_REPORT_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, DELISTED_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, EXTRA_TARGETS_PATH),
            getMasterAssetTypeMap(token).catch(error => { console.error(error); return null; }),
        ]);
        const report = JSON.parse(reportText);
        const validation = validationText ? JSON.parse(validationText) : null;
        delistedRows = delistedText ? parseCsv(delistedText) : [];
        delistedLoaded = true;
        extraTargetsRows = extraTargetsText ? parseCsv(extraTargetsText) : [];
        extraTargetsLoaded = true;

        summaryEl.innerHTML = '';

        // ----- 常時表示サマリー（更新最終日・データ品質・上場廃止の要点をまとめて出す） -----
        const lines = document.createElement('div');
        lines.className = 'status-lines';
        [
            { text: `チェック日時：${formatUtcIsoToJst(report.checked_at)} / 対象：${report.total_files}件` },
            { text: `全体の最新日付/最古日付：${report.latest_date}/${report.oldest_last_date}` },
            { text: `日付問題（${report.stale_days}日超過）：${report.stale_count}件`, warning: report.stale_count > 0 },
            { text: `品質問題：${validation ? `${validation.issue_count}件` : '未実行'}`, warning: !!validation && validation.issue_count > 0 },
            { text: `上場廃止（除外）：${delistedRows.length}件` },
        ].forEach(({ text, warning }) => {
            const p = document.createElement('p');
            p.textContent = text;
            if (warning) p.classList.add('status-line--warning');
            lines.appendChild(p);
        });
        summaryEl.appendChild(lines);

        // ----- 詳細（更新最終日／データ品質を2列。どちらもExpander閉が既定） -----
        const columns = document.createElement('div');
        columns.className = 'form-columns';

        // 更新最終日：銘柄ごとの最終日付の分布（新しい日付が上に来るように降順）。
        // 大半が最新日付に揃っていれば正常、古い日付に銘柄が散っていれば取りこぼしがあると分かる。
        // codes_by_date（日付ごとの該当銘柄コード一覧）があれば、行ごとに折りたたみで内訳を出す
        // （古いcheck_freshness.pyで作られたレポートにはこのフィールドが無いので、その場合は件数のみ表示する）。
        // 該当銘柄コードが分かる行には「再取得」ボタンを添え、その日付グループだけを差分取得し直せるようにする。
        const freshnessColumn = document.createElement('div');
        freshnessColumn.className = 'form-column';
        const freshnessSection = document.createElement('details');
        freshnessSection.className = 'status-section';
        const freshnessTitle = document.createElement('summary');
        freshnessTitle.className = 'update-form-title';
        freshnessTitle.textContent = '更新最終日';
        freshnessSection.appendChild(freshnessTitle);
        if (report.distribution) {
            const entries = Object.entries(report.distribution).sort((a, b) => b[0].localeCompare(a[0]));
            // codes_by_date（銘柄コード内訳）とasset_typeのMapが両方揃っているときだけ、
            // 内国株式／その他（ETF等）の分類階層を1つ上に挟んで表示する。
            // 揃わない場合（古い形式のレポート・master.csv取得失敗時）は分類無しの従来表示にフォールバックする。
            if (report.codes_by_date && Object.keys(report.codes_by_date).length > 0 && assetTypeMap) {
                [DOMESTIC_STOCK_CATEGORY, OTHER_ASSET_CATEGORY].forEach(category => {
                    const categoryCodesByDate = {};
                    let categoryTotal = 0;
                    Object.entries(report.codes_by_date).forEach(([date, codes]) => {
                        const filtered = codes.filter(code => classifyAssetCategory(code, assetTypeMap) === category);
                        if (filtered.length > 0) {
                            categoryCodesByDate[date] = filtered;
                            categoryTotal += filtered.length;
                        }
                    });
                    if (categoryTotal === 0) return;
                    const categoryEntries = Object.entries(categoryCodesByDate).sort((a, b) => b[0].localeCompare(a[0]));
                    const categoryDetail = document.createElement('details');
                    categoryDetail.className = 'status-category-detail';
                    const categorySummary = document.createElement('summary');
                    categorySummary.textContent = `${category}（${categoryTotal}銘柄）`;
                    categoryDetail.appendChild(categorySummary);
                    categoryDetail.appendChild(buildFreshnessDateList(categoryEntries, categoryCodesByDate));
                    freshnessSection.appendChild(categoryDetail);
                });
            } else {
                freshnessSection.appendChild(buildFreshnessDateList(entries, report.codes_by_date));
            }
        }
        // まとめて修正：最新日付（report.latest_date）のグループを含めるかどうかを切り替えられるようにする。
        // 同日中の実行では、既に最新日付まで届いている銘柄を再取得しても（当日分は保存されないため）
        // 無駄になるので既定は除外。一方、最新日付自体が2営業日以上前で止まっている状況では、
        // そのグループも含めて丸ごと再取得したいことがあるため、チェックボックスで選べるようにする。
        if (report.codes_by_date && Object.keys(report.codes_by_date).length > 0) {
            const bulkFixWrap = document.createElement('div');
            bulkFixWrap.className = 'status-bulk-fix';

            const includeLabel = document.createElement('label');
            const includeCheckbox = document.createElement('input');
            includeCheckbox.type = 'checkbox';
            includeLabel.appendChild(includeCheckbox);
            includeLabel.append(`最新日付（${report.latest_date}）のグループも含める`);

            const bulkBtn = document.createElement('button');
            bulkBtn.type = 'button';
            bulkBtn.className = 'run-btn run-btn--secondary status-inline-btn';
            bulkBtn.textContent = 'まとめて再取得';
            bulkBtn.addEventListener('click', () => {
                const codes = Object.entries(report.codes_by_date)
                    .filter(([date]) => includeCheckbox.checked || date !== report.latest_date)
                    .flatMap(([, codeList]) => codeList);
                if (codes.length === 0) {
                    alert('対象銘柄が0件です（最新日付のグループしか無く、それを含めない設定になっています）。');
                    return;
                }
                refetchCodesGroup('今日以前の分をまとめた銘柄', codes, bulkBtn);
            });

            bulkFixWrap.append(includeLabel, bulkBtn);
            freshnessSection.appendChild(bulkFixWrap);
        }
        // 登録済み上場廃止銘柄の一覧（削除で登録取り消し可能）。デフォルト閉のサブExpanderにする
        if (delistedRows.length > 0) {
            const delistedDetail = document.createElement('details');
            delistedDetail.className = 'status-date-detail';
            const delistedSummary = document.createElement('summary');
            delistedSummary.textContent = `登録済み上場廃止銘柄（${delistedRows.length}件）`;
            delistedDetail.appendChild(delistedSummary);
            const delistedList = document.createElement('ul');
            delistedList.className = 'status-distribution';
            delistedRows.forEach(row => {
                const li = document.createElement('li');
                li.textContent = `${row.code}（${row.updated_at || ''}） `;
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'run-btn run-btn--danger status-inline-btn';
                delBtn.textContent = '削除';
                delBtn.addEventListener('click', () => removeDelistedCode(row.code, delBtn));
                li.appendChild(delBtn);
                delistedList.appendChild(li);
            });
            delistedDetail.appendChild(delistedList);
            freshnessSection.appendChild(delistedDetail);
        }
        // 登録済み追加対象銘柄の一覧（削除で登録取り消し可能）。デフォルト閉のサブExpanderにする
        if (extraTargetsRows.length > 0) {
            const extraDetail = document.createElement('details');
            extraDetail.className = 'status-date-detail';
            const extraSummary = document.createElement('summary');
            extraSummary.textContent = `登録済み追加対象銘柄（${extraTargetsRows.length}件）`;
            extraDetail.appendChild(extraSummary);
            const extraList = document.createElement('ul');
            extraList.className = 'status-distribution';
            extraTargetsRows.forEach(row => {
                const li = document.createElement('li');
                li.textContent = `${row.code}（${row.updated_at || ''}） `;
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'run-btn run-btn--danger status-inline-btn';
                delBtn.textContent = '削除';
                delBtn.addEventListener('click', () => removeExtraTargetCode(row.code, delBtn));
                li.appendChild(delBtn);
                extraList.appendChild(li);
            });
            extraDetail.appendChild(extraList);
            freshnessSection.appendChild(extraDetail);
        }
        freshnessColumn.appendChild(freshnessSection);
        columns.appendChild(freshnessColumn);

        // データ品質：問題の種類・内容ごとの内訳（問題が無ければ内訳無し）
        const qualityColumn = document.createElement('div');
        qualityColumn.className = 'form-column';
        const qualitySection = document.createElement('details');
        qualitySection.className = 'status-section';
        const qualityTitle = document.createElement('summary');
        qualityTitle.className = 'update-form-title';
        qualityTitle.textContent = 'データ品質';
        qualitySection.appendChild(qualityTitle);
        if (validation && validation.issue_count > 0) {
            renderValidationIssues(qualitySection, validation, assetTypeMap);
        }
        qualityColumn.appendChild(qualitySection);
        columns.appendChild(qualityColumn);

        summaryEl.appendChild(columns);
    } catch (error) {
        console.error(error);
        summaryEl.textContent = `状態の取得に失敗しました: ${error.message}`;
    }
}

// 「更新最終日」の日付ごとの内訳<ul>を構築する（分類なし表示・内国株式／その他への分類後表示のどちらからも使う共通処理）。
// entries: [[date, count], ...]（降順ソート済み前提）。codesByDate: 該当コード内訳（無ければnull＝古い形式のレポート）。
function buildFreshnessDateList(entries, codesByDate) {
    const list = document.createElement('ul');
    list.className = 'status-distribution';
    entries.forEach(([date, count]) => {
        const codes = codesByDate ? codesByDate[date] : null;
        let refetchBtn = null;
        if (codes && codes.length > 0) {
            refetchBtn = document.createElement('button');
            refetchBtn.type = 'button';
            refetchBtn.className = 'run-btn run-btn--secondary status-inline-btn';
            refetchBtn.textContent = '再取得';
            refetchBtn.addEventListener('click', () => refetchCodesGroup(`${date}で止まっている銘柄`, codes, refetchBtn));
        }
        list.appendChild(buildExpandableListItem(`${date}: ${count}銘柄`, codes, refetchBtn));
    });
    return list;
}

// 件数テキスト（summaryText）を表示するリスト項目（<li>）を作る。
// codesが1件以上あればExpander（<details>）にして、開くと該当銘柄コードの一覧が見える形にする。
// codesが無ければ（古い形式のレポート等）文字列だけの<li>にする。
// trailingButtonを渡すと、<details>/テキストの外側（summaryの中ではない）にボタンを添える
// （<summary>内に置くとクリックがExpanderの開閉と競合するため）。
// 「更新最終日」の日付ごとの内訳・「データ品質」の問題ごとの内訳の両方で共通して使い、見た目を揃えている。
function buildExpandableListItem(summaryText, codes, trailingButton) {
    const li = document.createElement('li');
    if (codes && codes.length > 0) {
        const details = document.createElement('details');
        details.className = 'status-date-detail';
        const summary = document.createElement('summary');
        summary.textContent = summaryText;
        details.appendChild(summary);
        const codeList = document.createElement('div');
        codeList.className = 'status-code-list';
        codeList.textContent = codes.join(', ');
        details.appendChild(codeList);
        li.appendChild(details);
    } else {
        li.textContent = summaryText;
    }
    if (trailingButton) li.appendChild(trailingButton);
    return li;
}

/**
 * 欠損等の日付リストから、再取得に使う日付範囲（前後3日バッファ付き）を計算する。
 * datesが空・未指定なら null を返す（呼び出し側は全期間取得にフォールバックする）。
 * バッファは週末・祝日をまたぐケースやyfinanceのend日付の扱い（境界の取りこぼし）に対する安全マージン。
 */
function buildRefetchDateRange(dates) {
    if (!dates || dates.length === 0) return null;
    const sorted = [...dates].sort();
    const addDays = (dateStr, days) => {
        const d = new Date(`${dateStr}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    };
    return { start: addDays(sorted[0], -3), end: addDays(sorted[sorted.length - 1], 3) };
}

// 指定した銘柄コード群だけを取得し直す。共通関数で2通りの用途に使う：
//   mode='update'（既定）: 更新最終日側の日付グループ再取得。単なる取得漏れの解消が目的なので、
//                          最終日の翌日〜今日だけの差分取得で十分かつ軽い。
//   mode='full'          : データ品質側の問題（欠損・重複等）修繕用。行の途中に問題があるケースを
//                          直すには差分取得では直せないため、dateRangeがあればその期間だけピンポイントで、
//                          無ければ2013年以降の全期間を取得し直す。
// 完了後はチェック全体（runFullCheck）を再実行して結果を反映する。
async function refetchCodesGroup(description, codes, buttonEl, mode = 'update', dateRange = null) {
    if (codes.length === 0) return;

    let actionText;
    if (mode === 'full' && dateRange) {
        actionText = `${dateRange.start}〜${dateRange.end}の期間だけ取得し直します（ピンポイント再取得）`;
    } else if (mode === 'full') {
        actionText = '2013年以降の全期間を取得し直します（銘柄数によっては時間がかかります）';
    } else {
        actionText = '最新まで差分取得します';
    }
    const ok = confirm(`${description}（${codes.length}件）を、${actionText}。よろしいですか？`);
    if (!ok) return;

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    buttonEl.disabled = true;
    const originalText = buttonEl.textContent;
    buttonEl.textContent = '実行をリクエスト中...';

    try {
        const baseline = await getLatestWorkflowRun(token, OWNER, CODE_REPO, PRICE_ISSUES_WORKFLOW_FILE).catch(() => null);

        const workflowInputs = { codes: codes.join(','), mode };
        if (mode === 'full' && dateRange) {
            workflowInputs.start_date = dateRange.start;
            workflowInputs.end_date = dateRange.end;
        }
        await dispatchWorkflow(token, OWNER, CODE_REPO, PRICE_ISSUES_WORKFLOW_FILE, CODE_REPO_BRANCH, workflowInputs);

        buttonEl.textContent = `再取得の完了を待っています...（${codes.length}件・数分かかります）`;
        const run = await waitForWorkflowRun(token, PRICE_ISSUES_WORKFLOW_FILE, baseline ? baseline.id : null);

        if (!run) {
            alert('再取得の実行が見つかりませんでした。リクエスト自体は送信済みです。GitHubのActionsタブから状況を確認してください。');
        } else if (run.conclusion !== 'success') {
            alert(`再取得が完了しましたが、一部失敗した可能性があります（結果: ${run.conclusion}）。詳細はGitHubのActionsタブで確認してください。`);
        }

        await runFullCheck(); // 完了後、状態パネル全体が再描画されるためbuttonElへの参照はここで役目を終える
    } catch (error) {
        console.error(error);
        buttonEl.disabled = false;
        buttonEl.textContent = originalText;
        alert(`再取得の実行に失敗しました: ${error.message}`);
    }
}

// ===== 上場廃止銘柄の登録（stock/delisted.csv）。登録は即コミット（labels.csv等と違い仮登録の中間状態を持たない単純な追加/削除リスト） =====
document.getElementById('delisted-register-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const codesInput = document.getElementById('delisted-codes');
    const statusEl = document.getElementById('delisted-status');
    const codes = codesInput.value.split(',').map(s => s.trim()).filter(Boolean);
    if (codes.length === 0) { alert('証券コードを入力してください'); return; }

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (!delistedLoaded) { alert('先に「チェック」を実行してから登録してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    // 連打による二重コミット（GitHub側でshaの競合＝409エラーになる）を防ぐ
    btn.disabled = true;
    statusEl.textContent = '登録中...';
    try {
        const now = formatJstTimestamp();
        codes.forEach(code => {
            const existing = delistedRows.find(r => r.code === code);
            if (existing) existing.updated_at = now;
            else delistedRows.push({ code, note: '', updated_at: now });
        });
        const content = stringifyCsv(delistedRows, DELISTED_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, DELISTED_PATH, DATA_REPO_BRANCH, content, 'chore: 上場廃止銘柄を登録');
        codesInput.value = '';
        statusEl.textContent = `登録しました（現在${delistedRows.length}件）。`;
        await loadFreshnessStatus(); // 状態パネル全体が再描画されるためbtnへの参照はここで役目を終える
    } catch (error) {
        console.error(error);
        btn.disabled = false;
        statusEl.textContent = `登録に失敗しました: ${error.message}`;
    }
});

/** 上場廃止登録の取り消し（誤登録の訂正用）。確認の上、対象コードを除いて即コミットする。 */
async function removeDelistedCode(code, buttonEl) {
    const ok = confirm(`${code}の上場廃止登録を取り消します。よろしいですか？`);
    if (!ok) return;

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    buttonEl.disabled = true;
    try {
        delistedRows = delistedRows.filter(r => r.code !== code);
        const content = stringifyCsv(delistedRows, DELISTED_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, DELISTED_PATH, DATA_REPO_BRANCH, content, 'chore: 上場廃止銘柄の登録を取り消し');
        await loadFreshnessStatus();
    } catch (error) {
        console.error(error);
        buttonEl.disabled = false;
        alert(`取り消しに失敗しました: ${error.message}`);
    }
}

// ===== 追加対象銘柄の登録（stock/extra_targets.csv）。上場廃止銘柄の登録と同じ操作感（登録は即コミット、
// 仮登録の中間状態を持たない単純な追加/削除リスト）。master.csvには無いが継続更新したい対象
// （N225等の指数、master.csvにまだ反映されていない新規上場銘柄など）を登録する =====
document.getElementById('extra-target-register-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const codesInput = document.getElementById('extra-target-codes');
    const statusEl = document.getElementById('extra-target-status');
    const codes = codesInput.value.split(',').map(s => s.trim()).filter(Boolean);
    if (codes.length === 0) { alert('証券コードを入力してください'); return; }

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (!extraTargetsLoaded) { alert('先に「チェック」を実行してから登録してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    // 連打による二重コミット（GitHub側でshaの競合＝409エラーになる）を防ぐ
    btn.disabled = true;
    statusEl.textContent = '登録中...';
    try {
        const now = formatJstTimestamp();
        codes.forEach(code => {
            const existing = extraTargetsRows.find(r => r.code === code);
            if (existing) existing.updated_at = now;
            else extraTargetsRows.push({ code, yf_ticker: '', note: '', updated_at: now });
        });
        const content = stringifyCsv(extraTargetsRows, EXTRA_TARGETS_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, EXTRA_TARGETS_PATH, DATA_REPO_BRANCH, content, 'chore: 追加対象銘柄を登録');
        codesInput.value = '';
        statusEl.textContent = `登録しました（現在${extraTargetsRows.length}件）。`;
        await loadFreshnessStatus(); // 状態パネル全体が再描画されるためbtnへの参照はここで役目を終える
    } catch (error) {
        console.error(error);
        btn.disabled = false;
        statusEl.textContent = `登録に失敗しました: ${error.message}`;
    }
});

/** 追加対象登録の取り消し。確認の上、対象コードを除いて即コミットする。 */
async function removeExtraTargetCode(code, buttonEl) {
    const ok = confirm(`${code}の追加対象登録を取り消します。よろしいですか？`);
    if (!ok) return;

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    buttonEl.disabled = true;
    try {
        extraTargetsRows = extraTargetsRows.filter(r => r.code !== code);
        const content = stringifyCsv(extraTargetsRows, EXTRA_TARGETS_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, EXTRA_TARGETS_PATH, DATA_REPO_BRANCH, content, 'chore: 追加対象銘柄の登録を取り消し');
        await loadFreshnessStatus();
    } catch (error) {
        console.error(error);
        buttonEl.disabled = false;
        alert(`取り消しに失敗しました: ${error.message}`);
    }
}

// 指定ワークフローの実行が完了するまで待つ（バックグラウンドで並行して待てるようPromiseを返す）。
// baselineRunId: 起動前に記録しておいた「それまでの最新」run id（無ければnull）。
// 一覧の先頭がこれと変わる（＝新しい実行が始まった）まで探し、見つかったらそのrunが完了するまでポーリングする。
// 時刻ではなくid比較で新しい実行を判定する（ブラウザ側の時計とGitHubサーバー側の時計がズレていても正しく動く）。
// 戻り値: 完了したrunオブジェクト（status==='completed'）。実行が見つからなかった場合はnull。
async function waitForWorkflowRun(token, workflowFile, baselineRunId) {
    let run = null;
    for (let i = 0; i < 10; i++) {
        try {
            const latest = await getLatestWorkflowRun(token, OWNER, CODE_REPO, workflowFile);
            if (latest && latest.id !== baselineRunId) { run = latest; break; }
        } catch (error) {
            console.error(error);
        }
        await sleep(3000);
    }
    if (!run) return null;

    while (true) {
        try {
            const latestRun = await getWorkflowRun(token, OWNER, CODE_REPO, run.id);
            if (latestRun.status === 'completed') return latestRun;
        } catch (error) {
            console.error(error);
        }
        await sleep(15000);
    }
}

// 鮮度チェック・品質チェックを両方実行し、完了を待って状態パネルへ反映する。
// 「チェック」ボタンと、品質チェックの「検出銘柄をまとめて再取得」ボタン（再取得後に直せたか確認するため）の
// 両方から呼ばれる共通処理。
async function runFullCheck() {
    const summaryEl = document.getElementById('status-summary');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    summaryEl.textContent = 'チェックを実行中...（鮮度チェック・品質チェックを開始しています）';

    try {
        // 起動前に「それまでの最新」の実行を記録しておく（新しい実行が始まったことの判定に使う）
        const [freshnessBaseline, validationBaseline] = await Promise.all([
            getLatestWorkflowRun(token, OWNER, CODE_REPO, FRESHNESS_WORKFLOW_FILE).catch(() => null),
            getLatestWorkflowRun(token, OWNER, CODE_REPO, VALIDATE_WORKFLOW_FILE).catch(() => null),
        ]);

        // 鮮度チェックと品質チェックは別ファイル（freshness_report.json / validation_report.json）に
        // コミットするため競合せず、同時に起動できる
        await Promise.all([
            dispatchWorkflow(token, OWNER, CODE_REPO, FRESHNESS_WORKFLOW_FILE, CODE_REPO_BRANCH, {}),
            dispatchWorkflow(token, OWNER, CODE_REPO, VALIDATE_WORKFLOW_FILE, CODE_REPO_BRANCH, {}),
        ]);

        summaryEl.textContent = 'チェックを実行中...（完了を待っています。数分かかります）';

        const [freshnessRun, validationRun] = await Promise.all([
            waitForWorkflowRun(token, FRESHNESS_WORKFLOW_FILE, freshnessBaseline ? freshnessBaseline.id : null),
            waitForWorkflowRun(token, VALIDATE_WORKFLOW_FILE, validationBaseline ? validationBaseline.id : null),
        ]);

        const problems = [];
        if (!freshnessRun) problems.push('鮮度チェックの実行が見つかりませんでした');
        else if (freshnessRun.conclusion !== 'success') problems.push(`鮮度チェックが失敗しました（結果: ${freshnessRun.conclusion}）`);
        if (!validationRun) problems.push('品質チェックの実行が見つかりませんでした');
        else if (validationRun.conclusion !== 'success') problems.push(`品質チェックが失敗しました（結果: ${validationRun.conclusion}）`);

        await loadFreshnessStatus();

        if (problems.length > 0) {
            const warn = document.createElement('p');
            warn.className = 'status-line--warning';
            warn.textContent = problems.join(' / ') + '（GitHubのActionsタブで詳細を確認してください）';
            summaryEl.prepend(warn);
        }
    } catch (error) {
        console.error(error);
        summaryEl.textContent = `失敗しました: ${error.message}`;
    }
}

// ===== データ更新：チェック（鮮度チェック・品質チェックを両方実行し、完了を待って状態パネルへ反映） =====
document.getElementById('status-check-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
        await runFullCheck();
    } finally {
        btn.disabled = false;
    }
});

// データ品質チェックの問題内訳をcontainerに描画する。
// 状態パネルの「チェック」実行後、問題が1件以上あるときにloadFreshnessStatusから呼ばれる。
// assetTypeMapが渡された場合は、種類・内容ごとのグループ化（renderValidationIssueGroups）の1つ上に
// 内国株式／その他（ETF等）の分類階層を挟む（無ければ分類無しの従来表示にフォールバックする）。
function renderValidationIssues(container, validation, assetTypeMap) {
    if (assetTypeMap) {
        [DOMESTIC_STOCK_CATEGORY, OTHER_ASSET_CATEGORY].forEach(category => {
            const categoryIssues = validation.issues.filter(issue => classifyAssetCategory(issue.code, assetTypeMap) === category);
            if (categoryIssues.length === 0) return;
            const categoryCodeCount = new Set(categoryIssues.map(issue => issue.code)).size;
            const categoryDetail = document.createElement('details');
            categoryDetail.className = 'status-category-detail';
            const categorySummary = document.createElement('summary');
            categorySummary.textContent = `${category}（${categoryIssues.length}件・${categoryCodeCount}銘柄）`;
            categoryDetail.appendChild(categorySummary);
            renderValidationIssueGroups(categoryDetail, categoryIssues);
            container.appendChild(categoryDetail);
        });
    } else {
        renderValidationIssueGroups(container, validation.issues);
    }

    // まとめて再取得：問題グループ・分類を横断した全該当銘柄（重複除去）をまとめてmode=fullで再取得する
    // （分類はあくまで内訳表示上の区別であり、まとめて直したいケースでは分類をまたいで良いため分けていない）
    const allCodes = [...new Set(validation.issues.map(issue => issue.code))];
    if (allCodes.length > 0) {
        const bulkFixWrap = document.createElement('div');
        bulkFixWrap.className = 'status-bulk-fix';
        const bulkBtn = document.createElement('button');
        bulkBtn.type = 'button';
        bulkBtn.className = 'run-btn run-btn--secondary status-inline-btn';
        bulkBtn.textContent = `まとめて再取得（${allCodes.length}件）`;
        bulkBtn.addEventListener('click', () => refetchCodesGroup('問題が検出された銘柄すべて', allCodes, bulkBtn, 'full'));
        bulkFixWrap.appendChild(bulkBtn);
        container.appendChild(bulkFixWrap);
    }
}

// 問題（type+detail）ごとにグループ化して内訳<ul>をcontainerに描画する（renderValidationIssuesの内部処理）。
// 同一内容の問題は銘柄をまたいで多発しやすい（例: 特定期間の連休による欠損）ため、
// 件数付きのサマリーとしてまとめ、該当銘柄コードはExpanderの中に入れる（「更新最終日」と同じ見た目にする）。
function renderValidationIssueGroups(container, issues) {
    const groups = new Map();
    issues.forEach(issue => {
        const key = `${issue.type}::${issue.detail}`;
        if (!groups.has(key)) groups.set(key, { type: issue.type, detail: issue.detail, count: 0, codes: [], dates: [] });
        const group = groups.get(key);
        group.count += 1;
        group.codes.push(issue.code);
        if (issue.dates) group.dates.push(...issue.dates); // missing_close/duplicate_date/missing_dateのみ持つ
    });
    const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count);

    const list = document.createElement('ul');
    list.className = 'status-distribution';
    sortedGroups.forEach(group => {
        // 差分取得（mode=update）では直せない（問題が既存データの途中にあるため）ので、mode=fullで取り直す。
        // group.datesがあれば、その最小〜最大日付（前後3日バッファ）だけをピンポイントで再取得する
        // （無駄な全期間取得を避ける）。datesが無い問題（unsorted等、特定の日付を持たない）は
        // 従来通り2013年以降の全期間を取得し直す
        const refetchBtn = document.createElement('button');
        refetchBtn.type = 'button';
        refetchBtn.className = 'run-btn run-btn--secondary status-inline-btn';
        refetchBtn.textContent = '再取得';
        refetchBtn.addEventListener('click', () => {
            const dateRange = buildRefetchDateRange(group.dates);
            refetchCodesGroup(`「${group.detail}」に該当する銘柄`, group.codes, refetchBtn, 'full', dateRange);
        });
        list.appendChild(buildExpandableListItem(`${group.count}件：${group.detail}`, group.codes, refetchBtn));
    });
    container.appendChild(list);
}

// ===== 保有・履歴：保有銘柄（stock/holdings.csv）の手入力登録 =====
// 行単位で編集可能なテーブル（brainアプリの編集タブと同じ操作感: 一覧クリック→フォーム→新規/適用/削除）。
// 「適用」「削除」の時点ではholdingsRows（メモリ上）だけが変わり、GitHubへは反映されない。
// 「保存」を押した時点で初めてstock/holdings.csv（データリポジトリ）へコミットする。

let holdingsRows = [];          // 保有銘柄一覧（メモリ上の編集対象）
let holdingsLoaded = false;     // 一度でも読み込み（新規ファイルの場合は0件読み込み）が済んだか
let selectedHoldingId = null;   // 一覧で選択中の行ID（フォームの編集対象）
let holdingsDirty = false;      // 「読込」「保存」以降、holdingsRowsに未保存の変更が加わっているか（beforeunload警告に使用）

/** ページ離脱前に未保存の変更（holdingsDirty、または売買履歴の仮登録一覧gainsPendingRows）があれば確認ダイアログを出す。
 * どちらも「登録」を押すまでGitHubへは反映されない仕様のため、リロード・タブを閉じるだけで
 * 手動入力・CSV取込の内容が消えてしまう事故を防ぐ（gainsPendingRowsはこの後で宣言されるが、
 * このコールバックは初回読み込み完了後に発火するため参照時点では問題ない）。 */
window.addEventListener('beforeunload', (event) => {
    if (!holdingsDirty && gainsPendingRows.length === 0) return;
    event.preventDefault();
    event.returnValue = '';
});
let masterNameMapPromise = null; // 証券コード→銘柄名のMap（Promise）。セッション中は初回取得分を使い回す
let masterAssetTypeMapPromise = null; // 証券コード→asset_typeのMap（Promise）。セッション中は初回取得分を使い回す

/** master.csv を取得し、証券コード→銘柄名のMapを返す（保有銘柄一覧・入力フォームでの銘柄名表示に使用）。 */
function getMasterNameMap(token) {
    if (!masterNameMapPromise) {
        masterNameMapPromise = fetchFile(token, OWNER, DATA_REPO, MASTER_PATH)
            .then(text => new Map(parseCsv(text).map(r => [r.code, r.name])))
            .catch(error => { masterNameMapPromise = null; throw error; });
    }
    return masterNameMapPromise;
}

/** master.csv を取得し、証券コード→asset_typeのMapを返す（データ更新ページの内国株式／その他分類に使用）。 */
function getMasterAssetTypeMap(token) {
    if (!masterAssetTypeMapPromise) {
        masterAssetTypeMapPromise = fetchFile(token, OWNER, DATA_REPO, MASTER_PATH)
            .then(text => new Map(parseCsv(text).map(r => [r.code, r.asset_type])))
            .catch(error => { masterAssetTypeMapPromise = null; throw error; });
    }
    return masterAssetTypeMapPromise;
}

/** 証券コードをmaster.csvのasset_typeで「内国株式」「その他（ETF等）」に分類する。
 * master.csvに存在しないコード（N225等の指数）も「その他」に含める。 */
function classifyAssetCategory(code, assetTypeMap) {
    return assetTypeMap.get(code) === DOMESTIC_STOCK_CATEGORY ? DOMESTIC_STOCK_CATEGORY : OTHER_ASSET_CATEGORY;
}

/** holdingsRows内の最大id（数値部分）+1を返す（新規行のid採番用）。 */
function nextHoldingId(rows) {
    const maxId = rows.reduce((max, r) => {
        const n = parseInt(r.id, 10);
        return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return maxId + 1;
}

// 一覧のカラム定義（表示順）。keyは行オブジェクトのプロパティ名（'name'のみmaster.csv解決結果の仮想プロパティ）。
// numeric: trueの列は数値として比較・ソートする。sortクリックのヘッダー描画・getFilteredHoldingsRowsのソート双方で共有する。
const HOLDINGS_TABLE_COLS = [
    { key: 'owner',      label: '所有者' },
    { key: 'broker',     label: '証券会社' },
    { key: 'account',    label: '口座区分' },
    { key: 'code',       label: 'コード' },
    { key: 'name',       label: '銘柄名' },
    { key: 'shares',     label: '株数',     numeric: true },
    { key: 'avg_cost',   label: '取得単価', numeric: true },
    { key: 'updated_at', label: '最終更新日' },
];
const HOLDINGS_TRUNCATE_KEYS = new Set(['code', 'name']); // 長いファンド名が入りうるため省略表示する

/** 保有銘柄一覧テーブルを描画する。銘柄名はmaster.csvから解決できた場合のみ表示する（未解決でもコード自体は表示する）。
 * ヘッダークリックでの並び替え、検索欄（コード・銘柄名）による絞り込みに対応する。 */
async function renderHoldingsTable() {
    const table = document.getElementById('holdings-table');
    if (!table) return;

    const token = getTokenValue();
    let nameMap = new Map();
    if (token) {
        try { nameMap = await getMasterNameMap(token); } catch (error) { console.error(error); }
    }

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    HOLDINGS_TABLE_COLS.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label + (holdingsSort.key === col.key ? (holdingsSort.dir === 1 ? ' ▲' : ' ▼') : '');
        th.classList.add('holdings-sortable-th');
        th.addEventListener('click', () => {
            holdingsSort = { key: col.key, dir: holdingsSort.key === col.key ? -holdingsSort.dir : 1 };
            renderHoldingsTable();
        });
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    const rows = getFilteredHoldingsRows(nameMap);
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = HOLDINGS_TABLE_COLS.length;
        td.className = 'empty-cell';
        td.textContent = holdingsRows.length === 0
            ? '保有銘柄が登録されていません'
            : '絞り込み条件に一致する保有銘柄がありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        rows.forEach(row => {
            const tr = document.createElement('tr');
            if (String(row.id) === String(selectedHoldingId)) tr.classList.add('selected-row');

            // 最終更新日（updated_at）は2026-08-23追加のため、それ以前に登録された行は空欄になる
            HOLDINGS_TABLE_COLS.forEach(col => {
                const td = document.createElement('td');
                const text = (col.key === 'name' ? row._name : row[col.key]) ?? '';
                if (HOLDINGS_TRUNCATE_KEYS.has(col.key) && text.length > HOLDINGS_CODE_DISPLAY_MAX) {
                    td.textContent = text.slice(0, HOLDINGS_CODE_DISPLAY_MAX) + '…';
                    td.title = text; // 省略前の全文はホバーで確認できる
                } else {
                    td.textContent = text;
                }
                tr.appendChild(td);
            });

            tr.addEventListener('click', () => loadHoldingIntoForm(row.id));
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

// 所有者／証券会社／口座区分／検索（コード・銘柄名）の絞り込み状態（表示のみに影響。holdingsRows自体・保存内容には影響しない）
const holdingsFilters = { owner: '', broker: '', account: '', search: '' };
// 一覧の並び替え状態（表示のみに影響）。keyがnullの間は元の並び順（≒登録順）のまま。
let holdingsSort = { key: null, dir: 1 };

/** holdingsFilters・holdingsSortを適用した一覧を返す（空文字＝絞り込みなし）。表示用にmaster.csvで解決した
 * 銘柄名を`_name`として各行に付与する（検索・「銘柄名」列でのソート双方に使う。投資信託等、解決できない場合はcodeをそのまま使う）。 */
function getFilteredHoldingsRows(nameMap = new Map()) {
    const search = holdingsFilters.search.trim().toLowerCase();
    let rows = holdingsRows
        .map(row => ({ ...row, _name: nameMap.get(row.code) || row.code || '' }))
        .filter(row =>
            (!holdingsFilters.owner   || row.owner   === holdingsFilters.owner) &&
            (!holdingsFilters.broker  || row.broker  === holdingsFilters.broker) &&
            (!holdingsFilters.account || row.account === holdingsFilters.account) &&
            (!search || (row.code || '').toLowerCase().includes(search) || row._name.toLowerCase().includes(search))
        );

    if (holdingsSort.key) {
        const { key, dir } = holdingsSort;
        const numeric = HOLDINGS_TABLE_COLS.find(c => c.key === key)?.numeric;
        rows = rows.sort((a, b) => {
            const va = key === 'name' ? a._name : a[key];
            const vb = key === 'name' ? b._name : b[key];
            return numeric
                ? (Number(va) - Number(vb)) * dir
                : String(va || '').localeCompare(String(vb || ''), 'ja') * dir;
        });
    }
    return rows;
}

/** 所有者／証券会社／口座区分の絞り込み用<select>を、現在のholdingsRowsに実在する値から再構築する。選択中の値が引き続き有効なら維持する。 */
function renderHoldingsFilters() {
    const fillFilterSelect = (elId, field) => {
        const el = document.getElementById(elId);
        if (!el) return;

        const values = [...new Set(holdingsRows.map(r => r[field]).filter(Boolean))].sort();
        if (!values.includes(holdingsFilters[field])) holdingsFilters[field] = '';

        el.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'すべて';
        el.appendChild(allOption);
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            el.appendChild(option);
        });
        el.value = holdingsFilters[field];
    };

    fillFilterSelect('holdings-filter-owner',   'owner');
    fillFilterSelect('holdings-filter-broker',  'broker');
    fillFilterSelect('holdings-filter-account', 'account');
}

['owner', 'broker', 'account'].forEach(field => {
    document.getElementById(`holdings-filter-${field}`)?.addEventListener('change', (event) => {
        holdingsFilters[field] = event.target.value;
        renderHoldingsTable();
    });
});

document.getElementById('holdings-filter-search')?.addEventListener('input', (event) => {
    holdingsFilters.search = event.target.value;
    renderHoldingsTable();
});

/** 所有者／証券会社／口座区分の入力補助（datalist）を、現在のholdingsRowsに実在する値から再構築する。 */
function renderHoldingsDatalists() {
    const fillDatalist = (elId, values) => {
        const el = document.getElementById(elId);
        if (!el) return;
        el.innerHTML = '';
        [...new Set(values.filter(Boolean))].sort().forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            el.appendChild(option);
        });
    };
    fillDatalist('holdings-owner-list',   holdingsRows.map(r => r.owner));
    fillDatalist('holdings-broker-list',  holdingsRows.map(r => r.broker));
    fillDatalist('holdings-account-list', holdingsRows.map(r => r.account));
}

/** 入力フォームを新規登録モードにリセットする（所有者・証券会社・口座区分は連続入力しやすいよう既定値を残す）。 */
function clearHoldingsForm() {
    selectedHoldingId = null;
    document.getElementById('holdings-edit-id').value = '';
    document.getElementById('holdings-owner').value = 'Y';
    document.getElementById('holdings-broker').value = 'SBI';
    document.getElementById('holdings-account').value = '特定';
    document.getElementById('holdings-code').value = '';
    document.getElementById('holdings-code-name').textContent = '';
    document.getElementById('holdings-shares').value = '';
    document.getElementById('holdings-avg-cost').value = '';
    document.getElementById('holdings-form-title').textContent = '新規登録';
    renderHoldingsTable();
}

/** 指定idの保有銘柄を入力フォームへ読み込む（一覧クリック時）。 */
function loadHoldingIntoForm(id) {
    const row = holdingsRows.find(r => String(r.id) === String(id));
    if (!row) return;

    selectedHoldingId = row.id;
    document.getElementById('holdings-edit-id').value = row.id;
    document.getElementById('holdings-owner').value   = row.owner   || '';
    document.getElementById('holdings-broker').value  = row.broker  || '';
    document.getElementById('holdings-account').value = row.account || '';
    document.getElementById('holdings-code').value    = row.code    || '';
    document.getElementById('holdings-shares').value  = row.shares  || '';
    document.getElementById('holdings-avg-cost').value = row.avg_cost || '';
    document.getElementById('holdings-form-title').textContent = `編集（ID: ${row.id}）`;
    document.getElementById('holdings-code').dispatchEvent(new Event('input')); // 銘柄名プレビューを更新
    renderHoldingsTable();
}

/** stock/holdings.csv を読み込む（未作成の場合は0件として扱う）。 */
async function loadHoldings() {
    const listStatusEl = document.getElementById('holdings-list-status');
    const token = getTokenValue();
    if (!token) { listStatusEl.textContent = 'トークンを入力してください。'; return; }

    listStatusEl.textContent = '読み込み中...';

    try {
        const text = await fetchFileIfExists(token, OWNER, DATA_REPO, HOLDINGS_PATH);
        holdingsRows = text ? parseCsv(text) : [];
        holdingsLoaded = true;
        holdingsDirty = false; // GitHub側の最新内容を読み込み直したため、未保存扱いをリセットする
        clearHoldingsForm();
        renderHoldingsDatalists();
        renderHoldingsFilters();
        listStatusEl.textContent = text
            ? `${holdingsRows.length}件を読み込みました。`
            : 'まだ保有銘柄が登録されていません（「保存」を押すとstock/holdings.csvが新規作成されます）。';
    } catch (error) {
        console.error(error);
        listStatusEl.textContent = `読み込みに失敗しました: ${error.message}`;
    }
}

document.getElementById('holdings-reload-btn')?.addEventListener('click', loadHoldings);

// 証券コード入力のたびに、master.csvから引ける銘柄名をプレビュー表示する
document.getElementById('holdings-code')?.addEventListener('input', async () => {
    const codeInput = document.getElementById('holdings-code');
    const nameEl = document.getElementById('holdings-code-name');
    const code = codeInput.value.trim();
    const token = getTokenValue();
    if (!code || !token) { nameEl.textContent = ''; return; }

    try {
        const nameMap = await getMasterNameMap(token);
        if (codeInput.value.trim() !== code) return; // 取得中に入力内容が変わっていたら破棄
        nameEl.textContent = nameMap.has(code) ? nameMap.get(code) : '（銘柄マスタに見つかりません）';
    } catch (error) {
        console.error(error);
        nameEl.textContent = '';
    }
});

/** フォームの入力値を検証して返す（idは含まない）。証券コード・株数が未入力ならnullを返す（アラート表示済み）。
 * updated_atはフォーム項目ではなく、呼び出し時点の日時を自動セットする（手入力での更新日時と揃える）。 */
function readHoldingsFormFields() {
    const code   = document.getElementById('holdings-code').value.trim();
    const shares = document.getElementById('holdings-shares').value.trim();
    if (!code)   { alert('証券コードを入力してください'); return null; }
    if (!shares) { alert('株数を入力してください'); return null; }

    return {
        owner:   document.getElementById('holdings-owner').value.trim(),
        broker:  document.getElementById('holdings-broker').value.trim(),
        account: document.getElementById('holdings-account').value.trim(),
        code,
        shares,
        avg_cost: document.getElementById('holdings-avg-cost').value.trim(),
        updated_at: formatJstTimestamp(),
    };
}

/** 所有者×証券会社×口座区分×証券コードが一致する既存行を返す（無ければundefined）。「新規」の重複登録防止に使う。 */
function findDuplicateHoldingRow(fields) {
    return holdingsRows.find(r =>
        r.owner === fields.owner && r.broker === fields.broker &&
        r.account === fields.account && r.code === fields.code
    );
}

// 「新規」：フォームの内容を、選択中の行とは関係なく常に新しい1件として一覧へ追加する。
// 同一キー（所有者×証券会社×口座区分×コード）の行が既にある場合は、誤った二重登録を防ぐため確認を挟む
// （「適用」で既存行を更新するつもりが「新規」を押してしまうミスを想定）。
document.getElementById('holdings-new-btn')?.addEventListener('click', () => {
    const fields = readHoldingsFormFields();
    if (!fields) return;

    const duplicate = findDuplicateHoldingRow(fields);
    if (duplicate && !confirm(
        `同じ所有者・証券会社・口座区分・コードの行が既にあります（ID: ${duplicate.id}）。\n` +
        '既存行を更新したい場合は一覧からその行を選択し「適用」を使ってください。\n' +
        'このまま別行として新規追加してよろしいですか？'
    )) return;

    holdingsRows.push({ id: String(nextHoldingId(holdingsRows)), ...fields });
    holdingsDirty = true;

    clearHoldingsForm();
    renderHoldingsDatalists();
    renderHoldingsFilters();
    document.getElementById('holdings-list-status').textContent =
        `${holdingsRows.length}件（未保存の変更があります。「保存」を押すとGitHubへ反映されます）。`;
});

// 「適用」：一覧で選択中の行（holdings-edit-idに読み込み済み）を、フォームの内容で更新する。新規追加は行わない。
document.getElementById('holdings-apply-btn')?.addEventListener('click', () => {
    const editId = document.getElementById('holdings-edit-id').value;
    if (!editId) { alert('更新する行を一覧から選択してください（新しく登録する場合は「新規」ボタンを使ってください）'); return; }

    const fields = readHoldingsFormFields();
    if (!fields) return;

    const idx = holdingsRows.findIndex(r => String(r.id) === String(editId));
    if (idx === -1) { alert('選択中の行が見つかりませんでした。一覧から選び直してください'); return; }
    holdingsRows[idx] = { id: editId, ...fields };
    holdingsDirty = true;

    renderHoldingsTable();
    renderHoldingsDatalists();
    renderHoldingsFilters();
    document.getElementById('holdings-list-status').textContent =
        `${holdingsRows.length}件（未保存の変更があります。「保存」を押すとGitHubへ反映されます）。`;
});

document.getElementById('holdings-delete-btn')?.addEventListener('click', () => {
    const editId = document.getElementById('holdings-edit-id').value;
    if (!editId) { alert('削除する行を一覧から選択してください'); return; }
    if (!confirm('選択中の保有銘柄を削除します。よろしいですか？（この時点ではGitHubへは反映されません。反映するには「保存」を押してください）')) return;

    holdingsRows = holdingsRows.filter(r => String(r.id) !== String(editId));
    holdingsDirty = true;
    clearHoldingsForm();
    renderHoldingsDatalists();
    renderHoldingsFilters();
    document.getElementById('holdings-list-status').textContent =
        `${holdingsRows.length}件（未保存の変更があります。「保存」を押すとGitHubへ反映されます）。`;
});

document.getElementById('holdings-save-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('holdings-save-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (!holdingsLoaded) { alert('先に一覧の「読込」を押してから保存してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    statusEl.textContent = '保存中...';

    try {
        const content = stringifyCsv(holdingsRows, HOLDINGS_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, HOLDINGS_PATH, DATA_REPO_BRANCH, content, 'chore: 保有銘柄を更新');
        holdingsDirty = false; // GitHubへ反映済みになったため、未保存扱いを解除する
        statusEl.textContent = `保存しました（${holdingsRows.length}件）。`;
        document.getElementById('holdings-list-status').textContent = `${holdingsRows.length}件を読み込みました。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `保存に失敗しました: ${error.message}`;
    }
});

/** 現在のholdingsRows（絞り込み前の全件）をCSVとしてダウンロードする（バックアップ・手元確認用）。
 * stock/holdings.csvと同じ列構成（HOLDINGS_HEADERS）で書き出す。 */
document.getElementById('holdings-export-btn')?.addEventListener('click', () => {
    if (holdingsRows.length === 0) { alert('ダウンロードする保有銘柄がありません（先に「読込」を押してください）'); return; }

    const content = stringifyCsv(holdingsRows, HOLDINGS_HEADERS);
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holdings_${formatJstTimestamp().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

// ===== 保有・履歴：入力方法の切り替え（手動入力／CSV入力） =====
const HOLDINGS_INPUT_MODES = ['manual', 'csv'];

function renderHoldingsInputMode(mode) {
    HOLDINGS_INPUT_MODES.forEach(m => {
        document.getElementById(`holdings-mode-${m}`)?.classList.toggle('view-btn--active', m === mode);
    });
    const manualPanel = document.getElementById('holdings-manual-panel');
    const csvPanel    = document.getElementById('holdings-csv-panel');
    if (manualPanel) manualPanel.style.display = mode === 'manual' ? '' : 'none';
    if (csvPanel)    csvPanel.style.display    = mode === 'csv'    ? '' : 'none';
}

HOLDINGS_INPUT_MODES.forEach(mode => {
    document.getElementById(`holdings-mode-${mode}`)?.addEventListener('click', () => renderHoldingsInputMode(mode));
});

// ===== 保有・履歴：CSV入力（証券会社の出力ファイルから取り込み） =====
// 取り込むと、選択した所有者×証券会社の既存行だけを置き換える（他の所有者・証券会社の行は保持する）。
// SMBC日興証券は保有銘柄が少数のため手動入力で運用し、CSVパーサーは用意していない。
const HOLDINGS_CSV_PARSERS = {
    'SBI': parseSbiHoldingsCsv,
    '楽天': parseRakutenHoldingsCsv,
};
const HOLDINGS_CSV_APP_EXPORT_KIND = 'app_export'; // CSV出力（自アプリのholdings.csv形式）を取り込む特殊種別

/** テキストがCSVではなくHTMLページである可能性を判定する（先頭の空白を除いた冒頭が `<` で始まるか、
 * html/tableタグを含むかで簡易判定）。SBI証券をiPhone（Safari）でダウンロードすると、CSVではなく
 * 見た目だけ表形式のHTMLページが「〇〇.csv.html」という拡張子で保存される場合があるため、
 * その場合に備えて誤ってCSVとして解析する前に検出する（HTML自体の取り込みは未対応。2026-08-25時点）。 */
function looksLikeHtmlNotCsv(text) {
    const head = text.trimStart().slice(0, 200).toLowerCase();
    return head.startsWith('<') || head.includes('<html') || head.includes('<table');
}

/** 証券会社CSVのバイト列を文字列にデコードする。PCからダウンロードした場合はShift-JIS（cp932）だが、
 * 2026-08-25にスマホ（楽天証券アプリ／モバイルサイト）からダウンロードしたCSVがUTF-8だったことを確認したため、
 * まずUTF-8として厳格デコード（`fatal: true`）を試し、不正なバイト列でデコードに失敗した場合のみ
 * Shift-JISとして扱う（Shift-JISの2バイト文字は正しいUTF-8のバイト列としてほぼ成立しないため、
 * この判定順序で誤判定はほぼ起きない）。 */
function decodeBrokerCsvBytes(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return new TextDecoder('shift-jis').decode(buffer);
    }
}

// 証券会社の選択に応じて所有者欄の要否を切り替える（アプリのCSV出力は各行に所有者を含むため入力不要）
document.getElementById('holdings-csv-broker')?.addEventListener('change', (event) => {
    const ownerRow = document.getElementById('holdings-csv-owner-row');
    if (ownerRow) ownerRow.style.display = event.target.value === HOLDINGS_CSV_APP_EXPORT_KIND ? 'none' : '';
});

document.getElementById('holdings-csv-import-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('holdings-csv-status');
    const broker = document.getElementById('holdings-csv-broker').value;
    const owner  = document.getElementById('holdings-csv-owner').value.trim();
    const file   = document.getElementById('holdings-csv-file').files[0];

    if (!file) { alert('CSVファイルを選択してください'); return; }

    // アプリのCSV出力（3.1のCSV出力ボタンでダウンロードしたファイル）の取り込み：証券会社CSVと違い、
    // ファイル自体が所有者・証券会社・口座区分を列として持つ全件バックアップのため、部分マージではなく
    // 一覧全体をファイルの内容で置き換える（バックアップからの復元用途）。
    if (broker === HOLDINGS_CSV_APP_EXPORT_KIND) {
        if (!confirm('現在の一覧（未保存の変更を含む）を、このCSVファイルの内容ですべて置き換えます。よろしいですか？')) return;

        statusEl.textContent = '読み込み中...';
        try {
            const text = await file.text(); // 自アプリの出力はUTF-8のため、証券会社CSVと異なりShift-JISデコードは不要
            if (looksLikeHtmlNotCsv(text)) {
                statusEl.textContent = 'このファイルはCSVではなくHTML形式のようです（未対応）。CSV出力でダウンロードしたファイルをそのまま選択してください。';
                return;
            }
            const parsed = parseCsv(text);

            if (parsed.length === 0) {
                statusEl.textContent = 'CSVから保有銘柄を読み取れませんでした（CSV出力でダウンロードしたファイルか確認してください）。';
                return;
            }

            holdingsRows = parsed;
            holdingsDirty = true;

            clearHoldingsForm();
            renderHoldingsDatalists();
            renderHoldingsFilters();
            document.getElementById('holdings-csv-file').value = '';
            statusEl.textContent =
                `${parsed.length}件を読み込み、一覧全体を置き換えました` +
                `（未保存の変更があります。「登録」を押すとGitHubへ反映されます）。`;
        } catch (error) {
            console.error(error);
            statusEl.textContent = `取り込みに失敗しました: ${error.message}`;
        }
        return;
    }

    if (!owner) { alert('所有者を入力してください'); return; }

    const parser = HOLDINGS_CSV_PARSERS[broker];
    if (!parser) {
        statusEl.textContent = `${broker}のCSV取込は準備中です（${owner}分・ファイル「${file.name}」）。データ構造をもとに実装予定です。`;
        return;
    }

    statusEl.textContent = '読み込み中...';

    try {
        // 証券会社の出力CSVはPCからのダウンロード時はShift-JIS（cp932）だが、スマホ由来はUTF-8の場合があるため自動判定する
        const buffer = await file.arrayBuffer();
        const text = decodeBrokerCsvBytes(buffer);
        if (looksLikeHtmlNotCsv(text)) {
            statusEl.textContent =
                'このファイルはCSVではなくHTML形式のようです（未対応）。' +
                'iPhoneのSafariでダウンロードすると「.csv.html」という拡張子でHTML形式のページが保存されることがあります。' +
                'PC等でダウンロードしたCSVファイルをお試しください。';
            return;
        }
        const parsed = parser(text);

        if (parsed.length === 0) {
            statusEl.textContent = 'CSVから保有銘柄を読み取れませんでした（ファイル形式が想定と異なる可能性があります）。';
            return;
        }

        // 選択した所有者×証券会社に一致する既存行だけを置き換える（他の所有者・証券会社の行はそのまま保持）
        holdingsRows = holdingsRows.filter(r => !(r.owner === owner && r.broker === broker));
        let nextId = nextHoldingId(holdingsRows);
        const now = formatJstTimestamp();
        parsed.forEach(item => {
            holdingsRows.push({ id: String(nextId++), owner, broker, ...item, updated_at: now });
        });
        holdingsDirty = true;

        clearHoldingsForm();
        renderHoldingsDatalists();
        renderHoldingsFilters();
        document.getElementById('holdings-csv-file').value = '';
        statusEl.textContent =
            `${parsed.length}件を取り込みました（${owner} / ${broker}）。一覧全体: ${holdingsRows.length}件` +
            `（未保存の変更があります。「登録」を押すとGitHubへ反映されます）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `取り込みに失敗しました: ${error.message}`;
    }
});

// ===== 保有・履歴：売買履歴（実現損益。stock/realized_gains.csv） =====
// past/(chk済)_C05_(R3)譲渡益の記録.ipynbを移植。holdings.csvと違い「積み上げるデータ」（縦持ちの取引ログ）
// のため、保存は全体洗い替えではなく「追記型マージ」にする：登録ボタンを押した時点の最新の内容を取得し直し、
// 仮登録一覧（gainsPendingRows）のうち内容が完全一致する重複行だけを除いて追記する（同一CSVの誤った二重取込を防ぐ）。
// 旧notebookが行っていた同日同銘柄の合算・対話的な競合解決（合算/上書き/スキップ）は行わない
// （縦持ちならそもそも合算不要で、対話プロンプトもブラウザでは使えないため）。

let realizedGainsRows = [];  // 読込済みの売買履歴一覧（stock/realized_gains.csvの内容。表示・集計専用）
let gainsPendingRows = [];   // 手動入力・CSV取込で仮登録した未保存の行（{ _pendingId, owner, broker, asset_type, code, name, date, pnl }）
let gainsPendingSeq = 0;     // 仮登録行のUI管理用の連番（保存時に振り直す本番idとは別）

/** realizedGainsRows内の最大id（数値部分）+1を返す（新規行のid採番用）。holdingsのnextHoldingIdと同じロジック。 */
function nextGainsId(rows) {
    const maxId = rows.reduce((max, r) => {
        const n = parseInt(r.id, 10);
        return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return maxId + 1;
}

/** 重複判定の基本キー（証券会社・資産種別・コード・日付・損益）。同日同銘柄で同額の取引が複数あると
 * このキーだけでは区別できない（例：同日に同じ銘柄を100株ずつ2回売買し、たまたま損益が同額だった場合）ため、
 * 実際の重複判定（gains-save-btnのクリックハンドラ）ではこのキーの「同一キーの出現順」も合わせて比較する。 */
function gainsBaseKey(row) {
    return [row.broker, row.asset_type, row.code, row.date, row.pnl].join('|');
}

/** stock/realized_gains.csv を読み込み、一覧・集計グラフを再描画する。 */
async function loadRealizedGains() {
    const listStatusEl = document.getElementById('gains-list-status');
    const token = getTokenValue();
    if (!token) { listStatusEl.textContent = 'トークンを入力してください。'; return; }

    listStatusEl.textContent = '読込中...';
    try {
        const text = await fetchFileIfExists(token, OWNER, DATA_REPO, REALIZED_GAINS_PATH);
        realizedGainsRows = text ? parseCsv(text) : [];
        renderGainsLatestDates();
        renderGainsListFilters();
        await renderGainsTable();
        await renderGainsSummaryChart();
        listStatusEl.textContent = `${realizedGainsRows.length}件を読み込みました。`;
    } catch (error) {
        console.error(error);
        listStatusEl.textContent = `読込に失敗しました: ${error.message}`;
    }
}

document.getElementById('gains-reload-btn')?.addEventListener('click', loadRealizedGains);

/** 証券会社×資産種別ごとに、記録済みの約定日の最新値を一覧表示する。次にCSVを取得する際、
 * どの日付以降を取得すればよいか（取得範囲のギャップ）を判断する目安にする
 * （4.1「更新最終日」の株価版と同じ考え方。CSV入力の「種類」プルダウンの区分と揃えている）。 */
function renderGainsLatestDates() {
    const list = document.getElementById('gains-latest-date-list');
    if (!list) return;
    list.replaceChildren();

    const latestByGroup = new Map(); // "証券会社/資産種別" -> 最新の約定日
    realizedGainsRows.forEach(r => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
        const key = `${r.broker || '不明'}（${r.asset_type || '不明'}）`;
        const current = latestByGroup.get(key);
        if (!current || r.date > current) latestByGroup.set(key, r.date);
    });

    if (latestByGroup.size === 0) {
        const li = document.createElement('li');
        li.textContent = '記録がまだありません。';
        list.appendChild(li);
        return;
    }

    [...latestByGroup.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja')).forEach(([group, date]) => {
        const li = document.createElement('li');
        li.textContent = `${group}: ${date} まで記録済み`;
        list.appendChild(li);
    });
}

// 売買履歴一覧の絞り込み状態（表示のみに影響。realizedGainsRows自体・保存内容には影響しない）
const gainsListFilters = { owner: '', broker: '', start: '', end: '', search: '' };

/** gainsListFiltersを適用した一覧を返す（空文字＝絞り込みなし）。表示用の銘柄名はCSV由来のname列を使わず、
 * master.csvで解決できた名前を`_name`として各行に付与する（未解決の場合はcodeにフォールバック。holdingsの
 * `_name`と同じ考え方。検索・テーブル表示の両方に使う）。 */
function getFilteredGainsRows(nameMap = new Map()) {
    const search = gainsListFilters.search.trim().toLowerCase();
    return realizedGainsRows
        .map(r => ({ ...r, _name: nameMap.get(r.code) || r.code || '' }))
        .filter(r =>
            (!gainsListFilters.owner  || r.owner  === gainsListFilters.owner) &&
            (!gainsListFilters.broker || r.broker === gainsListFilters.broker) &&
            (!gainsListFilters.start  || r.date >= gainsListFilters.start) &&
            (!gainsListFilters.end    || r.date <= gainsListFilters.end) &&
            (!search || (r.code || '').toLowerCase().includes(search) || r._name.toLowerCase().includes(search))
        );
}

/** 所有者／証券会社の絞り込み用<select>を、現在のrealizedGainsRowsに実在する値から再構築する。
 * 選択中の値が引き続き有効なら維持する（holdingsのrenderHoldingsFiltersと同じ考え方）。 */
function renderGainsListFilters() {
    const fillFilterSelect = (elId, field) => {
        const el = document.getElementById(elId);
        if (!el) return;

        const values = [...new Set(realizedGainsRows.map(r => r[field]).filter(Boolean))].sort();
        if (!values.includes(gainsListFilters[field])) gainsListFilters[field] = '';

        el.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'すべて';
        el.appendChild(allOption);
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            el.appendChild(option);
        });
        el.value = gainsListFilters[field];
    };

    fillFilterSelect('gains-list-filter-owner',  'owner');
    fillFilterSelect('gains-list-filter-broker', 'broker');
}

['owner', 'broker'].forEach(field => {
    document.getElementById(`gains-list-filter-${field}`)?.addEventListener('change', (event) => {
        gainsListFilters[field] = event.target.value;
        renderGainsTable();
    });
});
['start', 'end'].forEach(field => {
    document.getElementById(`gains-list-filter-${field}`)?.addEventListener('change', (event) => {
        gainsListFilters[field] = event.target.value;
        renderGainsTable();
    });
});
document.getElementById('gains-list-filter-search')?.addEventListener('input', (event) => {
    gainsListFilters.search = event.target.value;
    renderGainsTable();
});

/** 売買履歴一覧テーブル（読込済み・保存済みの内容）を約定日の降順で描画する。銘柄名はCSV由来のname列を使わず、
 * master.csvのnameMapで解決できた名前を表示する（外国株・投資信託はmaster.csvに載らないため未解決コードのまま
 * 表示されることが多い。holdingsと同じフォールバック）。gainsListFilters（所有者・証券会社・期間・銘柄検索）
 * による絞り込みを適用する。 */
async function renderGainsTable() {
    const table = document.getElementById('gains-table');
    if (!table) return;

    const token = getTokenValue();
    let nameMap = new Map();
    if (token) {
        try { nameMap = await getMasterNameMap(token); } catch (error) { console.error(error); }
    }

    const cols = ['所有者', '証券会社', '資産種別', 'コード', '銘柄名', '約定日', '実現損益（円）'];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    const sorted = getFilteredGainsRows(nameMap).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    if (sorted.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = realizedGainsRows.length === 0 ? '売買履歴がありません' : '絞り込み条件に一致する売買履歴がありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        sorted.forEach(r => {
            const tr = document.createElement('tr');
            const values = [r.owner, r.broker, r.asset_type, r.code, r._name, r.date, Number(r.pnl).toLocaleString('ja-JP')];
            values.forEach(v => {
                const td = document.createElement('td');
                td.textContent = v ?? '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** 1グループ分（プラス側／マイナス側）の横棒グラフを描画する。バーは0を左端とし、rows内の最大絶対値を
 * 基準に伸ばす（プラス・マイナスでスケールを共有しない。renderGainsSummaryChartから呼ばれる）。 */
function renderGainsBarGroup(containerId, rows, fillClass) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.replaceChildren();

    if (rows.length === 0) {
        container.textContent = '該当銘柄はありません。';
        return;
    }

    const maxAbs = Math.max(...rows.map(r => Math.abs(r.total)), 1);
    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'gains-chart-row';

        const label = document.createElement('div');
        label.className = 'gains-chart-label';
        label.textContent = r.name ? `${r.code}：${r.name}` : r.code;
        label.title = label.textContent;

        const track = document.createElement('div');
        track.className = 'gains-chart-track';

        const fill = document.createElement('div');
        fill.className = `gains-chart-fill ${fillClass}`;
        fill.style.width = `${(Math.abs(r.total) / maxAbs) * 100}%`;
        track.appendChild(fill);

        const value = document.createElement('div');
        value.className = 'gains-chart-value';
        value.textContent = Math.round(r.total).toLocaleString('ja-JP');

        row.append(label, track, value);
        container.appendChild(row);
    });
}

// 銘柄別 実現損益合計グラフの集計期間（約定日ベース、YYYY-MM-DD文字列。空文字はその方向に無制限）
const gainsSummaryFilters = { start: '', end: '' };

document.getElementById('gains-summary-start')?.addEventListener('change', (event) => {
    gainsSummaryFilters.start = event.target.value;
    renderGainsSummaryChart();
});
document.getElementById('gains-summary-end')?.addEventListener('change', (event) => {
    gainsSummaryFilters.end = event.target.value;
    renderGainsSummaryChart();
});

/** 銘柄別 実現損益合計を、旧notebook同様プラス（利益）／マイナス（損失）の2つのグラフに分けて描画する。
 * realizedGainsRows（読込済みの保存済みデータ）のうち、gainsSummaryFilters（約定日の期間）に
 * 該当する行だけを対象にする（仮登録中の未保存分は含めない。登録後に「読込」し直せば反映される）。
 * 銘柄名はCSV由来のname列を使わず、master.csvで解決できた名前を表示する（未解決はcodeにフォールバック）。 */
async function renderGainsSummaryChart() {
    const { start, end } = gainsSummaryFilters;
    const targetRows = realizedGainsRows.filter(r => {
        if (start && r.date < start) return false;
        if (end && r.date > end) return false;
        return true;
    });

    const token = getTokenValue();
    let nameMap = new Map();
    if (token) {
        try { nameMap = await getMasterNameMap(token); } catch (error) { console.error(error); }
    }

    const totals = new Map(); // code -> { name, total }
    targetRows.forEach(r => {
        const pnl = Number(r.pnl);
        if (!Number.isFinite(pnl)) return;
        const entry = totals.get(r.code) || { name: nameMap.get(r.code) || r.code || '', total: 0 };
        entry.total += pnl;
        totals.set(r.code, entry);
    });

    const rows = [...totals.entries()].map(([code, { name, total }]) => ({ code, name, total }));
    const positive = rows.filter(r => r.total >= 0).sort((a, b) => b.total - a.total);
    const negative = rows.filter(r => r.total < 0).sort((a, b) => a.total - b.total);

    const sumOf = list => list.reduce((s, r) => s + r.total, 0);
    const positiveTotalEl = document.getElementById('gains-summary-total-positive');
    const negativeTotalEl = document.getElementById('gains-summary-total-negative');
    if (positiveTotalEl) positiveTotalEl.textContent = `${Math.round(sumOf(positive)).toLocaleString('ja-JP')}円`;
    if (negativeTotalEl) negativeTotalEl.textContent = `${Math.round(sumOf(negative)).toLocaleString('ja-JP')}円`;

    renderGainsBarGroup('gains-summary-chart-positive', positive, 'gains-chart-fill--positive');
    renderGainsBarGroup('gains-summary-chart-negative', negative, 'gains-chart-fill--negative');
}

// ===== 売買履歴：入力方法の切り替え（手動入力／CSV入力） =====
const GAINS_INPUT_MODES = ['manual', 'csv'];

function renderGainsInputMode(mode) {
    GAINS_INPUT_MODES.forEach(m => {
        document.getElementById(`gains-mode-${m}`)?.classList.toggle('view-btn--active', m === mode);
    });
    const manualPanel = document.getElementById('gains-manual-panel');
    const csvPanel    = document.getElementById('gains-csv-panel');
    if (manualPanel) manualPanel.style.display = mode === 'manual' ? '' : 'none';
    if (csvPanel)    csvPanel.style.display    = mode === 'csv'    ? '' : 'none';
}

GAINS_INPUT_MODES.forEach(mode => {
    document.getElementById(`gains-mode-${mode}`)?.addEventListener('click', () => renderGainsInputMode(mode));
});

/** 仮登録一覧（gainsPendingRows）テーブルを描画する。行クリックではなく「削除」ボタンで個別に取り消す。 */
function renderGainsPendingTable() {
    const table = document.getElementById('gains-pending-table');
    if (!table) return;

    const cols = ['所有者', '証券会社', '資産種別', 'コード', '銘柄名', '約定日', '実現損益（円）', ''];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (gainsPendingRows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '仮登録はありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        gainsPendingRows.forEach(r => {
            const tr = document.createElement('tr');
            const values = [r.owner, r.broker, r.asset_type, r.code, r.name, r.date, Number(r.pnl).toLocaleString('ja-JP')];
            values.forEach(v => {
                const td = document.createElement('td');
                td.textContent = v ?? '';
                tr.appendChild(td);
            });
            const actionTd = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'run-btn run-btn--danger';
            delBtn.textContent = '削除';
            delBtn.addEventListener('click', () => {
                gainsPendingRows = gainsPendingRows.filter(p => p._pendingId !== r._pendingId);
                renderGainsPendingTable();
            });
            actionTd.appendChild(delBtn);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** 手動入力フォームの内容をクリアする（所有者・証券会社・資産種別は連続入力しやすいよう残す）。 */
function clearGainsManualForm() {
    document.getElementById('gains-code').value = '';
    document.getElementById('gains-name').value = '';
    document.getElementById('gains-date').value = '';
    document.getElementById('gains-pnl').value = '';
}

document.getElementById('gains-add-btn')?.addEventListener('click', () => {
    const owner = document.getElementById('gains-owner').value.trim();
    const broker = document.getElementById('gains-broker').value.trim();
    const asset_type = document.getElementById('gains-asset-type').value;
    const code = document.getElementById('gains-code').value.trim();
    const name = document.getElementById('gains-name').value.trim();
    const date = document.getElementById('gains-date').value;
    const pnl = document.getElementById('gains-pnl').value.trim();

    if (!owner || !broker || !code || !date || pnl === '') { alert('所有者・証券会社・証券コード・約定日・実現損益を入力してください'); return; }

    gainsPendingRows.push({ _pendingId: ++gainsPendingSeq, owner, broker, asset_type, code, name, date, pnl: Number(pnl) });
    renderGainsPendingTable();
    clearGainsManualForm();
});

// ===== 売買履歴：CSV入力（証券会社の実現損益CSVから一括取込） =====
// 取り込んだ内容はいったんgainsPendingRowsに積むだけで、「登録」を押すまでGitHubへは反映されない。
const GAINS_CSV_PARSERS = {
    sbi_domestic: { parser: parseSbiDomesticRealizedGainsCsv, broker: 'SBI',  asset_type: '国内株式' },
    sbi_foreign:  { parser: parseSbiForeignRealizedGainsCsv,  broker: 'SBI',  asset_type: '外国株式' },
    sbi_fund:     { parser: parseSbiFundRealizedGainsCsv,     broker: 'SBI',  asset_type: '投資信託' },
    rakuten:      { parser: parseRakutenRealizedGainsCsv,     broker: '楽天', asset_type: '国内株式' },
};

const GAINS_CSV_APP_EXPORT_KIND = 'app_export'; // CSV出力（自アプリのrealized_gains.csv形式）を取り込む特殊種別

// 種類の選択に応じて所有者欄の要否を切り替える（アプリのCSV出力は各行に所有者を含むため入力不要）
document.getElementById('gains-csv-kind')?.addEventListener('change', (event) => {
    const ownerRow = document.getElementById('gains-csv-owner-row');
    if (ownerRow) ownerRow.style.display = event.target.value === GAINS_CSV_APP_EXPORT_KIND ? 'none' : '';
});

document.getElementById('gains-csv-import-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('gains-csv-status');
    const kind  = document.getElementById('gains-csv-kind').value;
    const owner = document.getElementById('gains-csv-owner').value.trim();
    const file  = document.getElementById('gains-csv-file').files[0];

    if (!file) { alert('CSVファイルを選択してください'); return; }

    // バックアップ復元（CSV出力でダウンロードしたファイルの取り込み）：ファイル自体が所有者・証券会社・
    // 資産種別を列として持つため、証券会社CSVと違い所有者の指定は不要。仮登録一覧に積むだけなので
    // holdingsのバックアップ復元と異なり全置換ではなく、既存データとの重複は「登録」時の重複判定に委ねる。
    if (kind === GAINS_CSV_APP_EXPORT_KIND) {
        statusEl.textContent = '読み込み中...';
        try {
            const text = await file.text(); // 自アプリの出力はUTF-8のため、証券会社CSVと異なりShift-JISデコードは不要
            if (looksLikeHtmlNotCsv(text)) {
                statusEl.textContent = 'このファイルはCSVではなくHTML形式のようです（未対応）。CSV出力でダウンロードしたファイルをそのまま選択してください。';
                return;
            }
            const parsed = parseCsv(text);

            if (parsed.length === 0) {
                statusEl.textContent = 'CSVから実現損益を読み取れませんでした（CSV出力でダウンロードしたファイルか確認してください）。';
                return;
            }

            parsed.forEach(({ id, ...item }) => { // idは「登録」時に採番し直すため、取り込み時点では捨てる
                gainsPendingRows.push({ _pendingId: ++gainsPendingSeq, ...item });
            });

            renderGainsPendingTable();
            document.getElementById('gains-csv-file').value = '';
            statusEl.textContent =
                `${parsed.length}件を仮登録一覧に追加しました。「登録」を押すとGitHubへ反映されます` +
                `（既存の履歴と重複する分は登録時に自動的にスキップされます）。`;
        } catch (error) {
            console.error(error);
            statusEl.textContent = `取り込みに失敗しました: ${error.message}`;
        }
        return;
    }

    if (!owner) { alert('所有者を入力してください'); return; }

    const config = GAINS_CSV_PARSERS[kind];
    statusEl.textContent = '読み込み中...';

    try {
        // 証券会社の出力CSVはPCからのダウンロード時はShift-JIS（cp932）だが、スマホ由来はUTF-8の場合があるため自動判定する
        const buffer = await file.arrayBuffer();
        const text = decodeBrokerCsvBytes(buffer);
        if (looksLikeHtmlNotCsv(text)) {
            statusEl.textContent =
                'このファイルはCSVではなくHTML形式のようです（未対応）。' +
                'iPhoneのSafariでダウンロードすると「.csv.html」という拡張子でHTML形式のページが保存されることがあります。' +
                'PC等でダウンロードしたCSVファイルをお試しください。';
            return;
        }
        const parsed = config.parser(text);

        if (parsed.length === 0) {
            statusEl.textContent = 'CSVから実現損益を読み取れませんでした（ファイル形式が想定と異なる可能性があります）。';
            return;
        }

        parsed.forEach(item => {
            gainsPendingRows.push({ _pendingId: ++gainsPendingSeq, owner, broker: config.broker, asset_type: config.asset_type, ...item });
        });

        renderGainsPendingTable();
        document.getElementById('gains-csv-file').value = '';
        statusEl.textContent = `${parsed.length}件を仮登録一覧に追加しました。「登録」を押すとGitHubへ反映されます。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `取り込みに失敗しました: ${error.message}`;
    }
});

/** 現在のrealizedGainsRows（「読込」済みの保存済みデータ。仮登録中の未保存分は含まない）をCSVとしてダウンロードする
 * （バックアップ・手元確認用）。stock/realized_gains.csvと同じ列構成（REALIZED_GAINS_HEADERS）で書き出す。 */
document.getElementById('gains-export-btn')?.addEventListener('click', () => {
    if (realizedGainsRows.length === 0) { alert('ダウンロードする売買履歴がありません（先に「読込」を押してください）'); return; }

    const content = stringifyCsv(realizedGainsRows, REALIZED_GAINS_HEADERS);
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `realized_gains_${formatJstTimestamp().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

// ===== 売買履歴：仮登録一覧をGitHubへ保存（追記型マージ） =====
// 保存直前に最新のstock/realized_gains.csvを取得し直し、重複していない分だけ新しいidを振って追記する
// （delisted.csv/extra_targets.csv等と同様、常に最新の内容の上にマージする）。
//
// 重複判定は「基本キー（gainsBaseKey）が完全一致する行が、既存データ側に何件あるか」を基準にした
// 出現順（1件目、2件目…）比較で行う。基本キーだけで重複を判定すると、同日に同じ銘柄を複数回売買して
// たまたま損益が同額だった場合（例：100株ずつ2回売買）に2件目以降を誤って重複扱いしてしまう。
// 出現順まで含めて比較することで、「本当に複数ある同条件の取引」（基本キーの出現件数が既存より多い分＝新規）と
// 「期間が重複する再取込み」（基本キーの出現件数が既存以下＝重複）を区別できる
// （旧notebook・past/(chk済)_C05_(R3)譲渡益の記録.ipynbは、同日同銘柄を合算してから既存値と完全一致するかを
// 比較する冪等性の仕組みだったため複数取引を区別できなかったが、縦持ちログではこの出現順方式でどちらも実現できる）。
document.getElementById('gains-save-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('gains-save-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (gainsPendingRows.length === 0) { alert('仮登録がありません（手動入力またはCSV取込で追加してください）'); return; }

    statusEl.textContent = '保存中...';
    try {
        const existingText = await fetchFileIfExists(token, OWNER, DATA_REPO, REALIZED_GAINS_PATH);
        const existingRows = existingText ? parseCsv(existingText) : [];

        const existingCounts = new Map(); // 基本キー -> 既存データ内での出現件数
        existingRows.forEach(r => {
            const key = gainsBaseKey(r);
            existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
        });

        let nextId = nextGainsId(existingRows);
        const pendingSeenCounts = new Map(); // 基本キー -> ここまでに処理した仮登録側の出現件数
        let added = 0, skipped = 0;
        gainsPendingRows.forEach(({ _pendingId, ...row }) => {
            const key = gainsBaseKey(row);
            const occurrence = (pendingSeenCounts.get(key) || 0) + 1;
            pendingSeenCounts.set(key, occurrence);

            if (occurrence <= (existingCounts.get(key) || 0)) { skipped++; return; } // 既存データ側に対応する出現がある＝重複
            existingRows.push({ id: String(nextId++), ...row });
            added++;
        });

        const content = stringifyCsv(existingRows, REALIZED_GAINS_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, REALIZED_GAINS_PATH, DATA_REPO_BRANCH, content, 'chore: 売買履歴（実現損益）を追加');

        gainsPendingRows = [];
        renderGainsPendingTable();
        statusEl.textContent = `保存しました（追加: ${added}件 / 重複スキップ: ${skipped}件 / 合計: ${existingRows.length}件）。`;
        await loadRealizedGains();
    } catch (error) {
        console.error(error);
        statusEl.textContent = `保存に失敗しました: ${error.message}`;
    }
});

renderGainsPendingTable();

// ===== データ更新：IRBANK企業ID取得（stock/irbank.csv。内国株式のEID・URL・社名） =====
// master.csvとは別ファイルにする理由: master.csvはJPX公式データからいつでも作り直せる派生データだが、
// irbank.csvはスクレイピングで積み上げた（再取得コストが高い）データのため、master.csvの再生成で
// 消えないよう独立させている（詳細はREADME参照）。

let irbankNotFoundRows = [];  // 直近チェックの未取得（除外済みを除く）銘柄一覧（{ code, name }）。除外ボタンから参照する
let irbankExcludedRows = [];  // 直近チェックのstock/irbank_excluded.csvの内容（メモリ上。除外/戻すのたびに最新化）
let irbankChecked = false;    // 一度でもチェックが済んだか（未チェックでの除外による取りこぼし上書きを防ぐ）

/** 未取得銘柄（要確認）テーブルを描画する。行ごとにチェックボックス・コード・銘柄名・IRBANKへのリンクを表示する。 */
function renderIrbankNotFoundTable() {
    const table = document.getElementById('irbank-notfound-table');
    if (!table) return;

    const cols = ['', 'コード', '銘柄名', 'IRBANK'];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (irbankNotFoundRows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '未取得の銘柄はありません。';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        irbankNotFoundRows.forEach(row => {
            const tr = document.createElement('tr');

            const checkTd = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'irbank-notfound-check';
            checkbox.dataset.code = row.code;
            checkTd.appendChild(checkbox);
            tr.appendChild(checkTd);

            const codeTd = document.createElement('td');
            codeTd.textContent = row.code;
            tr.appendChild(codeTd);

            const nameTd = document.createElement('td');
            nameTd.textContent = row.name || '（master.csvに名称なし）';
            tr.appendChild(nameTd);

            const linkTd = document.createElement('td');
            const a = document.createElement('a');
            a.href = `https://irbank.net/${row.code}`;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = '確認';
            linkTd.appendChild(a);
            tr.appendChild(linkTd);

            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** 除外済み銘柄テーブルを描画する（デフォルト閉のExpander内）。行ごとに「戻す」で除外を取り消せる。 */
function renderIrbankExcludedTable(nameMap) {
    const table = document.getElementById('irbank-excluded-table');
    if (!table) return;

    const cols = ['コード', '銘柄名', '除外日時', ''];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (irbankExcludedRows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '除外済みの銘柄はありません。';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        irbankExcludedRows.forEach(row => {
            const tr = document.createElement('tr');
            [row.code, nameMap.get(row.code) || '', row.updated_at || ''].forEach(v => {
                const td = document.createElement('td');
                td.textContent = v;
                tr.appendChild(td);
            });

            const actionTd = document.createElement('td');
            const undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.className = 'run-btn run-btn--danger status-inline-btn';
            undoBtn.textContent = '戻す';
            undoBtn.addEventListener('click', () => handleIrbankUnexcludeClick(row.code, undoBtn));
            actionTd.appendChild(undoBtn);
            tr.appendChild(actionTd);

            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** stock/irbank.csv を読み込み、内国株式の取得状況（取得済み／未取得／未着手／除外）を集計して表示する。
 * あわせて未取得銘柄（要確認）テーブル・除外済み銘柄テーブルも再描画する。 */
async function loadIrbankStatus() {
    const summaryEl = document.getElementById('irbank-status-summary');
    const token = getTokenValue();
    if (!token) { summaryEl.textContent = 'トークンを入力し「チェック」を押してください。'; return; }

    summaryEl.textContent = '状態を確認中...';

    try {
        const [masterText, irbankText, excludedText] = await Promise.all([
            fetchFile(token, OWNER, DATA_REPO, MASTER_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, IRBANK_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, IRBANK_EXCLUDED_PATH),
        ]);

        const masterRows = parseCsv(masterText);
        const nameMap = new Map(masterRows.map(r => [r.code, r.name]));
        const targetRows = masterRows.filter(r => r.status === 'listed' && r.asset_type === IRBANK_ASSET_TYPE);
        const irbankRows = irbankText ? parseCsv(irbankText) : [];
        const irbankByCode = new Map(irbankRows.map(r => [r.code, r]));

        irbankExcludedRows = excludedText ? parseCsv(excludedText) : [];
        irbankChecked = true;
        const excludedCodes = new Set(irbankExcludedRows.map(r => r.code));

        let okCount = 0;
        let notFoundCount = 0;
        let missingCount = 0;
        irbankNotFoundRows = [];
        targetRows.forEach(row => {
            if (excludedCodes.has(row.code)) return; // 除外済みは集計・一覧のどちらからも外す
            const irbankRow = irbankByCode.get(row.code);
            if (irbankRow && irbankRow.status === 'ok' && irbankRow.eid) okCount++;
            else if (irbankRow && irbankRow.status === 'not_found') {
                notFoundCount++;
                irbankNotFoundRows.push({ code: row.code, name: nameMap.get(row.code) || '' });
            } else missingCount++;
        });

        summaryEl.textContent =
            `対象（内国株式）: ${targetRows.length}銘柄 / 取得済み: ${okCount}件 / ` +
            `未取得（要再挑戦）: ${notFoundCount}件 / 未着手: ${missingCount}件 / 除外: ${irbankExcludedRows.length}件`;

        renderIrbankNotFoundTable();
        renderIrbankExcludedTable(nameMap);
    } catch (error) {
        console.error(error);
        summaryEl.textContent = `状態の取得に失敗しました: ${error.message}`;
    }
}

document.getElementById('irbank-status-check-btn')?.addEventListener('click', loadIrbankStatus);

/** 未取得銘柄（要確認）でチェックした銘柄を、stock/irbank_excluded.csvへ即時コミットで登録する
 * （delisted.csv等と同じ操作感。仮登録の中間状態は持たない）。 */
document.getElementById('irbank-exclude-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const statusEl = document.getElementById('irbank-exclude-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (!irbankChecked) { alert('先に「チェック」を実行してから除外してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    const checkedCodes = [...document.querySelectorAll('.irbank-notfound-check:checked')].map(cb => cb.dataset.code);
    if (checkedCodes.length === 0) { alert('除外する銘柄にチェックを付けてください'); return; }

    btn.disabled = true;
    statusEl.textContent = '除外中...';
    try {
        const now = formatJstTimestamp();
        checkedCodes.forEach(code => {
            const existing = irbankExcludedRows.find(r => r.code === code);
            if (existing) existing.updated_at = now;
            else irbankExcludedRows.push({ code, note: '手動確認（IRBANKに個別ページ無し等）', updated_at: now });
        });
        const content = stringifyCsv(irbankExcludedRows, IRBANK_EXCLUDED_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, IRBANK_EXCLUDED_PATH, DATA_REPO_BRANCH, content, 'chore: IRBANK企業ID未取得の除外銘柄を登録');
        statusEl.textContent = `${checkedCodes.length}件を除外しました。`;
        await loadIrbankStatus(); // 一覧・集計全体が再描画されるためbtnへの参照はここで役目を終える
    } catch (error) {
        console.error(error);
        btn.disabled = false;
        statusEl.textContent = `除外に失敗しました: ${error.message}`;
    }
});

/** 除外の取り消し（誤って除外した場合の訂正用）。確認の上、対象コードを除いて即コミットする。 */
async function handleIrbankUnexcludeClick(code, buttonEl) {
    const ok = confirm(`${code}の除外を取り消します（再び「未取得（要再挑戦）」の対象になります）。よろしいですか？`);
    if (!ok) return;

    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    buttonEl.disabled = true;
    try {
        irbankExcludedRows = irbankExcludedRows.filter(r => r.code !== code);
        const content = stringifyCsv(irbankExcludedRows, IRBANK_EXCLUDED_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, IRBANK_EXCLUDED_PATH, DATA_REPO_BRANCH, content, 'chore: IRBANK企業IDの除外銘柄を取り消し');
        await loadIrbankStatus();
    } catch (error) {
        console.error(error);
        buttonEl.disabled = false;
        alert(`取り消しに失敗しました: ${error.message}`);
    }
}

// ===== データ更新：配当情報取得（stock/dividends.csv。年別1株配当。past/(chk済)_C04_1_業績情報取得.ipynbを移植） =====
// stock/irbank.csvでURL取得済みの銘柄を対象に、notebooks/C04_配当情報取得.ipynbが年別の配当（予想／実績）を取得する。
// 縦持ち形式（1行=1年分）にしており、旧notebookの「銘柄コード×年の横持ち表」から変更している（他の移行済み
// データと同じキー名ベースのアクセスに揃えるため。詳細はnotebook側のmarkdownセル参照）。

/** stock/dividends.csv を読み込み、配当情報の取得状況（取得済み／未取得）を集計して表示する。
 * 対象はstock/irbank.csvでstatus=okかつURLがある銘柄（notebooks/C04_配当情報取得.ipynbの対象選定と揃えている）。 */
async function loadDividendStatus() {
    const summaryEl = document.getElementById('dividend-status-summary');
    const token = getTokenValue();
    if (!token) { summaryEl.textContent = 'トークンを入力し「チェック」を押してください。'; return; }

    summaryEl.textContent = '状態を確認中...';

    try {
        const [irbankText, dividendsText] = await Promise.all([
            fetchFileIfExists(token, OWNER, DATA_REPO, IRBANK_PATH),
            fetchFileIfExists(token, OWNER, DATA_REPO, DIVIDENDS_PATH),
        ]);

        const targetRows = (irbankText ? parseCsv(irbankText) : []).filter(r => r.status === 'ok' && r.url);
        const dividendRows = dividendsText ? parseCsv(dividendsText) : [];
        const fetchedCodes = new Set(dividendRows.map(r => r.code));

        const fetchedCount = targetRows.filter(r => fetchedCodes.has(r.code)).length;
        summaryEl.textContent =
            `対象（IRBANK取得済み銘柄）: ${targetRows.length}銘柄 / 配当データ取得済み: ${fetchedCount}件 / ` +
            `未取得: ${targetRows.length - fetchedCount}件`;
    } catch (error) {
        console.error(error);
        summaryEl.textContent = `状態の取得に失敗しました: ${error.message}`;
    }
}

document.getElementById('dividend-status-check-btn')?.addEventListener('click', loadDividendStatus);

/** 指定した証券コードの配当履歴（stock/dividends.csv）を年昇順で一覧表示する。 */
document.getElementById('dividend-lookup-btn')?.addEventListener('click', async () => {
    const table = document.getElementById('dividend-lookup-table');
    const code = document.getElementById('dividend-lookup-code').value.trim();
    const token = getTokenValue();
    if (!code)  { alert('証券コードを入力してください'); return; }
    if (!token) { alert('トークンを入力してください'); return; }

    try {
        const dividendsText = await fetchFileIfExists(token, OWNER, DATA_REPO, DIVIDENDS_PATH);
        const rows = (dividendsText ? parseCsv(dividendsText) : [])
            .filter(r => r.code === code)
            .sort((a, b) => Number(a.year) - Number(b.year));

        const thead = document.createElement('thead');
        const hRow = document.createElement('tr');
        ['年', '1株配当（円）', '区分'].forEach(label => {
            const th = document.createElement('th');
            th.textContent = label;
            hRow.appendChild(th);
        });
        thead.appendChild(hRow);

        const tbody = document.createElement('tbody');
        if (rows.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3;
            td.className = 'empty-cell';
            td.textContent = '配当データがありません';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            rows.forEach(r => {
                const tr = document.createElement('tr');
                [r.year, r.amount, r.is_forecast === 'True' ? '予想' : '実績'].forEach(v => {
                    const td = document.createElement('td');
                    td.textContent = v ?? '';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }
        table.replaceChildren(thead, tbody);
    } catch (error) {
        console.error(error);
        alert(`取得に失敗しました: ${error.message}`);
    }
});

// 配当情報の手動追記：IRBANK対象外の資産（投資信託・海外ETF等）や取得漏れの補完用。
// past/(chk済)_C06_1_(R4)銘柄情報の手動追記.ipynbのupdate_haitou_manualを移植。自動取得（notebooks/C04_配当情報取得.ipynb）
// と違い、「確定値を予想で退行させない」制約は適用せず、手入力の内容を常に優先して(コード,年)を上書きする。
document.getElementById('dividend-manual-register-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('dividend-manual-status');
    const token = getTokenValue();
    const code = document.getElementById('dividend-manual-code').value.trim();
    const year = document.getElementById('dividend-manual-year').value.trim();
    const amount = document.getElementById('dividend-manual-amount').value.trim();
    const isForecast = document.getElementById('dividend-manual-is-forecast').value;

    if (!token)  { alert('トークンを入力してください'); return; }
    if (!code)   { alert('証券コードを入力してください'); return; }
    if (!year)   { alert('年を入力してください'); return; }
    if (!amount) { alert('1株配当を入力してください'); return; }

    statusEl.textContent = '登録中...';
    try {
        const existingText = await fetchFileIfExists(token, OWNER, DATA_REPO, DIVIDENDS_PATH);
        const rowsMap = new Map((existingText ? parseCsv(existingText) : []).map(r => [`${r.code}|${r.year}`, r]));

        const now = formatJstTimestamp();
        rowsMap.set(`${code}|${year}`, { code, year, amount, is_forecast: isForecast, updated_at: now });

        const content = stringifyCsv([...rowsMap.values()], DIVIDEND_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, DIVIDENDS_PATH, DATA_REPO_BRANCH, content, 'chore: 配当情報を手動更新');

        statusEl.textContent = `登録しました（コード: ${code} / 年: ${year}）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `登録に失敗しました: ${error.message}`;
    }
});

// ===== 銘柄属性：高配当・優待ラベル（stock/labels.csv） =====
// master.csvとは別ファイルにする理由: master.csvはJPX公式データから毎回作り直される派生データだが、
// ラベルは人手で積み上げる再取得コストの高いデータのため（過去のirbank.csvと同じ判断。詳細はCLAUDE.md参照）。
// 「追加」「削除」はどちらもlabelsRows（登録対象・GitHubへ送る内容）を更新するが、上部の「登録済み一覧」表示には
// 反映しない（holdings.csvの手動入力と違い、編集中に何度でも上書きしうるため）。代わりに右側の「変更予定（未登録）」欄に
// 内容を追記していき、「登録」でコミットが成功した時点で初めて登録済み一覧に反映・変更予定一覧をクリアする。

let labelsRows = [];             // ラベル一覧（メモリ上の編集対象。「登録」でこの内容をまるごとコミットする）
let labelsLoaded = false;        // 一度でも読み込みが済んだか（未読み込みでの「登録」による取りこぼし上書きを防ぐ）
let labelsBaseline = new Map();  // 直近の読込/登録時点でのcode→行。「削除」がGitHub上に既に存在するコード対象かどうかの判定に使う
let pendingLabelChanges = [];    // 直近の読込/登録以降に「追加」「削除」した内容（表示専用。コードごとに最新の内容で上書き）

/** 現在時刻をJST・"YYYY-MM-DD HH:MM:SS"形式で返す（irbank.csvのupdated_atと表記を揃えている）。 */
function formatJstTimestamp() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const iso = jst.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/**
 * freshness_report.json/validation_report.jsonのchecked_at（例: "2026-08-17T05:03:27"）をJSTの
 * "YYYY/MM/DD HH:MM:SS"形式に変換する。scripts/*.pyはGitHub ActionsランナーのUTC時刻をタイムゾーン変換せず
 * そのままisoformat()で出力しているため、末尾に'Z'を補ってUTCとして明示的にパースしてからJSTへ変換する。
 */
function formatUtcIsoToJst(isoString) {
    if (!isoString) return isoString;
    const date = new Date(`${isoString}Z`);
    if (Number.isNaN(date.getTime())) return isoString;
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const iso = jst.toISOString();
    return `${iso.slice(0, 10).replace(/-/g, '/')} ${iso.slice(11, 19)}`;
}

// 登録済み一覧（Expander内）：高配当・優待・米国ETFの絞り込み（チェックON時のみそのラベルが1の行に絞る。OFFは絞り込みなし）。
// 業績情報をもとにした絞り込みは将来追加予定（ここに条件を足していく想定）。
const attributesFilters = { highDiv: false, perk: false, usEtf: false };

/** attributesFiltersを適用した一覧を返す。 */
function getFilteredLabelsRows() {
    return labelsRows.filter(row =>
        (!attributesFilters.highDiv || row['L_高配当'] === '1') &&
        (!attributesFilters.perk    || row['L_優待']   === '1') &&
        (!attributesFilters.usEtf   || row['L_米国ETF'] === '1')
    );
}

/** 登録済みラベル一覧テーブルを描画する。銘柄名はmaster.csvから解決できた場合のみ表示する。 */
async function renderAttributesTable() {
    const table = document.getElementById('attributes-table');
    if (!table) return;

    const token = getTokenValue();
    let nameMap = new Map();
    if (token) {
        try { nameMap = await getMasterNameMap(token); } catch (error) { console.error(error); }
    }

    const cols = ['コード', '銘柄名', '高配当', '優待', '米国ETF', '更新日時'];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(col => { const th = document.createElement('th'); th.textContent = col; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    const rows = getFilteredLabelsRows();
    const selectedCode = document.getElementById('attributes-code').value.trim();
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = labelsRows.length === 0
            ? 'ラベルが登録されていません'
            : '絞り込み条件に一致する銘柄がありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        rows.forEach(row => {
            const tr = document.createElement('tr');
            if (row.code === selectedCode) tr.classList.add('selected-row');

            const values = [row.code, nameMap.get(row.code) || '', row['L_高配当'] === '1' ? '○' : '', row['L_優待'] === '1' ? '○' : '', row['L_米国ETF'] === '1' ? '○' : '', row.updated_at || ''];
            values.forEach(value => {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });

            tr.addEventListener('click', () => loadLabelIntoForm(row.code));
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** 「変更予定（未登録）」テーブルを描画する。pendingLabelChanges（表示専用）の内容をそのまま出す。 */
async function renderAttributesPendingTable() {
    const table = document.getElementById('attributes-pending-table');
    if (!table) return;

    const token = getTokenValue();
    let nameMap = new Map();
    if (token) {
        try { nameMap = await getMasterNameMap(token); } catch (error) { console.error(error); }
    }

    const cols = ['コード', '銘柄名', '高配当', '優待', '米国ETF', '状態'];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(col => { const th = document.createElement('th'); th.textContent = col; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (pendingLabelChanges.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '「追加」「削除」を押すと、ここに追記されます';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        pendingLabelChanges.forEach(change => {
            const tr = document.createElement('tr');
            const values = [
                change.code,
                nameMap.get(change.code) || '',
                !change.deleted && change.highDiv ? '○' : '',
                !change.deleted && change.perk ? '○' : '',
                !change.deleted && change.usEtf ? '○' : '',
                change.deleted ? '削除' : '追加',
            ];
            values.forEach(value => {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });

            tr.addEventListener('click', () => loadLabelIntoForm(change.code));
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

document.getElementById('attributes-filter-high-div')?.addEventListener('change', (event) => {
    attributesFilters.highDiv = event.target.checked;
    renderAttributesTable();
});
document.getElementById('attributes-filter-perk')?.addEventListener('change', (event) => {
    attributesFilters.perk = event.target.checked;
    renderAttributesTable();
});
document.getElementById('attributes-filter-us-etf')?.addEventListener('change', (event) => {
    attributesFilters.usEtf = event.target.checked;
    renderAttributesTable();
});

/** 一覧クリック時：指定コードを編集フォームへ読み込む（銘柄名・チェック状態のプレビューはinputイベントに委譲）。 */
function loadLabelIntoForm(code) {
    const codeInput = document.getElementById('attributes-code');
    codeInput.value = code;
    codeInput.dispatchEvent(new Event('input'));
    renderAttributesTable(); // 選択行のハイライトを更新
}

/** stock/labels.csv を読み込む（未作成の場合は0件として扱う）。 */
async function loadLabels() {
    const statusEl = document.getElementById('attributes-list-status');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    statusEl.textContent = '読み込み中...';

    try {
        const text = await fetchFileIfExists(token, OWNER, DATA_REPO, LABELS_PATH);
        labelsRows = text ? parseCsv(text) : [];
        labelsLoaded = true;
        labelsBaseline = new Map(labelsRows.map(r => [r.code, r]));
        pendingLabelChanges = []; // 再読込により未登録の変更予定は破棄される（labelsRows自体を読み込み直すため）
        statusEl.textContent = text
            ? `${labelsRows.length}件を読み込みました。`
            : 'まだラベルが登録されていません（「登録」を押すとstock/labels.csvが新規作成されます）。';
        // 検索欄に既にコードが入力済みなら、読み込んだ内容でチェック状態を再反映する
        document.getElementById('attributes-code')?.dispatchEvent(new Event('input'));
        renderAttributesTable();
        renderAttributesPendingTable();
    } catch (error) {
        console.error(error);
        statusEl.textContent = `読み込みに失敗しました: ${error.message}`;
    }
}

document.getElementById('attributes-reload-btn')?.addEventListener('click', loadLabels);

/** 証券コード欄の入力値を、カンマ区切り（前後の空白は許容）でコード配列に分解する。空要素は除く。 */
function parseAttributesCodes(raw) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// 証券コード入力のたびに、master.csvから引ける銘柄名と、labelsRowsに既存のラベル状態をプレビュー表示する。
// 複数コード（カンマ区切り）の場合は、一括適用先の確認用に銘柄名一覧のみ表示し、チェック状態の自動反映は行わない
// （コードごとに既存状態が異なりうるため、単一コードの場合のみ意味を持つ）。
document.getElementById('attributes-code')?.addEventListener('input', async () => {
    const codeInput = document.getElementById('attributes-code');
    const nameEl = document.getElementById('attributes-code-name');
    const highDivEl = document.getElementById('attributes-label-high-div');
    const perkEl = document.getElementById('attributes-label-perk');
    const usEtfEl = document.getElementById('attributes-label-us-etf');
    const raw = codeInput.value.trim();
    const codes = parseAttributesCodes(raw);

    if (codes.length === 1) {
        const existing = labelsRows.find(r => r.code === codes[0]);
        highDivEl.checked = existing ? existing['L_高配当'] === '1' : false;
        perkEl.checked = existing ? existing['L_優待'] === '1' : false;
        usEtfEl.checked = existing ? existing['L_米国ETF'] === '1' : false;
    }

    const token = getTokenValue();
    if (codes.length === 0 || !token) { nameEl.textContent = ''; return; }

    try {
        const nameMap = await getMasterNameMap(token);
        if (codeInput.value.trim() !== raw) return; // 取得中に入力内容が変わっていたら破棄
        if (codes.length === 1) {
            nameEl.textContent = nameMap.has(codes[0]) ? nameMap.get(codes[0]) : '（銘柄マスタに見つかりません）';
        } else {
            nameEl.textContent = `${codes.length}件: ` + codes
                .map(c => `${c}（${nameMap.has(c) ? nameMap.get(c) : '銘柄マスタに見つかりません'}）`)
                .join('、');
        }
    } catch (error) {
        console.error(error);
        nameEl.textContent = '';
    }
});

// 「追加」：入力中のコード（カンマ区切りで複数可）すべてに、同じラベル状態をlabelsRowsへ反映する
// （GitHubへはまだ反映されない）。いずれかのラベルがONであることが前提（両方OFFでの削除は「削除」ボタンを使う）。
// 上部の「登録済み一覧」はここでは更新せず、代わりに右側の「変更予定（未登録）」に今回の内容を追記する
// （同じコードを再度「追加」した場合は最新の内容で上書き）。
document.getElementById('attributes-add-btn')?.addEventListener('click', () => {
    if (!labelsLoaded) { alert('先に「読込」を押してから編集してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    const codes = parseAttributesCodes(document.getElementById('attributes-code').value.trim());
    if (codes.length === 0) { alert('証券コードを入力してください'); return; }

    const highDiv = document.getElementById('attributes-label-high-div').checked;
    const perk = document.getElementById('attributes-label-perk').checked;
    const usEtf = document.getElementById('attributes-label-us-etf').checked;
    if (!highDiv && !perk && !usEtf) { alert('「追加」はいずれかのラベルをONにしてから押してください（削除する場合は「削除」ボタンを使ってください）'); return; }

    const now = formatJstTimestamp();

    codes.forEach(code => {
        const idx = labelsRows.findIndex(r => r.code === code);
        const row = { code, 'L_高配当': highDiv ? '1' : '0', 'L_優待': perk ? '1' : '0', 'L_米国ETF': usEtf ? '1' : '0', updated_at: now };
        if (idx !== -1) labelsRows[idx] = row; else labelsRows.push(row);

        const pendingIdx = pendingLabelChanges.findIndex(p => p.code === code);
        const pendingEntry = { code, highDiv, perk, usEtf, deleted: false };
        if (pendingIdx !== -1) pendingLabelChanges[pendingIdx] = pendingEntry; else pendingLabelChanges.push(pendingEntry);
    });

    renderAttributesPendingTable();
    document.getElementById('attributes-edit-status').textContent =
        `${codes.length}件を追加しました（右側に追記。累計${pendingLabelChanges.length}件）。「登録」を押すとGitHubへ反映されます。`;
});

// 「削除」：入力中のコード（カンマ区切りで複数可）をlabelsRowsから取り除く（GitHubへはまだ反映されない）。
// GitHub上に既に存在するコード（labelsBaseline）は「削除予定」として右側に残し、「登録」を押すまで確定しない。
// まだ登録されていない（今回「追加」しただけの）コードは、追加自体を取り消して変更予定一覧からも消す。
document.getElementById('attributes-delete-btn')?.addEventListener('click', () => {
    if (!labelsLoaded) { alert('先に「読込」を押してから編集してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    const codes = parseAttributesCodes(document.getElementById('attributes-code').value.trim());
    if (codes.length === 0) { alert('証券コードを入力してください'); return; }

    if (!confirm(`${codes.length}件を削除対象にします。よろしいですか？（この時点ではGitHubへは反映されません。反映するには「登録」を押してください）`)) return;

    codes.forEach(code => {
        const idx = labelsRows.findIndex(r => r.code === code);
        if (idx !== -1) labelsRows.splice(idx, 1);

        const pendingIdx = pendingLabelChanges.findIndex(p => p.code === code);
        if (labelsBaseline.has(code)) {
            const pendingEntry = { code, highDiv: false, perk: false, usEtf: false, deleted: true };
            if (pendingIdx !== -1) pendingLabelChanges[pendingIdx] = pendingEntry; else pendingLabelChanges.push(pendingEntry);
        } else if (pendingIdx !== -1) {
            pendingLabelChanges.splice(pendingIdx, 1); // 未登録の追加を取り消すだけなので、変更予定一覧からも消す
        }
    });

    renderAttributesPendingTable();
    document.getElementById('attributes-edit-status').textContent =
        `${codes.length}件を削除対象にしました（累計${pendingLabelChanges.length}件）。「登録」を押すとGitHubへ反映されます。`;
});

document.getElementById('attributes-save-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('attributes-save-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (!labelsLoaded) { alert('先に一覧の「読込」を押してから保存してください（既存データを取りこぼして上書きするのを防ぐため）'); return; }

    statusEl.textContent = '保存中...';

    try {
        const content = stringifyCsv(labelsRows, LABEL_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, LABELS_PATH, DATA_REPO_BRANCH, content, 'chore: 銘柄属性ラベルを更新');
        statusEl.textContent = `保存しました（${labelsRows.length}件）。`;
        document.getElementById('attributes-list-status').textContent = `${labelsRows.length}件を読み込みました。`;
        labelsBaseline = new Map(labelsRows.map(r => [r.code, r]));
        pendingLabelChanges = []; // 登録済み一覧に反映されたので、変更予定（未登録）一覧はクリアする
        document.getElementById('attributes-edit-status').textContent = '';
        renderAttributesTable();
        renderAttributesPendingTable();
    } catch (error) {
        console.error(error);
        statusEl.textContent = `保存に失敗しました: ${error.message}`;
    }
});

// ===== 銘柄属性：銘柄情報。master.csvに載らない資産の名称・業種を手動登録する =====
// past/(chk済)_C06_1_(R4)銘柄情報の手動追記.ipynbのupdate_idmapを移植した機能だが、2026-08-26に方針転換：
// stock/asset_info.csvは廃止し、master.csvを「コード→銘柄名・業種」対応の唯一の正の基準にする
// （JPX上場銘柄はJPX一覧由来の値、それ以外はsource=manual_fundとして手動登録した値を同じ列に持つ）。
// delisted.csv/extra_targets.csvと同様、仮登録の中間状態を持たず、コード指定→即時コミット方式。

let masterIndustryMapPromise = null; // 証券コード→industry33_nameのMap（Promise）。セッション中は初回取得分を使い回す
let masterRowMapPromise = null;      // 証券コード→master.csvの行全体のMap（Promise）。チェック・編集フォームへの
                                      // プリフィルで名称/資産種別/業種すべてを参照するために使う

/** master.csv を取得し、証券コード→industry33_nameのMapを返す（業種の入力補助・重複表記防止に使用）。 */
function getMasterIndustryMap(token) {
    if (!masterIndustryMapPromise) {
        masterIndustryMapPromise = fetchFile(token, OWNER, DATA_REPO, MASTER_PATH)
            .then(text => new Map(parseCsv(text).map(r => [r.code, r.industry33_name])))
            .catch(error => { masterIndustryMapPromise = null; throw error; });
    }
    return masterIndustryMapPromise;
}

/** master.csv を取得し、証券コード→行全体のMapを返す（未登録・業種未登録チェック、編集フォームへのプリフィルに使用）。 */
function getMasterRowMap(token) {
    if (!masterRowMapPromise) {
        masterRowMapPromise = fetchFile(token, OWNER, DATA_REPO, MASTER_PATH)
            .then(text => new Map(parseCsv(text).map(r => [r.code, r])))
            .catch(error => { masterRowMapPromise = null; throw error; });
    }
    return masterRowMapPromise;
}

/** master-fund-*の登録フォームへ、既存行（あれば）の内容を入力する。無ければコードのみ入力する。 */
function fillMasterFundForm(code, row) {
    document.getElementById('master-fund-code').value = code;
    document.getElementById('master-fund-name').value = row?.name || (row ? '' : code);
    document.getElementById('master-fund-asset-type').value = row?.asset_type || '内国株式'; // 不明な場合は最多パターンの内国株式をデフォルトにする（datalistで投資信託・外国株式・ETF・ETNへ変更可）
    document.getElementById('master-fund-industry').value = row?.industry33_name || '';
    document.getElementById('master-fund-status-select').value = row?.status === 'delisted' ? 'delisted' : 'listed';
    document.getElementById('master-fund-name').focus();
}

/** 業種入力欄（datalist）を、master.csvの既存業種一覧から再構築する（旧notebookのshow_industry_33_choices相当。
 * 表記ゆれ防止のため、新規に別表記を作る前に既存候補を提示する）。 */
async function renderMasterFundIndustryDatalist() {
    const datalist = document.getElementById('master-fund-industry-list');
    if (!datalist) return;
    const token = getTokenValue();
    if (!token) return;

    try {
        const industryMap = await getMasterIndustryMap(token);
        const choices = [...new Set(industryMap.values())].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja'));

        datalist.replaceChildren();
        choices.forEach(choice => {
            const option = document.createElement('option');
            option.value = choice;
            datalist.appendChild(option);
        });
    } catch (error) {
        console.error(error);
    }
}

/** 登録済み一覧（master.csvのうちsource=manual_fundの行のみ）テーブルを描画する。行クリックで登録フォームに
 * 内容を読み込んで編集できるようにし、「削除」ボタンでその場でmaster.csvから該当行を削除する。 */
function renderMasterFundTable(rows) {
    const table = document.getElementById('master-fund-table');
    if (!table) return;

    const cols = ['コード', '名称', '資産種別', '業種', 'ステータス', '最終更新日', ''];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '手動登録された銘柄がありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.title = 'クリックで登録フォームに読み込んで編集';
            tr.addEventListener('click', () => fillMasterFundForm(r.code, r));
            [r.code, r.name, r.asset_type, r.industry33_name, r.status, r.as_of].forEach(v => {
                const td = document.createElement('td');
                td.textContent = v ?? '';
                tr.appendChild(td);
            });
            const actionTd = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'run-btn run-btn--danger';
            delBtn.textContent = '削除';
            delBtn.addEventListener('click', (event) => {
                event.stopPropagation(); // 行クリック（編集読み込み）に伝播させない
                deleteMasterFundRow(r.code);
            });
            actionTd.appendChild(delBtn);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** master.csvから、source=manual_fundの該当コード行だけを削除してコミットする（JPX由来の行は対象外）。 */
async function deleteMasterFundRow(code) {
    const statusEl = document.getElementById('master-fund-list-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (!confirm(`コード「${code}」をmaster.csvから削除しますか？`)) return;

    statusEl.textContent = '削除中...';
    try {
        const existingText = await fetchFileIfExists(token, OWNER, DATA_REPO, MASTER_PATH);
        const rows = (existingText ? parseCsv(existingText) : [])
            .filter(r => !(r.code === code && r.source === 'manual_fund'));

        const content = stringifyCsv(rows, MASTER_COLUMNS);
        await commitFile(token, OWNER, DATA_REPO, MASTER_PATH, DATA_REPO_BRANCH, content, 'chore: master.csvから手動登録銘柄を削除');

        masterNameMapPromise = null;
        masterIndustryMapPromise = null;
        masterRowMapPromise = null;
        statusEl.textContent = `削除しました（コード: ${code}）。`;
        await loadMasterFundList();
    } catch (error) {
        console.error(error);
        statusEl.textContent = `削除に失敗しました: ${error.message}`;
    }
}

/** master.csv を読み込み、手動登録分（source=manual_fund）の一覧・業種datalistを再描画する。 */
async function loadMasterFundList() {
    const listStatusEl = document.getElementById('master-fund-list-status');
    const token = getTokenValue();
    if (!token) { listStatusEl.textContent = 'トークンを入力してください。'; return; }

    listStatusEl.textContent = '読込中...';
    try {
        const text = await fetchFileIfExists(token, OWNER, DATA_REPO, MASTER_PATH);
        const rows = (text ? parseCsv(text) : []).filter(r => r.source === 'manual_fund');
        renderMasterFundTable(rows);
        await renderMasterFundIndustryDatalist();
        listStatusEl.textContent = `${rows.length}件を読み込みました。`;
    } catch (error) {
        console.error(error);
        listStatusEl.textContent = `読込に失敗しました: ${error.message}`;
    }
}

document.getElementById('master-fund-reload-btn')?.addEventListener('click', loadMasterFundList);

/** codesのうちmaster.csvで「名称未登録」または「業種未登録（名称はあるが業種が空欄）」のものをlistEl（<ul>）に
 * 一覧表示する共通処理。行クリックで登録フォームに既存内容（業種未登録の場合は名称・資産種別も含む）を読み込む。
 * 戻り値は該当件数（0件時のメッセージ判定用）。 */
function renderMasterFundMissingList(listEl, codes, rowMap) {
    listEl.replaceChildren();
    const missing = codes
        .map(code => ({ code, row: rowMap.get(code) }))
        .filter(({ row }) => !row || !row.name || !row.industry33_name);

    missing.forEach(({ code, row }) => {
        const li = document.createElement('li');
        li.textContent = !row || !row.name ? `${code}（名称未登録）` : `${code}（業種未登録）`;
        li.style.cursor = 'pointer';
        li.title = 'クリックで登録フォームに読み込む';
        li.addEventListener('click', () => fillMasterFundForm(code, row));
        listEl.appendChild(li);
    });
    return missing.length;
}

// データ品質チェック：保有銘柄（stock/holdings.csv）のうち、master.csvで名称または業種が未登録のものを
// 一覧表示する（past/(chk済)_C06_1_(R4)銘柄情報の手動追記.ipynbの「bad = merged_df[...]」相当）。
// クリックすると登録フォームに読み込む。
document.getElementById('master-fund-check-holdings-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('master-fund-check-holdings-status');
    const listEl = document.getElementById('master-fund-check-holdings-list');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    statusEl.textContent = 'チェック中...';
    listEl.replaceChildren();

    try {
        const [holdingsText, rowMap] = await Promise.all([
            fetchFileIfExists(token, OWNER, DATA_REPO, HOLDINGS_PATH),
            getMasterRowMap(token),
        ]);

        const holdingsCodes = [...new Set((holdingsText ? parseCsv(holdingsText) : []).map(r => r.code))];
        const missingCount = renderMasterFundMissingList(listEl, holdingsCodes, rowMap);

        statusEl.textContent = missingCount === 0
            ? `保有銘柄 ${holdingsCodes.length}件中、名称・業種とも未登録のものはありません。`
            : `保有銘柄 ${holdingsCodes.length}件中、${missingCount}件が名称または業種未登録です（クリックで登録フォームに読み込み）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `チェックに失敗しました: ${error.message}`;
    }
});

// データ品質チェック：売買履歴（stock/realized_gains.csv）のコード列のうち、master.csvで名称または業種が
// 未登録のものを一覧表示する。クリックすると登録フォームに読み込む。
document.getElementById('master-fund-check-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('master-fund-check-status');
    const listEl = document.getElementById('master-fund-check-list');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    statusEl.textContent = 'チェック中...';
    listEl.replaceChildren();

    try {
        const [gainsText, rowMap] = await Promise.all([
            fetchFileIfExists(token, OWNER, DATA_REPO, REALIZED_GAINS_PATH),
            getMasterRowMap(token),
        ]);

        const gainsCodes = [...new Set((gainsText ? parseCsv(gainsText) : []).map(r => r.code).filter(Boolean))];
        const missingCount = renderMasterFundMissingList(listEl, gainsCodes, rowMap);

        statusEl.textContent = missingCount === 0
            ? `売買履歴の銘柄コード ${gainsCodes.length}件中、名称・業種とも未登録のものはありません。`
            : `売買履歴の銘柄コード ${gainsCodes.length}件中、${missingCount}件が名称または業種未登録です（クリックで登録フォームに読み込み）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `チェックに失敗しました: ${error.message}`;
    }
});

// 候補への追加・まとめてのmaster.csv登録：複数件を編集して溜めてから一括コミットできるようにする
// （売買履歴のgainsPendingRowsと同じ「仮登録一覧→まとめて保存」パターン。キーはcode）。
let masterFundPendingRows = []; // { code, name, asset_type, industry33_name, _delete }（_delete=trueは登録時に削除扱い）
renderMasterFundPendingTable(); // 初期表示で「登録候補はありません」を出す（関数宣言は巻き上げられるため定義前でも呼べる）

/** 登録候補一覧（未コミット）テーブルを描画する。行クリックで上のフォームに読み込んで編集し直せる。
 * 削除チェックは、まとめて登録した際にその行をmaster.csvから削除する指示として扱う。 */
function renderMasterFundPendingTable() {
    const table = document.getElementById('master-fund-pending-table');
    if (!table) return;

    const cols = ['コード', '名称', '資産種別', '業種', 'ステータス', '削除', ''];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (masterFundPendingRows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '登録候補はありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        masterFundPendingRows.forEach(p => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.title = 'クリックで上のフォームに読み込んで編集';
            tr.addEventListener('click', () => fillMasterFundForm(p.code, p));
            [p.code, p.name, p.asset_type, p.industry33_name, p.status].forEach(v => {
                const td = document.createElement('td');
                td.textContent = v ?? '';
                tr.appendChild(td);
            });

            const delTd = document.createElement('td');
            const delCheckbox = document.createElement('input');
            delCheckbox.type = 'checkbox';
            delCheckbox.checked = !!p._delete;
            delCheckbox.addEventListener('click', (event) => event.stopPropagation()); // 行クリックに伝播させない
            delCheckbox.addEventListener('change', () => { p._delete = delCheckbox.checked; });
            delTd.appendChild(delCheckbox);
            tr.appendChild(delTd);

            const actionTd = document.createElement('td');
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'run-btn run-btn--danger';
            removeBtn.textContent = '候補から外す';
            removeBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                masterFundPendingRows = masterFundPendingRows.filter(r => r.code !== p.code);
                renderMasterFundPendingTable();
            });
            actionTd.appendChild(removeBtn);
            tr.appendChild(actionTd);

            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}

/** 手動登録フォームの内容をクリアする（資産種別・ステータスは連続入力しやすいよう残す）。 */
function clearMasterFundForm() {
    document.getElementById('master-fund-code').value = '';
    document.getElementById('master-fund-name').value = '';
    document.getElementById('master-fund-industry').value = '';
}

// 「候補に追加」：フォームの内容を登録候補一覧（masterFundPendingRows）へcodeキーで追加・上書きする
// （まだmaster.csvへはコミットしない）。
document.getElementById('master-fund-add-btn')?.addEventListener('click', () => {
    const statusEl = document.getElementById('master-fund-add-status');
    const code = document.getElementById('master-fund-code').value.trim();
    const name = document.getElementById('master-fund-name').value.trim();
    const assetType = document.getElementById('master-fund-asset-type').value.trim();
    const industry = document.getElementById('master-fund-industry').value.trim();
    const status = document.getElementById('master-fund-status-select').value;
    if (!code || !name) { alert('コード・名称を入力してください'); return; }

    masterFundPendingRows = masterFundPendingRows.filter(r => r.code !== code);
    masterFundPendingRows.push({ code, name, asset_type: assetType, industry33_name: industry, status, _delete: false });
    renderMasterFundPendingTable();
    clearMasterFundForm();
    statusEl.textContent = `候補に追加しました（コード: ${code} / 候補件数: ${masterFundPendingRows.length}件）。`;
    document.getElementById('master-fund-code').focus();
});

// 登録：登録候補一覧（masterFundPendingRows）をまとめてmaster.csvへコミットする（source=manual_fund, statusは候補ごとに指定）。
// _delete=trueの候補はmaster.csvから該当コード（source=manual_fundのみ）を削除、それ以外は追加・更新する。
// build_stock_master.pyの積み上げマージはsource=tse_data_j以外の行をdelisted化しないため、次回のJPX一覧
// 取り込みでも追加・更新した行は消えない。
document.getElementById('master-fund-register-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('master-fund-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }
    if (masterFundPendingRows.length === 0) { alert('登録候補がありません（フォームから「候補に追加」してください）'); return; }

    statusEl.textContent = '登録中...';
    try {
        const existingText = await fetchFileIfExists(token, OWNER, DATA_REPO, MASTER_PATH);
        const rows = existingText ? parseCsv(existingText) : [];
        const rowsMap = new Map(rows.map(r => [r.code, r]));

        const now = formatJstTimestamp().slice(0, 10);
        let upserted = 0, deleted = 0;
        masterFundPendingRows.forEach(p => {
            if (p._delete) {
                if (rowsMap.get(p.code)?.source === 'manual_fund') { rowsMap.delete(p.code); deleted++; }
                return;
            }
            rowsMap.set(p.code, {
                id: p.code, code: p.code, name: p.name, market: '', segment: '', asset_type: p.asset_type,
                industry33_code: '', industry33_name: p.industry33_name, industry17_code: '', industry17_name: '',
                scale_code: '', scale_name: '', status: p.status === 'delisted' ? 'delisted' : 'listed', source: 'manual_fund', as_of: now,
            });
            upserted++;
        });

        const content = stringifyCsv([...rowsMap.values()], MASTER_COLUMNS);
        await commitFile(token, OWNER, DATA_REPO, MASTER_PATH, DATA_REPO_BRANCH, content, 'chore: master.csvに投信等を手動登録・削除');

        masterNameMapPromise = null;     // キャッシュ済みのnameMapを次回取得時に再構築させる
        masterIndustryMapPromise = null; // 業種Mapも同様
        masterRowMapPromise = null;      // 行全体のMapも同様
        masterFundPendingRows = [];
        renderMasterFundPendingTable();
        statusEl.textContent = `登録しました（更新・追加: ${upserted}件 / 削除: ${deleted}件 / 合計: ${rowsMap.size}件）。`;
        await loadMasterFundList();
    } catch (error) {
        console.error(error);
        statusEl.textContent = `登録に失敗しました: ${error.message}`;
    }
});

// ===== DEF：ディフェンシブ度（景気連動度）シミュレータ（2026-08-24、データ更新タブのDEFモードへ移動） =====
// past/(chk済)_C02-2_ディフェンシブ判定ラベル付け.ipynbのスコアリングロジックを移植したもの（js/modules/defensiveScore.js）。
// 旧実装の手動教師ラベル（L_def）は廃止し、連続スコアで評価する方針に変更した。
// 2026-08-22：下落局面相関・ボラ比を別々に重み付けする方式から、両者を統合した下方β（downside beta）1本に
// よるスコアリングへ変更（購入金額加重平均でポートフォリオ全体のディフェンシブ度を出す用途に対し、加重平均が
// 数学的に厳密に合成できる指標はβだけであるため）。MDD比・重みパラメータは完全に廃止した。
// 「計算」自体は試算のみで何もコミットしない。「適用」を押した時点で初めてスコアをstock/scores.csvへ保存する
// （銘柄選定用のスコアとして積み上げる。対象コードだけ更新・追加するマージ方式で、対象外の既存スコアは残す）。
// 旧手動ラベル（REFERENCE_LABELS）は、保存先を持たない比較表示専用の参考データ（scores.csvには含めない）。
// 2026-08-22：ディフェンシブ／オフェンシブの二値判定・判定しきい値の概念を廃止し、スコアの連続値のみで評価する
// 方針に変更（判定しきい値入力欄・判定列・旧参考ラベルとの不一致ハイライトを削除。旧手動ラベルはヒストグラムの
// 参考比較表示にのみ残す）。

const SIM_FETCH_BATCH_SIZE = 6; // 株価CSVの並列取得数（多すぎるとGitHub APIのレート制限に触れやすいため控えめに）
let simResults = []; // 直近の計算結果（{ code, name, score, beta, corrDown, volRatio, periods, downPeriods, refLabel, error }）

/** SIM入力欄からパラメータを読み取る（未入力・不正値はデフォルト値にフォールバック）。 */
function getSimParams() {
    const num = (id, fallback) => {
        const v = Number(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : fallback;
    };
    return {
        years:     num('sim-years', 10),
        betaGood:  num('sim-beta-good', 0),
        betaBad:   num('sim-beta-bad', 2),
        // 指標の定義（詳細設定）。js/modules/defensiveScore.jsのcalcDefensiveScoreへそのまま渡す
        downThreshold:     num('sim-down-threshold', 0),
        returnPeriodWeeks: num('sim-return-period-weeks', 2),
        volOutlierClip:    num('sim-vol-outlier-clip', 0.5),
    };
}

/** 対象銘柄コード一覧を返す。手入力があればそれを優先し、空欄ならlabels.csvのL_高配当=1銘柄を対象にする。 */
async function resolveSimTargetCodes(token) {
    const raw = document.getElementById('sim-codes').value.trim();
    if (raw) return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];

    const labelsText = await fetchFileIfExists(token, OWNER, DATA_REPO, LABELS_PATH);
    const rows = labelsText ? parseCsv(labelsText) : [];
    return rows.filter(r => r['L_高配当'] === '1').map(r => r.code);
}

async function runSimCalculation() {
    const statusEl = document.getElementById('sim-status');
    const progressWrap = document.getElementById('sim-progress');
    const progressBar = document.getElementById('sim-progress-bar');
    const progressPercent = document.getElementById('sim-progress-percent');
    const runBtn = document.getElementById('sim-run-btn');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    runBtn.disabled = true;
    progressWrap.style.display = '';
    progressBar.value = 0;
    progressPercent.textContent = '0%';
    statusEl.textContent = '対象銘柄を確認中...';

    try {
        const [codes, n225Text, nameMap] = await Promise.all([
            resolveSimTargetCodes(token),
            fetchFileIfExists(token, OWNER, DATA_REPO, `${PRICES_DIR}/N225.csv`),
            getMasterNameMap(token).catch(() => new Map()),
        ]);
        if (codes.length === 0) { statusEl.textContent = '対象銘柄が0件です（証券コードを指定するか、labels.csvに高配当銘柄を登録してください）。'; return; }
        if (!n225Text) {
            statusEl.textContent = '日経平均（N225）の株価データがまだ取得されていません。「データ」タブ→詳細設定「株価取得（銘柄コードを直接指定）」で証券コードに N225 と入力して取得してから、再度お試しください。';
            return;
        }

        const n225Rows = parseCsv(n225Text);
        const params = getSimParams();

        const results = [];
        let done = 0;
        for (let i = 0; i < codes.length; i += SIM_FETCH_BATCH_SIZE) {
            const batch = codes.slice(i, i + SIM_FETCH_BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async code => {
                try {
                    const text = await fetchFile(token, OWNER, DATA_REPO, `${PRICES_DIR}/${code}.csv`);
                    const result = calcDefensiveScore(parseCsv(text), n225Rows, params);
                    return { code, name: nameMap.get(code) || '', ...result, refLabel: REFERENCE_LABELS.get(code) || null, error: null };
                } catch (error) {
                    return { code, name: nameMap.get(code) || '', score: null, periods: 0, refLabel: REFERENCE_LABELS.get(code) || null, error: error.message };
                }
            }));
            results.push(...batchResults);
            done += batch.length;
            const pct = Math.round((done / codes.length) * 100);
            progressBar.value = pct;
            progressPercent.textContent = `${pct}%（${done}/${codes.length}）`;
        }

        simResults = results;
        const okCount = results.filter(r => Number.isFinite(r.score)).length;
        statusEl.textContent = `計算完了：${results.length}件中 ${okCount}件でスコアを算出しました（データ不足・取得エラー: ${results.length - okCount}件）。`;
        renderSimResults();
    } catch (error) {
        console.error(error);
        statusEl.textContent = `エラー: ${error.message}`;
    } finally {
        runBtn.disabled = false;
        progressWrap.style.display = 'none';
    }
}

document.getElementById('sim-run-btn')?.addEventListener('click', runSimCalculation);
document.getElementById('sim-hist-metric')?.addEventListener('change', renderSimHistogram);

// ===== DEF：計算結果を銘柄選定用のスコアとして保存（stock/scores.csv）。
// マージ方式（上書き）：今回計算できた銘柄（スコアが算出できたもののみ。データ不足・取得エラーは対象外）だけを
// 更新・追加し、対象外の銘柄の既存スコアはそのまま残す。DEFモードはscores.csvを読み込んでキャッシュする
// ステップを持たない（読込ボタンが無い）ため、押下のたびにGitHubから最新を取得してからマージする
// （delisted.csv/extra_targets.csvの登録と同様、常に最新の内容の上にマージすることで取りこぼしを防ぐ）。
document.getElementById('sim-apply-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const statusEl = document.getElementById('sim-apply-status');
    const token = getTokenValue();
    if (!token) { alert('トークンを入力してください'); return; }

    const targets = simResults.filter(r => Number.isFinite(r.score));
    if (targets.length === 0) { alert('保存できるスコアがありません（先に「計算」を実行してください）'); return; }

    btn.disabled = true;
    statusEl.textContent = '保存中...';
    try {
        const existingText = await fetchFileIfExists(token, OWNER, DATA_REPO, SCORES_PATH);
        const scoresMap = new Map((existingText ? parseCsv(existingText) : []).map(r => [r.code, r]));

        const now = formatJstTimestamp();
        targets.forEach(r => {
            scoresMap.set(r.code, { code: r.code, defensive_score: r.score.toFixed(1), updated_at: now });
        });

        const content = stringifyCsv([...scoresMap.values()], SCORES_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, SCORES_PATH, DATA_REPO_BRANCH, content, 'chore: ディフェンシブ度スコアを更新');
        statusEl.textContent = `保存しました（今回更新・追加：${targets.length}件 / 合計：${scoresMap.size}件）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `保存に失敗しました: ${error.message}`;
    } finally {
        btn.disabled = false;
    }
});

function renderSimResults() {
    renderSimHistogram();
    renderSimTable();
}

// ヒストグラムに表示できる指標一覧。fieldはsimResultsの各要素のキーと対応させる。
// min/maxを指定した指標は範囲固定（score: 0〜100の定義域そのもの／corrDown: 相関係数の定義域-1〜1）。
// beta・volRatioはgood/bad閾値次第でデータの実際の範囲が変わるため、都度simResultsの実測値から自動算出する（min/max省略）。
const SIM_HIST_METRICS = {
    score:    { label: 'スコア',           field: 'score',    min: 0, max: 100, binCount: 20, decimals: 0 },
    beta:     { label: 'β',                field: 'beta',                      binCount: 20, decimals: 2 },
    corrDown: { label: '下落局面相関',     field: 'corrDown', min: -1, max: 1,  binCount: 20, decimals: 1 },
    volRatio: { label: '下落局面ボラ比',   field: 'volRatio',                  binCount: 20, decimals: 2 },
};

/** ヒストグラムの指標選択欄（sim-hist-metric）から現在の選択を読み取る。未選択・不正値は'score'にフォールバック。 */
function getSimHistMetricKey() {
    const key = document.getElementById('sim-hist-metric')?.value;
    return SIM_HIST_METRICS[key] ? key : 'score';
}

/** ヒストグラムの軸ラベル・ツールチップ用に、指標の値を桁数を揃えて文字列化する。 */
function formatSimHistValue(value, metric) {
    return value.toFixed(metric.decimals);
}

/**
 * 指標分布をdiv要素の積み上げ棒グラフで描く（外部チャートライブラリは使わない簡易実装）。
 * 各binの棒は、旧実装の手動ラベル（refLabel。past/(chk済)_C02-2_ディフェンシブ判定ラベル付け.ipynb由来）で
 * 「旧ディフェンシブ／旧オフェンシブ／参考ラベル無し」の3区分に積み上げる（現在の判定しきい値とは無関係の表示）。
 */
function renderSimHistogram() {
    const container = document.getElementById('sim-histogram');
    if (!container) return;
    container.replaceChildren();

    const metric = SIM_HIST_METRICS[getSimHistMetricKey()];
    const items = simResults
        .map(r => ({ value: r[metric.field], category: r.refLabel }))
        .filter(it => Number.isFinite(it.value));
    if (items.length === 0) {
        container.textContent = '計算するとヒストグラムが表示されます。';
        return;
    }

    const bins = buildHistogramBins(items, { min: metric.min, max: metric.max, binCount: metric.binCount });
    const maxCount = Math.max(...bins.map(b => b.count), 1);

    // 軸ラベル（数字）はバー本体（線＝border-bottomで下端を揃える行）とは別行にして線の下に出す。
    // 同じ縦積みのカラム内で下揃えしていた旧実装では、数字が付くビンだけカラムの占有高さが変わり、
    // バーの下端が列ごとにずれてがたついて見える問題があった。
    const bars = document.createElement('div');
    bars.className = 'sim-hist-bars';
    const labels = document.createElement('div');
    labels.className = 'sim-hist-labels';

    // 積み上げの順（DOM順＝上から下）。旧ディフェンシブを一番下（軸線側）に置く
    const stackOrder = [
        { key: '_none',     cls: 'sim-hist-seg--none' },
        { key: 'offensive', cls: 'sim-hist-seg--offensive' },
        { key: 'defensive', cls: 'sim-hist-seg--defensive' },
    ];

    bins.forEach((bin, i) => {
        const col = document.createElement('div');
        col.className = 'sim-hist-col';

        const count = document.createElement('div');
        count.className = 'sim-hist-count';
        count.textContent = bin.count > 0 ? String(bin.count) : '';

        const stack = document.createElement('div');
        stack.className = 'sim-hist-stack';
        stack.style.height = `${(bin.count / maxCount) * 100}%`;
        stack.title = `${formatSimHistValue(bin.from, metric)}〜${formatSimHistValue(bin.to, metric)}: ${bin.count}件`;

        stackOrder.forEach(({ key, cls }) => {
            const segCount = bin.byCategory[key] || 0;
            if (segCount === 0) return;
            const seg = document.createElement('div');
            seg.className = `sim-hist-seg ${cls}`;
            seg.style.height = `${(segCount / bin.count) * 100}%`;
            stack.appendChild(seg);
        });

        col.append(count, stack);
        bars.appendChild(col);

        const label = document.createElement('div');
        label.className = 'sim-hist-label';
        label.textContent = i % 2 === 0 ? formatSimHistValue(bin.from, metric) : '';
        labels.appendChild(label);
    });

    container.append(bars, labels);
}

// SIM：銘柄一覧テーブルの列定義。sortValueは並べ替えに使う生の値、formatは表示用の文字列を返す
// （format省略時はsortValueの結果をそのまま表示する）。ディフェンシブ／オフェンシブの二値判定は行わず、
// スコア・β・下落局面相関・下落局面ボラ比の連続値のみを表示する。
const SIM_TABLE_COLUMNS = [
    { key: 'code',     label: 'コード',         sortValue: r => r.code },
    { key: 'name',     label: '銘柄名',         sortValue: r => r.name },
    { key: 'score',    label: 'スコア',         sortValue: r => r.score,    format: r => Number.isFinite(r.score) ? r.score.toFixed(1) : (r.error || '－') },
    { key: 'beta',     label: 'β',              sortValue: r => r.beta,     format: r => Number.isFinite(r.beta) ? r.beta.toFixed(2) : '－' },
    { key: 'corrDown', label: '下落局面相関',   sortValue: r => r.corrDown, format: r => Number.isFinite(r.corrDown) ? r.corrDown.toFixed(2) : '－' },
    { key: 'volRatio', label: '下落局面ボラ比', sortValue: r => r.volRatio, format: r => Number.isFinite(r.volRatio) ? r.volRatio.toFixed(2) : '－' },
];

let simSortKey = 'score'; // 現在のソート対象列のkey（既定：スコア）
let simSortDir = -1;      // 1=昇順、-1=降順（既定：スコア降順。旧実装のデフォルト表示と揃えている）

/** ソート値の比較。数値同士は数値として、それ以外は文字列として比較する。
 * null/undefined/算出不能（NaN）は昇順・降順どちらでも常に末尾に回す（値が無い行が上位に来て紛らわしくなるのを防ぐ）。 */
function compareSimSortValues(a, b, dir) {
    const aEmpty = a === null || a === undefined || (typeof a === 'number' && !Number.isFinite(a));
    const bEmpty = b === null || b === undefined || (typeof b === 'number' && !Number.isFinite(b));
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof a === 'number' && typeof b === 'number') return dir * (a - b);
    return dir * String(a).localeCompare(String(b), 'ja');
}

/** 結果一覧テーブル。列ヘッダークリックでその列でソートする（同じ列の再クリックで昇順/降順トグル、
 * 別の列への切り替えは降順から始める）。既定はスコア降順。 */
function renderSimTable() {
    const table = document.getElementById('sim-table');
    if (!table) return;

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    SIM_TABLE_COLUMNS.forEach(col => {
        const th = document.createElement('th');
        th.className = 'sim-table-sortable';
        const arrow = simSortKey === col.key ? (simSortDir === 1 ? ' ▲' : ' ▼') : '';
        th.textContent = col.label + arrow;
        th.addEventListener('click', () => {
            if (simSortKey === col.key) simSortDir *= -1;
            else { simSortKey = col.key; simSortDir = -1; }
            renderSimTable();
        });
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    const sortCol = SIM_TABLE_COLUMNS.find(c => c.key === simSortKey) || SIM_TABLE_COLUMNS[2];
    const sorted = [...simResults].sort((a, b) => compareSimSortValues(sortCol.sortValue(a), sortCol.sortValue(b), simSortDir));

    if (sorted.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = SIM_TABLE_COLUMNS.length;
        td.className = 'empty-cell';
        td.textContent = '計算結果がありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        sorted.forEach(r => {
            const tr = document.createElement('tr');

            SIM_TABLE_COLUMNS.forEach(col => {
                const td = document.createElement('td');
                const raw = col.sortValue(r);
                td.textContent = col.format ? col.format(r) : (raw ?? '－');
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    table.replaceChildren(thead, tbody);
}


// ===== スコア：ポートフォリオスコア（200点満点） =====
// past/(chk済)_C06_2_(R5)保有銘柄分析.ipynbのcell1（投資金額別のポートフォリオ）・cell3（配当銘柄分析）を移植。
// js/modules/portfolioScore.jsに計算ロジックを分離し、ここではデータ取得・DOM描画に専念する。
// DEFモードと同じ「パラメータ調整→計算→結果表示」の試算ページで、「計算」だけでは何も保存されない。

/** 対象口座チェックボックスグループ（所有者／証券会社／口座区分）の現在の選択値を返す。
 * チェックボックスが1つも無い（まだ読み込んでいない）場合はnull（絞り込み無し）を返し、
 * 1つ以上ある場合はチェック済みの値の配列（0件もありうる＝何も一致しない）を返す。 */
function getCheckboxGroupSelection(containerId) {
    const container = document.getElementById(containerId);
    const boxes = container ? [...container.querySelectorAll('input[type="checkbox"]')] : [];
    if (boxes.length === 0) return null;
    return boxes.filter(cb => cb.checked).map(cb => cb.value);
}

/**
 * 対象口座チェックボックスグループ（所有者／証券会社／口座区分のいずれか1つ）を、指定した値一覧から
 * 再構築する。既にチェックボックスが存在する値はそのチェック状態を保持し、新規の値は既定でON
 * （2026-08-24：マルチセレクトへの変更に伴い、既定は全選択とする方針のため）にする。
 */
function renderScoreAccountFilterGroup(containerId, values) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const previousChecked = new Map(
        [...container.querySelectorAll('input[type="checkbox"]')].map(cb => [cb.value, cb.checked])
    );

    container.replaceChildren();
    if (values.length === 0) {
        container.textContent = '（保有銘柄がありません）';
        return;
    }
    values.forEach(value => {
        const label = document.createElement('label');
        label.className = 'checkbox-chip';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.checked = previousChecked.has(value) ? previousChecked.get(value) : true;
        label.append(input, document.createTextNode(value));
        container.appendChild(label);
    });
}

/** 対象口座チェックボックス3グループ（所有者／証券会社／口座区分）を、保有銘柄一覧に実在する値から
 * 再構築する（既存のチェック状態は保持）。 */
function renderScoreAccountFilters(holdingsRows) {
    const distinct = (field) => [...new Set((holdingsRows || []).map(r => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    renderScoreAccountFilterGroup('score-target-owners', distinct('owner'));
    renderScoreAccountFilterGroup('score-target-brokers', distinct('broker'));
    renderScoreAccountFilterGroup('score-target-accounts', distinct('account'));
}

/** 対象口座チェックボックスの選択値をまとめて返す（js/modules/portfolioScore.jsのmatchesAccountSelection参照）。 */
function getScoreTargetSelection() {
    return {
        owners: getCheckboxGroupSelection('score-target-owners'),
        brokers: getCheckboxGroupSelection('score-target-brokers'),
        accounts: getCheckboxGroupSelection('score-target-accounts'),
    };
}

// スコアタブを開いたとき、トークンが入力済みなら対象口座チェックボックスを保有銘柄一覧から構築する
// （計算・銘柄提案の実行時にも最新のholdings.csvで再構築するため、ここでの読み込みは事前表示用）
document.getElementById('tab-score')?.addEventListener('click', async () => {
    const token = getTokenValue();
    if (!token) return;
    const holdingsText = await fetchFileIfExists(token, OWNER, DATA_REPO, HOLDINGS_PATH);
    renderScoreAccountFilters(holdingsText ? parseCsv(holdingsText) : []);
});

/** スコア計算パラメータを入力欄から読み取る（未入力・不正値はデフォルト値にフォールバック）。 */
function getScoreParams() {
    const num = (id, fallback) => {
        const v = Number(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : fallback;
    };
    const noPenaltyText = document.getElementById('score-industry-no-penalty')?.value || '';
    return {
        targetSelection: getScoreTargetSelection(),
        yieldGood: num('score-yield-good', 10),
        yieldBad:  num('score-yield-bad', 4),
        lowerPct:      num('score-industry-lower', 1.5),
        upperPct:      num('score-industry-upper', 15),
        decayUpperPct: num('score-industry-decay-upper', 17),
        noPenaltyIndustries: noPenaltyText.split(',').map(s => s.trim()).filter(Boolean),
        capPct: num('score-stock-cap', 3),
        targetAnnualDividend: num('score-target-dividend', 4200000),
    };
}

/** 業種別の割合（%）を降順に並べたバー配列を返す（renderScoreIndustryBarsで描画する）。 */
function buildIndustryShareList(rows, amountKey) {
    const total = rows.reduce((s, r) => s + (r[amountKey] || 0), 0);
    if (total <= 0) return [];
    const byIndustry = new Map();
    rows.forEach(r => {
        byIndustry.set(r.industry, (byIndustry.get(r.industry) || 0) + (r[amountKey] || 0));
    });
    return [...byIndustry.entries()]
        .map(([industry, amount]) => ({ industry, pct: (amount / total) * 100 }))
        .filter(item => item.pct > 0)
        .sort((a, b) => b.pct - a.pct);
}

/** 業種別配分の横棒グラフ（0〜100%の絶対スケール）を描画する。 */
function renderScoreIndustryBars(container, items) {
    container.replaceChildren();
    if (items.length === 0) {
        container.textContent = '対象銘柄がありません。';
        return;
    }
    items.forEach(({ industry, pct }) => {
        const row = document.createElement('div');
        row.className = 'score-bar-row';

        const label = document.createElement('div');
        label.className = 'score-bar-label';
        label.textContent = industry;
        label.title = industry;

        const track = document.createElement('div');
        track.className = 'score-bar-track';
        const fill = document.createElement('div');
        fill.className = 'score-bar-fill';
        fill.style.width = `${Math.min(100, pct)}%`;
        track.appendChild(fill);

        const value = document.createElement('div');
        value.className = 'score-bar-value';
        value.textContent = `${pct.toFixed(1)}%`;

        row.append(label, track, value);
        container.appendChild(row);
    });
}

/** 銘柄一覧テーブルを描画する（スコア対象行、投資金額降順）。 */
function renderScoreStockTable(container, rows) {
    const table = document.createElement('table');
    table.className = 'data-table';

    const cols = ['コード', '銘柄名', '業種', '株数', '取得単価', '投資金額', '投資金額(補)', '配当(1株)', '配当年度', '配当利回り(補)', 'defensive'];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    const sorted = [...rows].sort((a, b) => (b.investAmount || 0) - (a.investAmount || 0));
    sorted.forEach(r => {
        const tr = document.createElement('tr');
        const values = [
            r.code, r.name, r.industry, r.shares, r.avg_cost,
            Number.isFinite(r.investAmount) ? Math.round(r.investAmount).toLocaleString('ja-JP') : '－',
            Number.isFinite(r.investAmountAdj) ? Math.round(r.investAmountAdj).toLocaleString('ja-JP') : '－',
            r.dividendPerShare ?? '－',
            r.dividendYear ? `${r.dividendYear}（${r.dividendLabel}）` : '－',
            r.yieldAdjPct != null ? `${r.yieldAdjPct.toFixed(2)}%` : '－',
            r.defensiveScore != null ? r.defensiveScore.toFixed(1) : '－',
        ];
        values.forEach(v => {
            const td = document.createElement('td');
            td.textContent = v ?? '';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.append(thead, tbody);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper table-wrapper--limited';
    wrapper.appendChild(table);
    container.appendChild(wrapper);
}

/** 1ブロック分（全体、または所有者別）のスコア結果を描画する。 */
function renderScoreBlock(container, title, rows, allCategories, params) {
    const block = document.createElement('div');
    block.className = 'score-summary-block';

    const heading = document.createElement('p');
    heading.className = 'update-form-title';
    heading.textContent = title;
    block.appendChild(heading);

    if (rows.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'placeholder-text';
        empty.textContent = '対象銘柄がありません。';
        block.appendChild(empty);
        container.appendChild(block);
        return null;
    }

    const score = calcPortfolioScore(rows, allCategories, params);

    const summary = document.createElement('p');
    summary.className = 'update-status';
    summary.innerHTML =
        `投資金額: ${Math.round(score.totalInvest).toLocaleString('ja-JP')}円 / ` +
        `投資金額(補): ${Math.round(score.totalInvestAdj).toLocaleString('ja-JP')}円 / ` +
        `年間配当: ${Math.round(score.totalDividend).toLocaleString('ja-JP')}円<br>` +
        `配当利回り: ${score.yieldPct.toFixed(2)}% / 配当利回り(補): ${score.yieldAdjPct.toFixed(2)}%<br>` +
        `目標配当達成率: ${score.achievementPct.toFixed(1)}%（推進系予算${score.budgetGrowth.toFixed(0)}点／防衛系予算${score.budgetRisk.toFixed(0)}点）<br>` +
        `<strong>スコア合計: ${score.scoreTotal.toFixed(1)} / ${score.scoreMax}</strong><br>` +
        `推進系 ${score.scoreGrowthTotal.toFixed(1)}/${score.budgetGrowth.toFixed(0)}` +
        `（実質利回り ${score.scoreYield.toFixed(1)}/${score.scoreYieldMax.toFixed(0)}、` +
        `達成率 ${score.scoreAchievement.toFixed(1)}/${score.scoreAchievementMax.toFixed(0)}）<br>` +
        `防衛系 ${score.scoreRiskTotal.toFixed(1)}/${score.budgetRisk.toFixed(0)}` +
        `（業種分散 ${score.scoreIndustry.toFixed(1)}/${score.scoreIndustryMax.toFixed(0)}、` +
        `銘柄集中 ${score.scoreStock.toFixed(1)}/${score.scoreStockMax.toFixed(0)}、` +
        `DEF ${score.scoreDefensive.toFixed(1)}/${score.scoreDefensiveMax.toFixed(0)}` +
        (score.defensiveWeightedAvg != null ? `〈加重平均 ${score.defensiveWeightedAvg.toFixed(1)}点〉` : '〈対象銘柄無し〉') +
        `）`;
    block.appendChild(summary);

    renderScoreStockTable(block, rows);

    const investTitle = document.createElement('p');
    investTitle.className = 'update-form-title';
    investTitle.textContent = '業種別配分（投資額ベース）';
    block.appendChild(investTitle);
    const investChart = document.createElement('div');
    investChart.className = 'score-bar-chart';
    block.appendChild(investChart);
    renderScoreIndustryBars(investChart, buildIndustryShareList(rows, 'investAmountAdj'));

    const divTitle = document.createElement('p');
    divTitle.className = 'update-form-title';
    divTitle.textContent = '業種別配分（配当額ベース）';
    block.appendChild(divTitle);
    const divChart = document.createElement('div');
    divChart.className = 'score-bar-chart';
    block.appendChild(divChart);
    renderScoreIndustryBars(divChart, buildIndustryShareList(rows, 'dividendAmount'));

    container.appendChild(block);
    return score;
}

/** スコア・銘柄提案の両ページで共通して使うデータ（保有銘柄・銘柄名/業種・配当・実現損益・ディフェンシブ度）を
 * まとめて取得する。holdings.csvが空の場合はholdingsRows: []を返す（呼び出し側でエラー表示を判断する）。 */
async function loadPortfolioScoreContext(token) {
    const [holdingsText, masterText, dividendsText, scoresText, realizedGainsText] = await Promise.all([
        fetchFileIfExists(token, OWNER, DATA_REPO, HOLDINGS_PATH),
        fetchFile(token, OWNER, DATA_REPO, MASTER_PATH),
        fetchFileIfExists(token, OWNER, DATA_REPO, DIVIDENDS_PATH),
        fetchFileIfExists(token, OWNER, DATA_REPO, SCORES_PATH),
        fetchFileIfExists(token, OWNER, DATA_REPO, REALIZED_GAINS_PATH),
    ]);

    const holdingsRows = holdingsText ? parseCsv(holdingsText) : [];
    const masterRows = parseCsv(masterText);
    const scoresRows = scoresText ? parseCsv(scoresText) : [];
    const realizedGainsRows = realizedGainsText ? parseCsv(realizedGainsText) : [];
    const dividendRows = dividendsText ? parseCsv(dividendsText) : [];

    // 銘柄名・業種：master.csvが唯一の正の基準（2026-08-26〜）。JPX上場銘柄はJPX一覧由来の値、
    // 投信等はsource=manual_fundとして手動登録した値が同じ列に入っている
    const nameMap = new Map();
    const industryMap = new Map();
    masterRows.forEach(r => { if (r.name) nameMap.set(r.code, r.name); if (r.industry33_name) industryMap.set(r.code, r.industry33_name); });

    // 業種分散スコアの分母（全業種一覧）：master.csvに実在する業種
    const allCategories = [...new Set(masterRows.map(r => r.industry33_name))]
        .filter(v => v && !['', '-', '0'].includes(v));

    const defensiveScoreMap = new Map(scoresRows.map(r => [r.code, r.defensive_score]));
    const dividendPickMap = buildDividendPickMap(dividendRows);
    const realizedPnlMap = buildRealizedPnlMap(realizedGainsRows);

    return { holdingsRows, masterRows, nameMap, industryMap, allCategories, defensiveScoreMap, dividendPickMap, realizedPnlMap };
}

/** JSTの今年（西暦）を返す。 */
function getJstCurrentYear() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

/**
 * スコア・銘柄提案で「配当データが古すぎない」とみなす年度の一覧を返す（昨年・今年・来年）。
 * 2026-08-23判断：当初は{今年,昨年}のみだったが、多くの日本企業は決算期（3月期等）の終わる年で
 * 配当年度を表記するIRBANK方式のため、進行中の期の予想配当が「来年」表記になるケースが多く
 * （例：2026年4月〜2027年3月期の予想は「2027年」）、暦年ベースの{今年,昨年}だけでは実際には
 * 最新の予想配当を弾いてしまっていた（実データで確認：投資額ベースで除外分の約64%がこれが原因だった）。
 * 来年分も含めることで、進行中の期の予想配当を正しく「最新」として扱えるようにする。
 */
function getDividendYearWindow() {
    const currentYear = getJstCurrentYear();
    return [currentYear - 1, currentYear, currentYear + 1];
}

// ===== スコア：現状スコアの描画（2026-08-24、旧「現状スコア」「銘柄提案」タブ切り替えを廃止し、
// 「銘柄提案」ボタン1つで現状スコア計算・銘柄提案の両方を行う1ページ構成に統合した） =====
// 2026-08-29、スコア履歴（stock/score_history.csv）の記録機能を追加。【全体】ブロックのスコアのみを
// 対象とし（所有者別は組み合わせ爆発を避けるため対象外）、明示的な「スコアを記録」ボタンでのみ保存する
// （計算のたびに自動保存はしない）。

let latestOverallScore = null; // 直近に計算した【全体】ブロックのcalcPortfolioScore結果（記録ボタン用）
let latestScopeNote = '';      // 直近計算時の対象口座選択の説明文（記録時にnote列へ残す）

function nextScoreHistoryId(rows) {
    const maxId = rows.reduce((max, r) => {
        const n = parseInt(r.id, 10);
        return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return maxId + 1;
}

/** 対象口座の選択内容を、履歴のnote列に残すための短い説明文にする。 */
function describeTargetSelection(selection) {
    const describe = (label, list) => `${label}:${list == null ? '全' : (list.length ? list.join('・') : 'なし')}`;
    return [
        describe('所有者', selection.owners),
        describe('証券会社', selection.brokers),
        describe('口座区分', selection.accounts),
    ].join(' / ');
}

/** stock/score_history.csvへ、直近計算済みの【全体】スコア1行を追記する（洗い替えではなく単純追記）。 */
async function handleRecordScoreClick() {
    const statusEl = document.getElementById('score-record-status');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }
    if (!latestOverallScore) { statusEl.textContent = '先に「銘柄提案」を押してスコアを計算してください。'; return; }

    statusEl.textContent = '記録中...';
    try {
        const existingText = await fetchFileIfExists(token, OWNER, DATA_REPO, SCORE_HISTORY_PATH);
        const rows = existingText ? parseCsv(existingText) : [];
        const s = latestOverallScore;
        rows.push({
            id: String(nextScoreHistoryId(rows)),
            recorded_at: formatJstTimestamp(),
            note: latestScopeNote,
            total_invest_adj: Math.round(s.totalInvestAdj),
            total_dividend: Math.round(s.totalDividend),
            achievement_rate: s.achievementRate.toFixed(4),
            budget_growth: s.budgetGrowth.toFixed(2),
            budget_risk: s.budgetRisk.toFixed(2),
            score_yield: s.scoreYield.toFixed(2),
            score_achievement: s.scoreAchievement.toFixed(2),
            score_industry: s.scoreIndustry.toFixed(2),
            score_stock: s.scoreStock.toFixed(2),
            score_defensive: s.scoreDefensive.toFixed(2),
            score_growth_total: s.scoreGrowthTotal.toFixed(2),
            score_risk_total: s.scoreRiskTotal.toFixed(2),
            score_total: s.scoreTotal.toFixed(2),
            yield_ratio: s.scoreYieldRatio.toFixed(4),
            industry_ratio: s.scoreIndustryRatio.toFixed(4),
            stock_ratio: s.scoreStockRatio.toFixed(4),
            defensive_ratio: s.scoreDefensiveRatio.toFixed(4),
        });

        const content = stringifyCsv(rows, SCORE_HISTORY_HEADERS);
        await commitFile(token, OWNER, DATA_REPO, SCORE_HISTORY_PATH, DATA_REPO_BRANCH, content, 'chore: スコア履歴を記録');
        statusEl.textContent = `記録しました（累計${rows.length}件）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `記録に失敗しました: ${error.message}`;
    }
}

// ----- 2026-08-29追加：五角形レーダーチャート（現在値＋過去スナップショット比較）と
// 2軸（推進系／防衛系）時系列折れ線グラフ。外部グラフライブラリは使わずSVGで自前描画する
// （js/modules/chartGeometry.jsで座標だけ計算し、DOM生成はここで行う。CLAUDE.md参照）。

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

const RADAR_AXIS_LABELS = ['実質利回り', '達成率', '業種分散', 'DEF', '銘柄集中']; // calcPortfolioScoreのradarMetricsと同じ並び
const RADAR_CURRENT_COLOR = '#0d6efd';
const RADAR_OVERLAY_COLORS = ['#adb5bd', '#6f42c1', '#fd7e14']; // 過去スナップショット比較（最大3件）用

/** stock/score_history.csvの1行から、レーダーチャート用の5指標配列（0-100、radarMetricsと同じ並び）を作る。 */
function radarValuesFromHistoryRow(row) {
    return [
        Number(row.yield_ratio) * 100,
        Number(row.achievement_rate) * 100,
        Number(row.industry_ratio) * 100,
        Number(row.defensive_ratio) * 100,
        Number(row.stock_ratio) * 100,
    ];
}

function appendLegend(container, items) {
    const legend = document.createElement('div');
    legend.className = 'score-chart-legend';
    items.forEach(({ label, color }) => {
        const item = document.createElement('span');
        item.className = 'score-chart-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'score-chart-legend-swatch';
        swatch.style.background = color;
        item.append(swatch, document.createTextNode(label));
        legend.appendChild(item);
    });
    container.appendChild(legend);
}

/** 五角形レーダーチャートをSVGで描画する。seriesは[{ label, values(0-100の5要素、RADAR_AXIS_LABELS順), color, dashed }]。 */
function renderRadarChart(container, series) {
    container.replaceChildren();
    const size = 260, cx = size / 2, cy = size / 2, radius = 90;
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'score-radar-svg' });

    // グリッド（25/50/75/100%の同心五角形）
    [25, 50, 75, 100].forEach(pct => {
        const pts = buildRadarPoints(Array(5).fill(pct), { cx, cy, radius });
        svg.appendChild(svgEl('polygon', { points: pointsToSvgAttr(pts), class: 'score-radar-grid' }));
    });

    // 軸線
    buildRadarAxisPoints(5, { cx, cy, radius }).forEach(p => {
        svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: p.x, y2: p.y, class: 'score-radar-axis' }));
    });

    // 軸ラベル（外周の少し外側に配置）
    buildRadarPoints(Array(5).fill(122), { cx, cy, radius }).forEach((p, i) => {
        const text = svgEl('text', { x: p.x, y: p.y, class: 'score-radar-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        text.textContent = RADAR_AXIS_LABELS[i];
        svg.appendChild(text);
    });

    // 各シリーズ（現在値＋比較用の過去スナップショット）
    series.forEach(s => {
        const pts = buildRadarPoints(s.values, { cx, cy, radius });
        svg.appendChild(svgEl('polygon', {
            points: pointsToSvgAttr(pts),
            class: 'score-radar-polygon' + (s.dashed ? ' score-radar-polygon--dashed' : ''),
            style: `stroke:${s.color}; fill:${s.color};`,
        }));
        pts.forEach(p => svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 3, style: `fill:${s.color};` })));
    });

    container.appendChild(svg);
    appendLegend(container, series.map(s => ({ label: s.label, color: s.color })));
}

/** 推進系／防衛系スコアの時系列折れ線グラフ（2軸）をSVGで描画する。historyRowsはstock/score_history.csvの全行。 */
function renderScoreLineChart(container, historyRows) {
    container.replaceChildren();
    if (historyRows.length === 0) {
        container.textContent = '記録された履歴がありません（「スコアを記録」で記録を開始できます）。';
        return;
    }

    const sorted = [...historyRows].sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : 0));
    const growthValues = sorted.map(r => Number(r.score_growth_total));
    const riskValues = sorted.map(r => Number(r.score_risk_total));
    const maxY = Math.max(200, ...growthValues, ...riskValues);

    const width = 560, height = 200;
    const padding = { left: 36, right: 12, top: 12, bottom: 10 };
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'score-line-svg' });

    [0, 50, 100, 150, 200].filter(v => v <= maxY).forEach(v => {
        const y = padding.top + (height - padding.top - padding.bottom) * (1 - v / maxY);
        svg.appendChild(svgEl('line', { x1: padding.left, y1: y.toFixed(2), x2: width - padding.right, y2: y.toFixed(2), class: 'score-line-grid' }));
        const label = svgEl('text', { x: padding.left - 6, y: y.toFixed(2), class: 'score-line-axis-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
        label.textContent = String(v);
        svg.appendChild(label);
    });

    const lineOptions = { width, height, paddingLeft: padding.left, paddingRight: padding.right, paddingTop: padding.top, paddingBottom: padding.bottom, minY: 0, maxY };
    const growthPts = buildLineChartPoints(growthValues, lineOptions);
    const riskPts = buildLineChartPoints(riskValues, lineOptions);

    svg.appendChild(svgEl('polyline', { points: pointsToSvgAttr(growthPts), class: 'score-line-path score-line-path--growth' }));
    svg.appendChild(svgEl('polyline', { points: pointsToSvgAttr(riskPts), class: 'score-line-path score-line-path--risk' }));
    growthPts.forEach(p => svg.appendChild(svgEl('circle', { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 2.5, class: 'score-line-dot score-line-dot--growth' })));
    riskPts.forEach(p => svg.appendChild(svgEl('circle', { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 2.5, class: 'score-line-dot score-line-dot--risk' })));

    container.appendChild(svg);

    const xLabels = document.createElement('div');
    xLabels.className = 'score-line-x-labels';
    const showIdx = new Set([0, Math.floor((sorted.length - 1) / 2), sorted.length - 1]);
    sorted.forEach((r, i) => {
        if (!showIdx.has(i)) return;
        const span = document.createElement('span');
        span.textContent = (r.recorded_at || '').slice(0, 10);
        xLabels.appendChild(span);
    });
    container.appendChild(xLabels);

    appendLegend(container, [{ label: '推進系', color: '#28a745' }, { label: '防衛系', color: '#0d6efd' }]);
}

let scoreHistoryRows = [];          // 読み込んだstock/score_history.csvの全行（履歴を読込ボタンで取得）
let radarCompareIds = new Set();    // レーダー比較に選んだ履歴行のid（最大3件）

/** 現在のスコア（latestOverallScore）＋選択中の過去スナップショットを重ねてレーダーチャートを描画する。 */
function renderCurrentRadarChart() {
    const container = document.getElementById('score-radar-chart');
    if (!container) return;
    if (!latestOverallScore) { container.textContent = '先に「銘柄提案」を押してスコアを計算してください。'; return; }

    const series = [{ label: '現在', values: latestOverallScore.radarMetrics.map(m => m.pct), color: RADAR_CURRENT_COLOR }];
    scoreHistoryRows
        .filter(row => radarCompareIds.has(row.id))
        .forEach((row, i) => {
            series.push({
                label: (row.recorded_at || '').slice(0, 10),
                values: radarValuesFromHistoryRow(row),
                color: RADAR_OVERLAY_COLORS[i % RADAR_OVERLAY_COLORS.length],
                dashed: true,
            });
        });

    renderRadarChart(container, series);
}

/** 履歴の直近10件をチェックボックスで一覧表示し、レーダー比較対象を選べるようにする（最大3件）。 */
function renderScoreHistoryPicker() {
    const container = document.getElementById('score-history-picker');
    if (!container) return;
    container.replaceChildren();

    if (scoreHistoryRows.length === 0) {
        container.textContent = '記録がありません。';
        return;
    }

    [...scoreHistoryRows]
        .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : 0))
        .slice(0, 10)
        .forEach(row => {
            const label = document.createElement('label');
            label.className = 'checkbox-chip';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = radarCompareIds.has(row.id);
            input.addEventListener('change', () => {
                if (input.checked) {
                    if (radarCompareIds.size >= 3) {
                        input.checked = false;
                        alert('比較できるのは最大3件までです。');
                        return;
                    }
                    radarCompareIds.add(row.id);
                } else {
                    radarCompareIds.delete(row.id);
                }
                renderCurrentRadarChart();
            });
            label.append(input, document.createTextNode(`${(row.recorded_at || '').slice(0, 10)}（${Number(row.score_total).toFixed(0)}点）`));
            container.appendChild(label);
        });
}

async function handleLoadScoreHistoryClick() {
    const statusEl = document.getElementById('score-history-status');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    statusEl.textContent = '読み込み中...';
    try {
        const text = await fetchFileIfExists(token, OWNER, DATA_REPO, SCORE_HISTORY_PATH);
        scoreHistoryRows = text ? parseCsv(text) : [];
        radarCompareIds = new Set();
        statusEl.textContent = scoreHistoryRows.length
            ? `${scoreHistoryRows.length}件を読み込みました。`
            : 'まだ記録がありません（「スコアを記録」で最初の1件を保存できます）。';
        renderScoreHistoryPicker();
        renderCurrentRadarChart();
        renderScoreLineChart(document.getElementById('score-line-chart'), scoreHistoryRows);
    } catch (error) {
        console.error(error);
        statusEl.textContent = `読み込みに失敗しました: ${error.message}`;
    }
}

/** 「スコアを記録」「履歴を読込」ボタンと、レーダーチャート・時系列折れ線グラフをcontainerへ追加する
 * （【全体】ブロックの直後にのみ設置。所有者別ブロックには表示しない）。 */
function renderScoreHistorySection(container) {
    const recordWrap = document.createElement('div');
    recordWrap.className = 'update-form';
    const recordBtn = document.createElement('button');
    recordBtn.type = 'button';
    recordBtn.className = 'run-btn run-btn--secondary';
    recordBtn.textContent = 'スコアを記録';
    recordBtn.addEventListener('click', handleRecordScoreClick);
    const recordStatus = document.createElement('p');
    recordStatus.id = 'score-record-status';
    recordStatus.className = 'update-status';
    recordStatus.textContent = '【全体】の現在のスコアをstock/score_history.csvに記録します（所有者別ブロックは記録されません）。';
    recordWrap.append(recordBtn, recordStatus);
    container.appendChild(recordWrap);

    const historyWrap = document.createElement('div');
    historyWrap.className = 'update-form';

    const historyTitle = document.createElement('p');
    historyTitle.className = 'update-form-title';
    historyTitle.textContent = 'スコア履歴（推進系／防衛系の推移・過去スナップショット比較）';
    historyWrap.appendChild(historyTitle);

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'run-btn run-btn--secondary';
    loadBtn.textContent = '履歴を読込';
    loadBtn.addEventListener('click', handleLoadScoreHistoryClick);
    historyWrap.appendChild(loadBtn);

    const historyStatus = document.createElement('p');
    historyStatus.id = 'score-history-status';
    historyStatus.className = 'update-status';
    historyStatus.textContent = '「履歴を読込」で記録済みのスコアを取得します。';
    historyWrap.appendChild(historyStatus);

    const radarTitle = document.createElement('p');
    radarTitle.className = 'update-form-title';
    radarTitle.textContent = 'レーダーチャート（5指標の達成比率。現在値＋比較選択した過去スナップショット、最大3件）';
    historyWrap.appendChild(radarTitle);

    const picker = document.createElement('div');
    picker.id = 'score-history-picker';
    picker.className = 'checkbox-group';
    picker.textContent = '「履歴を読込」を押すと、比較したい過去の記録を選べます。';
    historyWrap.appendChild(picker);

    const radarChart = document.createElement('div');
    radarChart.id = 'score-radar-chart';
    radarChart.className = 'score-radar';
    historyWrap.appendChild(radarChart);

    const lineTitle = document.createElement('p');
    lineTitle.className = 'update-form-title';
    lineTitle.textContent = '時系列推移（推進系／防衛系スコア）';
    historyWrap.appendChild(lineTitle);

    const lineChart = document.createElement('div');
    lineChart.id = 'score-line-chart';
    lineChart.className = 'score-line-chart';
    lineChart.textContent = '「履歴を読込」を押すと表示されます。';
    historyWrap.appendChild(lineChart);

    container.appendChild(historyWrap);

    // 直前の計算で既に履歴を読み込み済みなら、再計算後もその内容を引き継いで再描画する
    if (scoreHistoryRows.length > 0) {
        historyStatus.textContent = `${scoreHistoryRows.length}件を読み込み済みです。`;
        renderScoreHistoryPicker();
        renderScoreLineChart(lineChart, scoreHistoryRows);
    }
    renderCurrentRadarChart(); // 履歴読込前でも「現在」だけのレーダーはすぐ表示する
}

/** 現状スコアの結果（【全体】＋【所有者別】の各ブロック）をcontainerへ描画する。 */
function renderCurrentScoreBlocks(container, targetRows, allCategories, params) {
    latestOverallScore = renderScoreBlock(container, '【全体】', targetRows, allCategories, params);
    latestScopeNote = describeTargetSelection(params.targetSelection);
    renderScoreHistorySection(container);

    const owners = [...new Set(targetRows.map(r => r.owner))].sort((a, b) => a.localeCompare(b, 'ja'));
    owners.forEach(owner => {
        renderScoreBlock(container, `【所有者別】所有者=${owner}`, targetRows.filter(r => r.owner === owner), allCategories, params);
    });
    return owners;
}

// ===== 銘柄提案：推奨銘柄提案（past/(chk済)_C06_2_(R5)保有銘柄分析.ipynbのcell5を移植） =====
// 対象口座・スコア閾値パラメータは現状スコアと共有し、現状ポートフォリオを定義した上で、高配当ラベル銘柄
// （未保有）を1銘柄追加した場合のスコア差分をシミュレーションして順位付けする。株価はstock/prices/{code}.csvの
// 最終終値を使う（旧notebookが依存していたData/kabuka参照関数はnotebook内に定義が残っておらず、
// コメントから挙動を推測して作り直した。詳細はjs/modules/portfolioScore.js参照）。
// 2026-08-24：「現状スコア」「銘柄提案」のタブ切り替えを廃止し、「銘柄提案」ボタン1つで現状スコアの計算と
// 銘柄提案の両方を行う1ページ構成に統合した（銘柄提案は現状ポートフォリオの計算を前提とする処理のため、
// 別ボタンに分ける必要が無かった）。

const SUGGEST_FETCH_BATCH_SIZE = 6; // 株価CSVの並列取得数（DEFモードと同じ理由で控えめにする）

/** 銘柄提案の計算パラメータを読み取る。対象口座・スコア閾値は現状スコアと共有（getScoreParams）で、
 * 銘柄提案固有の項目（候補ラベル・候補除外業種・最低投資金額・表示件数）だけをここで追加する。 */
function getSuggestParams() {
    const num = (id, fallback) => {
        const v = Number(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : fallback;
    };
    const excludedText = document.getElementById('suggest-industry-excluded')?.value || '';
    return {
        ...getScoreParams(),
        candidateLabels: {
            highDiv: document.getElementById('suggest-label-high-div')?.checked ?? false,
            perk: document.getElementById('suggest-label-perk')?.checked ?? false,
            usEtf: document.getElementById('suggest-label-us-etf')?.checked ?? false,
            other: document.getElementById('suggest-label-other')?.checked ?? false,
        },
        excludedCandidateIndustries: excludedText.split(',').map(s => s.trim()).filter(Boolean),
        minInvestAmount: num('suggest-min-invest', 200000),
        topN: Math.max(1, Math.round(num('suggest-topn', 30))),
    };
}

/** 保有行をコードごとに集計する（同一コードが複数口座にまたがる場合の合算）。 */
function groupHoldingsByCode(rows) {
    const map = new Map();
    rows.forEach(r => {
        if (!map.has(r.code)) map.set(r.code, { code: r.code, name: r.name, industry: r.industry, investAmountAdj: 0, dividendAmount: 0 });
        const g = map.get(r.code);
        g.investAmountAdj += (Number.isFinite(r.investAmountAdj) ? r.investAmountAdj : 0);
        g.dividendAmount += (r.dividendAmount || 0);
    });
    return [...map.values()];
}

/** 銘柄集中の減点対象（投資割合が上限%を超える銘柄）を降順で返す。 */
function findOverConcentratedStocks(rows, capPct) {
    const grouped = groupHoldingsByCode(rows);
    const total = grouped.reduce((s, g) => s + g.investAmountAdj, 0);
    if (total <= 0) return [];
    return grouped
        .map(g => ({ ...g, sharePct: (g.investAmountAdj / total) * 100 }))
        .filter(g => g.sharePct > capPct)
        .sort((a, b) => b.sharePct - a.sharePct);
}

/** 業種集中の減点対象（配当額シェアが上限%を超える業種。減点除外業種を除く）を降順で返す。 */
function findOverConcentratedIndustries(rows, upperPct, noPenaltyIndustries) {
    const total = rows.reduce((s, r) => s + (r.dividendAmount || 0), 0);
    if (total <= 0) return [];
    const byIndustry = new Map();
    rows.forEach(r => byIndustry.set(r.industry, (byIndustry.get(r.industry) || 0) + (r.dividendAmount || 0)));
    const noPenaltySet = new Set(noPenaltyIndustries || []);
    return [...byIndustry.entries()]
        .map(([industry, amount]) => ({ industry, sharePct: (amount / total) * 100 }))
        .filter(item => item.sharePct > upperPct && !noPenaltySet.has(item.industry))
        .sort((a, b) => b.sharePct - a.sharePct);
}

/** 減点対象（銘柄集中・業種集中）を一覧表示する。該当が無ければ何も描画しない。 */
function renderSuggestPenalties(container, targetRows, params) {
    const overStocks = findOverConcentratedStocks(targetRows, params.capPct);
    const overIndustries = findOverConcentratedIndustries(targetRows, params.upperPct, params.noPenaltyIndustries);
    if (overStocks.length === 0 && overIndustries.length === 0) return;

    if (overStocks.length > 0) {
        const title = document.createElement('p');
        title.className = 'update-form-title';
        title.textContent = `減点対象（銘柄集中：投資割合>${params.capPct}%）`;
        container.appendChild(title);
        const list = document.createElement('ul');
        list.className = 'status-distribution';
        overStocks.forEach(g => {
            const li = document.createElement('li');
            li.textContent = `${g.code} ${g.name}（${g.industry}）: ${g.sharePct.toFixed(1)}%`;
            list.appendChild(li);
        });
        container.appendChild(list);
    }

    if (overIndustries.length > 0) {
        const title = document.createElement('p');
        title.className = 'update-form-title';
        title.textContent = `減点対象（業種集中：配当比率>${params.upperPct}%）`;
        container.appendChild(title);
        const list = document.createElement('ul');
        list.className = 'status-distribution';
        overIndustries.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.industry}: ${item.sharePct.toFixed(1)}%`;
            list.appendChild(li);
        });
        container.appendChild(list);
    }
}

/** 推奨銘柄一覧テーブルを描画する（Δ総スコア降順、topN件）。 */
function renderSuggestTable(container, ranked, topN) {
    const table = document.createElement('table');
    table.className = 'data-table';

    const cols = ['コード', '銘柄名', '業種', '株価', '購入株数', '投資金額', '配当(合計)', '利回り', 'Δ総スコア', 'Δ配当', 'Δ業種', 'Δ銘柄', 'Δdefensive', '追加後スコア'];
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (ranked.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.className = 'empty-cell';
        td.textContent = '候補銘柄がありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        ranked.slice(0, topN).forEach(r => {
            const tr = document.createElement('tr');
            const values = [
                r.code, r.name, r.industry,
                r.avg_cost.toLocaleString('ja-JP'),
                r.shares.toLocaleString('ja-JP'),
                Math.round(r.investAmount).toLocaleString('ja-JP'),
                Math.round(r.dividendAmount).toLocaleString('ja-JP'),
                r.yieldPct != null ? `${r.yieldPct.toFixed(2)}%` : '－',
                `${r.deltaTotal >= 0 ? '+' : ''}${r.deltaTotal.toFixed(2)}`,
                `${r.deltaYield >= 0 ? '+' : ''}${r.deltaYield.toFixed(2)}`,
                `${r.deltaIndustry >= 0 ? '+' : ''}${r.deltaIndustry.toFixed(2)}`,
                `${r.deltaStock >= 0 ? '+' : ''}${r.deltaStock.toFixed(2)}`,
                `${r.deltaDefensive >= 0 ? '+' : ''}${r.deltaDefensive.toFixed(2)}`,
                r.scoreAfter.scoreTotal.toFixed(1),
            ];
            values.forEach(v => {
                const td = document.createElement('td');
                td.textContent = v ?? '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    table.append(thead, tbody);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper table-wrapper--limited';
    wrapper.appendChild(table);
    container.appendChild(wrapper);
}

document.getElementById('suggest-run-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('suggest-status');
    const scoreResultsEl = document.getElementById('score-results');
    const resultsEl = document.getElementById('suggest-results');
    const progressWrap = document.getElementById('suggest-progress');
    const progressBar = document.getElementById('suggest-progress-bar');
    const progressPercent = document.getElementById('suggest-progress-percent');
    const runBtn = document.getElementById('suggest-run-btn');
    const token = getTokenValue();
    if (!token) { statusEl.textContent = 'トークンを入力してください。'; return; }

    runBtn.disabled = true;
    statusEl.textContent = '現状ポートフォリオを計算中...';
    scoreResultsEl.replaceChildren();
    resultsEl.replaceChildren();

    try {
        const context = await loadPortfolioScoreContext(token);
        if (context.holdingsRows.length === 0) { statusEl.textContent = '保有銘柄が登録されていません（3.1 保有銘柄で登録してください）。'; return; }

        // 対象口座チェックボックスを最新のholdings.csvで再構築してから（既存のチェック状態は保持）、
        // その選択値を含むパラメータを読み取る
        renderScoreAccountFilters(context.holdingsRows);
        const params = getSuggestParams();

        const dividendYearWindow = getDividendYearWindow();
        const targetRows = buildScoreTargetRows(context.holdingsRows, context, {
            targetSelection: params.targetSelection,
            dividendYearWindow,
        });

        if (targetRows.length === 0) {
            statusEl.textContent = '対象銘柄が0件です（対象口座の指定、または配当データ・業種情報の登録状況を確認してください）。';
            return;
        }

        const owners = renderCurrentScoreBlocks(scoreResultsEl, targetRows, context.allCategories, params);

        // 候補銘柄：選択した候補ラベル（高配当／優待／米国ETF／その他＝いずれのラベルも無し）のOR和集合のうち、
        // 未保有・業種判明・候補除外業種でない・配当が直近2年度以内のもの（2026-08-29、候補ラベルを選択式にした）
        const labelsText = await fetchFileIfExists(token, OWNER, DATA_REPO, LABELS_PATH);
        const labelsRows = labelsText ? parseCsv(labelsText) : [];
        const ownedCodes = new Set(targetRows.map(r => r.code));
        const dividendYearSet = new Set(dividendYearWindow);

        if (!params.candidateLabels.highDiv && !params.candidateLabels.perk && !params.candidateLabels.usEtf && !params.candidateLabels.other) {
            statusEl.textContent = '現状スコアは計算しました。候補ラベルを1つ以上選択してください。';
            return;
        }

        const masterCodes = context.masterRows.filter(r => r.status === 'listed').map(r => r.code);
        const candidateCodes = buildLabelCandidatePool(labelsRows, masterCodes, params.candidateLabels)
            .filter(code => {
                if (ownedCodes.has(code)) return false;
                const industry = context.industryMap.get(code);
                if (!industry || ['', '-', '0'].includes(industry)) return false;
                if (params.excludedCandidateIndustries.includes(industry)) return false;
                const picked = context.dividendPickMap.get(code);
                if (!picked || !dividendYearSet.has(picked.year)) return false;
                return true;
            });

        if (candidateCodes.length === 0) {
            statusEl.textContent = '現状スコアは計算しました。候補銘柄が0件のため銘柄提案は表示できません（データタブ「ラベル」でラベルを登録するか、候補ラベル・候補除外業種の設定を確認してください）。';
            return;
        }

        // 株価取得（バッチ並列、DEFモードと同じ方式）
        progressWrap.style.display = '';
        progressBar.value = 0;
        progressPercent.textContent = '0%';

        const candidates = [];
        let done = 0;
        for (let i = 0; i < candidateCodes.length; i += SUGGEST_FETCH_BATCH_SIZE) {
            const batch = candidateCodes.slice(i, i + SUGGEST_FETCH_BATCH_SIZE);
            await Promise.all(batch.map(async code => {
                try {
                    const text = await fetchFile(token, OWNER, DATA_REPO, `${PRICES_DIR}/${code}.csv`);
                    const priceRows = parseCsv(text);
                    if (priceRows.length === 0) return;
                    const price = Number(priceRows[priceRows.length - 1].close);
                    if (!Number.isFinite(price) || price <= 0) return;

                    const picked = context.dividendPickMap.get(code);
                    const defensiveScoreRaw = context.defensiveScoreMap.get(code);
                    candidates.push({
                        code,
                        name: context.nameMap.get(code) || code,
                        industry: context.industryMap.get(code),
                        price,
                        dividendPerShare: picked.amount,
                        defensiveScore: Number.isFinite(Number(defensiveScoreRaw)) ? Number(defensiveScoreRaw) : null,
                    });
                } catch (error) {
                    // 株価CSV未取得（404等）の候補はスキップする
                }
            }));
            done += batch.length;
            const pct = Math.round((done / candidateCodes.length) * 100);
            progressBar.value = pct;
            progressPercent.textContent = `${pct}%（${done}/${candidateCodes.length}）`;
        }

        if (candidates.length === 0) {
            statusEl.textContent = '現状スコアは計算しました。株価が取得できた候補銘柄がないため銘柄提案は表示できません（データタブで株価を取得してください）。';
            return;
        }

        const { ranked } = rankCandidates(targetRows, candidates, context.allCategories, params, params.minInvestAmount);

        renderSuggestPenalties(resultsEl, targetRows, params);

        const tableTitle = document.createElement('p');
        tableTitle.className = 'update-form-title';
        tableTitle.textContent = `推奨（1銘柄追加でスコア最大化）Top${Math.min(params.topN, ranked.length)}`;
        resultsEl.appendChild(tableTitle);
        renderSuggestTable(resultsEl, ranked, params.topN);

        statusEl.textContent = `計算しました（対象銘柄: ${targetRows.length}件 / 所有者: ${owners.join(', ')} / 候補銘柄: ${candidates.length}件 / 全候補: ${candidateCodes.length}件）。`;
    } catch (error) {
        console.error(error);
        statusEl.textContent = `計算に失敗しました: ${error.message}`;
    } finally {
        runBtn.disabled = false;
        progressWrap.style.display = 'none';
    }
});
