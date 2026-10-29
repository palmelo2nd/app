// 2026-09-13：ES modules（import文）はURLごとにブラウザキャッシュされるため、更新後もブラウザが古い
// モジュールを使い続けてしまうことがあった。全importに「?v=N」をクエリ文字列として付け、バージョンを
// 上げるたびに全モジュールが新しいURLとして再取得されるようにする（stock/kanziアプリと同じ方式）。
// import文のModuleSpecifierは仕様上「文字列リテラルのみ」（変数や式は不可）のため、下記の全import文・
// index.html・js/modules/calendar.js（task.js）・excel.js（dataModel.js）・merge.js（task.js）・
// recurring.js（dataModel.js・task.js）が内部importする分の「?v=N」は、値を変数化できず文字列として
// 個別に書く必要がある。JS/CSSを編集した際は、これらすべての「?v=N」を同じ新しい値に一括で書き換える
// こと（例：sed的な一括置換、または該当箇所をgrepしてから1件ずつ更新）。
// 現在のバージョン: 28
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=57';
import { fetchFile, saveFile } from './modules/github.js?v=57';
import { parseMarkdown, stringifyMarkdown, MAIN_DATA_COLUMNS, MASTER_DATA_COLUMNS, formatCellValue } from './modules/dataModel.js?v=57';
import { mergeMainData, pickNewer, reassignDuplicatedParentChildren } from './modules/merge.js?v=57';
import { exportToExcel, importFromExcel } from './modules/excel.js?v=57';
import {
    generateChildManually, matchesSchedule,
    buildChildChartData, formatRecurringFrequencyLabel,
    RECURRING_FREQ_KEY, RECURRING_FREQ_PARTS, RECURRING_FREQ_OPTIONS, getRecurringFrequencyList, makeRecurringFrequency,
    getRecurringBaseDate,
    parseChildTemplates, stringifyChildTemplates, getRecurringTemplatesValue, RECURRING_TEMPLATE_KEY
} from './modules/recurring.js?v=57';
import { parseExceptions, getDefaultType } from './modules/workCalendar.js?v=57';
import {
    parseJpDatetime, formatJpDatetime, formatDuration,
    computeTotalDuration as computeTotalDurationM,
    getTimerSegments, setTimerSegments, isTimerRunning, startTimer, stopTimer, computeTimerSegmentMs, computeTimerTotalMs,
    filterMainDataByCategory, computeActualHours,
    getChildren as getChildrenM,
    wouldCreateCycle as wouldCreateCycleM,
    isRecurringParentRow, isRecurringChildRow, isNormalTaskRow, KIND_REPORT, KIND_WORK_CALENDAR, getRowKind, setSystemField, getSystemInfo
} from './modules/task.js?v=57';
import {
    KIND_DAYPLAN, isDayPlanRow, isTaskDoneForCalendar, getCalendarMarkDate,
    getTasksForDate as getTasksForDateM, getDayPlanTask as getDayPlanTaskM, parseDayPlanContent,
    countActiveTasksByField as countActiveTasksByFieldM, countTasksByField as countTasksByFieldM,
    sortByTotalCountDesc as sortByTotalCountDescM, calendarTaskListStatusRank, compareDateAscEmptyLast,
    extractTimeOnDate, assignCalendarColumns, DAYPLAN_COLUMN_COUNT, getCalendarStatusClass, getPriorityDotClass,
    computeDayPlanTimeSlot, getTaskScheduledTimeOnDate,
    getSuspendedTasks as getSuspendedTasksM, getTasksByStatus as getTasksByStatusM, taskOrganizeStatusRank,
    sortDayPlanBlocks, stringifyDayPlanBlocks, placeDayPlanBlock
} from './modules/calendar.js?v=57';
import {
    getAllKnownColumns as getAllKnownColumnsM, computeMasterWarnings as computeMasterWarningsM,
    createEmptyMasterRow as createEmptyMasterRowM
} from './modules/master.js?v=57';
import { createAiReviewView } from './views/aiReview.js?v=57';
import { createProjectTreeView } from './views/projectTree.js?v=57';
import { createGanttView } from './views/gantt.js?v=57';
import { createWorkCalendarView } from './views/workCalendar.js?v=57';
import {
    REPORT_PARA_STRUCTURE, REPORT_PARA_THEME, REPORT_PARA_ENTRY, REPORT_PARA_OCCASION,
    REPORT_STATE_PLANNED, REPORT_STATE_DONE, REPORT_STATE_SKIPPED,
    isReportStructureRow, isReportThemeRow, isReportEntryRow, isReportOccasionRow,
    splitReportIds, createReportRow,
    parseReportStructure, assignReportNodeIds, stringifyReportStructure, flattenReportTree,
    getReportThemes, getReportEntryThemeId,
    parseReportStates, stringifyReportStates, nextReportState, hasUnfinishedReportState,
    getReportOccasionsForVenue, getNextReportOccasion, buildReportDraft,
    REPORT_KEY_VENUES, REPORT_KEY_THEME, REPORT_KEY_STATES, getReportField, setReportField
} from './modules/report.js?v=57';

// 画面右上の「vバッジ」表示（top-barの「キャッシュ更新」ボタン右）。import.meta.urlはこのモジュール
// 自身の完全URL（?v=N込み）を返すため、キャッシュバスティングの値を別途手入力・同期する必要がない
// （?v=N更新時、ここは自動で追従する）。
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const PATH  = 'brain/data.md';

const CODE_REPO    = 'app';        // アプリ本体・README.mdが置かれているコードリポジトリ
const README_PATH  = 'brain/README.md';

// ===== グローバル状態 =====
let currentSha        = null;
let currentMainData   = [];
let currentMasterData = [];
let lastSyncedMarkdown = null;   // 直近でGitHub/キャッシュと一致している状態のMarkdown（未保存差分の判定基準）
let saveConflictPending = false; // true: 自動保存が他デバイスとの更新競合を検出し、自動マージを保留中（手動保存で解決するまでtrue）
let currentCategory   = 'すべて';        // カテゴリフィルタの選択値
let categoryInitialized = false;         // 初回ロード時にデフォルトカテゴリを設定済みか
let summaryView          = 'taskorg2';  // Summary ページの表示ビュー（'taskorg2' | 'info'）

// ===== 新方式（親ID）タブ用の状態 =====
// ステータス／プロジェクト（最上位の親ID）は複数選択、その他フィルタ（プロジェクト行・繰返し親タスク・繰返し子タスクの表示）は表示ON/OFFの単純なチェックボックス。
let taskorg2Filters = {
    status: new Set(), project: new Set(),
    showProject: false, showRecurringParent: false, showRecurringChild: true,
};
const taskorg2FilterKnownOptions = { status: new Set(), project: new Set() };
let taskorg2ProjectDrilldownPath = []; // 新タスク整理・プロジェクトフィルタ下のPJ(n層)ドリルダウンで選択中のID列（ルート→現在選択中の階層の順）
let selectedTaskorg2Id = null;      // 新タスク整理で選択中の行ID
let taskorg2QuickNewMode = false;   // true時: 「新規登録」ボタンから起動した新規登録モード（日付は空欄のまま）
const dayedit2Freq = { month: new Set(), day: new Set(), weekday: new Set() }; // 新タスク整理・編集パネルの頻度チップの選択状態
let dayedit2Templates = []; // 新タスク整理・編集パネルの実行タスクテンプレート編集状態（繰返しテンプレートのみ。Array<{startOffsetDays, endOffsetDays, titleSuffix, content, status, priority, category, estimate}>）
let selectedDayedit2TemplateIndex = null; // dayedit2Templatesのうち、共通フォーム（カテゴリ〜見積時間欄）で個別編集中のテンプレートのインデックス（未選択時はnull）
let dayedit2ParentFieldSnapshot = null;   // テンプレート個別編集モードに入る直前の、親タスク自身のカテゴリ〜見積時間欄の値（モード終了時に復元する）
let dayedit2FormBaseline = null;          // 編集フォームにタスクを読み込んだ直後の値（行の形に正規化したもの）。複数選択時の「変更した項目だけ一括適用」と色付け表示の比較基準
let taskorg2CalendarYear  = new Date().getFullYear(); // 新タスク整理のカレンダー表示年（旧タスク整理とは独立）
let taskorg2CalendarMonth = new Date().getMonth();    // 新タスク整理のカレンダー表示月（0始まり、旧タスク整理とは独立）
let selectedTaskorg2Date  = jpDateOnly(formatJpDatetime(new Date())); // 新タスク整理でカレンダーの日クリックにより選択中の日付（YYYY/MM/DD）。開いた時点では常に今日を選択する
let taskorg2View = 'calendar';      // 新タスク整理の表示ビュー（'calendar' | 'gantt' | 'workcal' | 'project' | 'report' | 'aireview'、旧タスク整理とは独立）
let dayedit2ParentPath = [];        // 新タスク整理・編集フォームの親（プロジェクト）階層プルダウンで選択中のID列（ルート→現在選択中の階層の順）
let taskorg2BulkPjPath = [];        // タスク整理「PJ一括編集」の階層プルダウンで選択中のID列（個別編集フォームのdayedit2ParentPathとは独立）
let project2AdminDeletePending = null;      // プロジェクト管理表で「削除」を押して再割り当て/未割り当ての選択待ちになっている行ID

// ===== 初期化 =====
window.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        setTokenInputs(saved);
        loadFromGitproject(saved, true);
    }
    renderSummary();
});

// ===== サイドバー／TOPページ共通コントロール（PW・Load・Save・Export・Import） =====

/** すべてのトークン入力欄（サイドバー・TOPページ）を同じ値に揃える */
function setTokenInputs(value) {
    document.querySelectorAll('.js-token-input').forEach(el => { el.value = value; });
}

/** いずれかのトークン入力欄から値を取得する（全欄が同期されているため先頭の値を使う） */
function getTokenValue() {
    return document.querySelector('.js-token-input')?.value.trim() || '';
}

/** 現在入力中のトークンをlocalStorageに保存する（空欄時は何もしない＝誤って既存の保存値を消さない）。 */
function persistCurrentToken() {
    const token = getTokenValue();
    if (token) saveToken(token);
}

/** すべてのトークン入力欄を相互に同期する */
document.querySelectorAll('.js-token-input').forEach(input => {
    input.addEventListener('input', () => setTokenInputs(input.value));
});

/** すべてのネットワークステータス表示（サイドバー・TOPページ）を更新する */
function setNetworkStatus(html) {
    document.querySelectorAll('.js-network-status').forEach(el => { el.innerHTML = html; });
}

/**
 * 現在のMarkdownが直近の同期済み内容と一致しているかどうかで「最新」「未保存の変更あり」バッジを切り替える。
 * オフライン表示中（読込失敗でキャッシュ表示中）はここでは上書きしない。
 */
function updateSyncBadge(markdown) {
    if (lastSyncedMarkdown === null) return; // 未読み込み状態では何もしない
    if (markdown === lastSyncedMarkdown) {
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
    } else {
        setNetworkStatus('<span class="status-badge unsaved-badge">オンライン（更新あり）</span>');
    }
}

/** データ変更のたびに呼ぶ：ローカルキャッシュへ保存し、未保存差分バッジを更新する */
function persistLocalCache() {
    invalidateTaskorg2HierarchyCache();
    const markdown = stringifyMarkdown(currentMainData, currentMasterData);
    saveCache(markdown, currentSha);
    updateSyncBadge(markdown);
}

// ===== 親ID階層の高速判定用キャッシュ =====
// 「他の行から親IDとして参照されているか」「最上位の祖先」の判定は、素朴に書くと currentMainData 全体を毎回スキャンする（O(N)）が、
// タスク整理のカレンダー・フィルタ処理は行ごとにこれらを呼ぶため、素朴に呼ぶと全体でO(N^2)になり
// データ件数増加に伴う体感速度の悪化の主因になっていた。ここでは「ID→行」「親として参照されているID集合」
// 「id→最上位祖先ID」をO(N)で1回だけ作り、以降はO(1)で引けるようにする。
// currentMainDataを変更する操作は必ずpersistLocalCache（またはapplyContentでの初回ロード）を経由する
// 前提のため、そのタイミングでキャッシュを破棄（再構築は次回参照時に遅延実行）すれば整合性を保てる。
let taskorg2HierarchyCache = null;
let taskorg2HierarchyDirty = true;

function invalidateTaskorg2HierarchyCache() {
    taskorg2HierarchyDirty = true;
}

function getTaskorg2HierarchyCache() {
    if (taskorg2HierarchyDirty || !taskorg2HierarchyCache) {
        const idMap = new Map(currentMainData.map(r => [String(r['ID']), r]));
        const parentIdSet = new Set();
        currentMainData.forEach(r => {
            const pid = String(r['親ID'] || '');
            if (pid) parentIdSet.add(pid);
        });
        taskorg2HierarchyCache = { idMap, parentIdSet, rootCache: new Map() };
        taskorg2HierarchyDirty = false;
    }
    return taskorg2HierarchyCache;
}

/** 指定IDが他の行から親IDとして参照されているか（＝実質プロジェクトかどうか）を、キャッシュ済みのSetでO(1)で判定する。 */
function isParentRowFast(id) {
    if (!id) return false;
    return getTaskorg2HierarchyCache().parentIdSet.has(String(id));
}

/** 従来のgetRootParentId(currentMainData, id)と同じ判定を、キャッシュ（id→最上位祖先IDのメモ化）でO(1)〜O(深さ)で行う。 */
function getRootParentIdFast(id) {
    const cache = getTaskorg2HierarchyCache();
    const key = String(id);
    if (cache.rootCache.has(key)) return cache.rootCache.get(key);

    const visited = new Set([key]);
    let currentId = key;
    let current = cache.idMap.get(currentId);
    while (current && current['親ID']) {
        const pid = String(current['親ID']);
        if (visited.has(pid) || !cache.idMap.has(pid)) break;
        visited.add(pid);
        currentId = pid;
        current = cache.idMap.get(pid);
    }
    cache.rootCache.set(key, currentId);
    return currentId;
}

/** id要素が指定アンカーの子でなければ移動する（Summary内の各タブでセクション本体を使い回すため） */
function mountSection(elId, anchorId) {
    const el     = document.getElementById(elId);
    const anchor = document.getElementById(anchorId);
    if (el && anchor && el.parentElement !== anchor) anchor.appendChild(el);
}

// --- ページレンダラー ---

const SUMMARY_VIEWS = ['taskorg2', 'info'];

/** Summary ページ（タスク管理／Infoの表示切り替え。クイック登録（旧INBOX）はタスク管理タブ最上部、メインデータ・マスタデータ一覧はInfoタブのExpanderに常駐。PW・Load〜Import・カテゴリは常時表示バーで共通）を描画する */
function renderSummary() {
    // 選択中のビューに応じて、セクション本体をこのページへ移動する
    if (summaryView === 'taskorg2')  mountSection('taskorg2-details',  'taskorg2-anchor-summary');

    renderCategoryFilter(); // 常時表示バーのカテゴリ選択を最新化
    renderWarnings(computeMasterWarnings());
    renderInboxBadge();
    if (summaryView === 'taskorg2')  renderCalendar2();
    if (summaryView === 'info')      renderInfoDataTables();
    // 「プロジェクト管理」表は、パフォーマンスのためExpanderが開いている時のみ再描画する
    // （閉じている間の操作では再描画しない。開いた瞬間はtoggleイベント側で描画）
    if (summaryView === 'taskorg2') {
        if (document.getElementById('taskorg2-project-admin-table-toggle')?.open) renderProject2AdminTable();
    }

    SUMMARY_VIEWS.forEach(view => {
        document.getElementById(`summary-tab-${view}`)?.classList.toggle('taskorg-view-btn--active', summaryView === view);
        const panel = document.getElementById(`summary-view-${view}`);
        if (panel) panel.style.display = summaryView === view ? '' : 'none';
    });
}

SUMMARY_VIEWS.forEach(view => {
    document.getElementById(`summary-tab-${view}`)?.addEventListener('click', () => { summaryView = view; renderSummary(); });
});

// ===== Info：コードリポジトリのREADME.md（アプリ概要）を取得しMarkdownとして表示 =====
async function loadInfoReadme() {
    const el = document.getElementById('info-content');
    const token = getTokenValue();
    if (!token) { el.textContent = 'トークンを入力してください。'; return; }

    el.textContent = '読み込み中...';

    try {
        const { content } = await fetchFile(token, OWNER, CODE_REPO, README_PATH);
        el.innerHTML = window.marked.parse(content);
    } catch (error) {
        console.error(error);
        el.textContent = `読み込みに失敗しました: ${error.message}`;
    }
}

// Infoタブを開いたとき、トークンが入力済みなら自動的に読み込む
// READMEは「アプリ概要」Expanderを開いたときに読み込む（既定は閉じているため、タブを開いただけでは取得しない）
document.getElementById('info-readme-toggle')?.addEventListener('toggle', (e) => {
    if (e.target.open && getTokenValue()) loadInfoReadme();
});

/**
 * InfoタブのメインデータExpander・マスタデータExpanderのうち、開いているものだけ表を描画する
 * （メインデータは800行超あり重いため、閉じている間は描画しない。開いた瞬間はtoggleイベント側で描画）。
 */
function renderInfoDataTables() {
    if (document.getElementById('info-main-toggle')?.open) {
        renderDataTable('table-main', 'summary-main', getFilteredMainData(), MAIN_DATA_COLUMNS, 'メインデータ', { editable: true, idColumn: 'ID' });
    }
    if (document.getElementById('info-master-toggle')?.open) {
        renderDataTable('table-master', 'summary-master', currentMasterData, MASTER_DATA_COLUMNS, 'マスタデータ', { editable: true, onEdit: () => { renderWarnings(computeMasterWarnings()); renderProject2AdminTable(); } });
    }
}
['info-main-toggle', 'info-master-toggle'].forEach(id => {
    document.getElementById(id)?.addEventListener('toggle', (e) => { if (e.target.open) renderInfoDataTables(); });
});

document.getElementById('info-reload-btn')?.addEventListener('click', loadInfoReadme);

/** クイック登録欄のカテゴリバッジを更新する */
function renderInboxBadge() {
    const text = currentCategory === 'すべて'
        ? 'カテゴリ: 未設定（「すべて」選択中）'
        : `カテゴリ: ${currentCategory}`;
    document.querySelectorAll('.js-inbox-badge').forEach(badge => { badge.textContent = text; });
}

/**
 * 指定テーブルをデータ配列で描画し、サマリーに件数バッジを更新する。
 * options.editable が true の場合、各セルを直接編集可能にし、
 * 編集完了（blur）時に row オブジェクトへ書き込んでキャッシュ保存する。
 * @param {string} tableId    - 描画先 <table> の id
 * @param {string} summaryId  - 件数を表示する <summary> の id
 * @param {Array}  data       - 行データの配列
 * @param {Array}  columns    - 表示列名の配列（MAIN_DATA_COLUMNS / MASTER_DATA_COLUMNS）
 * @param {string} label      - サマリー表示名
 * @param {{editable?: boolean, idColumn?: string, onEdit?: Function}} [options]
 */
function renderDataTable(tableId, summaryId, data, columns, label, options = {}) {
    const { editable = false, idColumn = null, onEdit = null } = options;

    // ---- サマリーの件数バッジを更新 ----
    const summaryEl = document.getElementById(summaryId);
    if (summaryEl) {
        summaryEl.innerHTML =
            `${label} 一覧<span class="expander-count">${data.length} 件</span>`;
    }

    const table = document.getElementById(tableId);
    if (!table) return;

    table.className = 'data-table' + (editable ? ' data-table--editable' : '');

    // ---- ヘッダー行 ----
    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    // ---- データ行 ----
    const tbody = document.createElement('tbody');
    if (data.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan   = columns.length;
        td.className = 'empty-cell';
        td.textContent = 'データがありません。GitHubから読み込んでください。';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        data.forEach(row => {
            const tr = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                td.textContent = formatCellValue(row[col]); // システム列などのオブジェクトはJSON文字列で表示する

                // ID列は参照キーとして使われるため編集不可にする
                if (editable && col !== idColumn) {
                    td.contentEditable = 'true';
                    td.classList.add('editable-cell');
                    td.addEventListener('keydown', e => {
                        if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
                    });
                    td.addEventListener('blur', () => {
                        const newVal = td.textContent.trim();
                        if (formatCellValue(row[col]) === newVal) return;
                        if (typeof row[col] === 'object' && row[col] !== null || (col === 'システム' && newVal.startsWith('{'))) {
                            // システム列はJSONとして解析できた場合だけ反映する（壊れた値で種別の判定が狂うのを防ぐ）
                            try { row[col] = newVal ? JSON.parse(newVal) : ''; }
                            catch { alert(`${col}はJSON形式で入力してください（例: {"種別":"1日タスク"}）`); td.textContent = formatCellValue(row[col]); return; }
                        } else {
                            row[col] = newVal;
                        }
                        persistLocalCache();
                        if (onEdit) onEdit();
                    });
                }

                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    table.replaceChildren(thead, tbody);
}

// ===== 日付の共通ヘルパー =====

/** 日時文字列 "YYYY/MM/DD HH:mm:ss" の日付部分のみを返す */
function jpDateOnly(dt) { return (dt || '').slice(0, 10); }
/** "YYYY-MM-DD" を "YYYY/MM/DD" に変換 */
function isoToJP(d) { return d.replace(/-/g, '/'); }
/** "YYYY/MM/DD" 形式の日付文字列を Date に変換する（末尾の時刻部分は無視）。パース不可ならnull。 */
function parseSlashDateOnly(str) {
    const m = (str || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
/** Date を "YYYY/MM/DD" 形式にフォーマットする */
function formatSlashDateOnly(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

// ===== <select> 共通ヘルパー =====

/** <select> のoption一覧を再構築する（先頭に空選択肢 + optionsを追加）。 */
function populateSelectOptions(el, options, placeholder) {
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>`;
    options.forEach(v => {
        const o = document.createElement('option');
        o.value = o.textContent = v;
        el.appendChild(o);
    });
}

/** id指定の既存<select>のoptionを再構築し、現在選択されていた値を維持する。 */
function rebuildSelectById(id, options, placeholder = '（未設定）') {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    populateSelectOptions(el, options, placeholder);
    el.value = prev;
}

// ===== マスタ管理 =====

/** MAIN_DATA_COLUMNS/MASTER_DATA_COLUMNSと実データ列の和集合を返す（新規列の自動認識用）。 */
function getAllKnownColumns() {
    return getAllKnownColumnsM(currentMainData, currentMasterData, MAIN_DATA_COLUMNS, MASTER_DATA_COLUMNS);
}

/** MAIN_DATA_COLUMNS と currentMasterData を照合して警告リストを返す。 */
function computeMasterWarnings() {
    return computeMasterWarningsM(currentMainData, currentMasterData, MAIN_DATA_COLUMNS, MASTER_DATA_COLUMNS);
}

/** Summary ページに警告バナーを描画する。 */
function renderWarnings(warnings) {
    document.querySelectorAll('#summary-dashboard-warning').forEach(dashEl => {
        dashEl.innerHTML = warnings.length > 0
            ? `<p class="warning-text">⚠ ${warnings.join('　/　')}</p>`
            : '';
    });
}

/** マスタデータの空行を生成する。 */
function createEmptyMasterRow() {
    return createEmptyMasterRowM(MASTER_DATA_COLUMNS);
}

/** 空のマスタデータ行を1件追加し、マスタデータ一覧テーブルを再描画する。 */
function addMasterRow() {
    currentMasterData.push(createEmptyMasterRow());
    persistLocalCache();
    renderDataTable('table-master', 'summary-master', currentMasterData, MASTER_DATA_COLUMNS, 'マスタデータ', { editable: true, onEdit: () => renderWarnings(computeMasterWarnings()) });
    renderWarnings(computeMasterWarnings());
}

document.getElementById('add-master-data-row-btn')?.addEventListener('click', addMasterRow);

// ===== Info：メインデータ一覧の行追加 =====

/** 空のメインデータ行を1件追加し、メインデータ一覧テーブルを再描画する。 */
document.getElementById('add-main-row-btn')?.addEventListener('click', () => {
    const maxId = currentMainData.reduce((max, row) => {
        const id = parseInt(row['ID'], 10);
        return isNaN(id) ? max : Math.max(max, id);
    }, 0);

    const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
    entry['ID']      = String(maxId + 1);
    entry['カテゴリ'] = currentCategory === 'すべて' ? '' : currentCategory;

    currentMainData.push(entry);
    persistLocalCache();

    renderDataTable('table-main', 'summary-main', getFilteredMainData(), MAIN_DATA_COLUMNS, 'メインデータ', { editable: true, idColumn: 'ID' });
});

// ===== データ読み込みヘルパー =====

/**
 * Markdownテキストを受け取り、グローバル状態を更新して現在ページを再描画する。
 */
function applyContent(content, sha) {
    invalidateTaskorg2HierarchyCache();
    currentSha = sha;
    const { mainData, masterData } = parseMarkdown(content);
    currentMainData   = mainData;
    currentMasterData = masterData;

    // 初回ロード時のみ、先頭カテゴリをデフォルト選択にする
    if (!categoryInitialized) {
        const categories = [...new Set(currentMasterData.map(r => r['(M)カテゴリ']).filter(Boolean))];
        if (categories.length > 0) currentCategory = categories[0];
        categoryInitialized = true;
    }

    renderCategoryFilter();   // データ更新時にカテゴリ一覧を再構築
    renderSummary();
}

// ===== 競合解決モーダル（真の競合を実データで見比べてユーザーに選ばせる） =====

/** conflict（{ id, base, local, remote }）から、local/remoteで値が異なる列だけを抽出して返す（IDは除く）。 */
function getConflictDiffColumns(conflict) {
    const { local, remote } = conflict;
    return MAIN_DATA_COLUMNS.filter(col => {
        if (col === 'ID') return false;
        const lv = local  ? formatCellValue(local[col])  : null;
        const rv = remote ? formatCellValue(remote[col]) : null;
        return lv !== rv;
    });
}

/** 競合解決モーダル内の「◯ / ◯件選択済み」表示と、適用ボタンの活性状態を更新する。 */
function updateConflictResolveApplyState(state) {
    const infoEl   = document.getElementById('conflict-resolve-info');
    const applyBtn = document.getElementById('conflict-resolve-apply-btn');
    const resolvedCount = state.selections.filter(Boolean).length;
    if (infoEl) infoEl.textContent = `${resolvedCount} / ${state.conflicts.length} 件選択済み`;
    if (applyBtn) applyBtn.disabled = resolvedCount !== state.conflicts.length;
}

/** 競合解決モーダルに1件分（1競合行）の差分テーブル＋選択肢を組み立てて追加する。 */
function renderConflictResolveRow(container, conflict, index, state) {
    const row = document.createElement('div');
    row.className = 'conflict-resolve-row';

    const sampleRow = conflict.local || conflict.remote;
    const header = document.createElement('div');
    header.className = 'conflict-resolve-row-title';
    header.textContent = `#${conflict.id} ${sampleRow ? (sampleRow['タイトル'] || '（無題）') : '（無題）'}`;
    row.appendChild(header);

    const diffCols = getConflictDiffColumns(conflict);
    const table = document.createElement('table');
    table.className = 'conflict-resolve-table';

    const headRow = document.createElement('tr');
    ['項目', 'ローカル', 'リモート'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
    });
    table.appendChild(headRow);

    if (diffCols.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.textContent = '差分のある項目はありません（片方の端末で削除されています）。';
        tr.appendChild(td);
        table.appendChild(tr);
    }
    diffCols.forEach(col => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = col;
        tr.appendChild(th);
        const tdLocal = document.createElement('td');
        tdLocal.textContent = conflict.local ? (formatCellValue(conflict.local[col]) || '（空欄）') : '（削除済み）';
        tr.appendChild(tdLocal);
        const tdRemote = document.createElement('td');
        tdRemote.textContent = conflict.remote ? (formatCellValue(conflict.remote[col]) || '（空欄）') : '（削除済み）';
        tr.appendChild(tdRemote);
        table.appendChild(tr);
    });
    row.appendChild(table);

    const options = document.createElement('div');
    options.className = 'conflict-resolve-options';
    const optionDefs = [];
    if (conflict.local)  optionDefs.push({ value: 'local',  label: 'ローカルを採用' });
    if (conflict.remote) optionDefs.push({ value: 'remote', label: 'リモートを採用' });
    if (conflict.local && conflict.remote) optionDefs.push({ value: 'both', label: '両方残す（新しいIDで複製）' });

    optionDefs.forEach(opt => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `conflict-resolve-${index}`;
        input.value = opt.value;
        input.addEventListener('change', () => {
            state.selections[index] = opt.value;
            updateConflictResolveApplyState(state);
        });
        label.appendChild(input);
        label.appendChild(document.createTextNode(opt.label));
        options.appendChild(label);
    });
    row.appendChild(options);

    container.appendChild(row);
}

/**
 * mergeMainDataが返した真の競合（conflicts）をモーダルで表示し、ユーザーが行ごとに選んだ結果を
 * { results, reassignments } で解決するPromiseを返す。
 * results: Array<Array<row>>（通常は1件、「両方残す」を選んだ場合は2件）
 * reassignments: 「両方残す」を選んだ行の { oldId, newId } の一覧（親ID付け替え用。呼び出し側で
 *                reassignDuplicatedParentChildren に渡す）
 * nextIdは「両方残す」を選んだ際に複製側へ割り振る新規IDの開始値（呼び出し側で全体のmaxID+1を渡す）。
 */
function showConflictResolutionModal(conflicts, nextId) {
    return new Promise(resolve => {
        const overlay  = document.getElementById('conflict-resolve-modal');
        const listEl   = document.getElementById('conflict-resolve-list');
        const applyBtn = document.getElementById('conflict-resolve-apply-btn');
        if (!overlay || !listEl || !applyBtn) {
            // モーダルDOMが無い場合の保険（通常到達しない）。安全側に倒し、更新日時が新しい方を採用する。
            const results = conflicts.map(c => [(c.local && c.remote) ? pickNewer(c.local, c.remote) : (c.local || c.remote)]);
            resolve({ results, reassignments: [] });
            return;
        }

        listEl.innerHTML = '';
        const state = { conflicts, selections: new Array(conflicts.length).fill(null) };
        conflicts.forEach((c, i) => renderConflictResolveRow(listEl, c, i, state));
        updateConflictResolveApplyState(state);
        overlay.style.display = '';

        let currentNextId = nextId;
        const onApply = () => {
            applyBtn.removeEventListener('click', onApply);
            overlay.style.display = 'none';

            const reassignments = [];
            const results = conflicts.map((c, i) => {
                const choice = state.selections[i];
                if (choice === 'local')  return c.local  ? [c.local]  : [];
                if (choice === 'remote') return c.remote ? [c.remote] : [];
                if (choice === 'both') {
                    const newId = String(currentNextId);
                    const duplicated = { ...c.remote, 'ID': newId };
                    reassignments.push({ oldId: c.id, newId });
                    currentNextId += 1;
                    return [c.local, duplicated];
                }
                return [];
            });
            resolve({ results, reassignments });
        };
        applyBtn.addEventListener('click', onApply);
    });
}

/**
 * mergeMainDataのconflicts（真の競合）をmerged配列に解決して追加する共通ヘルパー。
 * silent=trueの場合はモーダルを出さず、更新日時が新しい方を自動採用する（バックグラウンド処理向けの
 * 安全なフォールバックのみ。保存・読込とも通常operationはsilent=falseを通るため、実運用では基本この分岐に入らない）。
 * localRows/remoteRows: マージ前のローカル／リモート元データ。「両方残す」選択時の新規ID採番の重複チェックと、
 *                        複製された親IDを持つ子タスクの再割当て（reassignDuplicatedParentChildren）の両方に使う。
 */
async function resolveMergeConflicts(merged, conflicts, localRows, remoteRows, silent) {
    if (conflicts.length === 0) return merged;

    if (silent) {
        conflicts.forEach(c => {
            if (c.local && c.remote) merged.push(pickNewer(c.local, c.remote));
            else if (c.local || c.remote) merged.push(c.local || c.remote);
        });
        return merged;
    }

    const idPoolRows = [...localRows, ...remoteRows];
    const maxId = idPoolRows.reduce((max, row) => {
        const id = parseInt(row['ID'], 10);
        return isNaN(id) ? max : Math.max(max, id);
    }, 0);

    const { results, reassignments } = await showConflictResolutionModal(conflicts, maxId + 1);
    results.forEach(rows => rows.forEach(r => merged.push(r)));
    return reassignDuplicatedParentChildren(merged, reassignments, remoteRows, localRows);
}

// ===== GitHubから読み込み =====

/**
 * GitHubからデータを読み込み、失敗時はローカルキャッシュへフォールバックする。
 * (2) インプット: token (string), silent (boolean) - trueの場合トークン未入力時にアラートを出さない
 */
async function loadFromGitproject(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }
    saveToken(token);

    try {
        const { content, sha } = await fetchFile(token, OWNER, REPO, PATH);

        // ローカルに未保存の変更（前回の同期済み内容から書き換わっている）が残ったまま読込むと、
        // そのまま上書きしてしまうと変更が失われるため、その場合だけ直近の同期済み内容を基準に
        // リモートの最新内容とローカルの未保存分を3-wayマージし、両方の変更を残す（保存時の競合処理と同じ考え方）。
        const hasUnsavedLocalEdits = lastSyncedMarkdown !== null &&
            stringifyMarkdown(currentMainData, currentMasterData) !== lastSyncedMarkdown;

        if (hasUnsavedLocalEdits) {
            const { mainData: remoteMain, masterData: remoteMaster } = parseMarkdown(content);
            const { mainData: baseMain, masterData: baseMaster } = parseMarkdown(lastSyncedMarkdown);

            const { merged, conflicts } = mergeMainData(baseMain, currentMainData, remoteMain);
            currentMainData   = await resolveMergeConflicts(merged, conflicts, currentMainData, remoteMain, silent);
            currentMasterData = resolveMasterData(baseMaster, currentMasterData, remoteMaster);
            currentSha = sha;
            lastSyncedMarkdown = stringifyMarkdown(currentMainData, currentMasterData);
            persistLocalCache(); // 内部でinvalidateTaskorg2HierarchyCacheも実行される
            saveConflictPending = false;
            renderSyncConflictBanner();
            renderCategoryFilter();
            renderSummary();

            if (!silent) {
                alert(conflicts.length > 0
                    ? `未保存の変更が残っていたため、リモートの最新内容とマージしました（${conflicts.length}件の競合はご指定の内容で解決しました）。`
                    : '未保存の変更を保持したまま、リモートの最新内容を取り込みました。内容を確認し、必要なら「保存」してください。');
            }
            return;
        }

        applyContent(content, sha);
        lastSyncedMarkdown = content; // GitHub上の内容を「同期済み」の基準にする
        persistLocalCache();          // 繰り返しタスク自動生成分も含めた現在の状態をキャッシュ＆バッジ反映
        saveConflictPending = false;  // 最新状態を読み込み直したため、競合待ち状態を解除する
        renderSyncConflictBanner();
    } catch (error) {
        console.error(error);
        const cached = loadCache();
        if (cached) {
            applyContent(cached.content, cached.sha);
            lastSyncedMarkdown = cached.content; // 端末内キャッシュを「同期済み」の基準にする
            setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
            if (!silent) alert('通信できませんでした。デバイス内に一時保存されている前回のデータを表示します。');
        } else {
            // 端末内キャッシュも無い場合（初回読込・キャッシュクリア後等）、以前は何も表示せず
            // 無言で失敗していた。トークンの権限不足などに気づけないため、必ず状態表示とアラートを出す。
            setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
            if (!silent) alert(`GitHubからの読み込みに失敗しました（${error.message}）。トークンが「${OWNER}/${REPO}」への読み書き権限を持っているか確認してください。`);
        }
    }
}

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => loadFromGitproject(getTokenValue()));
});

// ===== GitHubへ保存 =====

/**
 * masterDataの競合を解決する。片方しか変更していなければその内容を採用し、
 * 両方が異なる内容に変更している場合のみユーザーに選ばせる（マージはしない）。
 */
function resolveMasterData(baseMasterData, localMasterData, remoteMasterData) {
    const baseJson   = JSON.stringify(baseMasterData);
    const localJson  = JSON.stringify(localMasterData);
    const remoteJson = JSON.stringify(remoteMasterData);

    if (localJson === remoteJson) return localMasterData;
    if (localJson === baseJson)   return remoteMasterData; // ローカルは未変更 → 相手を採用
    if (remoteJson === baseJson)  return localMasterData;  // 相手は未変更 → ローカルを採用

    const useLocal = confirm(
        'マスタデータ（カテゴリ・ステータス等の設定）が他端末でも更新されており、競合しています。\n' +
        'OK：自分のマスタ変更を優先して保存します\nキャンセル：他端末のマスタ内容を優先して保存します'
    );
    return useLocal ? localMasterData : remoteMasterData;
}

/** 同期競合バナー（sync-conflict-banner）の表示・非表示を saveConflictPending の状態に合わせて反映する。 */
function renderSyncConflictBanner() {
    const banner = document.getElementById('sync-conflict-banner');
    if (banner) banner.style.display = saveConflictPending ? '' : 'none';
}

/**
 * 保存時に409（他端末との更新競合）が発生した場合の処理。常にユーザーが明示的に保存操作をした
 * 場合にのみ呼ばれる（自動保存が競合を検出した場合はここを呼ばず、バナー表示のみで停止する）。
 * 相手の最新版を取得し、mainDataはID単位で3-wayマージ、masterDataは競合時のみユーザーに選ばせて、
 * 相手の最新SHAに対して保存し直す。
 */
async function handleSaveConflict(token) {
    try {
        const { content: remoteContent, sha: remoteSha } = await fetchFile(token, OWNER, REPO, PATH);
        const { mainData: remoteMain, masterData: remoteMaster } = parseMarkdown(remoteContent);
        const { mainData: baseMain,   masterData: baseMaster }   = parseMarkdown(lastSyncedMarkdown);

        const { merged, conflicts } = mergeMainData(baseMain, currentMainData, remoteMain);
        currentMainData   = await resolveMergeConflicts(merged, conflicts, currentMainData, remoteMain, false);
        currentMasterData = resolveMasterData(baseMaster, currentMasterData, remoteMaster);
        invalidateTaskorg2HierarchyCache(); // currentMainDataを丸ごと差し替えたため親ID階層キャッシュも破棄する
        renderCategoryFilter();
        renderSummary();

        const mergedMarkdown = stringifyMarkdown(currentMainData, currentMasterData);
        const { newSha } = await saveFile(token, OWNER, REPO, PATH, mergedMarkdown, remoteSha);

        currentSha = newSha;
        lastSyncedMarkdown = mergedMarkdown;
        saveCache(mergedMarkdown, newSha);
        updateSyncBadge(mergedMarkdown);
        saveConflictPending = false; // 解決済み。自動保存の停止・バナー表示を解除する
        renderSyncConflictBanner();

        alert(conflicts.length > 0
            ? `他端末の更新をマージして保存しました（${conflicts.length}件の競合はご指定の内容で解決しました）。`
            : '他端末の更新を取り込んでマージし、保存しました。');
    } catch (error) {
        console.error(error);
        setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
        alert('他端末の更新との自動マージに失敗しました。変更は端末内に保存されています。時間をおいて再度「保存」を押してください。');
    }
}

/**
 * 現在のデータをGitHubへ保存する。直近の同期済み内容と変わっていなければ何もしない。
 * 他端末との更新競合（409）が起きた場合、手動保存（silent=false）なら自動マージして保存し直すが、
 * 自動保存（silent=true）の場合は自動マージせずsaveConflictPendingを立てて停止する
 * （画面を見ていない間に古いローカルデータで勝手にマージ・上書きされることを防ぐため。手動で「保存」を
 * 押すか、競合バナーの「今すぐ確認して保存」ボタンを押すまでは、自動保存はスキップされ続ける）。
 * (2) インプット: token (string), silent (boolean) - trueの場合、進捗表示・完了アラートを出さない（自動保存用）
 */
async function saveToGithub(token, silent = false) {
    if (silent && saveConflictPending) return; // 競合解決待ちの間は自動保存を行わない

    const newMarkdown = stringifyMarkdown(currentMainData, currentMasterData);

    if (newMarkdown === lastSyncedMarkdown) {
        return;
    }

    saveCache(newMarkdown, currentSha);

    try {
        const { newSha } = await saveFile(token, OWNER, REPO, PATH, newMarkdown, currentSha);
        currentSha = newSha;
        lastSyncedMarkdown = newMarkdown;
        saveCache(newMarkdown, newSha);
        updateSyncBadge(newMarkdown); // 保存直後は lastSyncedMarkdown と一致するため「オンライン（最新）」になる
        if (!silent) {
            alert('保存が成功しました！');
        }
    } catch (error) {
        console.error(error);

        if (error.status === 409) {
            if (silent) {
                saveConflictPending = true;
                renderSyncConflictBanner();
                setNetworkStatus('<span class="status-badge unsaved-badge">オフライン（他デバイスと競合中）</span>');
                return;
            }
            await handleSaveConflict(token);
            return;
        }

        setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
        if (!silent) {
            alert('現在通信ができません。変更はデバイス内に一時保存されました。電波の良い場所に移動してから、再度「保存」を押して同期してください。');
        }
    }
}

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getTokenValue();
        if (!token)      return alert('トークンを入力してください');
        if (!currentSha) return alert('先にデータを読み込んでください（またはオフラインキャッシュを読み込んでください）');
        persistCurrentToken();
        saveToGithub(token);
    });
});

document.getElementById('sync-conflict-resolve-btn')?.addEventListener('click', () => {
    const token = getTokenValue();
    if (!token)      return alert('トークンを入力してください');
    if (!currentSha) return alert('先にデータを読み込んでください（またはオフラインキャッシュを読み込んでください）');
    persistCurrentToken();
    saveToGithub(token); // silent=false固定。競合があれば必ずhandleSaveConflictを通り、結果をalertで知らせる
});

// ===== 自動保存（1分ごと。変更がある場合のみGitHubへ保存し、変更が無ければ何もしない。
//        他デバイスとの競合を検出中（saveConflictPending）は、解決されるまで自動保存をスキップする） =====
const AUTO_SAVE_INTERVAL_MS = 1 * 60 * 1000;
setInterval(() => {
    const token = getTokenValue();
    if (!token || !currentSha) return; // 未読み込み・未認証時は自動保存の対象外
    saveToGithub(token, true);
}, AUTO_SAVE_INTERVAL_MS);

// ===== Excelエクスポート =====
document.querySelectorAll('.js-excel-export-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        persistCurrentToken();
        if (currentMainData.length === 0 && currentMasterData.length === 0) {
            return alert('エクスポートするデータがありません。先にGitHubからデータを読み込んでください。');
        }
        exportToExcel(currentMainData, currentMasterData);
    });
});

// ===== Excelインポート =====
document.querySelectorAll('.js-excel-import').forEach(input => {
    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const token      = getTokenValue();
        persistCurrentToken();

        const { mainData, masterData } = await importFromExcel(file);
        currentMainData   = mainData;
        currentMasterData = masterData;
        invalidateTaskorg2HierarchyCache(); // currentMainDataを丸ごと差し替えたため親ID階層キャッシュも破棄する

        const newMarkdown = stringifyMarkdown(mainData, masterData);
        saveCache(newMarkdown, currentSha);
        e.target.value = ''; // 同一ファイルの再インポートを可能にするためリセット

        if (token && currentSha) {
            try {
                const { newSha } = await saveFile(token, OWNER, REPO, PATH, newMarkdown, currentSha);
                currentSha = newSha;
                lastSyncedMarkdown = newMarkdown;
                saveCache(newMarkdown, newSha);
                updateSyncBadge(newMarkdown); // 保存直後は lastSyncedMarkdown と一致するため「オンライン（最新）」になる
                alert('Excelのインポートとデータ保存が完了しました！');
            } catch (error) {
                console.error(error);
                setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
                alert('インポートデータを端末内に保存しました。「GitHubへ保存する」で同期してください。');
            }
        } else {
            setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
            alert('インポートデータを端末内に保存しました。GitHubへ同期するには、トークンを入力して読み込んでから再度インポートしてください。');
        }
    });
});

// ===== キャッシュ更新（デバイス等で古いコードが残る場合の強制リフレッシュ） =====

document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？（入力中の内容は失われます）')) return;
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
        } catch (error) {
            console.error(error);
        }
        // ページURLにキャッシュバスター用のクエリを付けて再読み込みし、HTML自体のキャッシュを回避する
        location.href = location.pathname + '?nocache=' + Date.now();
    });
});

// ===== クイック登録（旧INBOX。タスク管理タブ最上部） =====

document.querySelectorAll('.js-inbox-submit').forEach(btn => {
    btn.addEventListener('click', () => {
        const form     = btn.closest('.inbox-form');
        const textarea = form.querySelector('.js-inbox-content');
        const content  = textarea.value.trim();
        if (!content) { textarea.focus(); return; }

        // IDの自動採番: 既存の最大ID + 1（IDが未設定の場合は1から開始）
        const maxId = currentMainData.reduce((max, row) => {
            const id = parseInt(row['ID'], 10);
            return isNaN(id) ? max : Math.max(max, id);
        }, 0);

        // タイムスタンプ: YYYY/MM/DD HH:mm:ss
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts  = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} `
                  + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // 全カラムを空文字で初期化してから必要な値だけ設定する。通常のタスク（システム列は空）として、ステータス・優先度・日付などは空欄のまま登録し、
        // タスク管理タブの「属性未設定」一覧で後から整理する（2026-10-28にINBOX区分を廃止し、この方式に変更）
        const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
        entry['ID']        = String(maxId + 1);
        entry['タイトル']   = content.slice(0, 15);
        entry['内容']       = content;
        entry['作成日時']   = ts;
        entry['更新日時']   = ts;
        entry['カテゴリ']   = currentCategory === 'すべて' ? '' : currentCategory;

        currentMainData.push(entry);

        // LocalStorage に自動保存（GitHub push 前の安全網）
        persistLocalCache();

        document.querySelectorAll('.js-inbox-content').forEach(ta => { ta.value = ''; });
        textarea.focus();
        renderSummary(); // カテゴリバッジ等を再描画
    });
});

// ===== カテゴリフィルタ =====

/**
 * masterData の (M)カテゴリ 列から一意のカテゴリ一覧を取得し、
 * サイドバーにラジオボタンとして描画する。
 * データ未読み込み時は「すべて」のみ表示する。
 */
function renderCategoryFilter() {
    const containers = document.querySelectorAll('.js-category-list');
    if (containers.length === 0) return;

    // (M)カテゴリ列から重複なしで一覧を生成
    const categories = [...new Set(
        currentMasterData.map(r => r['(M)カテゴリ']).filter(Boolean)
    )];

    containers.forEach(container => {
        container.innerHTML = '';

        ['すべて', ...categories].forEach(cat => {
            const label = document.createElement('label');
            label.className = 'category-radio-label' + (cat === currentCategory ? ' active' : '');

            const input  = document.createElement('input');
            input.type   = 'radio';
            input.name   = `category-filter-${container.id}`;
            input.value  = cat;
            input.checked = (cat === currentCategory);

            input.addEventListener('change', () => {
                currentCategory = cat;
                renderCategoryFilter(); // 全コンテナの選択状態を再同期
                renderSummary();
            });

            label.append(input, document.createTextNode(cat));
            container.appendChild(label);
        });
    });
}

/**
 * 選択中のカテゴリでフィルタされたメインデータを返す。
 * 「すべて」選択時は全件返す。
 * @returns {Array}
 */
function getFilteredMainData() {
    return filterMainDataByCategory(currentMainData, currentCategory);
}

/** 指定タスクの補正込み累計時間（ms） */
function computeTotalDuration(taskId) {
    return computeTotalDurationM(currentMainData, taskId);
}

// ===== フィルタ・件数の共通ヘルパー =====

/** 通常のタスクで、指定フィールドが value と一致し、ステータスが完了・中断以外の件数を、カテゴリで絞り込んで返す。 */
function countActiveTasksByField(field, value) {
    return countActiveTasksByFieldM(currentMainData, currentCategory, field, value);
}

/** 通常のタスクで、指定フィールドが value と一致する件数を（ステータスを問わず）、カテゴリで絞り込んで返す。 */
function countTasksByField(field, value) {
    return countTasksByFieldM(currentMainData, currentCategory, field, value);
}

/** 選択肢を複数選択可能なチップ（チェックボックス）群として描画し、選択中はハイライトする。 */
function createCalendarMultiFilter(options, selectedSet, buildLabel, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'calendar-multi-filter';
    options.forEach(v => {
        const label = document.createElement('label');
        label.className = 'calendar-multi-filter-chip' + (selectedSet.has(v) ? ' calendar-multi-filter-chip--active' : '');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedSet.has(v);
        cb.addEventListener('change', () => {
            if (cb.checked) selectedSet.add(v); else selectedSet.delete(v);
            onChange();
        });

        label.append(cb, document.createTextNode(buildLabel(v)));
        wrap.appendChild(label);
    });
    return wrap;
}

/** options を件数（N）の多い順にソートして返す。 */
function sortByTotalCountDesc(options, field) {
    return sortByTotalCountDescM(options, currentMainData, currentCategory, field);
}

/** タスクのステータスマスタ値一覧（(M)ステータス）を返す。 */
function getFilteredTaskStatuses() {
    return [...new Set(
        currentMasterData.map(r => r['(M)ステータス']).filter(Boolean)
    )];
}

/** 初めて現れた選択肢をデフォルトでチェック済みにする（既知の選択肢はユーザーの選択状態を尊重して触らない）。 */
function seedFilterOptionSet(options, selectedSet, knownSet) {
    options.forEach(v => {
        if (knownSet.has(v)) return;
        knownSet.add(v);
        selectedSet.add(v);
    });
}

// ===== 親ID方式プロジェクト絞り込みの共通ヘルパー（新タスク整理・旧繰返しで共有） =====

/** set・value の単純一致判定（valueが空なら常に一致扱い）。ステータスの絞り込みに使う。 */
function matchesFilterValue(set, value) {
    return !value || set.has(value);
}

/** rows が属する、実際にプロジェクト（子を持つ最上位の親行）である最上位の親行一覧を返す（繰返しテンプレートは除く）。 */
function getProjectRootRows(rows) {
    const rootIds = new Set();
    rows.forEach(r => {
        const rootId = getRootParentIdFast(r['ID']);
        if (isParentRowFast(rootId)) rootIds.add(rootId);
    });
    return [...rootIds]
        .map(id => currentMainData.find(r => String(r['ID']) === id))
        .filter(Boolean)
        .filter(r => !isRecurringParentRow(r));
}

/** rows のうち、最上位の親IDが rootId と一致する件数を返す（activeOnly指定時は完了・中断を除く）。 */
function countRowsByProjectRoot(rows, rootId, activeOnly = false) {
    return rows.filter(r => {
        if (getRootParentIdFast(r['ID']) !== rootId) return false;
        if (activeOnly && (r['ステータス'] === '完了' || r['ステータス'] === '中断')) return false;
        return true;
    }).length;
}

/** row がプロジェクト（親ID方式）の絞り込みを満たすか判定する。プロジェクトに属さない単独行は常に素通しする。 */
function matchesProjectRootFilter(row, filterSet) {
    const rootId = getRootParentIdFast(row['ID']);
    const rootRow = currentMainData.find(r => String(r['ID']) === rootId);
    // 最上位が繰返しテンプレート（プロジェクトに属さない単独の繰返しタスク）の場合は、
    // プロジェクト一覧の選択肢に出てこないため、単独タスクと同様に常に通過させる。
    if (!isParentRowFast(rootId) || (rootRow && isRecurringParentRow(rootRow))) return true;
    return filterSet.has(rootId);
}

/**
 * row がプロジェクトのPJ(n層)ドリルダウン絞り込みを満たすか判定する。
 * drilldownPath が空なら常に通過。空でなければ、drilldownPath の末尾（最も深い階層で選択中のID）が
 * row自身、またはrowの親ID系列（ルート→row自身）に含まれる場合のみ通過させる（＝そのPJ配下の子孫タスクのみ表示）。
 */
function matchesProjectDrilldownFilter(row, drilldownPath) {
    if (drilldownPath.length === 0) return true;
    const targetId = drilldownPath[drilldownPath.length - 1];
    return buildProject2PathFromId(row['ID']).includes(targetId);
}

const RECURRING_WEEKBOARD_DAY_LABELS = ['月', '火', '水', '木', '金', '土', '日']; // 週間ボードの列順（月始まり）

/** 「開始予定」欄の時刻部分（HH:mm）を分単位に変換する。時刻未入力ならnull。 */
function extractRecurringStartMinutes(row) {
    // 日付付き（"2026/07/14 09:00"）・時刻のみ（"09:00"）のどちらでも拾えるよう、文字列中のHH:mmを直接探す
    const m = (row['開始予定'] || '').match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** 親タスク配列を開始予定の昇順（時刻未入力は後ろ）に並べ替えた配列を返す。 */
function sortRecurringParentsByStart(parents) {
    return [...parents].sort((a, b) => {
        const ta = extractRecurringStartMinutes(a);
        const tb = extractRecurringStartMinutes(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
    });
}

/** id要素（expander-count用span）に "N 件" 形式で件数を表示する。 */
function setExpanderCount(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${count} 件`;
}

/** id要素（expander-count用span）に "N件 / N件" 形式で2つの件数を表示する。 */
function setExpanderCountPair(id, countA, countB) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${countA} 件 / ${countB} 件`;
}

/** 時・分の2つの<input type="number">から "HH:mm" 文字列を組み立てる（いずれか未入力なら空文字）。 */
function readCalendarTime(hourId, minuteId) {
    const hour   = document.getElementById(hourId).value;
    const minute = document.getElementById(minuteId).value;
    if (hour === '' || minute === '') return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(hour)}:${pad(minute)}`;
}

// ---- タスク編集フォーム（各画面の prefix-* 入力欄）共通ヘルパー ----
// 各タスク編集パネルは、id接頭辞（prefix）が異なるだけで日時フィールド・頻度チップ等の構造が同一のため、
// prefixを引数に取る共通関数へ集約する。

/** "YYYY/MM/DD[ HH:mm]" または日付なしの "HH:mm" のみの文字列を { date, time } に分解する。 */
function splitDateAndTime(str) {
    const value = str || '';
    const withDate = value.match(/^(\d{4}\/\d{1,2}\/\d{1,2})(?:\s+(\d{1,2}:\d{2}))?$/);
    if (withDate) return { date: withDate[1], time: withDate[2] || '' };
    const timeOnly = value.match(/^(\d{1,2}:\d{2})$/);
    if (timeOnly) return { date: '', time: timeOnly[1] };
    return { date: '', time: '' };
}

/** row の開始予定・終了予定・完了日を、prefix-start-date/hour/minute 等のフォーム欄に分解して反映する。 */
function writeTaskDateTimeFieldsToForm(prefix, row) {
    const start = splitDateAndTime(row['開始予定']);
    const end   = splitDateAndTime(row['終了予定']);
    const [startHour, startMinute] = (start.time || '').split(':');
    const [endHour,   endMinute]   = (end.time   || '').split(':');
    document.getElementById(`${prefix}-start-date`).value   = start.date ? start.date.replace(/\//g, '-') : '';
    document.getElementById(`${prefix}-start-hour`).value   = startHour   || '';
    document.getElementById(`${prefix}-start-minute`).value = startMinute || '';
    document.getElementById(`${prefix}-end-date`).value     = end.date ? end.date.replace(/\//g, '-') : '';
    document.getElementById(`${prefix}-end-hour`).value     = endHour     || '';
    document.getElementById(`${prefix}-end-minute`).value   = endMinute   || '';
    document.getElementById(`${prefix}-complete-date`).value = (row['完了日'] || '').replace(/\//g, '-');
}

/** 日付・時刻を組み合わせて保存用文字列にする。日付が無くても時刻だけは失わずに残す（繰返し親タスクなど日付を持たない行向け）。 */
function combineDateAndTime(dateVal, timeVal) {
    const datePart = dateVal ? dateVal.replace(/-/g, '/') : '';
    if (datePart && timeVal) return `${datePart} ${timeVal}`;
    return datePart || timeVal;
}

/** prefix-start-date/hour/minute 等のフォーム欄から開始予定・終了予定・完了日を読み取り、保存用文字列にまとめて返す。 */
function readTaskDateTimeFieldsFromForm(prefix) {
    const startDate = document.getElementById(`${prefix}-start-date`).value;
    const startTime = readCalendarTime(`${prefix}-start-hour`, `${prefix}-start-minute`);
    const endDate    = document.getElementById(`${prefix}-end-date`).value;
    const endTime    = readCalendarTime(`${prefix}-end-hour`, `${prefix}-end-minute`);
    return {
        開始予定: combineDateAndTime(startDate, startTime),
        終了予定: combineDateAndTime(endDate, endTime),
        完了日:   document.getElementById(`${prefix}-complete-date`).value.replace(/-/g, '/'),
    };
}

/**
 * 実績時間を分単位で返す。「実績時間」列に手入力値（h）があればそれを分に換算し、
 * 無ければタイマーの累計（区間ごとの補正込み）から直接分単位で算出する
 * （computeActualHoursの0.1h＝6分刻みの丸めを経由すると短時間の実績が0分に潰れてしまうため、分表示専用に独立して計算する）。
 */
function computeActualMinutes(row) {
    const manual = parseFloat(row['実績時間'] || '');
    if (!isNaN(manual) && manual > 0) return Math.round(manual * 60);
    const ms = computeTimerTotalMs(row);
    return ms > 0 ? Math.round(ms / 60000) : 0;
}

/**
 * row の見積時間・実績時間（実績は編集不可）をフォームへ反映する。
 * unit が 'minutes' の場合、実績時間は分単位で表示する（タスク整理・繰り返し編集用）。省略時は時間単位（プロジェクト編集用）。
 */
function writeTaskEstimateActualToForm(prefix, row, unit = 'hours') {
    const estimateEl = document.getElementById(`${prefix}-estimate`);
    if (estimateEl) estimateEl.value = row['見積時間'] ?? '';
    const actualEl = document.getElementById(`${prefix}-actual`);
    if (actualEl) actualEl.value = String(unit === 'minutes' ? computeActualMinutes(row) : computeActualHours(row));
}

/** prefix-freq-month/day/weekday の頻度チップを freqState に基づいて描画する（選択変更時は自身を再描画）。各項目に全て選択／全て解除ボタンを併設する。 */
function renderFreqChipsFor(prefix, freqState) {
    const monthOptions   = RECURRING_FREQ_OPTIONS['月'];
    const dayOptions     = RECURRING_FREQ_OPTIONS['日'];
    const weekdayOptions = RECURRING_FREQ_OPTIONS['曜日'];

    const rerender = () => renderFreqChipsFor(prefix, freqState);

    function buildFreqControl(containerId, options, selectedSet) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button';
        selectAllBtn.className = 'calendar-filter-bulk-btn';
        selectAllBtn.textContent = '全て選択';
        selectAllBtn.addEventListener('click', () => { options.forEach(v => selectedSet.add(v)); rerender(); });

        const deselectAllBtn = document.createElement('button');
        deselectAllBtn.type = 'button';
        deselectAllBtn.className = 'calendar-filter-bulk-btn';
        deselectAllBtn.textContent = '全て解除';
        deselectAllBtn.addEventListener('click', () => { selectedSet.clear(); rerender(); });

        const chips = createCalendarMultiFilter(options, selectedSet, v => v, rerender);
        el.replaceChildren(selectAllBtn, deselectAllBtn, chips);
    }

    buildFreqControl(`${prefix}-freq-month`,   monthOptions,   freqState.month);
    buildFreqControl(`${prefix}-freq-day`,     dayOptions,     freqState.day);
    buildFreqControl(`${prefix}-freq-weekday`, weekdayOptions, freqState.weekday);
}

/** row の繰返し頻度（システム列の「繰返し頻度」の月／日／曜日）を freqState（{month,day,weekday}のSet集合）へ読み込む。 */
function loadFreqStateFromRow(freqState, row) {
    freqState.month.clear();   getRecurringFrequencyList(row, '月').forEach(v => freqState.month.add(v));
    freqState.day.clear();     getRecurringFrequencyList(row, '日').forEach(v => freqState.day.add(v));
    freqState.weekday.clear(); getRecurringFrequencyList(row, '曜日').forEach(v => freqState.weekday.add(v));
}


// ===== 日付ずらしヘルパー =====

/** "YYYY/MM/DD HH:mm" のような日時文字列の日付部分だけを days 日分ずらして返す（時刻部分は保持）。パース不可なら元の文字列のまま返す。 */
function shiftSlashDateTimeString(str, days) {
    const [datePart, timePart] = (str || '').split(' ');
    const d = parseSlashDateOnly(datePart);
    if (!d) return str;
    d.setDate(d.getDate() + days);
    const shifted = formatSlashDateOnly(d);
    return timePart ? `${shifted} ${timePart}` : shifted;
}

// ===== 勤務カレンダーのデータ（画面はjs/views/workCalendar.js） =====

/** 指定年の勤務カレンダーエントリをメインデータから返す。存在しなければ undefined。 */
function findWorkCalendarEntry(year) {
    return currentMainData.find(r =>
        getRowKind(r) === KIND_WORK_CALENDAR && r['タイトル'] === `${year}休日`
    );
}

/** 指定年の内容テキストを返す（エントリ未作成時は空文字）。 */
function getWorkCalendarContent(year) {
    return findWorkCalendarEntry(year)?.['内容'] ?? '';
}

/** 指定年のエントリの内容テキストを更新し LocalStorage へキャッシュする。エントリが無ければ新規作成する。 */
function saveWorkCalendarContent(year, contentText) {
    const ts    = formatJpDatetime(new Date());
    let   entry = findWorkCalendarEntry(year);
    if (!entry) {
        const maxId = currentMainData.reduce((max, row) => {
            const id = parseInt(row['ID'], 10);
            return isNaN(id) ? max : Math.max(max, id);
        }, 0);
        entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(c => [c, '']));
        entry['ID']        = String(maxId + 1);
        entry['システム']   = { '種別': KIND_WORK_CALENDAR };
        entry['タイトル']   = `${year}休日`;
        entry['作成日時']   = ts;
        currentMainData.push(entry);
    }
    entry['内容']     = contentText;
    entry['更新日時'] = ts;
    persistLocalCache();
}

const workCalendarView = createWorkCalendarView({
    getWorkCalendarContent,
    saveWorkCalendarContent,
    onSaved: () => { if (taskorg2View === 'calendar') renderTaskorg2CalendarGrid(); },
});
function renderWorkCalendar() { workCalendarView.render(); }

// ===========================================================================
// タスク管理タブ（親ID方式）
// プロジェクトという特別な区分は無く、他行から親IDとして参照されている行が
// 実質的にプロジェクト（親）として扱われる。
// ===========================================================================

// ===== 選択肢・親（プロジェクト）の階層プルダウン =====

/** prefix-status／priority／category の select 選択肢を再構築する（新方式にはプロジェクトselectが無いため対象外）。 */
function populateTaskEditSelects2(prefix) {
    const statuses = [...new Set(
        currentMasterData.map(r => r['(M)ステータス']).filter(Boolean)
    )];
    rebuildSelectById(`${prefix}-status`,   statuses);
    rebuildSelectById(`${prefix}-priority`, [...new Set(currentMasterData.map(r => r['(M)優先度']).filter(Boolean))]);
    rebuildSelectById(`${prefix}-category`, [...new Set(currentMasterData.map(r => r['(M)カテゴリ']).filter(Boolean))]);
}

/**
 * 親（プロジェクト）階層プルダウン用に、excludeId自身とその子孫を除いた「親になれる（通常のタスク）」行一覧を返す（新タスク整理の編集フォームで使用）。
 * 繰返しテンプレート（繰返し親タスク）も候補に含める。手動で選んでも実行タスク生成時と同じ親子関係になるだけで支障は無いため。
 */
function getParentEligibleRows(excludeId) {
    let excludedIds = new Set();
    if (excludeId) {
        excludedIds.add(String(excludeId));
        let frontier = [String(excludeId)];
        while (frontier.length > 0) {
            const next = currentMainData
                .filter(r => frontier.includes(String(r['親ID'] || '')))
                .map(r => String(r['ID']))
                .filter(id => !excludedIds.has(id));
            next.forEach(id => excludedIds.add(id));
            frontier = next;
        }
    }
    return filterMainDataByCategory(currentMainData, currentCategory)
        .filter(r => !excludedIds.has(String(r['ID'])))
        .filter(r => isNormalTaskRow(r));
}

const NEW_PJ_MARK = '__new_pj__'; // 親プルダウンの「＋ 新規PJを追加」選択肢の特殊値

/**
 * 親（プロジェクト）階層プルダウンで「＋ 新規PJを追加」を選んだ際、その場で新規プロジェクト（タスク）を作成しIDを返す。
 * ステータス=進行中、優先度・開始予定・終了予定・完了日は空欄とする（優先度は高・低だけを付ける運用。2026-10-30）。タイトル未入力（キャンセル含む）ならnullを返す。
 * @param {string} parentId - 新規プロジェクトの親ID（空文字ならルート＝最上位プロジェクトとして作成）
 */
function createNewProjectViaPrompt(parentId) {
    const title = (prompt('新しいプロジェクト（PJ）のタイトルを入力してください') || '').trim();
    if (!title) return null;

    const maxId = currentMainData.reduce((max, row) => {
        const id = parseInt(row['ID'], 10);
        return isNaN(id) ? max : Math.max(max, id);
    }, 0);
    const ts = formatJpDatetime(new Date());

    const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
    entry['ID']        = String(maxId + 1);
    entry['タイトル']   = title;
    entry['ステータス'] = '進行中';
    entry['カテゴリ']   = currentCategory === 'すべて' ? '' : currentCategory;
    entry['親ID']       = parentId || '';
    entry['作成日時']   = ts;
    entry['更新日時']   = ts;

    currentMainData.push(entry);
    persistLocalCache();

    return entry['ID'];
}

/**
 * 「新タスク整理」編集フォームの親（プロジェクト）階層プルダウン（PJ(1層)〜必要な階層数だけ）を描画する。
 * 階層1は既存の最上位プロジェクトのみ、階層2以降は直前に選択した行の子（通常のタスク）を選択肢とする。
 * どの階層にも「＋ 新規PJを追加」を用意し、選ぶとその階層でその場に新規プロジェクトを作成して選択状態にする。
 * 何かが選択されている限り次の階層のプルダウンを（既存の子が無くても）表示し、任意の深さまで追加できるようにする。
 * 選択のたびに dayedit2ParentPath を再構築し、最終選択値を dayedit2-parent-id（hidden）へ反映する。
 */
function renderDayedit2ParentDropdowns() {
    const container = document.getElementById('dayedit2-parent-dropdowns');
    if (!container) return;
    container.innerHTML = '';

    const eligibleRows = getParentEligibleRows(selectedTaskorg2Id);
    const newPjExtraOption = [{ value: NEW_PJ_MARK, label: '＋ 新規PJを追加' }];

    let level = 0;
    let parentId = ''; // 空文字ならこのレベルはルート階層（親ID空欄）の選択肢を出す
    for (;;) {
        let options = level === 0
            ? eligibleRows.filter(r => !r['親ID'] && (isParentRowFast(r['ID']) || String(r['ID']) === dayedit2ParentPath[0]))
            : getChildrenM(eligibleRows, parentId);

        const currentValue = dayedit2ParentPath[level] || '';

        // 繰返しテンプレートは通常の親候補（eligibleRows）から除外されているため、実行タスクが
        // テンプレートを親IDに持つ場合はそのままだとこの階層の選択肢に出てこない。新規に他タスクの
        // 親として選べるようにするためではなく、既存の関係を正しく表示するために、現在の選択値が
        // テンプレートの時だけこの階層の選択肢に補って表示する。
        if (currentValue && !options.some(r => String(r['ID']) === currentValue)) {
            const currentRow = currentMainData.find(r => String(r['ID']) === currentValue);
            if (currentRow && String(currentRow['親ID'] || '') === parentId) {
                options = [...options, currentRow];
            }
        }
        const levelForClosure = level;
        const parentIdForClosure = parentId;
        appendProject2DropdownRow(container, `PJ(${level + 1}層)`, decorateProjectDropdownOptions(options), currentValue, value => {
            if (value === NEW_PJ_MARK) {
                const newId = createNewProjectViaPrompt(parentIdForClosure);
                if (newId) dayedit2ParentPath = [...dayedit2ParentPath.slice(0, levelForClosure), newId];
                renderDayedit2ParentDropdowns();
                return;
            }
            dayedit2ParentPath = value ? buildProject2PathFromId(value) : dayedit2ParentPath.slice(0, levelForClosure);
            renderDayedit2ParentDropdowns();
        }, newPjExtraOption);

        if (!currentValue) break; // このレベルで何も選ばれていなければ、これ以上下の階層は出さない
        parentId = currentValue;
        level++;
    }

    const hiddenEl = document.getElementById('dayedit2-parent-id');
    if (hiddenEl) hiddenEl.value = dayedit2ParentPath[dayedit2ParentPath.length - 1] || '';
}

/** 指定行の親IDに newParentId を設定しようとした際に循環参照になる場合、確認アラートを出して false を返す。 */
function checkParentCycleOrAlert(childId, newParentId) {
    if (!newParentId) return true;
    const parentRow = currentMainData.find(r => String(r['ID']) === String(newParentId));
    // 繰返しテンプレート自身は通常の親候補選択UIには出さないが（getParentEligibleRows）、
    // 実行タスク生成（recurring.js の buildChild）が正規に割り当てる親IDのため、保存時の検証では許可する。
    if (!parentRow || (!isNormalTaskRow(parentRow) && !isRecurringParentRow(parentRow))) {
        alert('親（プロジェクト）に設定できるのはタスクのみです。');
        return false;
    }
    if (wouldCreateCycleM(currentMainData, childId, newParentId)) {
        alert('この親を設定すると循環参照になるため、保存できません。');
        return false;
    }
    return true;
}

// ===== タスク管理タブのフィルタ判定・母集団 =====

/** 選択中カテゴリのメインデータのうち、実際にプロジェクト（子を持つ最上位の親行）に属するものを対象に、最上位の親行一覧を返す。 */
function getTaskorg2ProjectRootRows() {
    return getProjectRootRows(filterMainDataByCategory(currentMainData, currentCategory));
}

/** rootId を最上位の親に持つ通常のタスクの件数（activeOnly指定時は完了・中断を除く）を、選択中カテゴリで絞り込んで返す。 */
function countTaskorg2ProjectTasks(rootId, activeOnly) {
    const pool = filterMainDataByCategory(currentMainData, currentCategory).filter(r => isNormalTaskRow(r));
    return countRowsByProjectRoot(pool, rootId, activeOnly);
}

/** ステータス／プロジェクト（親ID・ドリルダウン）／繰返し親子タスク表示ON/OFFのtaskorg2フィルタ条件をrowが満たすか判定する（1日タスク除外は含まない）。 */
function matchesTaskorg2CommonFilters(r) {
    if (!matchesFilterValue(taskorg2Filters.status, r['ステータス'])) return false;
    if (!matchesProjectRootFilter(r, taskorg2Filters.project)) return false;
    if (!matchesProjectDrilldownFilter(r, taskorg2ProjectDrilldownPath)) return false;

    if (isRecurringParentRow(r) && !taskorg2Filters.showRecurringParent) return false;
    if (isRecurringChildRow(currentMainData, r) && !taskorg2Filters.showRecurringChild) return false;
    // 繰返しテンプレートは専用のshowRecurringParentで制御するため、showProjectの対象からは除く
    if (!taskorg2Filters.showProject && !isRecurringParentRow(r) && isParentRowFast(r['ID'])) return false;
    return true;
}

/** 選択中カテゴリ・ステータスフィルタ＋その他フィルタ（プロジェクト・繰返し親子タスクの表示ON/OFF）で絞り込んだメインデータ一覧を返す（日付絞り込みは含まない）。カレンダーの日別集計に使う。 */
function getTaskorg2BaseFilteredList() {
    return filterMainDataByCategory(currentMainData, currentCategory).filter(r => {
        if (isDayPlanRow(r)) return false; // 1日タスク（DAYPLAN）の器行は通常の一覧・カレンダーには出さない
        return matchesTaskorg2CommonFilters(r);
    });
}

/**
 * 選択中カテゴリ・ステータス／プロジェクト（最上位の親ID）フィルタ＋その他フィルタで絞り込んだ、通常のタスクの行一覧を返す（日付を問わず全件、旧タスク整理と同一仕様）。
 * 通常のタスク（isNormalTaskRow）のみを対象とするため、1日タスク（DAYPLAN）の器行は含まれない。
 * ソート順: ステータス（完了・連絡待ち・中断・進行中・未着手・空欄の順）→ 完了日 昇順 → 開始予定 昇順 → 終了予定 昇順。
 */
function matchesTaskorg2ListFilters(r) {
    if (!matchesFilterValue(taskorg2Filters.status, r['ステータス'])) return false;
    if (!matchesProjectRootFilter(r, taskorg2Filters.project)) return false;
    if (!matchesProjectDrilldownFilter(r, taskorg2ProjectDrilldownPath)) return false;

    if (isRecurringParentRow(r) && !taskorg2Filters.showRecurringParent) return false;
    if (isRecurringChildRow(currentMainData, r) && !taskorg2Filters.showRecurringChild) return false;

    if (taskorg2ProjectDrilldownPath.length > 0) {
        // PJ(n層)を選択中は、選択階層を親IDとする直接の子タスクのみ表示する（孫以降は非表示）
        const targetId = taskorg2ProjectDrilldownPath[taskorg2ProjectDrilldownPath.length - 1];
        if (String(r['親ID'] || '') !== targetId) return false;
    }
    // showProjectがOFFならプロジェクト行（さらに子を持つ親行）を除外し、最下層タスクのみ表示（ドリルダウン選択中も同様に適用）
    if (!taskorg2Filters.showProject && !isRecurringParentRow(r) && isParentRowFast(r['ID'])) return false;
    return true;
}

/** 選択中カテゴリ・ステータス／プロジェクト（最上位の親ID）フィルタ＋その他フィルタで絞り込んだ、通常のタスクの行一覧を返す（日付を問わず全件、旧タスク整理と同一仕様）。
 * PJ(n層)ドリルダウン選択中は、選択階層の直接の子タスクのみに絞り込む（孫は非表示）。
 */
function getTaskorg2FilteredList() {
    const tasks = filterMainDataByCategory(currentMainData, currentCategory)
        .filter(r => isNormalTaskRow(r) && matchesTaskorg2ListFilters(r));

    tasks.sort((a, b) => {
        const rankDiff = calendarTaskListStatusRank(a['ステータス']) - calendarTaskListStatusRank(b['ステータス']);
        if (rankDiff !== 0) return rankDiff;

        let cmp = compareDateAscEmptyLast(a['完了日'], b['完了日']);
        if (cmp !== 0) return cmp;

        cmp = compareDateAscEmptyLast(a['開始予定'], b['開始予定']);
        if (cmp !== 0) return cmp;

        return compareDateAscEmptyLast(a['終了予定'], b['終了予定']);
    });

    return tasks;
}

// ===== 月間カレンダー・月送り・ビュー切り替え =====

/** dateJP にカレンダーの●印が出る（＝その日にマークされる）taskorg2の行一覧を、プロジェクト／ステータスフィルタ適用済みで返す。 */
function getTaskorg2TasksForDate(dateJP) {
    const todayJP = jpDateOnly(formatJpDatetime(new Date()));
    return getTaskorg2BaseFilteredList().filter(r => getCalendarMarkDate(r, todayJP) === dateJP);
}

/**
 * dateJP→該当taskorg2行一覧 のMapを1回のフィルタ走査だけで作る。
 * 月カレンダーは日セルごとにgetTaskorg2TasksForDateを呼ぶと、フィルタ済み一覧をセル数（最大31回）分
 * 再計算してしまい重いため、月グリッド描画側ではこちらを使って1回の走査結果を使い回す。
 */
function groupTaskorg2TasksByMarkDate() {
    const todayJP = jpDateOnly(formatJpDatetime(new Date()));
    const map = new Map();
    getTaskorg2BaseFilteredList().forEach(r => {
        const dateJP = getCalendarMarkDate(r, todayJP);
        if (!dateJP) return;
        if (!map.has(dateJP)) map.set(dateJP, []);
        map.get(dateJP).push(r);
    });
    return map;
}

/** 現在の taskorg2CalendarYear／taskorg2CalendarMonth に基づいて新タスク整理の月間カレンダーを描画する。日クリックでその日の一覧絞り込みを切り替える。 */
function renderTaskorg2CalendarGrid() {
    const label = document.getElementById('calendar2-month-label');
    if (label) label.textContent = `${taskorg2CalendarYear}年${taskorg2CalendarMonth + 1}月`;

    const grid = document.getElementById('calendar2-grid');
    if (!grid) return;
    grid.innerHTML = '';

    ['日', '月', '火', '水', '木', '金', '土'].forEach(d => {
        const head = document.createElement('div');
        head.className = 'calendar-day-head';
        head.textContent = d;
        grid.appendChild(head);
    });

    const todayJP        = jpDateOnly(formatJpDatetime(new Date()));
    const startWeekday   = new Date(taskorg2CalendarYear, taskorg2CalendarMonth, 1).getDay();
    const daysInMonth    = new Date(taskorg2CalendarYear, taskorg2CalendarMonth + 1, 0).getDate();
    const pad            = n => String(n).padStart(2, '0');

    for (let i = 0; i < startWeekday; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day calendar-day--empty';
        grid.appendChild(cell);
    }

    const workExceptions = parseExceptions(getWorkCalendarContent(taskorg2CalendarYear));
    const tasksByDate = groupTaskorg2TasksByMarkDate(); // 日セルごとの再フィルタを避けるため、1回の走査結果を使い回す

    for (let d = 1; d <= daysInMonth; d++) {
        const dateJP = `${taskorg2CalendarYear}/${pad(taskorg2CalendarMonth + 1)}/${pad(d)}`;
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        if (dateJP === todayJP)              cell.classList.add('calendar-day--today');
        if (dateJP === selectedTaskorg2Date) cell.classList.add('calendar-day--selected');

        const workType = workExceptions.get(dateJP)?.type
            ?? getDefaultType(new Date(taskorg2CalendarYear, taskorg2CalendarMonth, d));
        if (workType !== '出勤日') cell.classList.add(`calendar-day--work-${workType}`);

        const num = document.createElement('div');
        num.className = 'calendar-day-num';
        num.textContent = String(d);
        cell.appendChild(num);

        const dayTasks = tasksByDate.get(dateJP) || [];
        if (dayTasks.length > 0) {
            const hasRemaining = dayTasks.some(r => !isTaskDoneForCalendar(r));
            const badge = document.createElement('span');
            badge.className = `calendar-day-badge ${hasRemaining ? 'calendar-day-badge--red' : 'calendar-day-badge--green'}`;
            badge.textContent = '●';
            badge.title = `${dayTasks.length} 件の予定`;
            cell.appendChild(badge);
        }

        cell.addEventListener('click', () => {
            selectedTaskorg2Date = dateJP;
            selectedTaskorg2Id   = null;
            taskorg2QuickNewMode = false;
            renderTaskorg2DateChange();
        });
        grid.appendChild(cell);
    }
}

/** taskorg2CalendarYear／Month に依存する、現在表示中のビューだけを再描画する（カレンダー／ガント）。 */
function refreshTaskorg2MonthDependentView() {
    if (taskorg2View === 'calendar') renderTaskorg2CalendarGrid();
    else if (taskorg2View === 'gantt') renderTaskorg2GanttChart();
}
function goToPrevMonthTaskorg2() {
    taskorg2CalendarMonth--;
    if (taskorg2CalendarMonth < 0) { taskorg2CalendarMonth = 11; taskorg2CalendarYear--; }
    refreshTaskorg2MonthDependentView();
}
function goToNextMonthTaskorg2() {
    taskorg2CalendarMonth++;
    if (taskorg2CalendarMonth > 11) { taskorg2CalendarMonth = 0; taskorg2CalendarYear++; }
    refreshTaskorg2MonthDependentView();
}
document.getElementById('calendar2-prev-btn')?.addEventListener('click', goToPrevMonthTaskorg2);
document.getElementById('calendar2-next-btn')?.addEventListener('click', goToNextMonthTaskorg2);
document.getElementById('calendar2-gantt-prev-btn')?.addEventListener('click', goToPrevMonthTaskorg2);
document.getElementById('calendar2-gantt-next-btn')?.addEventListener('click', goToNextMonthTaskorg2);

/** 新タスク整理の「カレンダー」「ガントチャート」「勤務歴」「プロジェクト」「報告」「AI確認」表示切り替えボタンの状態・表示パネルを反映する。 */
function renderTaskorg2ViewToggle() {
    document.getElementById('taskorg2-tab-calendar')?.classList.toggle('taskorg-view-btn--active', taskorg2View === 'calendar');
    document.getElementById('taskorg2-tab-gantt')?.classList.toggle('taskorg-view-btn--active', taskorg2View === 'gantt');
    document.getElementById('taskorg2-tab-workcal')?.classList.toggle('taskorg-view-btn--active', taskorg2View === 'workcal');
    document.getElementById('taskorg2-tab-project')?.classList.toggle('taskorg-view-btn--active', taskorg2View === 'project');
    document.getElementById('taskorg2-tab-report')?.classList.toggle('taskorg-view-btn--active', taskorg2View === 'report');
    document.getElementById('taskorg2-tab-aireview')?.classList.toggle('taskorg-view-btn--active', taskorg2View === 'aireview');
    const calEl       = document.getElementById('taskorg2-view-calendar');
    const ganttEl     = document.getElementById('taskorg2-view-gantt');
    const workcalEl   = document.getElementById('taskorg2-view-workcal');
    const projectEl   = document.getElementById('taskorg2-view-project');
    const reportEl    = document.getElementById('taskorg2-view-report');
    const aiReviewEl  = document.getElementById('taskorg2-view-aireview');
    if (calEl)       calEl.style.display       = taskorg2View === 'calendar'  ? '' : 'none';
    if (ganttEl)     ganttEl.style.display     = taskorg2View === 'gantt'     ? '' : 'none';
    if (workcalEl)   workcalEl.style.display   = taskorg2View === 'workcal'   ? '' : 'none';
    if (projectEl)   projectEl.style.display   = taskorg2View === 'project'   ? '' : 'none';
    if (reportEl)    reportEl.style.display    = taskorg2View === 'report'    ? '' : 'none';
    if (aiReviewEl)  aiReviewEl.style.display  = taskorg2View === 'aireview'  ? '' : 'none';
}

document.getElementById('taskorg2-tab-calendar')?.addEventListener('click', () => { taskorg2View = 'calendar'; renderCalendar2(); });
document.getElementById('taskorg2-tab-gantt')?.addEventListener('click', () => { taskorg2View = 'gantt'; renderCalendar2(); });
document.getElementById('taskorg2-tab-workcal')?.addEventListener('click', () => { taskorg2View = 'workcal'; renderCalendar2(); });
document.getElementById('taskorg2-tab-project')?.addEventListener('click', () => { taskorg2View = 'project'; renderCalendar2(); });
document.getElementById('taskorg2-tab-report')?.addEventListener('click', () => { taskorg2View = 'report'; renderCalendar2(); });
document.getElementById('taskorg2-tab-aireview')?.addEventListener('click', () => { taskorg2View = 'aireview'; renderCalendar2(); });

// ===== ガントチャート（画面はjs/views/gantt.js） =====

/** カテゴリ・taskorg2Filters（ステータス／その他フィルタ）で絞り込んだタスク一覧を返す。1日タスクは除外し、日付未設定の行も除外する。 */
function getTaskorg2GanttTasks() {
    return getTaskorg2BaseFilteredList().filter(r => isNormalTaskRow(r) && (r['開始予定'] || r['終了予定']));
}

const ganttView = createGanttView({
    getTasks: getTaskorg2GanttTasks,
    getMonth: () => ({ year: taskorg2CalendarYear, month: taskorg2CalendarMonth }),
    getSelectedDate: () => selectedTaskorg2Date,
    onSelectDate: date => { selectedTaskorg2Date = date; renderTaskorg2DateChange(); },
    getWorkCalendarContent,
    isChipSelected: isTaskorg2ChipSelected,
    selectTask: selectTaskorg2TaskFromView,
    jpDateOnly,
});
function renderTaskorg2GanttChart() { ganttView.render(); }
function renderTaskorg2GanttUnitToggle() { ganttView.renderUnitToggle(); }

// ===== プロジェクトツリー（画面はjs/views/projectTree.js） =====

/**
 * 「プロジェクト」ツリービューの対象母集団を返す。カレンダー・ガントチャートと同じ taskorg2Filters
 * （ステータス／プロジェクト／PJ(n層)ドリルダウン／繰返し親子タスク表示ON/OFF）を適用したうえで、
 * 通常のタスク（isNormalTaskRow）に絞り込む（1日タスクは常に除外）。
 * ただし「その他フィルタ」の“プロジェクト”表示チェック（showProject）だけは適用しない。
 * プロジェクトタブはツリー構造そのものを見せる画面のため、他画面向けの「親（プロジェクト）行を隠す」
 * トグルがOFF（既定）だと階層の頂点が軒並み消えて何も表示されなくなってしまうため。
 */
function getTaskorg2ProjectTreePool() {
    return filterMainDataByCategory(currentMainData, currentCategory).filter(r => {
        if (isDayPlanRow(r)) return false;
        if (!isNormalTaskRow(r)) return false;
        if (!matchesFilterValue(taskorg2Filters.status, r['ステータス'])) return false;
        if (!matchesProjectRootFilter(r, taskorg2Filters.project)) return false;
        if (!matchesProjectDrilldownFilter(r, taskorg2ProjectDrilldownPath)) return false;
        if (isRecurringParentRow(r) && !taskorg2Filters.showRecurringParent) return false;
        if (isRecurringChildRow(currentMainData, r) && !taskorg2Filters.showRecurringChild) return false;
        return true;
    });
}

/** ビュー（AI確認・プロジェクトツリーなど）の行クリックで、タスクを単独選択して編集フォームに読み込む。 */
function selectTaskorg2TaskFromView(id) {
    clearAllTaskorg2BulkSelections(); // チップの選択とチェックボックスの複数選択は同時に使わない（チップを選んだらチェックは外す）
    selectedTaskorg2Id = id;
    taskorg2QuickNewMode = false;
    renderTaskorg2TaskChange();
}

const projectTreeView = createProjectTreeView({
    getPool: getTaskorg2ProjectTreePool,
    getMainData: () => currentMainData,
    getSelectedIds: () => selectedTaskorg2ProjectTreeIds, // 宣言がこれより後ろにあるため、取得関数で渡す
    pruneSelection: pruneTaskorg2Selection,
    onCheckboxChange: onTaskorg2BulkCheckboxChange,
    isChipSelected: isTaskorg2ChipSelected,
    appendChipLabel,
    selectTask: selectTaskorg2TaskFromView,
});
function renderTaskorg2ProjectTree() { projectTreeView.render(); }

// ===== AI確認（画面はjs/views/aiReview.js） =====

const aiReviewView = createAiReviewView({
    getMainData: () => currentMainData,
    persistLocalCache,
    buildProjectPathFromId: buildProject2PathFromId,
    isChipSelected: isTaskorg2ChipSelected,
    appendChipLabel,
    selectTask: selectTaskorg2TaskFromView,
    jpDateOnly,
});
function renderAiReviewTab() { aiReviewView.render(); }

// ===== 新タスク整理：報告（テーマ × 報告先のマトリクス。2026-10-14に再設計） =====
// 報告先＝構造行（1件）、テーマ＝テーマ行、成果＝エントリ行（システム列のテーマID・報告状態=報告先ごとの状態）、
// 報告先ごとの日付と下書き＝タイミング行。データ構造の詳細は js/modules/report.js 冒頭を参照。

let reportSelectedVenueId    = null;  // 報告タブ：準備画面を開いている報告先ID（sN）
const reportChosenOccasionIds = new Map(); // 報告タブ：報告先ID → 日付チップで選んだタイミング行ID（端末内の一時状態。保存しない）
let reportOnlyUnfinished     = false; // 報告タブ：成果一覧を「予定・見送りが残るもの」だけに絞る
let reportEditingEntryId     = null;  // 報告タブ：成果一覧でインライン編集中のエントリID
const reportCollapsedThemeIds = new Set(); // 報告タブ：成果一覧で折りたたみ中のテーマID（テーマ未設定グループは''）
const REPORT_LAST_THEME_KEY = 'brain_report_last_theme';

function reportTodayJP() { return jpDateOnly(formatJpDatetime(new Date())); }

/** "yyyy/mm/dd" を "M/D" 表記にする。パース不可なら空文字。 */
function reportShortDate(dateJP) {
    const m = /^\d{4}\/(\d{1,2})\/(\d{1,2})/.exec(dateJP || '');
    return m ? `${+m[1]}/${+m[2]}` : '';
}

function reportEntryShortText(row, maxLen = 30) {
    const t = (row['内容'] || row['タイトル'] || '（無題）').replace(/\s+/g, ' ');
    return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
}

function loadReportLastThemeId() {
    try { return localStorage.getItem(REPORT_LAST_THEME_KEY) || ''; } catch (_) { return ''; }
}
function saveReportLastThemeId(id) {
    try { localStorage.setItem(REPORT_LAST_THEME_KEY, id); } catch (_) { /* 保存できなくても動作に影響しない */ }
}

/**
 * 報告先の「対象の回」（タイミング行）を返す。表の状態セルで「済」にするときの日付と、報告準備の画面の両方がこれを使う。
 * 決め方：日付チップで選んだ回 → 次回（今日以降で最も近い回） → 直近の過去の回。回が1つも無ければnull。
 */
function getReportTargetOccasion(venueId, today) {
    const occasions = getReportOccasionsForVenue(currentMainData, venueId);
    const chosenId = reportChosenOccasionIds.get(venueId);
    return occasions.find(o => String(o['ID']) === chosenId)
        || getNextReportOccasion(currentMainData, venueId, today)
        || occasions[0] || null;
}

/** 報告構造行（システム列 { 種別: '報告', 報告区分: '構造' }）を返す。存在しなければ空のものを新規作成してcurrentMainDataに追加する。 */
function getOrCreateReportStructureRow() {
    let row = currentMainData.find(isReportStructureRow);
    if (row) return row;
    row = createReportRow(currentMainData, MAIN_DATA_COLUMNS, formatJpDatetime(new Date()),
        REPORT_PARA_STRUCTURE, { 'タイトル': '報告構造' });
    currentMainData.push(row);
    return row;
}

/** 報告先（マトリクスの列）を { id, label }[] で返す。 */
function getReportVenues() {
    const row = getOrCreateReportStructureRow();
    return flattenReportTree(parseReportStructure(row['内容']));
}

function createReportThemeRow(name) {
    const row = createReportRow(currentMainData, MAIN_DATA_COLUMNS, formatJpDatetime(new Date()),
        REPORT_PARA_THEME, { 'タイトル': name });
    currentMainData.push(row);
    persistLocalCache();
    return row;
}

/** エントリの報告先ごとの状態を書き換える（state が空文字なら対象外に戻す）。保存（persistLocalCache）は呼び出し側で行う。 */
function setReportEntryState(entry, venueId, state, date) {
    const states = parseReportStates(getReportField(entry, REPORT_KEY_STATES));
    if (state) states.set(venueId, { state, date: state === REPORT_STATE_DONE ? date : '' });
    else states.delete(venueId);
    setReportField(entry, REPORT_KEY_STATES, stringifyReportStates(states));
    entry['更新日時'] = formatJpDatetime(new Date());
}

/** 指定報告先で指定状態のエントリを、作成日時の古い順で返す。 */
function getReportEntriesByVenueState(venueId, state) {
    return currentMainData.filter(isReportEntryRow)
        .filter(r => parseReportStates(getReportField(r, REPORT_KEY_STATES)).get(venueId)?.state === state)
        .sort((a, b) => (a['作成日時'] || '').localeCompare(b['作成日時'] || ''));
}

/** 報告タブ全体を再描画する。taskorg2View==='report'の時だけ呼ばれる想定。 */
function renderReportTab() {
    renderReportQuickCapture();
    renderReportMatrix();
    renderReportVenuePanel();
    renderReportSettings();
}

// ----- クイック追記 -----

function renderReportQuickCapture() {
    const sel = document.getElementById('report-quick-capture-theme');
    if (!sel) return;
    const themes = getReportThemes(currentMainData);
    let chosen = (sel.value && sel.value !== '__new__') ? sel.value : loadReportLastThemeId();
    if (!themes.some(t => String(t['ID']) === chosen)) chosen = themes.length > 0 ? String(themes[0]['ID']) : '';

    sel.innerHTML = '';
    themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = String(t['ID']);
        opt.textContent = t['タイトル'] || '（無題）';
        sel.appendChild(opt);
    });
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '＋ 新しいテーマを作成…';
    sel.appendChild(newOpt);
    sel.value = chosen || '__new__';
    updateReportQuickCaptureHint();
}

function updateReportQuickCaptureHint() {
    const sel    = document.getElementById('report-quick-capture-theme');
    const hintEl = document.getElementById('report-quick-capture-hint');
    if (!sel || !hintEl) return;
    const theme = currentMainData.find(r => isReportThemeRow(r) && String(r['ID']) === sel.value);
    if (!theme) { hintEl.textContent = 'テーマを選ぶか、新しく作成してください'; return; }
    const venues = getReportVenues();
    const labels = splitReportIds(getReportField(theme, REPORT_KEY_VENUES)).map(id => venues.find(v => v.id === id)?.label).filter(Boolean);
    hintEl.textContent = labels.length > 0
        ? `追記すると「${labels.join('、')}」の報告が自動で「予定」になります`
        : '既定の報告先が未設定です（「報告先・テーマの設定」で選ぶと、追記時に自動で「予定」になります）';
}

document.getElementById('report-quick-capture-theme')?.addEventListener('change', (e) => {
    const sel = e.target;
    if (sel.value === '__new__') {
        const name = (prompt('新しいテーマの名称を入力してください') || '').trim();
        if (name) saveReportLastThemeId(String(createReportThemeRow(name)['ID']));
        renderReportTab();
        return;
    }
    saveReportLastThemeId(sel.value);
    updateReportQuickCaptureHint();
});

function addReportQuickCaptureEntry() {
    const textEl = document.getElementById('report-quick-capture-text');
    const sel    = document.getElementById('report-quick-capture-theme');
    const text = (textEl?.value || '').trim();
    if (!text) return;
    const theme = currentMainData.find(r => isReportThemeRow(r) && String(r['ID']) === sel?.value);
    if (!theme) { alert('テーマを選択してください'); return; }

    const venueIds = new Set(getReportVenues().map(v => v.id));
    const states = new Map();
    splitReportIds(getReportField(theme, REPORT_KEY_VENUES)).filter(id => venueIds.has(id))
        .forEach(id => states.set(id, { state: REPORT_STATE_PLANNED, date: '' }));

    const entry = createReportRow(currentMainData, MAIN_DATA_COLUMNS, formatJpDatetime(new Date()), REPORT_PARA_ENTRY, {
        'タイトル': text.slice(0, 20),
        '内容':     text,
    }, {
        [REPORT_KEY_THEME]:  String(theme['ID']),
        [REPORT_KEY_STATES]: stringifyReportStates(states),
    });
    currentMainData.push(entry);
    persistLocalCache();

    textEl.value = '';
    renderReportMatrix();
    renderReportVenuePanel();
}
document.getElementById('report-quick-capture-add-btn')?.addEventListener('click', addReportQuickCaptureEntry);
document.getElementById('report-quick-capture-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addReportQuickCaptureEntry(); }
});

// ----- 成果一覧（テーマ × 報告先のマトリクス） -----

document.getElementById('report-only-unfinished')?.addEventListener('change', (e) => {
    reportOnlyUnfinished = e.target.checked;
    renderReportMatrix();
});

function renderReportMatrix() {
    const wrap = document.getElementById('report-matrix-wrapper');
    if (!wrap) return;
    const scrollTop = wrap.scrollTop, scrollLeft = wrap.scrollLeft;
    wrap.innerHTML = '';

    const venues = getReportVenues();
    if (venues.length === 0) {
        wrap.innerHTML = '<p class="calendar-empty-text">「報告先・テーマの設定」で報告先（会議・月報など）を登録してください</p>';
        return;
    }
    const themes  = getReportThemes(currentMainData);
    const entries = currentMainData.filter(isReportEntryRow);
    const today   = reportTodayJP();
    const targetByVenue = new Map(); // 報告先ID → 対象の回（見出しの描画時に決める）

    const table = document.createElement('table');
    table.className = 'report-matrix';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thText = document.createElement('th');
    thText.className = 'report-col-text';
    thText.textContent = '成果';
    headRow.appendChild(thText);
    venues.forEach(v => {
        const th = document.createElement('th');
        th.className = 'report-col-venue';
        if (v.id === reportSelectedVenueId) th.classList.add('report-col-venue--active');
        const next   = getNextReportOccasion(currentMainData, v.id, today);
        const target = getReportTargetOccasion(v.id, today);
        targetByVenue.set(v.id, target);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'report-venue-head-btn';
        const nameEl = document.createElement('span');
        nameEl.textContent = v.label;
        const dateEl = document.createElement('span');
        dateEl.className = 'report-venue-head-date';
        if (!target) dateEl.textContent = '日程未定';
        else if (target === next) dateEl.textContent = `次回 ${reportShortDate(target['開始予定'])}`;
        else if (reportChosenOccasionIds.has(v.id)) {
            dateEl.textContent = `${reportShortDate(target['開始予定'])}の回`;
            dateEl.classList.add('report-venue-head-date--chosen');
        } else dateEl.textContent = `前回 ${reportShortDate(target['開始予定'])}`;
        btn.append(nameEl, dateEl);
        btn.addEventListener('click', () => {
            reportSelectedVenueId = v.id;
            renderReportMatrix();
            renderReportVenuePanel();
            document.getElementById('report-venue-section')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        th.appendChild(btn);
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const themeIdSet = new Set(themes.map(t => String(t['ID'])));
    const groups = themes.map(t => ({ id: String(t['ID']), name: t['タイトル'] || '（無題）', orphan: false }));
    if (entries.some(e => !themeIdSet.has(getReportEntryThemeId(e)))) {
        groups.push({ id: '', name: '（テーマ未設定）', orphan: true });
    }

    let shownGroups = 0;
    groups.forEach(g => {
        const all = entries.filter(e => g.orphan
            ? !themeIdSet.has(getReportEntryThemeId(e))
            : getReportEntryThemeId(e) === g.id);
        const items = (reportOnlyUnfinished ? all.filter(hasUnfinishedReportState) : all)
            .sort((a, b) => (b['作成日時'] || '').localeCompare(a['作成日時'] || ''));
        if (reportOnlyUnfinished && items.length === 0) return;
        shownGroups++;

        const collapsed = reportCollapsedThemeIds.has(g.id);
        const headTr = document.createElement('tr');
        headTr.className = 'report-theme-header-row';
        const headTd = document.createElement('td');
        headTd.colSpan = venues.length + 1;
        headTd.textContent = `${collapsed ? '▶' : '▼'} ${g.name}（${items.length}件）`;
        headTd.addEventListener('click', () => {
            if (collapsed) reportCollapsedThemeIds.delete(g.id); else reportCollapsedThemeIds.add(g.id);
            renderReportMatrix();
        });
        headTr.appendChild(headTd);
        tbody.appendChild(headTr);

        if (!collapsed) items.forEach(e => tbody.appendChild(buildReportEntryRow(e, venues, themes, targetByVenue)));
    });
    if (shownGroups === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = venues.length + 1;
        td.className = 'calendar-empty-text';
        td.textContent = themes.length === 0 && entries.length === 0
            ? '上の「クイック追記」から、テーマを作って最初の成果を記録してください'
            : '該当する成果はありません';
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    wrap.scrollTop = scrollTop;
    wrap.scrollLeft = scrollLeft;
}

/** マトリクスの成果1行（本文＋報告先ごとの状態セル）を組み立てる。targetByVenue：報告先ID → 対象の回（タイミング行またはnull）。 */
function buildReportEntryRow(entry, venues, themes, targetByVenue) {
    const entryId = String(entry['ID']);
    const tr = document.createElement('tr');
    const tdText = document.createElement('td');
    tdText.className = 'report-col-text';

    if (entryId === reportEditingEntryId) {
        const textarea = document.createElement('textarea');
        textarea.className = 'calendar-dayplan-textarea';
        textarea.rows = 3;
        textarea.value = entry['内容'] || '';
        tdText.appendChild(textarea);

        const themeSel = document.createElement('select');
        const currentTheme = getReportEntryThemeId(entry);
        if (!themes.some(t => String(t['ID']) === currentTheme)) {
            const opt = document.createElement('option');
            opt.value = currentTheme;
            opt.textContent = '（テーマ未設定）';
            themeSel.appendChild(opt);
        }
        themes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = String(t['ID']);
            opt.textContent = t['タイトル'] || '（無題）';
            themeSel.appendChild(opt);
        });
        themeSel.value = currentTheme;
        tdText.appendChild(themeSel);

        const actions = document.createElement('div');
        actions.className = 'report-entry-edit-actions';
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'calendar-add-btn';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', () => {
            const text = textarea.value.trim();
            if (!text) { alert('成果の内容を入力してください（削除する場合は「削除」を押してください）'); return; }
            entry['内容']     = text;
            entry['タイトル'] = text.slice(0, 20);
            setReportField(entry, REPORT_KEY_THEME, themeSel.value);
            entry['更新日時'] = formatJpDatetime(new Date());
            persistLocalCache();
            reportEditingEntryId = null;
            renderReportMatrix();
            renderReportVenuePanel();
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'calendar-filter-bulk-btn';
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.addEventListener('click', () => { reportEditingEntryId = null; renderReportMatrix(); });
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'calendar-danger-btn';
        deleteBtn.textContent = '削除';
        deleteBtn.addEventListener('click', () => {
            if (!confirm(`「${reportEntryShortText(entry)}」を削除します。よろしいですか？（この操作は取り消せません）`)) return;
            currentMainData = currentMainData.filter(r => r !== entry);
            persistLocalCache();
            reportEditingEntryId = null;
            renderReportMatrix();
            renderReportVenuePanel();
        });
        actions.append(saveBtn, cancelBtn, deleteBtn);
        tdText.appendChild(actions);
    } else {
        const span = document.createElement('span');
        span.className = 'report-entry-text';
        span.textContent = entry['内容'] || entry['タイトル'] || '（無題）';
        span.title = 'クリックで編集';
        span.addEventListener('click', () => { reportEditingEntryId = entryId; renderReportMatrix(); });
        tdText.appendChild(span);
    }
    tr.appendChild(tdText);

    const states = parseReportStates(getReportField(entry, REPORT_KEY_STATES));
    venues.forEach(v => {
        const td = document.createElement('td');
        td.className = 'report-col-venue';
        const cur = states.get(v.id);
        const state = cur ? cur.state : '';
        const target = targetByVenue.get(v.id) || null;
        const targetDate = target ? (target['開始予定'] || '') : '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'report-state-btn';
        if (state === REPORT_STATE_PLANNED) { btn.classList.add('report-state--planned'); btn.textContent = '予定'; }
        else if (state === REPORT_STATE_DONE) {
            btn.classList.add('report-state--done');
            btn.textContent = `✓ ${reportShortDate(cur.date) || '済'}`;
            btn.title = `報告済み ${cur.date || ''}`;
            if (cur.date !== targetDate) btn.classList.add('report-state--done-other'); // 対象の回とは別の回で報告済み
        }
        else if (state === REPORT_STATE_SKIPPED) { btn.classList.add('report-state--skipped'); btn.textContent = '見送り'; }
        else { btn.classList.add('report-state--empty'); btn.textContent = '・'; }
        btn.addEventListener('click', () => {
            let nextState = nextReportState(state);
            if (nextState === REPORT_STATE_DONE && !targetDate) {
                // 「済」の日付には対象の回の日付を入れるため、回が無い報告先では「済」を飛ばす
                alert(`「${v.label}」の日付がまだありません。報告済みにするには、報告準備で日付を登録してください`);
                nextState = nextReportState(nextState);
            }
            setReportEntryState(entry, v.id, nextState, targetDate);
            persistLocalCache();
            renderReportMatrix();
            renderReportVenuePanel();
        });
        td.appendChild(btn);
        tr.appendChild(td);
    });
    return tr;
}

// ----- 報告先ごとの準備画面（日付・予定の成果・下書き） -----

/** 報告準備の画面で開いている報告先の、対象の回（getReportTargetOccasion）を返す。 */
function getSelectedReportOccasion() {
    return reportSelectedVenueId ? getReportTargetOccasion(reportSelectedVenueId, reportTodayJP()) : null;
}

function renderReportVenuePanel() {
    const section = document.getElementById('report-venue-section');
    if (!section) return;
    const venue = getReportVenues().find(v => v.id === reportSelectedVenueId);
    if (!venue) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById('report-venue-title').textContent = `${venue.label} の報告準備`;

    const today = reportTodayJP();
    const occasions = getReportOccasionsForVenue(currentMainData, venue.id);
    const next = getNextReportOccasion(currentMainData, venue.id, today);
    const occasion = getSelectedReportOccasion();

    const dateInput = document.getElementById('report-occasion-new-date');
    if (dateInput && !dateInput.value) dateInput.value = today.replace(/\//g, '-');

    const occListEl = document.getElementById('report-occasion-list');
    occListEl.innerHTML = '';
    if (occasions.length === 0) {
        occListEl.innerHTML = '<p class="calendar-empty-text">日付がまだありません。「＋ 日付を追加」で登録してください</p>';
    }
    occasions.forEach(o => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'report-occasion-chip';
        if (o === occasion) chip.classList.add('report-occasion-chip--active');
        chip.textContent = `${o['開始予定'] || '（日付なし）'}${next && o === next ? '（次回）' : ''}`;
        chip.addEventListener('click', () => {
            reportChosenOccasionIds.set(venue.id, String(o['ID'])); // 上の表の列もこの回を基準に表示する
            renderReportMatrix();
            renderReportVenuePanel();
        });
        occListEl.appendChild(chip);
    });

    const doneDate = occasion ? (occasion['開始予定'] || today) : today;
    const themes = getReportThemes(currentMainData);
    const themeName = (entry) => themes.find(t => String(t['ID']) === getReportEntryThemeId(entry))?.['タイトル'] || '（テーマ未設定）';

    const planned = getReportEntriesByVenueState(venue.id, REPORT_STATE_PLANNED);
    const plannedEl = document.getElementById('report-planned-list');
    plannedEl.innerHTML = '';
    if (planned.length === 0) plannedEl.innerHTML = '<p class="calendar-empty-text">予定の成果はありません</p>';
    planned.forEach(entry => {
        const line = document.createElement('div');
        line.className = 'report-pool-row';
        const tag = document.createElement('span');
        tag.className = 'report-theme-tag';
        tag.textContent = themeName(entry);
        const text = document.createElement('span');
        text.className = 'report-pool-row-title';
        text.textContent = reportEntryShortText(entry, 80);
        text.title = entry['内容'] || '';
        const actions = document.createElement('span');
        actions.className = 'report-pool-row-actions';
        [
            ['済', REPORT_STATE_DONE, `${doneDate} 付けで報告済みにします`],
            ['見送り', REPORT_STATE_SKIPPED, ''],
            ['予定を外す', '', ''],
        ].forEach(([label, state, tip]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'calendar-filter-bulk-btn';
            b.textContent = label;
            if (tip) b.title = tip;
            b.addEventListener('click', () => {
                setReportEntryState(entry, venue.id, state, doneDate);
                persistLocalCache();
                renderReportMatrix();
                renderReportVenuePanel();
            });
            actions.appendChild(b);
        });
        line.append(tag, text, actions);
        plannedEl.appendChild(line);
    });
    document.getElementById('report-bulk-done-btn').disabled = planned.length === 0;

    const detailEl = document.getElementById('report-occasion-detail');
    if (!occasion) { detailEl.style.display = 'none'; return; }
    detailEl.style.display = '';
    document.getElementById('report-occasion-detail-title').textContent = `${occasion['開始予定'] || ''} の報告`;
    const draftEl = document.getElementById('report-detail-draft');
    if (document.activeElement !== draftEl) draftEl.value = occasion['内容'] || '';

    const reportedEl = document.getElementById('report-reported-list');
    reportedEl.innerHTML = '';
    const reported = currentMainData.filter(isReportEntryRow).filter(r => {
        const st = parseReportStates(getReportField(r, REPORT_KEY_STATES)).get(venue.id);
        return st && st.state === REPORT_STATE_DONE && st.date === occasion['開始予定'];
    });
    if (reported.length === 0) reportedEl.innerHTML = '<p class="calendar-empty-text">まだありません</p>';
    reported.forEach(entry => {
        const chip = document.createElement('span');
        chip.className = 'calendar-unscheduled-chip calendar-unscheduled-chip--solo';
        chip.style.background = '#28a745';
        chip.textContent = `${themeName(entry)}：${reportEntryShortText(entry, 20)}`;
        chip.title = entry['内容'] || '';
        reportedEl.appendChild(chip);
    });
}

document.getElementById('report-occasion-add-btn')?.addEventListener('click', () => {
    const venue = getReportVenues().find(v => v.id === reportSelectedVenueId);
    if (!venue) return;
    const dateInput = document.getElementById('report-occasion-new-date');
    const dateJP = dateInput?.value ? isoToJP(dateInput.value) : reportTodayJP();
    const occasion = createReportRow(currentMainData, MAIN_DATA_COLUMNS, formatJpDatetime(new Date()), REPORT_PARA_OCCASION, {
        '開始予定': dateJP,
        'タイトル': `報告 ${venue.label} ${dateJP}`,
    }, { [REPORT_KEY_VENUES]: venue.id });
    currentMainData.push(occasion);
    persistLocalCache();
    reportChosenOccasionIds.set(venue.id, String(occasion['ID']));
    renderReportMatrix();
    renderReportVenuePanel();
});

function saveReportDraft() {
    const occasion = getSelectedReportOccasion();
    if (!occasion) return;
    occasion['内容']     = document.getElementById('report-detail-draft').value;
    occasion['更新日時'] = formatJpDatetime(new Date());
    persistLocalCache();
}

document.getElementById('report-detail-save-btn')?.addEventListener('click', () => {
    saveReportDraft();
    renderReportVenuePanel();
});

document.getElementById('report-draft-generate-btn')?.addEventListener('click', () => {
    if (!getSelectedReportOccasion()) return;
    const draft = buildReportDraft(currentMainData, reportSelectedVenueId);
    if (!draft) { alert('予定の成果がありません'); return; }
    const draftEl = document.getElementById('report-detail-draft');
    if (draftEl.value.trim() && !confirm('現在の下書きを、予定の成果から作った内容で置き換えます。よろしいですか？')) return;
    draftEl.value = draft;
    saveReportDraft();
    renderReportVenuePanel();
});

document.getElementById('report-bulk-done-btn')?.addEventListener('click', () => {
    const venueId = reportSelectedVenueId;
    const planned = getReportEntriesByVenueState(venueId, REPORT_STATE_PLANNED);
    if (planned.length === 0) return;
    const occasion = getSelectedReportOccasion();
    const doneDate = occasion ? (occasion['開始予定'] || reportTodayJP()) : reportTodayJP();
    if (!confirm(`予定の成果 ${planned.length} 件を、${doneDate} 付けで報告済みにします。よろしいですか？`)) return;

    if (occasion && !(occasion['内容'] || '').trim()) {
        occasion['内容']     = buildReportDraft(currentMainData, venueId);
        occasion['更新日時'] = formatJpDatetime(new Date());
    }
    planned.forEach(entry => setReportEntryState(entry, venueId, REPORT_STATE_DONE, doneDate));
    persistLocalCache();
    renderReportMatrix();
    renderReportVenuePanel();
});

document.getElementById('report-occasion-delete-btn')?.addEventListener('click', () => {
    const occasion = getSelectedReportOccasion();
    if (!occasion) return;
    if (!confirm(`「${occasion['開始予定'] || occasion['タイトル']}」を削除します。報告済みの記録（成果側の日付）は残ります。よろしいですか？`)) return;
    currentMainData = currentMainData.filter(r => r !== occasion);
    reportChosenOccasionIds.delete(reportSelectedVenueId);
    persistLocalCache();
    renderReportMatrix();
    renderReportVenuePanel();
});

// ----- 設定（報告先・テーマ） -----

function renderReportSettings() {
    const editor = document.getElementById('report-venue-editor-text');
    if (editor && document.activeElement !== editor) {
        editor.value = getOrCreateReportStructureRow()['内容'] || '';
    }

    const listEl = document.getElementById('report-theme-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const venues  = getReportVenues();
    const themes  = getReportThemes(currentMainData);
    const entries = currentMainData.filter(isReportEntryRow);
    if (themes.length === 0) listEl.innerHTML = '<p class="calendar-empty-text">テーマがまだありません</p>';

    themes.forEach(theme => {
        const themeId = String(theme['ID']);
        const box = document.createElement('div');
        box.className = 'report-theme-item';

        const head = document.createElement('div');
        head.className = 'report-theme-item-head';
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'report-theme-name-btn';
        nameBtn.textContent = theme['タイトル'] || '（無題）';
        nameBtn.title = 'クリックで名称変更';
        nameBtn.addEventListener('click', () => {
            const name = (prompt('新しい名称を入力してください', theme['タイトル'] || '') || '').trim();
            if (!name) return;
            theme['タイトル'] = name;
            theme['更新日時'] = formatJpDatetime(new Date());
            persistLocalCache();
            renderReportTab();
        });
        const count = entries.filter(e => getReportEntryThemeId(e) === themeId).length;
        const countEl = document.createElement('span');
        countEl.className = 'report-theme-count';
        countEl.textContent = `${count}件`;
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'calendar-danger-btn';
        delBtn.textContent = '削除';
        delBtn.addEventListener('click', () => {
            const msg = count > 0
                ? `テーマ「${theme['タイトル']}」と、配下の成果 ${count} 件を削除します。よろしいですか？（この操作は取り消せません）`
                : `テーマ「${theme['タイトル']}」を削除します。よろしいですか？`;
            if (!confirm(msg)) return;
            currentMainData = currentMainData.filter(r => r !== theme && !(isReportEntryRow(r) && getReportEntryThemeId(r) === themeId));
            persistLocalCache();
            renderReportTab();
        });
        head.append(nameBtn, countEl, delBtn);
        box.appendChild(head);

        const defaults = new Set(splitReportIds(getReportField(theme, REPORT_KEY_VENUES)));
        const checks = document.createElement('div');
        checks.className = 'report-tag-checkboxes';
        const caption = document.createElement('span');
        caption.className = 'calendar-dayplan-hint';
        caption.textContent = '既定の報告先：';
        checks.appendChild(caption);
        venues.forEach(v => {
            const label = document.createElement('label');
            label.className = 'report-tag-checkbox';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = defaults.has(v.id);
            cb.addEventListener('change', () => {
                if (cb.checked) defaults.add(v.id); else defaults.delete(v.id);
                setReportField(theme, REPORT_KEY_VENUES, venues.map(x => x.id).filter(id => defaults.has(id)).join(','));
                theme['更新日時'] = formatJpDatetime(new Date());
                persistLocalCache();
                updateReportQuickCaptureHint();
            });
            label.append(cb, document.createTextNode(v.label));
            checks.appendChild(label);
        });
        box.appendChild(checks);
        listEl.appendChild(box);
    });
}

document.getElementById('report-theme-add-btn')?.addEventListener('click', () => {
    const name = (prompt('テーマの名称を入力してください') || '').trim();
    if (!name) return;
    createReportThemeRow(name);
    renderReportTab();
});

document.getElementById('report-venue-editor-save-btn')?.addEventListener('click', () => {
    const editor = document.getElementById('report-venue-editor-text');
    const tree = assignReportNodeIds(parseReportStructure(editor.value));
    const newIds = new Set(flattenReportTree(tree).map(n => n.id));
    const removed = getReportVenues().filter(v => !newIds.has(v.id));
    if (removed.length > 0) {
        const removedIds = new Set(removed.map(v => v.id));
        const occCount = currentMainData.filter(r => isReportOccasionRow(r) && removedIds.has(getReportField(r, REPORT_KEY_VENUES))).length;
        const msg = `報告先「${removed.map(v => v.label).join('、')}」を削除します。紐づく日付 ${occCount} 件と、成果に記録された状態も削除されます。よろしいですか？（この操作は取り消せません）`;
        if (!confirm(msg)) return;
        currentMainData = currentMainData.filter(r => !(isReportOccasionRow(r) && removedIds.has(getReportField(r, REPORT_KEY_VENUES))));
        currentMainData.filter(isReportEntryRow).forEach(entry => {
            const states = parseReportStates(getReportField(entry, REPORT_KEY_STATES));
            removedIds.forEach(id => states.delete(id));
            setReportField(entry, REPORT_KEY_STATES, stringifyReportStates(states));
        });
        removedIds.forEach(id => reportChosenOccasionIds.delete(id));
        if (removedIds.has(reportSelectedVenueId)) reportSelectedVenueId = null;
    }
    const row = getOrCreateReportStructureRow();
    row['内容']     = stringifyReportStructure(tree);
    row['更新日時'] = formatJpDatetime(new Date());
    persistLocalCache();
    editor.blur();
    renderReportTab();
});

// ===== チップの共通部品 =====

/** バッジ（チップ）の左端に付ける優先度ドット（高=赤／低=緑）を1件分組み立てる。それ以外の値・未設定ならnull。 */
function createPriorityDot(row) {
    const cls = getPriorityDotClass(row['優先度']);
    if (!cls) return null;
    const dot = document.createElement('span');
    dot.className = `calendar-priority-dot ${cls}`;
    dot.setAttribute('aria-hidden', 'true');
    return dot;
}

/** チップのバッジ本体に、優先度ドット（あれば）＋タイトルのテキストノードを組み立てて追加する。 */
function appendChipLabel(chip, row, text) {
    const dot = createPriorityDot(row);
    if (dot) chip.appendChild(dot);
    chip.appendChild(document.createTextNode(text));
}

// ===== 新タスク整理：日別タイムライン＋1日タスク（DAYPLAN、旧タスク整理と同じデータ・同じ仕様） =====

/**
 * dateJP のtaskorg2行を「時間帯が決まっているもの（timed）」と「時間帯未定（unscheduled、今回は未表示）」に分ける。
 * 1日タスク（DAYPLAN）のブロックで参照済みの行は通常枠から除外し、DAYPLANブロック自身（リンク先タスクの有無を問わず）を timed に追加する（旧タスク整理と同一仕様）。
 * timed の各要素は { row, startMin, endMin, isDayPlanBlock?, dayPlanBlockIndex? }（分単位、0〜1440）。
 */
function getTaskorg2SegmentsForDate(dateJP) {
    const dayPlanTask   = getDayPlanTaskM(currentMainData, dateJP);
    const dayPlanBlocks = dayPlanTask ? parseDayPlanContent(dayPlanTask['内容']) : [];
    const referencedIds = new Set(dayPlanBlocks.map(b => b.refId).filter(Boolean));

    const timed = [];
    const unscheduled = [];
    const referenced = [];

    getTaskorg2TasksForDate(dateJP).forEach(row => {
        if (referencedIds.has(String(row['ID']))) { referenced.push(row); return; } // 1日タスクのブロックとして別途表示するため通常枠には出さない

        const startInfo = extractTimeOnDate(row['開始予定'], dateJP);
        const endInfo   = extractTimeOnDate(row['終了予定'], dateJP);
        const hasStartTime = !!(startInfo && startInfo.hasTime);
        const hasEndTime   = !!(endInfo && endInfo.hasTime);

        if (!hasStartTime && !hasEndTime) { unscheduled.push(row); return; }

        let startMin = hasStartTime ? startInfo.minutes : endInfo.minutes - 30;
        let endMin   = hasEndTime   ? endInfo.minutes   : startInfo.minutes + 30;
        if (endMin <= startMin) endMin = startMin + 30;
        startMin = Math.max(0, Math.min(1439, startMin));
        endMin   = Math.max(startMin + 15, Math.min(1440, endMin));

        timed.push({ row, startMin, endMin });
    });

    dayPlanBlocks.forEach((b, dayPlanBlockIndex) => {
        const linkedRow = b.refId ? currentMainData.find(r => String(r['ID']) === b.refId) : null;
        timed.push({
            row: linkedRow || { ID: null, タイトル: b.label || '（ラベルなし）', ステータス: null },
            startMin: b.startMin,
            endMin: b.endMin,
            isDayPlanBlock: true,
            dayPlanBlockIndex,
            column: b.column
        });
    });

    return { timed, unscheduled, referenced };
}

const CALENDAR_HOUR_HEIGHT = 40; // 1時間あたりの高さ(px)

/** 1日の時間軸（0:00〜24:00の目盛り）と選択中日付のタスクの時間帯ブロックを描画する。選択中日付が無ければセクション自体を隠す。 */
function renderTaskorg2Timeline() {
    const titleEl = document.getElementById('calendar2-detail-title');
    if (titleEl) titleEl.textContent = selectedTaskorg2Date || '';
    if (!selectedTaskorg2Date) return;

    const hoursEl = document.getElementById('calendar2-timeline-hours');
    const lanesEl = document.getElementById('calendar2-timeline-lanes');
    if (!hoursEl || !lanesEl) return;

    const totalHeight = CALENDAR_HOUR_HEIGHT * 24;
    hoursEl.style.height = `${totalHeight}px`;
    lanesEl.style.height = `${totalHeight}px`;

    hoursEl.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        const row = document.createElement('div');
        row.className = 'calendar-hour-row';
        row.style.height = `${CALENDAR_HOUR_HEIGHT}px`;
        row.textContent = `${String(h).padStart(2, '0')}:00`;
        hoursEl.appendChild(row);
    }

    lanesEl.innerHTML = '';
    const dateJP = selectedTaskorg2Date;
    const { timed } = getTaskorg2SegmentsForDate(dateJP);
    assignCalendarColumns(timed);

    const pxPerMin = CALENDAR_HOUR_HEIGHT / 60;

    for (let m = 0; m < 1440; m += 15) {
        const minuteOfHour = m % 60;
        const variant = minuteOfHour === 0 ? 'hour' : minuteOfHour === 30 ? 'half' : 'quarter';
        const line = document.createElement('div');
        line.className = `calendar-timeline-gridline calendar-timeline-gridline--${variant}`;
        line.style.top = `${m * pxPerMin}px`;
        lanesEl.appendChild(line);
    }

    // 固定4列（列1=決まっている予定／列2〜4=空き時間消化）の区切りを縦の点線で明示する
    for (let i = 1; i < DAYPLAN_COLUMN_COUNT; i++) {
        const divider = document.createElement('div');
        divider.className = 'calendar-timeline-column-divider';
        divider.style.left = `${(100 / DAYPLAN_COLUMN_COUNT) * i}%`;
        lanesEl.appendChild(divider);
    }

    const blockBySeg = new Map();

    timed.forEach(seg => {
        const laneWidthPct = 100 / seg.laneCount;
        const block = document.createElement('div');
        const hasLinkedTask = seg.row['ID'] != null;
        block.className = `calendar-time-block ${hasLinkedTask ? getCalendarStatusClass(seg.row['ステータス']) : 'calendar-time-block--dayplan'}`;
        if (hasLinkedTask && isTaskorg2ChipSelected(String(seg.row['ID']))) block.classList.add('calendar-time-block--selected');
        block.style.top    = `${seg.startMin * pxPerMin}px`;
        block.style.height = `${(seg.endMin - seg.startMin) * pxPerMin}px`;
        block.style.left   = `${seg.lane * laneWidthPct}%`;
        block.style.width  = `calc(${laneWidthPct}% - 4px)`;

        const labelSpan = document.createElement('span');
        labelSpan.textContent = seg.row['タイトル'] || '（無題）';
        block.appendChild(labelSpan);

        const handle = document.createElement('div');
        handle.className = 'calendar-time-block-resize-handle';
        block.appendChild(handle);

        blockBySeg.set(seg, block);
        attachTaskorg2TimelineDragHandlers(block, handle, labelSpan, seg, dateJP, pxPerMin, hasLinkedTask);
        lanesEl.appendChild(block);
    });

    const scrollEl = document.getElementById('calendar2-timeline-scroll');
    if (scrollEl) scrollEl.scrollTop = 8 * CALENDAR_HOUR_HEIGHT;

    renderTaskorg2DayPlanSection();
}

const TIMELINE_SNAP_MIN = 15;         // ドラッグ操作のスナップ単位（分）
const TIMELINE_DRAG_THRESHOLD_MIN = 8; // これ未満の移動量はクリック（属性編集を開く）として扱う

/** 分を15分単位に丸める。 */
function snapTimelineMinutes(min) {
    return Math.round(min / TIMELINE_SNAP_MIN) * TIMELINE_SNAP_MIN;
}

/**
 * タイムラインのブロックへ「移動（時刻＋列）」「リサイズ（時刻のみ）」操作を付与する。
 * ドラッグ中は自分自身の位置・高さ・列のみを更新し、他ブロックのレーン再配置は行わない
 * （ドラッグ中に他ブロックまで位置が飛んで見づらくなるのを防ぐため）。レーンの再計算は
 * ドラッグ確定後の再描画時にまとめて行われる。「移動」は縦方向で時刻、横方向で列（1〜4）を変更できる。
 * 「リサイズ」（下端ハンドル）は時刻（終了予定）のみで列は変わらない。
 */
function attachTaskorg2TimelineDragHandlers(block, handle, labelSpan, seg, dateJP, pxPerMin, hasLinkedTask) {
    let dragMode  = null; // 'move' | 'resize'
    let pointerId = null;
    let startClientY = 0;
    let origStart  = seg.startMin;
    let origEnd    = seg.endMin;
    let origColumn = seg.lane + 1;
    let pendingStart  = seg.startMin;
    let pendingEnd    = seg.endMin;
    let pendingColumn = origColumn;

    function applyColumnStyle(column) {
        const laneWidthPct = 100 / DAYPLAN_COLUMN_COUNT;
        block.style.left  = `${(column - 1) * laneWidthPct}%`;
        block.style.width = `calc(${laneWidthPct}% - 4px)`;
    }

    function updatePreview(newStart, newEnd, newColumn) {
        pendingStart  = newStart;
        pendingEnd    = newEnd;
        pendingColumn = newColumn;
        block.style.top    = `${newStart * pxPerMin}px`;
        block.style.height = `${(newEnd - newStart) * pxPerMin}px`;
        applyColumnStyle(newColumn);
        labelSpan.textContent = seg.row['タイトル'] || '（無題）';
    }

    /** clientXが乗っている列（1〜4、コンテナ幅を4等分）を返す。block.parentElement（lanesEl）は、この関数が
     * 呼ばれる時点（ドラッグ操作時）では必ずDOMに接続済みだが、attachTaskorg2TimelineDragHandlers呼び出し時点
     * （まだlanesElへappendChildする前）ではnullのため、ここで都度取得する。 */
    function columnFromClientX(clientX) {
        const rect = block.parentElement.getBoundingClientRect();
        const laneWidthPx = rect.width / DAYPLAN_COLUMN_COUNT;
        const col = Math.floor((clientX - rect.left) / laneWidthPx) + 1;
        return Math.max(1, Math.min(DAYPLAN_COLUMN_COUNT, col));
    }

    function onPointerMove(e) {
        if (!dragMode) return;
        const deltaMin = snapTimelineMinutes((e.clientY - startClientY) / pxPerMin);

        if (dragMode === 'move') {
            const duration = origEnd - origStart;
            const newStart = Math.max(0, Math.min(1440 - duration, origStart + deltaMin));
            updatePreview(newStart, newStart + duration, columnFromClientX(e.clientX));
        } else {
            const newEnd = Math.max(origStart + TIMELINE_SNAP_MIN, Math.min(1440, origEnd + deltaMin));
            updatePreview(origStart, newEnd, origColumn); // リサイズは列を変えない
        }
    }

    function onPointerUp() {
        if (!dragMode) return;
        block.releasePointerCapture(pointerId);
        block.removeEventListener('pointermove', onPointerMove);
        block.removeEventListener('pointerup', onPointerUp);
        block.removeEventListener('pointercancel', onPointerUp);

        const movedMin      = Math.abs(pendingStart - origStart) + Math.abs(pendingEnd - origEnd);
        const columnChanged = dragMode === 'move' && pendingColumn !== origColumn;
        if (movedMin < TIMELINE_DRAG_THRESHOLD_MIN && !columnChanged) {
            updatePreview(origStart, origEnd, origColumn); // 微小な移動は元に戻す
            if (dragMode === 'move' && hasLinkedTask) { clearAllTaskorg2BulkSelections(); selectedTaskorg2Id = String(seg.row['ID']); taskorg2QuickNewMode = false; renderTaskorg2TaskChange(); }
        } else {
            commitTaskorg2TimelineDrag(seg, dateJP, pendingStart, pendingEnd, pendingColumn, columnChanged);
        }
        dragMode = null;
    }

    function startDrag(mode, e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragMode      = mode;
        pointerId     = e.pointerId;
        startClientY  = e.clientY;
        origStart     = seg.startMin;
        origEnd       = seg.endMin;
        origColumn    = seg.lane + 1;
        pendingStart  = origStart;
        pendingEnd    = origEnd;
        pendingColumn = origColumn;
        block.setPointerCapture(pointerId);
        block.addEventListener('pointermove', onPointerMove);
        block.addEventListener('pointerup', onPointerUp);
        block.addEventListener('pointercancel', onPointerUp);
        e.preventDefault();
        e.stopPropagation();
    }

    block.addEventListener('pointerdown', (e) => startDrag('move', e));
    handle.addEventListener('pointerdown', (e) => startDrag('resize', e));
}

/**
 * タイムラインのドラッグ操作結果を確定保存する。ケースによって実際に変更されるデータが異なるため、
 * 再描画範囲もそれに合わせて最小限に絞る（無関係なビューまで再計算する重い処理を避けるため）。
 * targetColumnはドラッグ／リサイズ後にブロックが位置する列（1〜4）を常に渡す（列を変えていなくても渡す。
 * リサイズは常に元の列のまま）。列2〜4は placeDayPlanBlock 側で重なりを自動的に押し出して解消し、
 * 24:00を超えるようならキャンセル（何も書き換えずタイムラインだけ再描画して元の位置に戻す）。列1は重なりを気にせず
 * そのまま配置する。
 *
 * - 1日タスクのスケジュール行（isDayPlanBlock）: その行（＋押し出された同じ列の他ブロック）の時刻・列だけを書き換える。
 *   他のタスク行には一切影響しないため、タイムラインだけ再描画すれば十分。
 * - 1日タスクに未追加のタスクを列方向にドラッグ（columnChanged）: そのタスク自身の開始予定・終了予定は変えず、
 *   1日タスクへ新しい行として追加する（＝昇格）。「対応中タスク」一覧での参照状態が変わるため未設定タスク一覧も再描画。
 * - 1日タスクに未追加のタスクを縦方向のみドラッグ（時刻だけ変更）: タスク自身の開始予定・終了予定を書き換える。
 *   月間カレンダーのバッジ・ガントのマーカー・タスク一覧の該当行が変わりうるため、選択日に依存するビュー一式
 *   （renderTaskorg2DateChange）の再描画が必要。
 */
function commitTaskorg2TimelineDrag(seg, dateJP, newStartMin, newEndMin, targetColumn, columnChanged) {
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

    if (seg.isDayPlanBlock) {
        const dayPlan = getDayPlanTaskM(currentMainData, dateJP);
        if (!dayPlan) return;
        const result = placeDayPlanBlock(dayPlan['内容'], seg.dayPlanBlockIndex, newStartMin, newEndMin, targetColumn);
        if (!result.ok) { renderTaskorg2Timeline(); return; } // 24:00を超えるためキャンセル、元の位置に戻す
        dayPlan['内容']     = result.content;
        dayPlan['更新日時'] = formatJpDatetime(new Date());
        persistLocalCache();
        renderTaskorg2Timeline(); // 1日タスクのテキストとタイムライン上のチップ位置しか変わらないため、他のビューは再描画不要
        return;
    }

    if (columnChanged) {
        let dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) {
            createTaskorg2DayPlanTask();
            dayPlan = getTaskorg2DayPlanTask();
            if (!dayPlan) return;
        }
        const newBlock = { refId: String(seg.row['ID']), label: seg.row['タイトル'] || '（無題）' };
        const result = placeDayPlanBlock(dayPlan['内容'], null, newStartMin, newEndMin, targetColumn, newBlock);
        if (!result.ok) { renderTaskorg2Timeline(); return; } // 24:00を超えるためキャンセル、タスクは未追加のまま
        dayPlan['内容']     = result.content;
        dayPlan['更新日時'] = formatJpDatetime(new Date());
        persistLocalCache();
        renderTaskorg2Timeline();
        renderTaskorg2UnsetSection(); // 「対応中タスク」の未設定/参照済み区分が変わるため
        return;
    }

    const row = currentMainData.find(r => String(r['ID']) === String(seg.row['ID']));
    if (!row) return;
    row['開始予定'] = `${dateJP} ${fmt(newStartMin)}`;
    row['終了予定'] = `${dateJP} ${fmt(newEndMin)}`;
    row['更新日時'] = formatJpDatetime(new Date());
    persistLocalCache();
    renderTaskorg2DateChange(); // タスク本体の日程が変わり、カレンダー/ガント/一覧など選択日依存のビューに影響しうる
}

/** 選択中日付の1日タスク行（isDayPlanRow）を返す。無ければnull。 */
function getTaskorg2DayPlanTask() {
    return selectedTaskorg2Date ? getDayPlanTaskM(currentMainData, selectedTaskorg2Date) : null;
}

/** 1日タスクの作成ボタン／編集エリアを、選択中の日付の状態に合わせて描画する（旧タスク整理と同一仕様）。 */
function renderTaskorg2DayPlanSection() {
    const createBtn = document.getElementById('calendar2-dayplan-create-btn');
    const editor    = document.getElementById('calendar2-dayplan-editor');
    const contentEl = document.getElementById('calendar2-dayplan-content');
    if (!createBtn || !editor || !contentEl) return;

    if (!selectedTaskorg2Date) {
        createBtn.style.display = 'none';
        editor.style.display = 'none';
        return;
    }

    const dayPlan = getTaskorg2DayPlanTask();
    if (dayPlan) {
        createBtn.style.display = 'none';
        editor.style.display = '';
        if (document.activeElement !== contentEl) contentEl.value = dayPlan['内容'] || '';
    } else {
        createBtn.style.display = '';
        editor.style.display = 'none';
        contentEl.value = '';
    }
}

/** "HH:MM" 文字列を分に変換する。 */
function parseHHMMToMinutes(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
}

/**
 * 選択中日付の1日タスクを新規作成する（システム列 { 種別: '1日タスク' }、開始予定=選択中日付）。
 * 内容には既定の「09:00-09:30 メールチェック、予定整理」に加え、その日既に開始予定・終了予定が
 * 時刻まで指定されている既存タスクを取り込む（カテゴリの絞り込みは適用、プロジェクト／ステータスの絞り込みは適用しない）。
 */
function createTaskorg2DayPlanTask() {
    if (!selectedTaskorg2Date) return;

    const maxId = currentMainData.reduce((max, row) => {
        const id = parseInt(row['ID'], 10);
        return isNaN(id) ? max : Math.max(max, id);
    }, 0);
    const ts = formatJpDatetime(new Date());

    const noFilters = { status: new Set() };
    const scheduledBlocks = getTasksForDateM(currentMainData, currentCategory, noFilters, selectedTaskorg2Date)
        .map(row => {
            const timeInfo = getTaskScheduledTimeOnDate(row, selectedTaskorg2Date);
            if (!timeInfo) return null;
            return {
                startMin: parseHHMMToMinutes(timeInfo.startStr),
                endMin:   parseHHMMToMinutes(timeInfo.endStr),
                refId:    String(row['ID']),
                label:    '',
                column:   1
            };
        })
        .filter(Boolean);

    const defaultBlock = { startMin: 9 * 60, endMin: 9 * 60 + 30, refId: null, label: 'メールチェック、予定整理', column: 1 };
    const content = stringifyDayPlanBlocks(sortDayPlanBlocks([defaultBlock, ...scheduledBlocks]));

    const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
    entry['ID']        = String(maxId + 1);
    entry['システム']   = { '種別': KIND_DAYPLAN };
    entry['タイトル']   = `1日タスク ${selectedTaskorg2Date}`;
    entry['開始予定']   = selectedTaskorg2Date;
    entry['内容']       = content;
    entry['作成日時']   = ts;
    entry['更新日時']   = ts;

    currentMainData.push(entry);
    persistLocalCache();
    renderCalendar2();
}

/** 編集エリアの内容をその日の1日タスクに保存する。 */
function saveTaskorg2DayPlanContent() {
    if (!selectedTaskorg2Date) return;
    const dayPlan = getTaskorg2DayPlanTask();
    if (!dayPlan) return;
    const contentEl  = document.getElementById('calendar2-dayplan-content');
    const rawContent = contentEl ? contentEl.value : '';
    const sortedBlocks = sortDayPlanBlocks(parseDayPlanContent(rawContent));
    dayPlan['内容']     = stringifyDayPlanBlocks(sortedBlocks);
    dayPlan['更新日時'] = formatJpDatetime(new Date());
    if (contentEl) contentEl.value = dayPlan['内容'];
    persistLocalCache();
    renderTaskorg2Timeline();
}

/** 選択中日付の1日タスクを削除する。 */
function deleteTaskorg2DayPlanTask() {
    if (!selectedTaskorg2Date) return;
    const dayPlan = getTaskorg2DayPlanTask();
    if (!dayPlan) return;
    currentMainData = currentMainData.filter(r => r !== dayPlan);
    persistLocalCache();
    renderCalendar2();
}

document.getElementById('calendar2-dayplan-create-btn')?.addEventListener('click', createTaskorg2DayPlanTask);
document.getElementById('calendar2-dayplan-save-btn')?.addEventListener('click', saveTaskorg2DayPlanContent);
document.getElementById('calendar2-dayplan-delete-btn')?.addEventListener('click', deleteTaskorg2DayPlanTask);

// ===== 1日タスクへの追加（＋ボタン・ドラッグ共通） =====

/**
 * 選択中日付の1日タスクに「[列番号] HH:MM-HH:MM #ID タイトル」の1行を追加する（1日タスクが無ければ新規作成）。
 * タイムラインでのドラッグ（列を明示的に変えた場合）と、対応中タスクの「＋」ボタンの両方から使う共通処理。
 */
function appendTaskorg2DayPlanLine(row, startStr, endStr, column) {
    if (!selectedTaskorg2Date) return;
    let dayPlan = getTaskorg2DayPlanTask();
    if (!dayPlan) {
        createTaskorg2DayPlanTask();
        dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) return;
    }
    const line = `[${column}] ${startStr}-${endStr} #${row['ID']} ${row['タイトル'] || '（無題）'}`;
    dayPlan['内容']     = dayPlan['内容'] ? `${dayPlan['内容']}\n${line}` : line;
    dayPlan['更新日時'] = formatJpDatetime(new Date());
}

/**
 * タスクを選択中日付の1日タスクに追加する（対応中タスクなどの「＋」ボタン用）。
 * 開始予定・終了予定が既にその日の時刻まで指定済みのタスク（決まっている予定）は列1に固定配置。
 * それ以外（時間未定のタスク）は、9:00起点で列2〜4の作業枠のうち最も早く空く列へ自動的に割り当てる。
 */
function addTaskorg2ToDayPlan(row) {
    if (!selectedTaskorg2Date) return;
    let dayPlan = getTaskorg2DayPlanTask();
    if (!dayPlan) {
        createTaskorg2DayPlanTask();
        dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) return;
    }
    const busyBlocks = parseDayPlanContent(dayPlan['内容']);
    const fixedSlot = getTaskScheduledTimeOnDate(row, selectedTaskorg2Date);
    const { startStr, endStr, column } = fixedSlot ? { ...fixedSlot, column: 1 } : computeDayPlanTimeSlot(busyBlocks);
    appendTaskorg2DayPlanLine(row, startStr, endStr, column);
    persistLocalCache();
    renderCalendar2();
}

/** チップ群（{row, label}の配列）を container に描画する。空なら emptyText を表示する。options.showAddButton（既定true）で1日タスクへの追加＋ボタンの有無を切り替える。 */
// ===== チップ一覧の描画（共通） =====

/**
 * チップ（ボタン）一覧を描画する。selectionSetを渡すと、各チップの左側にチェックボックスを配置し、
 * 複数選択→編集エリアの「適用」「削除」での一括編集対象にできるようにする（getTaskorg2BulkSelectedIds参照）。
 * チェックを入れたタスクは、その場で編集エリアのアクティブ対象にもする。
 */
function renderTaskorg2ChipList(container, chipEntries, emptyText, options = {}) {
    const { showAddButton = true, selectionSet = null } = options;
    if (!container) return;
    container.innerHTML = '';
    if (chipEntries.length === 0) {
        const p = document.createElement('p');
        p.className = 'calendar-empty-text';
        p.textContent = emptyText;
        container.appendChild(p);
        return;
    }
    chipEntries.forEach(({ row, label }) => {
        const rowId = String(row['ID']);

        const line = document.createElement('span');
        line.className = 'calendar-unscheduled-chip-line';

        if (selectionSet) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'calendar-unscheduled-chip-checkbox';
            checkbox.checked = selectionSet.has(rowId);
            checkbox.addEventListener('click', (e) => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                onTaskorg2BulkCheckboxChange(selectionSet, rowId, checkbox.checked);
            });
            line.appendChild(checkbox);
        }

        const wrap = document.createElement('span');
        wrap.className = 'calendar-unscheduled-chip-wrap';

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `calendar-unscheduled-chip ${showAddButton ? '' : 'calendar-unscheduled-chip--solo'} ${getCalendarStatusClass(row['ステータス'])}`;
        if (isTaskorg2ChipSelected(rowId)) chip.classList.add('calendar-unscheduled-chip--active-outline');
        chip.title = label;
        appendChipLabel(chip, row, label);
        chip.addEventListener('click', () => { clearAllTaskorg2BulkSelections(); selectedTaskorg2Id = rowId; taskorg2QuickNewMode = false; renderTaskorg2TaskChange(); });
        wrap.appendChild(chip);

        if (showAddButton) {
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'calendar-unscheduled-chip-add';
            addBtn.title = '1日タスクに追加';
            addBtn.textContent = '+';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                addTaskorg2ToDayPlan(row);
            });
            wrap.appendChild(addBtn);
        }

        line.appendChild(wrap);
        container.appendChild(line);
    });
}

/** 未設定タスクの一覧を、ステータス順でグループ化して描画する（旧タスク整理と同一仕様）。 */
function renderTaskorg2GroupedChips(container, chipEntries, emptyText, options = {}) {
    const { showAddButton = false, selectionSet = null } = options;
    if (!container) return;
    container.innerHTML = '';
    if (chipEntries.length === 0) {
        const p = document.createElement('p');
        p.className = 'calendar-empty-text';
        p.textContent = emptyText;
        container.appendChild(p);
        return;
    }

    const groups = new Map();
    chipEntries.forEach(entry => {
        const status = entry.row['ステータス'] || '（未設定）';
        if (!groups.has(status)) groups.set(status, []);
        groups.get(status).push(entry);
    });
    const sortedStatuses = [...groups.keys()].sort((a, b) => taskOrganizeStatusRank(a) - taskOrganizeStatusRank(b));

    sortedStatuses.forEach(status => {
        const groupEntries = groups.get(status)
            .sort((a, b) => compareDateAscEmptyLast(a.row['終了予定'], b.row['終了予定']));

        const header = document.createElement('p');
        header.className = 'calendar-section-label calendar-section-label--accent calendar-section-label--nested';
        header.textContent = `${status}（${groupEntries.length}）`;
        container.appendChild(header);

        const listEl = document.createElement('div');
        listEl.className = 'calendar-unscheduled-list calendar-unscheduled-list--grid2';
        container.appendChild(listEl);

        renderTaskorg2ChipList(listEl, groupEntries, '', { showAddButton, selectionSet });
    });
}

// ===== 対応中／対応待ち／属性未設定タスク一覧 =====

/**
 * カテゴリ／ステータス／プロジェクト（親ID）／日付それぞれが未設定のタスクを、領域ごとに分けて返す（重複あり）。
 * 優先度は高・低だけを付け普通は空欄にする運用のため、対象にしない（2026-10-30）。
 * 5つの領域とも、母集団は同じ：通常のタスク（繰返しテンプレートを除く）のうち、taskorg2フィルタ（ステータス・プロジェクト・その他）を満たし、
 * 完了・中断ではないもの（打ち切ったタスクには属性が不要なため。2026-10-29）。カテゴリは選択中のカテゴリに一致するか未入力のもの
 * （未入力の行もカテゴリ領域に出すため）。日付は開始予定・終了予定の少なくとも一方に日付部分が無いもの（空欄・時刻のみ）。
 */
function getTaskorg2UnsetAttributeGroups() {
    const hasDate = v => !!parseSlashDateOnly(v);
    const pool = currentMainData.filter(r =>
        isNormalTaskRow(r) && !isRecurringParentRow(r) &&
        (currentCategory === 'すべて' || !r['カテゴリ'] || r['カテゴリ'] === currentCategory) &&
        !TASKORG2_CLOSED_STATUSES.has(r['ステータス']) &&
        matchesTaskorg2CommonFilters(r)
    );
    return {
        categoryUnset: pool.filter(r => !r['カテゴリ']),
        statusUnset:   pool.filter(r => !r['ステータス']),
        projectUnset:  pool.filter(r => !r['親ID']),
        dateUnset:     pool.filter(r => !(hasDate(r['開始予定']) && hasDate(r['終了予定']))),
    };
}

// 完了・中断（打ち切り）のステータス。属性未設定・期限切れの判定から外す
const TASKORG2_CLOSED_STATUSES = new Set(['完了', '中断']);

/**
 * 期限切れのタスク（終了予定の日付が今日より前で、完了・中断ではないもの）を、終了予定が古い順に返す（2026-10-29追加）。
 * taskorg2フィルタ・選択中カテゴリを適用する。開始予定は問わない。
 */
function getTaskorg2OverdueTasks() {
    const todayJP = jpDateOnly(formatJpDatetime(new Date()));
    return getTaskorg2BaseFilteredList().filter(r => {
        if (!isNormalTaskRow(r) || TASKORG2_CLOSED_STATUSES.has(r['ステータス'])) return false;
        const end = parseSlashDateOnly(r['終了予定']);
        return !!end && jpDateOnly(r['終了予定']) < todayJP;
    }).sort((a, b) => compareDateAscEmptyLast(a['終了予定'], b['終了予定']));
}

/** ステータスが「中断」のタスクを、中断した日の新しい順に { row, date } で返す（日付の条件なし。フィルタは適用しない）。 */
function getTaskorg2SuspendedTasks() {
    const todayJP = jpDateOnly(formatJpDatetime(new Date()));
    return getSuspendedTasksM(currentMainData, currentCategory, todayJP);
}

/** ステータスが「連絡待ち」で、対応中タスクに該当しないタスクを返す。 */
function getTaskorg2WaitingContactTasks() {
    const todayJP = jpDateOnly(formatJpDatetime(new Date()));
    return getTasksByStatusM(currentMainData, currentCategory, '連絡待ち', todayJP);
}


/** 未設定タスク一覧（未設定/設定済み・属性未設定〔カテゴリ・ステータス・プロジェクト・日付〕・中断）を描画する。 */
function renderTaskorg2UnsetSection() {
    const unscheduledEl    = document.getElementById('calendar2-unscheduled-list');
    const dayplanAddedEl   = document.getElementById('calendar2-dayplan-added-list');
    const incompleteEl     = document.getElementById('calendar2-incomplete-date-list');
    const unsetCategoryEl  = document.getElementById('calendar2-unset-category-list');
    const unsetStatusEl    = document.getElementById('calendar2-unset-status-list');
    const unsetProjectEl   = document.getElementById('calendar2-unset-project-list');
    const suspendedEl      = document.getElementById('calendar2-suspended-list');
    const waitingContactEl = document.getElementById('calendar2-waitingcontact-list');
    const overdueEl        = document.getElementById('calendar2-overdue-list');
    const overdueLabelEl   = document.getElementById('calendar2-overdue-label');
    if (!incompleteEl) return;

    // 3セクション（対応中／対応待ち／属性未設定）とも既定は折りたたみのため、件数バッジ・選択整合性の更新（軽量）は
    // 常に行うが、行ごとのチップDOM生成（重い）はExpanderが開いている時だけ行う（繰返しタスク等と同じパフォーマンス対策）。
    const unsetOpen    = document.getElementById('taskorg2-unset-toggle')?.open;
    const waitingOpen  = document.getElementById('taskorg2-waiting-toggle')?.open;
    const inProgressOpen = document.getElementById('taskorg2-inprogress-toggle')?.open;

    const unsetGroups = getTaskorg2UnsetAttributeGroups();
    const toChips = rows => rows.map(row => ({ row, label: row['タイトル'] || '（無題）' }));
    if (unsetOpen) {
        renderTaskorg2ChipList(unsetCategoryEl, toChips(unsetGroups.categoryUnset), '該当なし', { selectionSet: selectedTaskorg2UnsetIds });
        renderTaskorg2ChipList(unsetStatusEl,   toChips(unsetGroups.statusUnset),   '該当なし', { selectionSet: selectedTaskorg2UnsetIds });
        renderTaskorg2ChipList(unsetProjectEl,  toChips(unsetGroups.projectUnset),  '該当なし', { selectionSet: selectedTaskorg2UnsetIds });
    }
    setExpanderCount('calendar2-unset-category-count', unsetGroups.categoryUnset.length);
    setExpanderCount('calendar2-unset-status-count',   unsetGroups.statusUnset.length);
    setExpanderCount('calendar2-unset-project-count',  unsetGroups.projectUnset.length);

    const incompleteTasks = unsetGroups.dateUnset;
    const incompleteChips = incompleteTasks.map(row => ({ row, label: row['タイトル'] || '（無題）' }));
    if (unsetOpen) renderTaskorg2ChipList(incompleteEl, incompleteChips, '該当なし', { selectionSet: selectedTaskorg2UnsetIds });
    setExpanderCount('calendar2-incomplete-count', incompleteChips.length);

    setExpanderCount('calendar2-unset-total-count',
        unsetGroups.categoryUnset.length + unsetGroups.statusUnset.length +
        unsetGroups.projectUnset.length +
        incompleteChips.length);

    // このエリア（属性未設定タスク）に実在しなくなったチェック済みIDは選択から外す
    const unsetValidIds = new Set([
        ...unsetGroups.categoryUnset, ...unsetGroups.statusUnset,
        ...unsetGroups.projectUnset,
        ...incompleteTasks,
    ].map(r => String(r['ID'])));
    pruneTaskorg2Selection(selectedTaskorg2UnsetIds, unsetValidIds);

    const waitingContactChips = toChips(getTaskorg2WaitingContactTasks());
    // 中断：チップの先頭に中断した日を付ける（今年はMM/DD、それ以外はYYYY/MM/DD）
    const thisYear = String(new Date().getFullYear());
    const suspendedChips = getTaskorg2SuspendedTasks().map(({ row, date }) => ({
        row,
        label: `${date ? (date.startsWith(thisYear + '/') ? date.slice(5) : date) + ' ' : ''}${row['タイトル'] || '（無題）'}`,
    }));
    if (waitingOpen) {
        renderTaskorg2ChipList(waitingContactEl, waitingContactChips, '該当なし', { selectionSet: selectedTaskorg2WaitingIds });
        renderTaskorg2ChipList(suspendedEl,      suspendedChips,      '該当なし', { selectionSet: selectedTaskorg2WaitingIds });
    }
    setExpanderCount('calendar2-waitingcontact-count', waitingContactChips.length);
    setExpanderCount('calendar2-suspended-count',      suspendedChips.length);
    setExpanderCount('calendar2-waiting-total-count',
        waitingContactChips.length + suspendedChips.length);

    // このエリア（対応待ちタスク）に実在しなくなったチェック済みIDは選択から外す
    const waitingValidIds = new Set(
        [...waitingContactChips, ...suspendedChips].map(c => String(c.row['ID']))
    );
    pruneTaskorg2Selection(selectedTaskorg2WaitingIds, waitingValidIds);

    if (!selectedTaskorg2Date) {
        if (inProgressOpen) {
            if (unscheduledEl)  unscheduledEl.innerHTML = '';
            if (dayplanAddedEl) dayplanAddedEl.innerHTML = '';
        }
        setExpanderCountPair('calendar2-todo-dayplan-count', 0, 0);
        selectedTaskorg2InProgressIds.clear();
        return;
    }

    // 期限切れ（選択日ではなく今日を基準にする）
    const overdueChips = toChips(getTaskorg2OverdueTasks());
    if (inProgressOpen) renderTaskorg2ChipList(overdueEl, overdueChips, '該当なし', { selectionSet: selectedTaskorg2InProgressIds });
    setExpanderCount('calendar2-overdue-count', overdueChips.length);
    overdueLabelEl?.classList.toggle('calendar-section-label--overdue', overdueChips.length > 0);

    const { timed, unscheduled, referenced } = getTaskorg2SegmentsForDate(selectedTaskorg2Date);
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const chipEntries = [
        ...unscheduled.map(row => ({ row, label: row['タイトル'] || '（無題）' })),
        ...timed.filter(seg => seg.row['ID'] != null && !seg.isDayPlanBlock)
                .map(seg => ({ row: seg.row, label: `${fmt(seg.startMin)}–${fmt(seg.endMin)} ${seg.row['タイトル'] || '（無題）'}` })),
    ];
    chipEntries.sort((a, b) => compareDateAscEmptyLast(a.row['終了予定'], b.row['終了予定']));

    const referencedChips = referenced.map(row => ({ row, label: row['タイトル'] || '（無題）' }));
    if (inProgressOpen) {
        renderTaskorg2GroupedChips(unscheduledEl, chipEntries, 'この日のタスクはありません', { showAddButton: true, selectionSet: selectedTaskorg2InProgressIds });
        renderTaskorg2GroupedChips(dayplanAddedEl, referencedChips, 'まだありません', { selectionSet: selectedTaskorg2InProgressIds });
    }

    setExpanderCountPair('calendar2-todo-dayplan-count', chipEntries.length, referencedChips.length);

    // このエリア（対応中タスク）に実在しなくなったチェック済みIDは選択から外す
    const inProgressValidIds = new Set([...chipEntries, ...referencedChips, ...overdueChips].map(c => String(c.row['ID'])));
    pruneTaskorg2Selection(selectedTaskorg2InProgressIds, inProgressValidIds);
}

// ===== フィルタの描画 =====

/**
 * 新タスク整理のフィルタを描画する。上部（カレンダーエリア）と下部（タスク一覧の直上）の2箇所に、
 * 同じ状態（taskorg2Filters／taskorg2ProjectDrilldownPath）を参照する複製フィルタとして描画することで、
 * どちらを操作しても同じフィルタとして同期して動作するようにする。
 */
function renderTaskorg2Filters() {
    ['calendar2-filter-area', 'calendar2-filter-area-bottom'].forEach(renderTaskorg2FiltersInto);
}

/**
 * 新タスク整理のフィルタを指定IDの領域に描画する。表示順はステータス→その他フィルタ→プロジェクト。
 * 「その他フィルタ」は、カレンダー・タスクリストへの表示有無を切り替えるプロジェクト／繰返し親タスク／繰返し子タスクの
 * チェックボックスを1行で並べる。プロジェクトの複数選択チェックボックスの下には、PJ(1層)から始まる
 * ドリルダウン用プルダウンを配置し、階層を辿って子孫タスクだけに絞り込めるようにする。
 */
function renderTaskorg2FiltersInto(areaId) {
    const area = document.getElementById(areaId);
    if (!area) return;
    area.innerHTML = '';

    function makeRow(labelText, options, selectedSet, buildLabel) {
        const row = document.createElement('div');
        row.className = 'triage-filter-row';
        const lbl = document.createElement('span');
        lbl.className = 'triage-filter-label';
        lbl.textContent = labelText;

        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button';
        selectAllBtn.className = 'calendar-filter-bulk-btn';
        selectAllBtn.textContent = '全選択';
        selectAllBtn.addEventListener('click', () => { options.forEach(v => selectedSet.add(v)); renderCalendar2(); });

        const deselectAllBtn = document.createElement('button');
        deselectAllBtn.type = 'button';
        deselectAllBtn.className = 'calendar-filter-bulk-btn';
        deselectAllBtn.textContent = '全解除';
        deselectAllBtn.addEventListener('click', () => { selectedSet.clear(); renderCalendar2(); });

        const ctrl = createCalendarMultiFilter(options, selectedSet, buildLabel, () => renderCalendar2());
        row.append(lbl, selectAllBtn, deselectAllBtn, ctrl);
        area.appendChild(row);
    }

    const statusOptions = sortByTotalCountDesc(getFilteredTaskStatuses(), 'ステータス');
    seedFilterOptionSet(statusOptions, taskorg2Filters.status, taskorg2FilterKnownOptions.status);
    makeRow('ステータス', statusOptions, taskorg2Filters.status, v => `${v} (${countActiveTasksByField('ステータス', v)}/${countTasksByField('ステータス', v)})`);

    const otherRow = document.createElement('div');
    otherRow.className = 'triage-filter-row';
    const otherLbl = document.createElement('span');
    otherLbl.className = 'triage-filter-label';
    otherLbl.textContent = 'その他フィルタ';
    otherRow.appendChild(otherLbl);

    [
        { key: 'showProject',         label: 'プロジェクト' },
        { key: 'showRecurringParent', label: '繰返しテンプレート' },
        { key: 'showRecurringChild',  label: '繰返し実行タスク' },
    ].forEach(({ key, label }) => {
        const cbLabel = document.createElement('label');
        cbLabel.className = 'calendar-checkbox-label';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = taskorg2Filters[key];
        cb.addEventListener('change', () => {
            taskorg2Filters[key] = cb.checked;
            renderCalendar2();
        });
        cbLabel.append(cb, document.createTextNode(label));
        otherRow.appendChild(cbLabel);
    });
    area.appendChild(otherRow);

    // プロジェクト＝最上位の親IDのタイトルをボタンとして表示（中間階層の親IDは束ねてカウント、旧タスク整理と同様の選び方）
    const projectRowsSorted = [...getTaskorg2ProjectRootRows()]
        .sort((a, b) => countTaskorg2ProjectTasks(String(b['ID']), false) - countTaskorg2ProjectTasks(String(a['ID']), false));
    const projectIds = projectRowsSorted.map(r => String(r['ID']));
    seedFilterOptionSet(projectIds, taskorg2Filters.project, taskorg2FilterKnownOptions.project);
    makeRow('プロジェクト', projectIds, taskorg2Filters.project, id => {
        const row = projectRowsSorted.find(r => String(r['ID']) === id);
        return `${row ? (row['タイトル'] || `#${id}`) : `#${id}`} (${countTaskorg2ProjectTasks(id, true)}/${countTaskorg2ProjectTasks(id, false)})`;
    });

    const drilldownContainer = document.createElement('div');
    drilldownContainer.className = 'calendar-project-drilldown';
    area.appendChild(drilldownContainer);
    // PJ(1層)の選択肢は、プロジェクトのチェックボックスで選択中のものだけに絞る
    const checkedRootProjectRows = projectRowsSorted.filter(r => taskorg2Filters.project.has(String(r['ID'])));
    // チェックを外した結果、ドリルダウンの選択中PJ(1層)が選択肢から外れた場合は選択状態をクリアする
    if (taskorg2ProjectDrilldownPath[0] && !checkedRootProjectRows.some(r => String(r['ID']) === taskorg2ProjectDrilldownPath[0])) {
        taskorg2ProjectDrilldownPath = [];
    }
    renderTaskorg2ProjectDrilldown(drilldownContainer, checkedRootProjectRows);
}

/**
 * プロジェクトフィルタ下のPJ(n層)ドリルダウンを描画する。PJ(1層)はプロジェクトのチェックボックスで選択中の
 * プロジェクトのみを選択肢とし、選択するとその子タスク一覧がタスクリストに反映されると同時に、
 * その子の中から選ぶPJ(2層)が追加される。未選択のプルダウンに達したら打ち切り、
 * taskorg2ProjectDrilldownPathを選択中ID列（ルート→現在階層）で保持する。
 */
function renderTaskorg2ProjectDrilldown(container, rootProjectRowsSorted) {
    container.innerHTML = '';

    let level = 0;
    let parentId = ''; // 空文字ならこのレベルはルート階層（チェック済みPJ一覧）の選択肢を出す
    for (;;) {
        const options = level === 0
            ? rootProjectRowsSorted
            : sortProject2OptionsByDescendantCountDesc(getChildrenM(currentMainData, parentId));
        const currentValue = taskorg2ProjectDrilldownPath[level] || '';
        const levelForClosure = level;

        appendProject2DropdownRow(container, `PJ(${level + 1}層)`, decorateProjectDropdownOptions(options), currentValue, value => {
            taskorg2ProjectDrilldownPath = value
                ? [...taskorg2ProjectDrilldownPath.slice(0, levelForClosure), value]
                : taskorg2ProjectDrilldownPath.slice(0, levelForClosure);
            renderCalendar2();
        });

        if (!currentValue) break; // このレベルで何も選ばれていなければ、これ以上下の階層は出さない
        parentId = currentValue;
        level++;
    }
}

/** 新タスク整理のタスク一覧テーブルを描画する。行クリックで編集対象を切り替える。 */
// ===== タスク一覧・PJ一括編集 =====

/**
 * タスク整理一番下の「タスク一覧」表を描画する。行クリックで編集対象を切り替える。
 * 左端にチェックボックスを配置し、複数選択→編集エリアの「適用」でPJ(n層)などをまとめて変更したり、
 * 「削除」でまとめて削除したりできる（階層整理の「兄弟を選択して一括移動」の代替）。
 */
function renderTaskorg2List() {
    const table = document.getElementById('calendar2-task-list-table');
    if (!table) return;

    const tasks = getTaskorg2FilteredList();
    table.className = 'data-table';
    const cols = ['ID', 'タイトル', 'ステータス', '親ID', '開始予定', '終了予定', '完了日'];

    // このエリアに実在しなくなったチェック済みIDは選択から外す（フィルタ変更等で一覧から消えたタスク対策）
    pruneTaskorg2Selection(selectedTaskorg2ListIds, new Set(tasks.map(r => String(r['ID']))));

    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    const thCheck = document.createElement('th');
    thCheck.style.width = '32px';
    hRow.appendChild(thCheck);
    cols.forEach(col => { const th = document.createElement('th'); th.textContent = col; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    tasks.forEach(row => {
        const rowId = String(row['ID']);
        const tr = document.createElement('tr');
        if (isTaskorg2ChipSelected(rowId)) tr.classList.add('selected-row');

        const tdCheck = document.createElement('td');
        tdCheck.style.textAlign = 'center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedTaskorg2ListIds.has(rowId);
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', () => {
            onTaskorg2BulkCheckboxChange(selectedTaskorg2ListIds, rowId, checkbox.checked);
        });
        tdCheck.appendChild(checkbox);
        tr.appendChild(tdCheck);

        cols.forEach(col => { const td = document.createElement('td'); td.textContent = row[col] ?? ''; tr.appendChild(td); });
        tr.addEventListener('click', () => { clearAllTaskorg2BulkSelections(); selectedTaskorg2Id = rowId; taskorg2QuickNewMode = false; renderTaskorg2TaskChange(); });
        tbody.appendChild(tr);
    });

    table.replaceChildren(thead, tbody);
}

/**
 * タスク整理「PJ一括編集」の PJ(n層) 階層プルダウンを描画する。編集エリアの階層プルダウン
 * （renderDayedit2ParentDropdowns）と同じ操作感（どの階層でも「＋ 新規PJを追加」でその場に新規プロジェクトを
 * 作成できる）だが、選択状態は taskorg2BulkPjPath として個別編集フォームとは独立に持つ。
 * 「PJ一括編集」ボタンはここで選んだ親IDだけをチェックボックス選択中の全タスクへ適用し、
 * タイトル・ステータスなど他の属性には一切触れない。
 */
function renderTaskorg2BulkPjDropdowns() {
    const container = document.getElementById('calendar2-bulk-pj-dropdowns');
    if (!container) return;
    container.innerHTML = '';

    const eligibleRows = getParentEligibleRows(null);
    const newPjExtraOption = [{ value: NEW_PJ_MARK, label: '＋ 新規PJを追加' }];

    let level = 0;
    let parentId = ''; // 空文字ならこのレベルはルート階層（親ID空欄）の選択肢を出す
    for (;;) {
        const options = sortProject2OptionsByDescendantCountDesc(level === 0
            ? eligibleRows.filter(r => !r['親ID'] && (isParentRowFast(r['ID']) || String(r['ID']) === taskorg2BulkPjPath[0]))
            : getChildrenM(eligibleRows, parentId));

        const currentValue = taskorg2BulkPjPath[level] || '';
        const levelForClosure = level;
        const parentIdForClosure = parentId;
        appendProject2DropdownRow(container, `PJ(${level + 1}層)`, decorateProjectDropdownOptions(options), currentValue, value => {
            if (value === NEW_PJ_MARK) {
                const newId = createNewProjectViaPrompt(parentIdForClosure);
                if (newId) taskorg2BulkPjPath = [...taskorg2BulkPjPath.slice(0, levelForClosure), newId];
                renderTaskorg2BulkPjDropdowns();
                return;
            }
            taskorg2BulkPjPath = value ? buildProject2PathFromId(value) : taskorg2BulkPjPath.slice(0, levelForClosure);
            renderTaskorg2BulkPjDropdowns();
        }, newPjExtraOption);

        if (!currentValue) break; // このレベルで何も選ばれていなければ、これ以上下の階層は出さない
        parentId = currentValue;
        level++;
    }
}

/**
 * 「PJ一括編集」ボタン: いずれかのチェックボックス一覧（タスク一覧・対応中／対応待ち／属性未設定・繰返し子タスク）で
 * 選択中の全タスクへ、上記PJ(n層)プルダウンで選んだ親IDだけを一括適用する。タイトル・内容・ステータスなど
 * 他の属性には一切触れない（dayedit2-apply-btnの一括適用とは異なり、編集フォームの内容をコピーしない）。
 */
document.getElementById('calendar2-bulk-pj-apply-btn')?.addEventListener('click', () => {
    const bulkIds = getTaskorg2BulkSelectedIds();
    if (bulkIds.size === 0) { alert('先にタスク一覧などでタスクにチェックを入れてください'); return; }

    const parentId = taskorg2BulkPjPath[taskorg2BulkPjPath.length - 1] || '';
    const rows = [...bulkIds].map(id => currentMainData.find(r => String(r['ID']) === id)).filter(Boolean);
    if (rows.some(row => !checkParentCycleOrAlert(row['ID'], parentId))) return;

    const ts = formatJpDatetime(new Date());
    rows.forEach(row => { row['親ID'] = parentId; row['更新日時'] = ts; });
    clearAllTaskorg2BulkSelections(); // 適用後はチェックボックスを解除し、次回の一括操作に前回の選択が持ち越されないようにする
    persistLocalCache();
    renderCalendar2();
});

// ===== 繰返しタスク（テンプレート・実行タスク・実績グラフ）・選択の共通処理 =====

/**
 * タスク整理「繰返しタスク」Expander用: カテゴリ・ステータス・プロジェクト（親ID・ドリルダウン）の
 * taskorg2フィルタを適用した繰返し親タスク（テンプレート）一覧を返す。旧繰返しエリア専用のフィルタ
 * （recurringFilters）の代わりに、タスク整理共通のフィルタで絞り込めるようにする。
 * ただし「繰返し親タスク／繰返し子タスクの表示ON/OFF」はカレンダー・一覧側の表示制御用のため、
 * この繰返し管理エリア自体には適用しない（OFFでも常に一覧できるようにする）。
 */
function getTaskorg2RecurringParentRows() {
    return getFilteredMainData().filter(r =>
        isRecurringParentRow(r) &&
        matchesFilterValue(taskorg2Filters.status, r['ステータス']) &&
        matchesProjectRootFilter(r, taskorg2Filters.project) &&
        matchesProjectDrilldownFilter(r, taskorg2ProjectDrilldownPath)
    );
}

/** タスク整理「繰返しタスク」Expanderの「基準日」入力欄が未設定の場合のみ、当日をデフォルト値としてセットする。 */
function ensureCalendar2RecurringManualDateDefault() {
    const el = document.getElementById('calendar2-recurring-manual-date');
    if (!el || el.value) return;
    const t = new Date();
    const pad = n => String(n).padStart(2, '0');
    el.value = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** タスク整理「繰返しタスク」Expanderの「基準日」入力欄の値をDateオブジェクトで返す（未入力時は今日）。 */
function getCalendar2RecurringManualDate() {
    const value = document.getElementById('calendar2-recurring-manual-date')?.value || '';
    const [y, m, d] = value.split('-').map(Number);
    return (y && m && d) ? new Date(y, m - 1, d) : new Date();
}

// タスク整理「繰返しタスク」Expanderで、右側（子タスク一覧）の表示対象として選択中の親タスクID
let selectedTaskorg2RecurringParentId = null;
let taskorg2RecurringChart = null;
let taskorg2RecurringChartVisible = false; // 実績グラフは既定非表示。「実績グラフ」ボタンで表示切り替え
// 右側（子タスク一覧）でチェックボックスにより複数選択中の子タスクID集合（適用／削除ボタンの一括操作対象）
const selectedTaskorg2RecurringChildIds = new Set();
// 「対応中タスク（期間内）」「対応待ちタスク（期間外）」「属性未設定タスク」「タスク一覧」でチェックボックスにより
// 複数選択中のタスクID集合（エリアごとに独立。適用／削除ボタンの一括操作対象）
const selectedTaskorg2InProgressIds = new Set();
const selectedTaskorg2WaitingIds    = new Set();
const selectedTaskorg2UnsetIds      = new Set();
const selectedTaskorg2ListIds       = new Set();
// 「プロジェクト」ツリービューでチェックボックスにより複数選択中の行ID集合（親・子いずれの階層でも選択可）
const selectedTaskorg2ProjectTreeIds = new Set();

/** 上記6つの複数選択集合すべての和集合を返す（編集エリアの「適用」「削除」ボタンの一括操作対象の判定に使う）。 */
function getTaskorg2BulkSelectedIds() {
    return new Set([
        ...selectedTaskorg2RecurringChildIds,
        ...selectedTaskorg2InProgressIds,
        ...selectedTaskorg2WaitingIds,
        ...selectedTaskorg2UnsetIds,
        ...selectedTaskorg2ListIds,
        ...selectedTaskorg2ProjectTreeIds,
    ]);
}

/**
 * 編集フォームの「適用」「削除」を一括編集として扱うか。チェックが2件以上のときだけ一括編集にする。
 * チェックが1件だけのときは、フォームに表示中のタスクの単独編集として扱う（Why：チェックが1件残ったまま別のタスクを開いて
 * 「適用」すると、表示中のタスクではなくチェックの付いたタスクへ書き込まれてしまっていたため。2026-10-28）。
 */
function isDayedit2BulkMode() {
    return getTaskorg2BulkSelectedIds().size >= 2;
}

/** selectionSet から、validIds に含まれなくなったID（フィルタ変更等で一覧から消えたタスク）を取り除く。 */
function pruneTaskorg2Selection(selectionSet, validIds) {
    [...selectionSet].forEach(id => { if (!validIds.has(id)) selectionSet.delete(id); });
}

/**
 * 「繰返しタスク」Expanderの件数バッジだけを更新する。Expanderが閉じている間も件数は常に見えるようにするため、
 * 中身（親子一覧・チャート）を描画する renderTaskorg2RecurringList とは別に、軽量に呼べるようにしている。
 */
function updateTaskorg2RecurringCount() {
    setExpanderCount('calendar2-recurring-count', getTaskorg2RecurringParentRows().length);
}

/**
 * タスク整理「繰返しタスク」Expanderを描画する。繰返しエリアと同様に左＝親タスク・右＝選択中の親の
 * 子タスクをボタン（チップ）形式で配置する。ボタンのクリックはタスク整理の編集エリアと選択状態を
 * リンクする（通常タスクの一覧・カレンダーと同じ selectedTaskorg2Id を共有する）。
 * 頻度が今日に該当する親タスクは赤枠（calendar-unscheduled-chip--today-match）で強調する。
 */
function renderTaskorg2RecurringList() {
    const parentListEl = document.getElementById('calendar2-recurring-parent-list');
    const childListEl  = document.getElementById('calendar2-recurring-child-list');
    if (!parentListEl || !childListEl) return;

    ensureCalendar2RecurringManualDateDefault();
    renderTaskorg2RecurringChart();
    const today = new Date();
    const pool = getFilteredMainData();
    const childCountOf = parentId => pool.filter(r => r['親ID'] === parentId).length;

    // 表示順: 頻度が今日に該当するもの（赤枠）を先頭に、その中では子タスクが多いものほど上に来るようにする
    const parents = getTaskorg2RecurringParentRows().sort((a, b) => {
        const todayDiff = Number(matchesSchedule(b, today)) - Number(matchesSchedule(a, today));
        if (todayDiff !== 0) return todayDiff;
        return childCountOf(String(b['ID'])) - childCountOf(String(a['ID']));
    });
    setExpanderCount('calendar2-recurring-count', parents.length);

    // 選択中の親タスクがフィルタ等で一覧から外れた場合は選択解除する
    if (selectedTaskorg2RecurringParentId && !parents.some(r => String(r['ID']) === selectedTaskorg2RecurringParentId)) {
        selectedTaskorg2RecurringParentId = null;
    }

    parentListEl.innerHTML = '';
    if (parents.length === 0) {
        const p = document.createElement('p');
        p.className = 'calendar-empty-text';
        p.textContent = '登録済みの繰り返しタスクがありません';
        parentListEl.appendChild(p);
    } else {
        parents.forEach(row => {
            const rowId = String(row['ID']);

            const wrap = document.createElement('span');
            wrap.className = 'calendar-unscheduled-chip-wrap';

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `calendar-unscheduled-chip ${getCalendarStatusClass(row['ステータス'])}`;
            if (matchesSchedule(row, today)) chip.classList.add('calendar-unscheduled-chip--today-match');
            // 右側（子タスク一覧）の表示対象になっている親タスクを、太い黒枠でひと目でわかるようにする
            if (rowId === selectedTaskorg2RecurringParentId) chip.classList.add('calendar-unscheduled-chip--active-outline');
            chip.title = `${row['タイトル'] || '（無題）'}（${formatRecurringFrequencyLabel(row)}）`;
            appendChipLabel(chip, row, row['タイトル'] || '（無題）');
            chip.addEventListener('click', () => {
                clearAllTaskorg2BulkSelections(); // チップの選択とチェックボックスの複数選択は同時に使わない（チップを選んだらチェックは外す）
                if (selectedTaskorg2RecurringParentId !== rowId) selectedTaskorg2RecurringChildIds.clear(); // 親を切り替えたら子の複数選択はリセットする
                selectedTaskorg2RecurringParentId = rowId;
                selectedTaskorg2Id = rowId;
                taskorg2QuickNewMode = false;
                renderTaskorg2TaskChange();
            });
            wrap.appendChild(chip);

            // 「基準日」入力欄の日付を基準に子タスクを「進行中」で生成する（繰返しエリアの実行タスク生成と同じ挙動）
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'calendar-unscheduled-chip-add calendar-unscheduled-chip-add--green';
            addBtn.title = '基準日を基準に実行タスクを「進行中」で生成';
            addBtn.textContent = '+';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const children = generateChildManually(row, currentMainData, getCalendar2RecurringManualDate());
                if (children.length === 0) { alert('指定日分は既に生成済みです'); return; }
                const ts = formatJpDatetime(new Date());
                children.forEach(child => { child['ステータス'] = '進行中'; child['更新日時'] = ts; });
                currentMainData.push(...children);
                persistLocalCache();
                selectedTaskorg2RecurringParentId = rowId;
                renderTaskorg2RecurringList();
            });
            wrap.appendChild(addBtn);

            parentListEl.appendChild(wrap);
        });
    }

    childListEl.innerHTML = '';
    if (!selectedTaskorg2RecurringParentId) {
        const p = document.createElement('p');
        p.className = 'calendar-empty-text';
        p.textContent = 'テンプレートを選択してください';
        childListEl.appendChild(p);
        return;
    }

    // 基準日が新しいものが上に来るよう並べる（基準日未設定の行はIDの降順で末尾にまとめる）
    const children = getFilteredMainData()
        .filter(r => r['親ID'] === selectedTaskorg2RecurringParentId)
        .sort((a, b) => {
            const da = getRecurringBaseDate(a), db = getRecurringBaseDate(b);
            if (!da && !db) return parseInt(b['ID'], 10) - parseInt(a['ID'], 10);
            if (!da) return 1;
            if (!db) return -1;
            return db.localeCompare(da);
        });

    // 表示対象外になった子タスクのチェックは外しておく（親を切り替えた後の混入防止）
    const childIds = new Set(children.map(r => String(r['ID'])));
    [...selectedTaskorg2RecurringChildIds].forEach(id => { if (!childIds.has(id)) selectedTaskorg2RecurringChildIds.delete(id); });

    if (children.length === 0) {
        const p = document.createElement('p');
        p.className = 'calendar-empty-text';
        p.textContent = '実行タスクがありません';
        childListEl.appendChild(p);
        return;
    }

    children.forEach(row => {
        const rowId = String(row['ID']);

        // チェックボックスは、チップ側のoverflow:hidden（角丸クリップ）で見切れないよう、チップの外側（同じ行内）に配置する
        const line = document.createElement('span');
        line.className = 'calendar-unscheduled-chip-line';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'calendar-unscheduled-chip-checkbox';
        checkbox.checked = selectedTaskorg2RecurringChildIds.has(rowId);
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', () => {
            onTaskorg2BulkCheckboxChange(selectedTaskorg2RecurringChildIds, rowId, checkbox.checked);
        });
        line.appendChild(checkbox);

        const wrap = document.createElement('span');
        wrap.className = 'calendar-unscheduled-chip-wrap';

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `calendar-unscheduled-chip calendar-unscheduled-chip--solo ${getCalendarStatusClass(row['ステータス'])}`;
        // 編集エリアのアクティブ対象になっている子タスクを、親タスクと同様に太い黒枠で強調する
        if (isTaskorg2ChipSelected(rowId)) chip.classList.add('calendar-unscheduled-chip--active-outline');
        chip.title = row['タイトル'] || '（無題）';
        appendChipLabel(chip, row, row['タイトル'] || '（無題）');
        chip.addEventListener('click', () => {
            clearAllTaskorg2BulkSelections(); // チップの選択とチェックボックスの複数選択は同時に使わない（チップを選んだらチェックは外す）
            selectedTaskorg2Id = rowId;
            taskorg2QuickNewMode = false;
            renderTaskorg2TaskChange();
        });
        wrap.appendChild(chip);
        line.appendChild(wrap);

        childListEl.appendChild(line);
    });
}

/**
 * タスク整理「繰返しタスク」Expanderの実績グラフを描画する（繰返しエリアの実績グラフと同じロジックを移植）。
 * 選択中の親タスクの子タスクの実績時間推移をChart.jsで表示する。「実績グラフ」ボタンで表示中のときのみ描画する。
 */
function renderTaskorg2RecurringChart() {
    const wrap = document.getElementById('calendar2-recurring-chart-wrap');
    if (!wrap) return;

    if (taskorg2RecurringChart) { taskorg2RecurringChart.destroy(); taskorg2RecurringChart = null; }
    wrap.innerHTML = '';
    wrap.style.display = taskorg2RecurringChartVisible ? '' : 'none';
    if (!taskorg2RecurringChartVisible) return;

    if (!selectedTaskorg2RecurringParentId) {
        const p = document.createElement('p');
        p.className   = 'placeholder-text';
        p.textContent = 'テンプレートを選択するとグラフが表示されます';
        wrap.appendChild(p);
        return;
    }

    const children  = currentMainData.filter(r => r['親ID'] === selectedTaskorg2RecurringParentId);
    const chartData = buildChildChartData(children);
    const dataMinutes = chartData.data.map(h => Math.round(h * 60));

    if (chartData.labels.length > 0 && window.Chart) {
        const canvas = document.createElement('canvas');
        wrap.appendChild(canvas);
        taskorg2RecurringChart = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: '実績時間 (分)',
                    data:  dataMinutes,
                    borderColor: '#4a90d9',
                    backgroundColor: 'rgba(74,144,217,0.1)',
                    tension: 0.3,
                    pointRadius: 4,
                    fill: true,
                }],
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { title: { display: true, text: '日付' } },
                    y: { title: { display: true, text: '実績時間 (分)' }, beginAtZero: true },
                },
            },
        });
    } else {
        const p = document.createElement('p');
        p.className   = 'placeholder-text';
        p.textContent = chartData.labels.length === 0
            ? '実行タスクに実績データがありません'
            : 'Chart.js が読み込まれていません';
        wrap.appendChild(p);
    }
}

document.getElementById('calendar2-recurring-chart-toggle-btn')?.addEventListener('click', () => {
    taskorg2RecurringChartVisible = !taskorg2RecurringChartVisible;
    renderTaskorg2RecurringChart();
});

// ===== 編集フォーム：繰返しの頻度・実行タスクテンプレート =====

/**
 * 「繰り返しタスクの親として管理する」チェックボックスの状態に応じて、頻度（月/日/曜日）チップと
 * 子タスクテンプレート欄の表示・非表示を切り替える（新タスク整理版）。
 */
function updateDayedit2FreqVisibility() {
    const section = document.getElementById('dayedit2-freq-section');
    const checkbox = document.getElementById('dayedit2-recurring-parent');
    const isParent = !!(checkbox && checkbox.checked);
    if (section) section.style.display = isParent ? '' : 'none';

    const templateSectionEl = document.getElementById('dayedit2-template-section');
    if (templateSectionEl) templateSectionEl.style.display = isParent ? '' : 'none';
}

/** 新タスク整理・編集パネルの頻度（月/日/曜日）チップを描画する。 */
function renderDayedit2FreqChips() {
    renderFreqChipsFor('dayedit2', dayedit2Freq);
}

/**
 * 新タスク整理・編集パネルの実行タスクテンプレート一覧を、1行1テンプレートの表形式で描画する
 * （dayedit2Templatesを直接編集するDOM行を生成）。列は「開始予定」「終了予定」「タイトル」「内容（省略可）」。
 * 開始予定・終了予定は基準日からのオフセット日数（±の整数）で、テンプレートごとに個別に指定できる。
 */
function renderDayedit2Templates() {
    const list = document.getElementById('dayedit2-template-list');
    if (!list) return;

    const table = document.createElement('table');
    table.className = 'data-table recur-template-table';

    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    ['開始予定', '終了予定', 'タイトル', '内容（省略可）', ''].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    if (dayedit2Templates.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyTd = document.createElement('td');
        emptyTd.className = 'empty-cell';
        emptyTd.colSpan = 5;
        emptyTd.textContent = 'テンプレートがありません';
        emptyRow.appendChild(emptyTd);
        tbody.appendChild(emptyRow);
    }
    dayedit2Templates.forEach((template, index) => {
        const row = document.createElement('tr');
        row.dataset.templateIndex = String(index);
        row.className = 'recur-template-row' + (index === selectedDayedit2TemplateIndex ? ' recur-template-row--selected' : '');
        // 行クリックで個別編集モードに切り替える。ハイライト更新のみで表全体は再描画しないため、
        // 行内のinput（オフセット・タイトル・内容）をクリックしてもフォーカスが失われない。
        row.addEventListener('click', (e) => {
            if (e.target.closest('.recur-template-remove-btn')) return;
            selectDayedit2Template(index);
        });

        const startTd = document.createElement('td');
        const startInput = document.createElement('input');
        startInput.type  = 'number';
        startInput.step  = '1';
        startInput.title = '基準日からの相対日数（例: -7で1週間前、0で当日）';
        startInput.value = template.startOffsetDays;
        startInput.addEventListener('input', () => {
            template.startOffsetDays = parseInt(startInput.value, 10) || 0;
        });
        startTd.appendChild(startInput);
        row.appendChild(startTd);

        const endTd = document.createElement('td');
        const endInput = document.createElement('input');
        endInput.type  = 'number';
        endInput.step  = '1';
        endInput.title = '基準日からの相対日数（例: -7で1週間前、0で当日）';
        endInput.value = template.endOffsetDays;
        endInput.addEventListener('input', () => {
            template.endOffsetDays = parseInt(endInput.value, 10) || 0;
        });
        endTd.appendChild(endInput);
        row.appendChild(endTd);

        const suffixTd = document.createElement('td');
        const suffixInput = document.createElement('input');
        suffixInput.type = 'text';
        suffixInput.placeholder = '例: 資料作成';
        suffixInput.value = template.titleSuffix;
        suffixInput.addEventListener('input', () => { template.titleSuffix = suffixInput.value; });
        suffixTd.appendChild(suffixInput);
        row.appendChild(suffixTd);

        const contentTd = document.createElement('td');
        const contentInput = document.createElement('input');
        contentInput.type = 'text';
        contentInput.placeholder = '省略時は親の内容を使用';
        contentInput.value = template.content;
        contentInput.addEventListener('input', () => { template.content = contentInput.value; });
        contentTd.appendChild(contentInput);
        row.appendChild(contentTd);

        const removeTd = document.createElement('td');
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'recur-template-remove-btn';
        removeBtn.textContent = '削除';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dayedit2Templates.splice(index, 1);
            if (selectedDayedit2TemplateIndex === index) {
                restoreDayedit2ParentFieldSnapshot();
                selectedDayedit2TemplateIndex = null;
            } else if (selectedDayedit2TemplateIndex !== null && selectedDayedit2TemplateIndex > index) {
                selectedDayedit2TemplateIndex -= 1;
            }
            renderDayedit2Templates();
            updateDayedit2TemplateModeBanner();
        });
        removeTd.appendChild(removeBtn);
        row.appendChild(removeTd);

        tbody.appendChild(row);
    });
    table.appendChild(tbody);

    list.replaceChildren(table);
}

document.getElementById('dayedit2-template-add-btn')?.addEventListener('click', () => {
    dayedit2Templates.push({ startOffsetDays: 0, endOffsetDays: 0, titleSuffix: '', content: '', status: '', priority: '', category: '', estimate: '' });
    renderDayedit2Templates();
});

/**
 * カテゴリ〜見積時間欄（共通フォーム）に、選択中テンプレートの個別設定値を読み込む。
 * 未設定の項目は空欄のまま表示する（生成時に親タスクの値を使うため）。
 */
function loadDayedit2TemplateFieldsIntoForm(template) {
    document.getElementById('dayedit2-status').value    = template.status   || '';
    document.getElementById('dayedit2-priority').value  = template.priority || '';
    document.getElementById('dayedit2-category').value  = template.category || '';
    document.getElementById('dayedit2-estimate').value  = template.estimate || '';
}

/** テンプレート個別編集モードに入る直前に保存しておいた、親タスク自身のカテゴリ〜見積時間欄の値をフォームへ復元する。 */
function restoreDayedit2ParentFieldSnapshot() {
    if (!dayedit2ParentFieldSnapshot) return;
    document.getElementById('dayedit2-status').value    = dayedit2ParentFieldSnapshot.status;
    document.getElementById('dayedit2-priority').value  = dayedit2ParentFieldSnapshot.priority;
    document.getElementById('dayedit2-category').value  = dayedit2ParentFieldSnapshot.category;
    document.getElementById('dayedit2-estimate').value  = dayedit2ParentFieldSnapshot.estimate;
    dayedit2ParentFieldSnapshot = null;
}

/**
 * テンプレート一覧の行ハイライトだけを更新する（表全体の再描画はしない）。表全体を作り直すと
 * 行内のinput（オフセット・タイトル・内容）がクリックのたびに再生成されフォーカスが失われてしまうため、
 * 選択状態の切り替えではDOMのclassだけを差し替える。
 */
function updateDayedit2TemplateRowHighlight() {
    document.querySelectorAll('#dayedit2-template-list tbody tr').forEach(tr => {
        tr.classList.toggle('recur-template-row--selected', Number(tr.dataset.templateIndex) === selectedDayedit2TemplateIndex);
    });
}

/**
 * 実行タスクテンプレート一覧の行をクリックした時の処理。共通フォーム（カテゴリ〜見積時間欄）を
 * そのテンプレートの個別編集モードに切り替える。初回切り替え時のみ、親タスク自身の値をスナップショットしておき、
 * モード終了時（親タスクの編集に戻る／他の行・他のタスクへ選択が移る／適用・新規登録時）に復元する。
 */
function selectDayedit2Template(index) {
    if (selectedDayedit2TemplateIndex === null) {
        dayedit2ParentFieldSnapshot = {
            status:   document.getElementById('dayedit2-status').value,
            priority: document.getElementById('dayedit2-priority').value,
            category: document.getElementById('dayedit2-category').value,
            estimate: document.getElementById('dayedit2-estimate').value
        };
    }
    selectedDayedit2TemplateIndex = index;
    loadDayedit2TemplateFieldsIntoForm(dayedit2Templates[index]);
    updateDayedit2TemplateRowHighlight();
    updateDayedit2TemplateModeBanner();
}

/** テンプレート個別編集モードを終了し、親タスク自身のカテゴリ〜見積時間欄の値をフォームへ戻す。 */
function exitDayedit2TemplateDetailMode() {
    if (selectedDayedit2TemplateIndex === null) return;
    restoreDayedit2ParentFieldSnapshot();
    selectedDayedit2TemplateIndex = null;
    updateDayedit2TemplateRowHighlight();
    updateDayedit2TemplateModeBanner();
}

/** テンプレート個別編集モード中であることを示すバナーの表示・非表示とラベル文言を更新する。 */
function updateDayedit2TemplateModeBanner() {
    const banner = document.getElementById('dayedit2-template-mode-banner');
    const label  = document.getElementById('dayedit2-template-mode-label');
    if (!banner) return;
    if (selectedDayedit2TemplateIndex === null) {
        banner.style.display = 'none';
        return;
    }
    const template = dayedit2Templates[selectedDayedit2TemplateIndex];
    const name = template?.titleSuffix ? template.titleSuffix : `実行タスク${selectedDayedit2TemplateIndex + 1}`;
    if (label) label.textContent = `「${name}」を個別編集中（カテゴリ〜見積時間欄はこのテンプレートだけの設定。空欄なら親タスクの値を使用）`;
    banner.style.display = '';
}

document.getElementById('dayedit2-template-mode-exit-btn')?.addEventListener('click', exitDayedit2TemplateDetailMode);

// テンプレート個別編集モード中、カテゴリ〜見積時間欄への入力を選択中テンプレートへ直接書き戻す
// （通常モード時は何もしない＝従来通り「適用」ボタン押下時にrowへまとめて反映）。
['status', 'priority', 'category'].forEach(field => {
    document.getElementById(`dayedit2-${field}`)?.addEventListener('change', () => {
        if (selectedDayedit2TemplateIndex === null) return;
        dayedit2Templates[selectedDayedit2TemplateIndex][field] = document.getElementById(`dayedit2-${field}`).value;
    });
});
document.getElementById('dayedit2-estimate')?.addEventListener('input', () => {
    if (selectedDayedit2TemplateIndex === null) return;
    dayedit2Templates[selectedDayedit2TemplateIndex].estimate = document.getElementById('dayedit2-estimate').value;
});

document.getElementById('dayedit2-recurring-parent')?.addEventListener('change', (e) => {
    exitDayedit2TemplateDetailMode(); // 繰返し親のON/OFF切り替え時はテンプレート個別編集モードを解除しておく
    // チェックを入れた直後、テンプレートが1件も無ければ既定の1件（オフセット0）を用意する
    if (e.target.checked && dayedit2Templates.length === 0) {
        dayedit2Templates = parseChildTemplates('');
        renderDayedit2Templates();
    }
    updateDayedit2FreqVisibility();
});

/** ステータスを「完了」「中断」に変更したら、完了日を自動的に本日の日付にする（新タスク整理版）。既に完了日が入力済みなら上書きしない。中断の完了日は中断した日の記録（カレンダーの●もその日に付く）。 */
document.getElementById('dayedit2-status')?.addEventListener('change', (e) => {
    if (selectedDayedit2TemplateIndex !== null) return; // テンプレート個別編集モード中は親タスクの完了日には触れない
    if (e.target.value !== '完了' && e.target.value !== '中断') return;
    const completeEl = document.getElementById('dayedit2-complete-date');
    if (!completeEl || completeEl.value) return;
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    completeEl.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
});

// ===== 編集フォーム：入力補助・クリア・読み込み =====

/** 開始予定の日付を入力したら、終了予定の日付に同じ日付を自動セットする（新タスク整理版）。手動で修正可能。 */
function autoFillTaskorg2EndDate() {
    const startDateEl = document.getElementById('dayedit2-start-date');
    const endDateEl   = document.getElementById('dayedit2-end-date');
    if (!startDateEl.value) return;
    endDateEl.value = startDateEl.value;
}
document.getElementById('dayedit2-start-date')?.addEventListener('change', autoFillTaskorg2EndDate);

/** 開始予定の時間を入力したら、開始予定の分を0に、終了予定の時間を+1・分を0に自動セットする（新タスク整理版。日付は見ない）。手動で修正可能。 */
function autoFillTaskorg2EndTime() {
    const startHourEl   = document.getElementById('dayedit2-start-hour');
    const startMinuteEl = document.getElementById('dayedit2-start-minute');
    const endHourEl     = document.getElementById('dayedit2-end-hour');
    const endMinuteEl   = document.getElementById('dayedit2-end-minute');
    if (startHourEl.value === '') return;

    startMinuteEl.value = 0;
    endHourEl.value     = (Number(startHourEl.value) + 1) % 24;
    endMinuteEl.value   = 0;
}
document.getElementById('dayedit2-start-hour')?.addEventListener('change', autoFillTaskorg2EndTime);

/** 「開始/終了リセット」ボタン（新タスク整理版）: 開始予定・終了予定の日付・時・分をまとめて空欄に戻す。 */
document.getElementById('dayedit2-reset-start-end-btn')?.addEventListener('click', () => {
    ['start-date', 'start-hour', 'start-minute', 'end-date', 'end-hour', 'end-minute'].forEach(f => {
        const el = document.getElementById(`dayedit2-${f}`);
        if (el) el.value = '';
    });
});

/** 「完了日を開始/終了予定に代入」ボタン（新タスク整理版）: 完了日が入力済みで、開始予定・終了予定の空欄になっている方だけに完了日（時間帯なし）を代入する。 */
document.getElementById('dayedit2-fill-date-from-complete-btn')?.addEventListener('click', () => {
    const completeDate = document.getElementById('dayedit2-complete-date').value;
    if (!completeDate) return;

    const startDateEl = document.getElementById('dayedit2-start-date');
    const endDateEl   = document.getElementById('dayedit2-end-date');
    if (!startDateEl.value) startDateEl.value = completeDate;
    if (!endDateEl.value)   endDateEl.value   = completeDate;
});

/**
 * 「繰り返しタスクの親として管理する」チェックボックスがONなら、target を繰り返しタスクの親として
 * システム列の「繰返し頻度」（月/日/曜日）と「繰返しテンプレート」を設定する。OFFなら両方を消す（新タスク整理版）。
 */
function applyRecurringFieldsFromForm2(target) {
    const isRecurringParent = document.getElementById('dayedit2-recurring-parent')?.checked;
    if (isRecurringParent) {
        // 頻度を1つも選んでいなくても空の配列を持たせる（「繰返し頻度」がある行＝繰返しテンプレートと判定するため）
        setSystemField(target, RECURRING_FREQ_KEY, makeRecurringFrequency({ '月': dayedit2Freq.month, '日': dayedit2Freq.day, '曜日': dayedit2Freq.weekday }));
        setSystemField(target, RECURRING_TEMPLATE_KEY, stringifyChildTemplates(dayedit2Templates)); // 子タスクテンプレートはシステム列に保存する
    } else {
        if (getSystemInfo(target)[RECURRING_FREQ_KEY]) setSystemField(target, RECURRING_FREQ_KEY, '');
        if (getRecurringTemplatesValue(target) !== '') setSystemField(target, RECURRING_TEMPLATE_KEY, '');
    }
}

/**
 * 新規登録モード（未選択）の際、編集フォームを既定値へリセットする。
 * - 開始予定・終了予定の日付: 選択中のカレンダー日付（「新規登録」ボタン起動時＝taskorg2QuickNewModeは空欄のまま）
 */
function clearTaskorg2EditForm() {
    ['dayedit2-id', 'dayedit2-title', 'dayedit2-content'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const statusEl = document.getElementById('dayedit2-status');
    if (statusEl) statusEl.value = '未着手';
    const priorityEl = document.getElementById('dayedit2-priority');
    if (priorityEl) priorityEl.value = ''; // 優先度は高・低だけを付け、普通は空欄（2026-10-30）
    const categoryEl = document.getElementById('dayedit2-category');
    if (categoryEl && currentCategory !== 'すべて') categoryEl.value = currentCategory;

    dayedit2Freq.month.clear();
    dayedit2Freq.day.clear();
    dayedit2Freq.weekday.clear();
    const recurringCheckbox = document.getElementById('dayedit2-recurring-parent');
    if (recurringCheckbox) recurringCheckbox.checked = false;
    dayedit2Templates = [];
    selectedDayedit2TemplateIndex = null;
    dayedit2ParentFieldSnapshot = null;
    renderDayedit2Templates();
    updateDayedit2TemplateModeBanner();

    dayedit2ParentPath = [];
    ['start-hour', 'start-minute', 'end-hour', 'end-minute', 'complete-date'].forEach(f => {
        const el = document.getElementById(`dayedit2-${f}`);
        if (el) el.value = '';
    });

    // 「新規登録」ボタンから起動した場合は、日付をカレンダー選択日で埋めずに空欄のままにする
    const dateValue = (!taskorg2QuickNewMode && selectedTaskorg2Date) ? selectedTaskorg2Date.replace(/\//g, '-') : '';
    const startDateEl = document.getElementById('dayedit2-start-date');
    if (startDateEl) startDateEl.value = dateValue;
    const endDateEl = document.getElementById('dayedit2-end-date');
    if (endDateEl) endDateEl.value = dateValue;

    document.getElementById('dayedit2-estimate').value = '';
    document.getElementById('dayedit2-actual').value   = '';

    const timerSection = document.getElementById('dayedit2-timer-section');
    if (timerSection) timerSection.style.display = 'none';
}

/** タスク整理・進行中タスクのタイマー表示（累計時間・実績時間）のみを更新する（他の未適用の入力値は保持するため、フォーム全体は再描画しない）。 */
function updateDayedit2TimerDisplay() {
    const row = currentMainData.find(r => String(r['ID']) === selectedTaskorg2Id);
    if (!row) return;
    const elapsedEl = document.getElementById('dayedit2-timer-elapsed');
    if (elapsedEl) elapsedEl.textContent = formatDuration(computeTotalDuration(row['ID']));
    const actualEl = document.getElementById('dayedit2-actual');
    if (actualEl) actualEl.value = String(computeActualMinutes(row));
    const running = isTimerRunning(row);
    const startBtn = document.getElementById('dayedit2-timer-start-btn');
    if (startBtn) startBtn.disabled = running;
    const stopBtn = document.getElementById('dayedit2-timer-stop-btn');
    if (stopBtn) stopBtn.disabled = !running;
}

/** 新タスク整理の編集フォーム（選択中行、または新規登録モード）を描画する。 */
function renderTaskorg2Edit() {
    populateTaskEditSelects2('dayedit2');

    // 選択行が変わるたびフォーム全体を作り直すため、テンプレート個別編集モードも一旦解除する
    // （復元は不要。次の行データでカテゴリ〜見積時間欄をこの後すぐ上書きするため）。
    selectedDayedit2TemplateIndex = null;
    dayedit2ParentFieldSnapshot = null;

    const row = currentMainData.find(r => String(r['ID']) === selectedTaskorg2Id);
    if (!row) {
        dayedit2FormBaseline = null;
        updateDayedit2BulkChangeHighlight();
        clearTaskorg2EditForm();
        renderDayedit2ParentDropdowns();
        renderDayedit2FreqChips();
        updateDayedit2FreqVisibility();
        setDayedit2BatchSyncVisibility(false);
        return;
    }

    const isParentRow = isRecurringParentRow(row);

    document.getElementById('dayedit2-id').value       = row['ID'];
    document.getElementById('dayedit2-title').value    = row['タイトル'] || '';
    document.getElementById('dayedit2-content').value  = row['内容'] || '';
    document.getElementById('dayedit2-status').value   = row['ステータス'] || '';
    document.getElementById('dayedit2-priority').value = row['優先度'] || '';
    document.getElementById('dayedit2-category').value = row['カテゴリ'] || '';
    dayedit2ParentPath = buildProject2PathFromId(row['親ID']);
    renderDayedit2ParentDropdowns();
    writeTaskDateTimeFieldsToForm('dayedit2', row);
    writeTaskEstimateActualToForm('dayedit2', row, 'minutes');

    dayedit2Templates = isParentRow ? parseChildTemplates(getRecurringTemplatesValue(row)) : [];
    renderDayedit2Templates();
    updateDayedit2TemplateModeBanner();

    const recurringCheckbox = document.getElementById('dayedit2-recurring-parent');
    if (recurringCheckbox) recurringCheckbox.checked = isParentRow;
    loadFreqStateFromRow(dayedit2Freq, row);
    renderDayedit2FreqChips();
    updateDayedit2FreqVisibility();

    const timerSection = document.getElementById('dayedit2-timer-section');
    if (timerSection) {
        timerSection.style.display = '';
        const segEl = document.getElementById('dayedit2-timer-segments');
        if (segEl) renderTimerSegmentTable(segEl, row);
        updateDayedit2TimerDisplay();
    }

    setDayedit2BatchSyncVisibility(!isParentRow && !!getRecurringBaseDate(row));

    dayedit2FormBaseline = readDayedit2FormAsRow(row);
    updateDayedit2BulkChangeHighlight();
}

// ===== 再描画の入口（全体・日付変更・タスク選択変更） =====

/** 「新タスク整理」タブ全体（フィルタ・カレンダー・一覧・編集フォーム・子一覧）を再描画する。 */
function renderCalendar2() {
    renderTaskorg2Filters();
    renderTaskorg2ViewToggle();
    // カレンダー／ガントは実際に表示中のビューのみ再描画する（両方は不要）
    if (taskorg2View === 'calendar') renderTaskorg2CalendarGrid();
    renderTaskorg2GanttUnitToggle();
    if (taskorg2View === 'gantt') renderTaskorg2GanttChart();
    if (taskorg2View === 'workcal') renderWorkCalendar();
    if (taskorg2View === 'project') renderTaskorg2ProjectTree();
    if (taskorg2View === 'report') renderReportTab();
    if (taskorg2View === 'aireview') renderAiReviewTab();
    renderTaskorg2Timeline();
    renderTaskorg2UnsetSection();
    renderTaskorg2List();
    renderTaskorg2BulkPjDropdowns();
    // 「繰返しタスク」Expanderの中身（親子一覧・チャート）は、パフォーマンスのため開いている時だけ再描画する
    // （閉じている間はスキップ、開いた瞬間はtoggleイベント側で描画）。ただし件数バッジは常に最新化する。
    updateTaskorg2RecurringCount();
    if (document.getElementById('calendar2-recurring-toggle')?.open) renderTaskorg2RecurringList();
    renderTaskorg2Edit();
}

/**
 * カレンダー／ガントの「日付」だけを選び直した時の軽量再描画。フィルタ・タスク一覧は選択日に依存しないため
 * 再描画不要（重いため省略）。ビュー(カレンダー/ガント)・タイムライン・対応中タスク（期間内）のみ更新する。
 */
function renderTaskorg2DateChange() {
    if (taskorg2View === 'calendar') renderTaskorg2CalendarGrid(); else renderTaskorg2GanttChart();
    renderTaskorg2Timeline();
    renderTaskorg2UnsetSection();
    renderTaskorg2List();
    renderTaskorg2Edit();
}

/**
 * タスクを選び直した（一覧行・ガント行・タイムライン・未設定チップのクリック）時の軽量再描画。
 * フィルタ・カレンダー本体・ガント本体は選択タスクに依存しないため再描画不要（重いため省略）。
 * 選択ハイライトを持つタイムライン・一覧・未設定チップと、編集フォームのみ更新する。
 */
function renderTaskorg2TaskChange() {
    // ガントチャート／プロジェクトツリーは選択タスクの行ハイライトを持つため、表示中の場合のみ更新する
    if (taskorg2View === 'gantt') renderTaskorg2GanttChart();
    if (taskorg2View === 'project') renderTaskorg2ProjectTree();
    if (taskorg2View === 'aireview') renderAiReviewTab(); // 編集フォームでの移動・修正（差分表示）をすぐ反映する
    renderTaskorg2Timeline();
    renderTaskorg2UnsetSection();
    renderTaskorg2List();
    if (document.getElementById('calendar2-recurring-toggle')?.open) renderTaskorg2RecurringList();
    renderTaskorg2Edit();
}

// 繰返しタスク／プロジェクト管理のExpanderを開いた瞬間だけ、その場で再描画する
// （閉じている間はrenderSummary側で再描画をスキップしているため、開いた直後の内容を最新化する目的）
document.getElementById('calendar2-recurring-toggle')?.addEventListener('toggle', (e) => { if (e.target.open) renderTaskorg2RecurringList(); });
document.getElementById('taskorg2-project-admin-table-toggle')?.addEventListener('toggle', (e) => { if (e.target.open) renderProject2AdminTable(); });
['taskorg2-inprogress-toggle', 'taskorg2-waiting-toggle', 'taskorg2-unset-toggle'].forEach(id => {
    document.getElementById(id)?.addEventListener('toggle', (e) => { if (e.target.open) renderTaskorg2UnsetSection(); });
});

document.getElementById('dayedit2-parent-clear-btn')?.addEventListener('click', () => {
    dayedit2ParentPath = [];
    renderDayedit2ParentDropdowns();
});

/** タイマー開始（編集フォーム）: 開始=現在時刻の区間を追加する。 */
document.getElementById('dayedit2-timer-start-btn')?.addEventListener('click', () => {
    const row = currentMainData.find(r => String(r['ID']) === selectedTaskorg2Id);
    if (!row) return;
    const ts = formatJpDatetime(new Date());
    if (!startTimer(row, ts)) return;
    row['更新日時'] = ts;
    afterTimerEdit(row);
});

/** タイマー停止（編集フォーム）: 計測中の区間に終了=現在時刻を入れる。 */
document.getElementById('dayedit2-timer-stop-btn')?.addEventListener('click', () => {
    const row = currentMainData.find(r => String(r['ID']) === selectedTaskorg2Id);
    if (!row) return;
    const ts = formatJpDatetime(new Date());
    if (!stopTimer(row, ts)) return;
    row['更新日時'] = ts;
    afterTimerEdit(row);
});

// ===== 編集フォーム：タイマーの計測区間 =====

/** "yyyy/mm/dd hh:mm:ss" ⇔ datetime-local の値（"yyyy-mm-ddThh:mm:ss"）の変換。 */
function jpDatetimeToLocalInput(s) {
    const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}` : '';
}
function localInputToJpDatetime(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v || ''));
    return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}` : '';
}

/**
 * タイマーの区間を編集したあとの共通処理：保存し、（同じタスクを開いていれば）編集フォームの表示を更新する。
 */
function afterTimerEdit(row) {
    persistLocalCache();
    if (String(row['ID']) === String(selectedTaskorg2Id)) {
        const segEl = document.getElementById('dayedit2-timer-segments');
        if (segEl) renderTimerSegmentTable(segEl, row);
        updateDayedit2TimerDisplay();
    }
}

/**
 * タイマーの計測区間の一覧表（開始・終了・時間・補正(分)・削除、合計、＋区間を追加）を container に描画する。
 * 編集フォームのタイマー欄で使う。編集はその場で保存する（編集フォームの「適用」は不要）。
 * 開始が空・読めない、終了が開始より前、計測中（終了が空）の区間が最後以外にある、のいずれかの場合は保存せず元に戻す。
 */
function renderTimerSegmentTable(container, row) {
    const segs = getTimerSegments(row).map(s => ({ ...s }));
    const table = document.createElement('table');
    table.className = 'timer-seg-table';
    const head = document.createElement('tr');
    ['開始', '終了', '時間', '補正(分)', ''].forEach(t => { const th = document.createElement('th'); th.textContent = t; head.appendChild(th); });
    table.appendChild(head);

    const commit = () => {
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            const start = parseJpDatetime(s['開始']);
            if (!start) { alert('開始の日時を入力してください'); renderTimerSegmentTable(container, row); return; }
            if (s['終了']) {
                const end = parseJpDatetime(s['終了']);
                if (!end || end < start) { alert('終了は開始より後の日時にしてください'); renderTimerSegmentTable(container, row); return; }
            } else if (i !== segs.length - 1) {
                alert('計測中（終了が空）にできるのは最後の区間だけです'); renderTimerSegmentTable(container, row); return;
            }
        }
        setTimerSegments(row, segs);
        row['更新日時'] = formatJpDatetime(new Date());
        afterTimerEdit(row);
    };

    const now = Date.now();
    segs.forEach((s, i) => {
        const tr = document.createElement('tr');
        const mkDt = (key) => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'datetime-local';
            input.step = '1';
            input.value = jpDatetimeToLocalInput(s[key]);
            input.addEventListener('change', () => { s[key] = localInputToJpDatetime(input.value); commit(); });
            td.appendChild(input);
            return td;
        };
        tr.appendChild(mkDt('開始'));
        tr.appendChild(mkDt('終了'));
        const durTd = document.createElement('td');
        durTd.className = 'timer-seg-duration' + (s['終了'] ? '' : ' timer-seg-running');
        durTd.textContent = s['終了'] ? formatDuration(computeTimerSegmentMs(s, now)) : '計測中';
        tr.appendChild(durTd);
        const adjTd = document.createElement('td');
        const adj = document.createElement('input');
        adj.type = 'number';
        adj.step = '1';
        adj.className = 'runner-adj-input';
        adj.value = s['補正'] ? String(s['補正']) : '';
        adj.placeholder = '±分';
        adj.addEventListener('change', () => { s['補正'] = parseFloat(adj.value) || 0; commit(); });
        adjTd.appendChild(adj);
        tr.appendChild(adjTd);
        const delTd = document.createElement('td');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'calendar-filter-bulk-btn';
        del.textContent = '削除';
        del.addEventListener('click', () => {
            if (!confirm('この区間を削除しますか？')) return;
            segs.splice(i, 1);
            commit();
        });
        delTd.appendChild(del);
        tr.appendChild(delTd);
        table.appendChild(tr);
    });

    const total = document.createElement('tr');
    total.className = 'timer-seg-total';
    const tl = document.createElement('td'); tl.colSpan = 2; tl.textContent = segs.length > 0 ? '合計' : '（計測区間はまだありません）';
    const tv = document.createElement('td'); tv.className = 'timer-seg-duration'; tv.textContent = segs.length > 0 ? formatDuration(computeTimerTotalMs(row, now)) : '';
    const tr2 = document.createElement('td'); tr2.colSpan = 2;
    total.append(tl, tv, tr2);
    table.appendChild(total);

    const actions = document.createElement('div');
    actions.className = 'timer-seg-actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'calendar-filter-bulk-btn';
    addBtn.textContent = '＋ 区間を追加';
    addBtn.title = 'タイマーを使わなかった作業を後から記録します（開始・終了とも現在時刻で追加されるので、編集してください）';
    addBtn.addEventListener('click', () => {
        const ts = formatJpDatetime(new Date());
        const item = { '開始': ts, '終了': ts, '補正': 0 };
        // 計測中の区間は常に最後に置くため、その手前に追加する
        if (segs.length > 0 && !segs[segs.length - 1]['終了']) segs.splice(segs.length - 1, 0, item);
        else segs.push(item);
        commit();
    });
    actions.appendChild(addBtn);
    container.replaceChildren(table, actions);
}

document.getElementById('calendar2-quick-new-btn')?.addEventListener('click', () => {
    clearAllTaskorg2BulkSelections(); // チップの選択とチェックボックスの複数選択は同時に使わない（チップを選んだらチェックは外す）
    selectedTaskorg2Id = null;
    taskorg2QuickNewMode = true;
    renderCalendar2();
});

/** 「新規」ボタン: フォームの現在値で新規行を追加する（常に通常のタスク）。 */
document.getElementById('dayedit2-new-btn')?.addEventListener('click', () => {
    exitDayedit2TemplateDetailMode(); // カテゴリ〜見積時間欄が親タスクの値に戻っている状態で読み取る
    const title = document.getElementById('dayedit2-title').value.trim();
    if (!title) { alert('タイトルを入力してください'); return; }

    const parentId = document.getElementById('dayedit2-parent-id').value || '';

    const maxId = currentMainData.reduce((max, row) => {
        const id = parseInt(row['ID'], 10);
        return isNaN(id) ? max : Math.max(max, id);
    }, 0);
    const ts = formatJpDatetime(new Date());

    const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
    entry['ID']        = String(maxId + 1);
    entry['タイトル']   = title;
    entry['内容']       = document.getElementById('dayedit2-content').value.trim();
    entry['ステータス'] = document.getElementById('dayedit2-status').value;
    entry['優先度']     = document.getElementById('dayedit2-priority').value;
    entry['見積時間']   = document.getElementById('dayedit2-estimate').value;
    entry['カテゴリ']   = document.getElementById('dayedit2-category').value || (currentCategory === 'すべて' ? '' : currentCategory);
    entry['親ID']       = parentId;
    applyRecurringFieldsFromForm2(entry);
    Object.assign(entry, readTaskDateTimeFieldsFromForm('dayedit2'));
    entry['作成日時']   = ts;
    entry['更新日時']   = ts;

    currentMainData.push(entry);
    persistLocalCache();

    selectedTaskorg2Id = entry['ID'];
    renderCalendar2();
});

// ===== 編集フォーム：保存・一括編集 =====

/** dayedit2フォームの入力内容を row へ書き戻す（親IDは呼び出し側で循環参照チェック済みのものを渡すこと）。 */
function writeDayedit2FormFieldsToRow(row, parentId) {
    row['タイトル']   = document.getElementById('dayedit2-title').value.trim();
    row['内容']       = document.getElementById('dayedit2-content').value.trim();
    row['ステータス'] = document.getElementById('dayedit2-status').value;
    row['優先度']     = document.getElementById('dayedit2-priority').value;
    row['見積時間']   = document.getElementById('dayedit2-estimate').value;
    row['カテゴリ']   = document.getElementById('dayedit2-category').value;
    row['親ID']       = parentId;
    applyRecurringFieldsFromForm2(row);
    Object.assign(row, readTaskDateTimeFieldsFromForm('dayedit2'));
    row['更新日時'] = formatJpDatetime(new Date());
}

/** 編集フォームの現在値を、baseRow を土台にした行の形で返す（baseRow 自体は書き換えない）。更新日時は比較対象外のため除く。 */
function readDayedit2FormAsRow(baseRow) {
    const r = { ...baseRow };
    writeDayedit2FormFieldsToRow(r, document.getElementById('dayedit2-parent-id').value || '');
    delete r['更新日時'];
    return r;
}

/** フォームに読み込んだ時点（dayedit2FormBaseline）から変更された項目を返す。基準が無い場合はnull。 */
function getDayedit2ChangedFields() {
    if (!dayedit2FormBaseline) return null;
    const current = readDayedit2FormAsRow(dayedit2FormBaseline);
    // 値は中身（JSON文字列）で比べる（システム列のオブジェクトは書き込みのたびに別オブジェクトになるため）。
    // システム列は、編集フォームで変わりうる項目（DAYEDIT2_SYSTEM_KEYS）ごとに「システム.項目名」として判定する
    const keys = [];
    Object.keys(current).forEach(k => {
        if (k === 'システム') {
            DAYEDIT2_SYSTEM_KEYS.forEach(sk => {
                if (formatCellValue(getSystemInfo(current)[sk] ?? '') !== formatCellValue(getSystemInfo(dayedit2FormBaseline)[sk] ?? '')) keys.push(`システム.${sk}`);
            });
        } else if (formatCellValue(current[k]) !== formatCellValue(dayedit2FormBaseline[k])) keys.push(k);
    });
    return { keys, values: current };
}

// 編集フォームで変わりうるシステム列の項目（一括編集の変更判定・反映の単位）
const DAYEDIT2_SYSTEM_KEYS = [RECURRING_FREQ_KEY, RECURRING_TEMPLATE_KEY];

/** 一括編集の案内・確認で表示する項目名（システム列の項目は画面上の名前で表示する）。 */
function dayedit2FieldLabel(key) {
    if (key === `システム.${RECURRING_FREQ_KEY}`) return '繰返し（親として管理・頻度）';
    if (key === `システム.${RECURRING_TEMPLATE_KEY}`) return '実行タスクテンプレート';
    return key;
}

// 一括編集で変更した項目を色付けする対象の要素（行の列名 → 編集フォームの要素ID）
const DAYEDIT2_FIELD_ELEMENT_IDS = {
    'タイトル': ['dayedit2-title'],
    '内容': ['dayedit2-content'],
    'システム.繰返し頻度': ['dayedit2-recurring-parent', 'dayedit2-freq-month', 'dayedit2-freq-day', 'dayedit2-freq-weekday'],
    'システム.繰返しテンプレート': ['dayedit2-template-list'],
    'ステータス': ['dayedit2-status'],
    '優先度': ['dayedit2-priority'],
    '見積時間': ['dayedit2-estimate'],
    'カテゴリ': ['dayedit2-category'],
    '親ID': ['dayedit2-parent-dropdowns'],
    '開始予定': ['dayedit2-start-date', 'dayedit2-start-hour', 'dayedit2-start-minute'],
    '終了予定': ['dayedit2-end-date', 'dayedit2-end-hour', 'dayedit2-end-minute'],
    '完了日': ['dayedit2-complete-date'],
};

/**
 * 複数選択中（一括編集モード）のとき、変更した項目の入力欄に色を付け、編集フォーム上部に案内を表示する。
 * 単独編集中・テンプレート個別編集中は色付けしない。
 */
function updateDayedit2BulkChangeHighlight() {
    const bannerEl = document.getElementById('dayedit2-bulk-banner');
    const bulkCount = getTaskorg2BulkSelectedIds().size;
    const active = isDayedit2BulkMode() && !!dayedit2FormBaseline && selectedDayedit2TemplateIndex === null;
    const changedKeys = active ? (getDayedit2ChangedFields()?.keys || []) : [];

    Object.entries(DAYEDIT2_FIELD_ELEMENT_IDS).forEach(([key, ids]) => {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const target = el.type === 'checkbox' ? el.parentElement : el; // チェックボックスは自身に背景色が付かないためラベル側を色付けする
            target.classList.toggle('dayedit2-bulk-changed', changedKeys.includes(key));
        });
    });

    if (!bannerEl) return;
    bannerEl.style.display = active ? '' : 'none';
    if (active) {
        bannerEl.textContent = `${bulkCount}件を一括編集中：色の付いた項目だけを、選択中の全タスクに反映します（変更していない項目は各タスクの値のまま）。`
            + (changedKeys.length > 0 ? `変更した項目：${changedKeys.map(dayedit2FieldLabel).join('、')}` : 'まだ変更した項目はありません。');
    }
}

// 編集フォームの入力・チェックボックスの選択変更・チップ類のクリックのたびに、色付け表示を最新化する
['input', 'change', 'click'].forEach(type => {
    document.addEventListener(type, () => requestAnimationFrame(updateDayedit2BulkChangeHighlight));
});

/**
 * 「グループに適用」ボタン・ヒントの表示切り替え。同時生成された子タスク（繰返し基準日を持つ）を
 * 編集中のときのみ表示する（旧繰返しエリアと同じ条件）。チェックボックスで複数タスクを選択中の場合は、
 * 対象が曖昧になるためボタンを無効化する（非表示にはしない）。
 */
function setDayedit2BatchSyncVisibility(show) {
    const btnEl  = document.getElementById('dayedit2-batch-sync-btn');
    const hintEl = document.getElementById('dayedit2-batch-sync-hint');
    if (btnEl) {
        btnEl.style.display = show ? '' : 'none';
        btnEl.disabled = isDayedit2BulkMode();
    }
    if (hintEl) hintEl.style.display = show ? '' : 'none';
}

/**
 * 「グループに適用」ボタン: 選択中の子タスクへの変更を適用したうえで、同じ回（親ID＝繰返しテンプレート＋
 * 繰返し基準日が同じ）の他の子タスクへも連動反映する（旧繰返しエリアの同機能を移植）。開始予定・終了予定
 * どちらも「変更前後の日数差分」で扱い、その差分だけグループ全体（編集中タスク自身も含む）の開始予定・
 * 終了予定を平行移動する（＝各タスクの長さ・相対位置を保ったまま全体が動く）。
 * 開始予定と終了予定を両方変更した場合は、開始予定側の差分を優先して使う。
 * チェックボックスで複数タスクを選択中（一括編集モード）の場合は、対象が曖昧になるため何もしない。
 */
function applyDayedit2BatchSync() {
    exitDayedit2TemplateDetailMode(); // カテゴリ〜見積時間欄が親タスクの値に戻っている状態で読み取る
    if (isDayedit2BulkMode()) return; // 複数選択中は動作させない
    if (!selectedTaskorg2Id) return;
    const row = currentMainData.find(r => String(r['ID']) === selectedTaskorg2Id);
    if (!row || isRecurringParentRow(row) || !getRecurringBaseDate(row)) return;

    const parentId = document.getElementById('dayedit2-parent-id').value || '';
    if (!checkParentCycleOrAlert(row['ID'], parentId)) return;

    const oldStartStr  = row['開始予定'];
    const oldEndStr    = row['終了予定'];
    const oldStartDate = parseSlashDateOnly(oldStartStr);
    const oldEndDate   = parseSlashDateOnly(oldEndStr);
    const { 開始予定: newStart, 終了予定: newEnd } = readTaskDateTimeFieldsFromForm('dayedit2');
    const newStartDate = parseSlashDateOnly(newStart);
    const newEndDate   = parseSlashDateOnly(newEnd);

    const deltaStart = (oldStartDate && newStartDate) ? Math.round((newStartDate - oldStartDate) / 86400000) : 0;
    const deltaEnd    = (oldEndDate   && newEndDate)   ? Math.round((newEndDate   - oldEndDate)   / 86400000) : 0;
    const delta = deltaStart !== 0 ? deltaStart : deltaEnd; // 開始予定の差分を優先

    writeDayedit2FormFieldsToRow(row, parentId); // 選択中タスク自身の変更（日付以外も含む）を通常通り適用

    if (delta !== 0) {
        // 編集中タスク自身も、他タスクと同じ delta シフトで開始予定・終了予定を揃え直す
        // （フォームに入力した値そのものではなく、変更前の値からの平行移動として再計算するため、
        //   触っていない側の日付も含めて他タスクと同じだけ動く）
        if (oldStartStr) row['開始予定'] = shiftSlashDateTimeString(oldStartStr, delta);
        if (oldEndStr)   row['終了予定'] = shiftSlashDateTimeString(oldEndStr, delta);

        const siblings = currentMainData.filter(r =>
            r['親ID'] === row['親ID'] &&
            getRecurringBaseDate(r) === getRecurringBaseDate(row) &&
            String(r['ID']) !== selectedTaskorg2Id
        );

        const ts = formatJpDatetime(new Date());
        row['更新日時'] = ts;
        siblings.forEach(sib => {
            if (sib['開始予定']) sib['開始予定'] = shiftSlashDateTimeString(sib['開始予定'], delta);
            if (sib['終了予定']) sib['終了予定'] = shiftSlashDateTimeString(sib['終了予定'], delta);
            sib['更新日時'] = ts;
        });
    }

    persistLocalCache();
    renderCalendar2();
}

document.getElementById('dayedit2-batch-sync-btn')?.addEventListener('click', applyDayedit2BatchSync);

// ===== チップの選択状態（単独選択とチェックボックスの複数選択） =====

/**
 * チップ（行）の単独選択として強調表示するか。チェックボックスで1件でも選んでいる間は、編集フォームに読み込んだタスクが
 * あってもチップの選択としては表示しない（チップの選択とチェックボックスの複数選択は同時に使わない運用。2026-10-28）。
 */
function isTaskorg2ChipSelected(id) {
    return String(id) === String(selectedTaskorg2Id) && getTaskorg2BulkSelectedIds().size === 0;
}

/**
 * チェックボックス（タスク一覧・対応中／対応待ち／属性未設定・繰返し子タスク・プロジェクトツリー）の変更。
 * チェックを入れたタスクを編集フォームに読み込む（一括編集の変更判定の基準にするため。チップの選択表示は消える）。
 * 編集フォームに表示中のタスクのチェックを外したときは、残りのチェックのうち最後のものを読み込む（残りが無ければ選択なし）。
 */
function onTaskorg2BulkCheckboxChange(selectionSet, id, checked) {
    if (checked) {
        selectionSet.add(id);
        selectedTaskorg2Id = id;
    } else {
        selectionSet.delete(id);
        if (String(selectedTaskorg2Id) === String(id)) {
            const rest = [...getTaskorg2BulkSelectedIds()];
            selectedTaskorg2Id = rest.length > 0 ? rest[rest.length - 1] : null;
        }
    }
    taskorg2QuickNewMode = false;
    renderTaskorg2TaskChange();
}

/** 6つのチェックボックス複数選択集合（繰返し子・対応中・対応待ち・属性未設定・タスク一覧・プロジェクトツリー）をすべてクリアする。 */
function clearAllTaskorg2BulkSelections() {
    selectedTaskorg2RecurringChildIds.clear();
    selectedTaskorg2InProgressIds.clear();
    selectedTaskorg2WaitingIds.clear();
    selectedTaskorg2UnsetIds.clear();
    selectedTaskorg2ListIds.clear();
    selectedTaskorg2ProjectTreeIds.clear();
}

/**
 * 「適用」ボタン: 通常は選択中行へフォーム内容を書き戻す。親IDは循環参照チェックを通過した場合のみ保存する。
 * いずれかのチェックボックス一覧（繰返し子タスク／対応中／対応待ち／属性未設定／タスク一覧）でタスクを複数選択中の場合は、
 * 選択中の全タスクへ同じフォーム内容をまとめて反映する（一括編集）。
 */
document.getElementById('dayedit2-apply-btn')?.addEventListener('click', () => {
    exitDayedit2TemplateDetailMode(); // カテゴリ〜見積時間欄が親タスクの値に戻っている状態で読み取る
    const parentId = document.getElementById('dayedit2-parent-id').value || '';
    const bulkIds = getTaskorg2BulkSelectedIds();

    if (isDayedit2BulkMode()) {
        // 一括編集：フォームに読み込んだ時点から変更した項目だけを、選択中の全タスクへ反映する
        // （フォーム全項目を書き込むと、表示中の1件のタイトル・内容などで他のタスクまで上書きしてしまうため）
        const changed = getDayedit2ChangedFields();
        if (!changed) { alert('一括編集の基準になるタスクが読み込まれていません。タスクを1件クリックしてから操作してください'); return; }
        if (changed.keys.length === 0) { alert('変更された項目がありません。反映したい項目だけを書き換えてから「適用」を押してください'); return; }
        const rows = [...bulkIds]
            .map(id => currentMainData.find(r => String(r['ID']) === id))
            .filter(Boolean);
        if (!confirm(`選択中の${rows.length}件に、次の項目を反映します。
${changed.keys.map(dayedit2FieldLabel).join('、')}`)) return;
        if (changed.keys.includes('親ID') && rows.some(row => !checkParentCycleOrAlert(row['ID'], parentId))) return;
        const ts = formatJpDatetime(new Date());
        rows.forEach(row => {
            changed.keys.forEach(k => {
                // システム列は丸ごと書き写さず、変更した項目（繰返し頻度・繰返しテンプレート）だけを反映する（種別・AI原案などを他のタスクへ写さないため）。
                // 配列・オブジェクトはタスクごとに複製して、複数のタスクで同じオブジェクトを共有しないようにする
                if (k.startsWith('システム.')) {
                    const sk = k.slice('システム.'.length);
                    const v = getSystemInfo(changed.values)[sk];
                    setSystemField(row, sk, v === undefined || v === '' ? '' : JSON.parse(JSON.stringify(v)));
                } else row[k] = changed.values[k];
            });
            row['更新日時'] = ts;
        });
    } else {
        if (!selectedTaskorg2Id) return;
        const row = currentMainData.find(r => String(r['ID']) === selectedTaskorg2Id);
        if (!row) return;
        if (!checkParentCycleOrAlert(row['ID'], parentId)) return;
        writeDayedit2FormFieldsToRow(row, parentId);
    }

    persistLocalCache();
    renderCalendar2();
});

/**
 * 「削除」ボタン: 通常は選択中行を削除する（この行を親IDとして参照していた子行は親ID欄を空欄化する）。
 * いずれかのチェックボックス一覧でタスクを複数選択中の場合は、選択中の全タスクをまとめて削除する。
 */
document.getElementById('dayedit2-delete-btn')?.addEventListener('click', () => {
    const bulkIds = getTaskorg2BulkSelectedIds();
    if (isDayedit2BulkMode()) {
        const targetIds = [...bulkIds];
        if (!confirm(`選択中の${targetIds.length}件のタスクを削除しますか？`)) return;

        targetIds.forEach(id => {
            currentMainData.forEach(r => { if (String(r['親ID'] || '') === id) r['親ID'] = ''; });
        });
        currentMainData = currentMainData.filter(r => !targetIds.includes(String(r['ID'])));
        if (targetIds.includes(selectedTaskorg2Id)) selectedTaskorg2Id = null;
        clearAllTaskorg2BulkSelections();
        persistLocalCache();
        renderCalendar2();
        return;
    }

    if (!selectedTaskorg2Id) return;
    if (!confirm('この行を削除しますか？')) return;

    currentMainData.forEach(r => { if (String(r['親ID'] || '') === selectedTaskorg2Id) r['親ID'] = ''; });
    currentMainData = currentMainData.filter(r => String(r['ID']) !== selectedTaskorg2Id);
    persistLocalCache();

    selectedTaskorg2Id = null;
    renderCalendar2();
});

// ===========================================================================
// プロジェクト管理（一覧表示・名前変更・統合・削除）
// 特別な「プロジェクト」区分は無く、他行から親IDとして参照されている行を
// 一覧表示・編集する。
// ===========================================================================

/** プロジェクト管理表用：他行から親IDとして参照されている「最上位（ルート）」の行を全件返す（繰返しテンプレートは除く）。 */
function getProject2AllParentRowsForAdmin() {
    let rows = currentMainData.filter(r => !r['親ID'] && isParentRowFast(r['ID']) && !isRecurringParentRow(r));
    if (currentCategory !== 'すべて') rows = rows.filter(r => r['カテゴリ'] === currentCategory);
    return rows;
}

/** プロジェクト管理表の「統合先」「削除時の再割り当て先」の選択肢用：階層を問わず全プロジェクト（子を持つ行）を返す（繰返しテンプレートは除く）。 */
function getProject2AllProjectRowsFlat() {
    let rows = currentMainData.filter(r => isParentRowFast(r['ID']) && !isRecurringParentRow(r));
    if (currentCategory !== 'すべて') rows = rows.filter(r => r['カテゴリ'] === currentCategory);
    return rows;
}

/** PJ(n層)階層プルダウンの選択肢を、配下の子孫（子・孫…全階層）の総数が多い順にソートする（フィルタ・PJ一括編集の階層プルダウン共通）。 */
function sortProject2OptionsByDescendantCountDesc(rows) {
    return [...rows].sort((a, b) => collectProject2Descendants(b['ID']).length - collectProject2Descendants(a['ID']).length);
}

/** rootId 配下の全階層の子孫を { row, depth } の配列（深さ優先、親の直後にその子が続く順）で返す。「新規プロジェクトの追加」の付け替え候補一覧に使用する。 */
function collectProject2Descendants(rootId, depth = 1, out = [], visited = new Set()) {
    if (visited.has(String(rootId))) return out; // 循環データ保護
    visited.add(String(rootId));
    getChildrenM(currentMainData, rootId).forEach(child => {
        out.push({ row: child, depth });
        collectProject2Descendants(child['ID'], depth + 1, out, visited);
    });
    return out;
}

/** id からその行自身までの親ID系列を、ルート→id自身の順で返す（循環データ保護つき）。プルダウン選択・行選択のたびに現在の実データを基準に再構築する。 */
function buildProject2PathFromId(id) {
    if (!id) return [];
    const idMap = new Map(currentMainData.map(r => [String(r['ID']), r]));
    const chain = [];
    const visited = new Set();
    let currentId = String(id);
    let current = idMap.get(currentId);
    while (current && !visited.has(currentId)) {
        chain.unshift(currentId);
        visited.add(currentId);
        const pid = current['親ID'] ? String(current['親ID']) : null;
        if (!pid || !idMap.has(pid)) break;
        currentId = pid;
        current = idMap.get(pid);
    }
    return chain;
}

// ---- プロジェクト管理表（名前変更・統合・削除） ----

// プロジェクト管理表で「下階層」ドリルダウン中の子プロジェクトID（rowId(string) -> 選択中の子プロジェクトID）。
// 各行は一度に1つの子だけ展開でき、選択し直すと別の子に切り替わる。
let project2AdminDrilldown = new Map();

/**
 * プロジェクト管理表の1行を tbody に追加する。depthに応じてプロジェクト名を字下げする。
 * 「下階層」列に、このプロジェクト直下のさらに子を持つプロジェクト（サブプロジェクト）を選ぶプルダウンを置き、
 * 選択するとドリルダウンした子プロジェクトの行をこの行の直後に追加する（再帰）。
 */
function appendProject2AdminRow(tbody, row, depth, allProjectsFlat) {
    const id = String(row['ID']);
    const tr = document.createElement('tr');

    // プロジェクト名（階層の深さに応じて字下げ）
    const tdName = document.createElement('td');
    tdName.textContent = row['タイトル'] || '';
    tdName.style.paddingLeft = `${8 + depth * 20}px`;
    tr.appendChild(tdName);

    // タスク数（全階層合計）
    const tdCount = document.createElement('td');
    tdCount.textContent = String(collectProject2Descendants(id).length);
    tr.appendChild(tdCount);

    // 名前変更
    const tdRename = document.createElement('td');
    const renameInput = document.createElement('input');
    renameInput.type  = 'text';
    renameInput.value = row['タイトル'] || '';
    renameInput.style.width = '10em';
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'calendar-add-btn';
    renameBtn.textContent = '変更';
    renameBtn.addEventListener('click', () => {
        const newName = renameInput.value.trim();
        if (!newName) { alert('プロジェクト名を入力してください'); return; }
        row['タイトル']   = newName;
        row['更新日時']   = formatJpDatetime(new Date());
        persistLocalCache();
        renderProject2AdminTable();
    });
    tdRename.append(renameInput, renameBtn);
    tr.appendChild(tdRename);

    // 統合（このプロジェクトを他のプロジェクトへ統合し、自身は統合先の子に降格する）
    const tdMerge = document.createElement('td');
    const mergeSelect = document.createElement('select');
    const blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = '（統合先を選択）';
    mergeSelect.appendChild(blankOpt);
    allProjectsFlat.filter(p => String(p['ID']) !== id).forEach(p => {
        const opt = document.createElement('option');
        opt.value = String(p['ID']);
        opt.textContent = p['タイトル'] || '';
        mergeSelect.appendChild(opt);
    });
    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.className = 'calendar-add-btn';
    mergeBtn.textContent = '統合';
    mergeBtn.addEventListener('click', () => {
        const targetId = mergeSelect.value;
        if (!targetId) { alert('統合先のプロジェクトを選択してください'); return; }
        if (!confirm(`「${row['タイトル']}」を「${mergeSelect.options[mergeSelect.selectedIndex].textContent}」へ統合します。よろしいですか？`)) return;
        mergeProject2Into(id, targetId);
    });
    tdMerge.append(mergeSelect, mergeBtn);
    tr.appendChild(tdMerge);

    // 削除
    const tdDelete = document.createElement('td');
    if (project2AdminDeletePending === id) {
        const childCount = getChildrenM(currentMainData, id).length;
        if (childCount > 0) {
            const reassignSelect = document.createElement('select');
            const unassignOpt = document.createElement('option');
            unassignOpt.value = '';
            unassignOpt.textContent = '（未割り当てにする）';
            reassignSelect.appendChild(unassignOpt);
            allProjectsFlat.filter(p => String(p['ID']) !== id).forEach(p => {
                const opt = document.createElement('option');
                opt.value = String(p['ID']);
                opt.textContent = p['タイトル'] || '';
                reassignSelect.appendChild(opt);
            });
            const execBtn = document.createElement('button');
            execBtn.type = 'button';
            execBtn.className = 'calendar-danger-btn';
            execBtn.textContent = '削除実行';
            execBtn.addEventListener('click', () => {
                deleteProject2(id, reassignSelect.value || null);
            });
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'calendar-add-btn';
            cancelBtn.textContent = 'キャンセル';
            cancelBtn.addEventListener('click', () => {
                project2AdminDeletePending = null;
                renderProject2AdminTable();
            });
            tdDelete.append(reassignSelect, execBtn, cancelBtn);
        } else {
            const execBtn = document.createElement('button');
            execBtn.type = 'button';
            execBtn.className = 'calendar-danger-btn';
            execBtn.textContent = '削除実行';
            execBtn.addEventListener('click', () => deleteProject2(id, null));
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'calendar-add-btn';
            cancelBtn.textContent = 'キャンセル';
            cancelBtn.addEventListener('click', () => {
                project2AdminDeletePending = null;
                renderProject2AdminTable();
            });
            tdDelete.append(execBtn, cancelBtn);
        }
    } else {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'calendar-danger-btn';
        deleteBtn.textContent = '削除';
        deleteBtn.addEventListener('click', () => {
            project2AdminDeletePending = id;
            renderProject2AdminTable();
        });
        tdDelete.appendChild(deleteBtn);
    }
    tr.appendChild(tdDelete);

    // 下階層（このプロジェクト直下の、さらに子を持つプロジェクトへドリルダウンする）
    const tdDrill = document.createElement('td');
    const subProjects = decorateProjectDropdownOptions(getChildrenM(currentMainData, id)).filter(r => r.__childCount > 0);
    if (subProjects.length > 0) {
        const drillSelect = document.createElement('select');
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '（下の階層を選択）';
        drillSelect.appendChild(noneOpt);
        subProjects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = String(p['ID']);
            opt.textContent = p['タイトル'];
            drillSelect.appendChild(opt);
        });
        drillSelect.value = project2AdminDrilldown.get(id) || '';
        drillSelect.addEventListener('change', () => {
            if (drillSelect.value) project2AdminDrilldown.set(id, drillSelect.value);
            else project2AdminDrilldown.delete(id);
            renderProject2AdminTable();
        });
        tdDrill.appendChild(drillSelect);
    } else {
        tdDrill.textContent = '-';
    }
    tr.appendChild(tdDrill);

    tbody.appendChild(tr);

    const drilledId = project2AdminDrilldown.get(id);
    if (drilledId) {
        const childRow = currentMainData.find(r => String(r['ID']) === drilledId);
        if (childRow) {
            appendProject2AdminRow(tbody, childRow, depth + 1, allProjectsFlat);
        } else {
            project2AdminDrilldown.delete(id); // 実データに存在しなくなっていたら選択解除
        }
    }
}

/** 「プロジェクト管理」表を描画する。列: プロジェクト名／タスク数／状態／名前変更／統合／削除／下階層。 */
function renderProject2AdminTable() {
    const table = document.getElementById('project2-admin-table');
    if (!table) return;

    const projects = getProject2AllParentRowsForAdmin()
        .sort((a, b) => collectProject2Descendants(String(b['ID'])).length - collectProject2Descendants(String(a['ID'])).length);
    const allProjectsFlat = getProject2AllProjectRowsFlat();
    table.className = 'data-table';
    const cols = ['プロジェクト名', 'タスク数', '名前変更', '統合', '削除', '下階層'];

    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; hRow.appendChild(th); });
    thead.appendChild(hRow);

    const tbody = document.createElement('tbody');
    projects.forEach(row => appendProject2AdminRow(tbody, row, 0, allProjectsFlat));

    table.replaceChildren(thead, tbody);
}

/** sourceId のプロジェクトを targetId へ統合する。sourceの直接の子は全てtargetの子へ付け替え、source自身もtargetの子（通常タスク）に降格する。 */
function mergeProject2Into(sourceId, targetId) {
    if (wouldCreateCycleM(currentMainData, sourceId, targetId)) {
        alert('この統合は循環参照になるため実行できません。');
        return;
    }
    const ts = formatJpDatetime(new Date());
    getChildrenM(currentMainData, sourceId).forEach(child => {
        child['親ID']   = targetId;
        child['更新日時'] = ts;
    });
    const sourceRow = currentMainData.find(r => String(r['ID']) === sourceId);
    if (sourceRow) {
        sourceRow['親ID']   = targetId;
        sourceRow['更新日時'] = ts;
    }
    persistLocalCache();
    project2AdminDrilldown.clear(); // 統合で階層が変わるため、プロジェクト管理表のドリルダウン状態はリセットする
    renderProject2AdminTable();
}

/** projectId のプロジェクトを削除する。reassignToId指定時は直接の子をそちらへ付け替え、未指定時は子の親IDを空欄化（単独タスク化）してから削除する。 */
function deleteProject2(projectId, reassignToId) {
    const ts = formatJpDatetime(new Date());
    getChildrenM(currentMainData, projectId).forEach(child => {
        child['親ID']   = reassignToId || '';
        child['更新日時'] = ts;
    });
    currentMainData = currentMainData.filter(r => String(r['ID']) !== projectId);
    persistLocalCache();

    project2AdminDeletePending = null;
    project2AdminDrilldown.clear(); // 削除で階層が変わるため、プロジェクト管理表のドリルダウン状態はリセットする
    renderProject2AdminTable();
}

/**
 * PJ(n層)プルダウンの選択肢を、子タスクを持つもの（＝プロジェクト）を先頭に、その中では子タスク数が
 * 多い順に並べ替える。プロジェクトのタイトルには表示上「PJ:」を接頭辞として付ける（実データは変更しない）。
 */
function decorateProjectDropdownOptions(options) {
    return options
        .map(r => {
            const descendantCount = collectProject2Descendants(r['ID']).length; // 子だけでなく孫以降も含めた総階層数
            return descendantCount > 0
                ? { ...r, 'タイトル': `【PJ】${r['タイトル'] || ''}`, __childCount: descendantCount }
                : { ...r, __childCount: 0 };
        })
        .sort((a, b) => b.__childCount - a.__childCount);
}

const PROJECT2_STANDALONE_MARK = '__standalone__'; // 階層1の「（単独タスク）」選択肢の特殊値

/** 汎用の階層プルダウン1段を container に追加する（ラベル・選択肢・現在値・changeハンドラを指定）。extraOptions（{value, label}の配列）指定時は先頭付近に特殊選択肢を追加する。 */
function appendProject2DropdownRow(container, labelText, options, currentValue, onChange, extraOptions = []) {
    const row = document.createElement('div');
    row.className = 'calendar-edit-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const select = document.createElement('select');
    const blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = '（未選択）';
    select.appendChild(blankOpt);
    extraOptions.forEach(({ value, label: text }) => {
        const extraOpt = document.createElement('option');
        extraOpt.value = value;
        extraOpt.textContent = text;
        select.appendChild(extraOpt);
    });
    options.forEach(r => {
        const opt = document.createElement('option');
        opt.value = String(r['ID']);
        opt.textContent = r['タイトル'] || '';
        select.appendChild(opt);
    });
    select.value = currentValue || '';
    select.addEventListener('change', () => onChange(select.value));
    row.append(label, select);
    container.appendChild(row);
}
