// 対応中／対応待ち／属性未設定タスクの一覧ビュー（タスク管理タブの1日タスクの下のExpander群。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { formatJpDatetime, isRecurringParentRow, isNormalTaskRow } from '../modules/task.js?v=66';
import { compareDateAscEmptyLast, getSuspendedTasks as getSuspendedTasksM, getTasksByStatus as getTasksByStatusM } from '../modules/calendar.js?v=66';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData
 *   getCategory                — 選択中カテゴリ（「すべて」もあり）
 *   getSelectedDate            — 選択中の日（YYYY/MM/DD）
 *   getInProgressIds           — 対応中タスク（期限切れ含む）でチェック中のID集合
 *   getWaitingIds              — 対応待ちタスクでチェック中のID集合
 *   getUnsetIds                — 属性未設定タスクでチェック中のID集合
 *   getBaseFilteredList        — カテゴリ・フィルタ適用済みの行（日付絞り込みなし）
 *   matchesCommonFilters       — 行がタスク管理タブのフィルタを満たすか
 *   getSegmentsForDate         — 選択日のタイムラインの区間（未設定・参照済みのタスク）
 *   pruneSelection             — 表示されなくなったIDを集合から外す
 *   renderChipList             — チップ一覧を描画（共通）
 *   renderGroupedChips         — ステータスごとにまとめたチップ一覧を描画（共通）
 *   setExpanderCount           — Expanderの件数バッジを設定
 *   setExpanderCountPair       — Expanderの件数バッジ（2つの数）を設定
 *   jpDateOnly                 — 日時文字列の日付部分
 *   parseSlashDateOnly         — YYYY/MM/DD を Date に（日付部分が無ければ null）
 * }
 * (4) アウトプット: { render }
 */
export function createTaskListsView(ctx) {
    const { getMainData, getCategory, getSelectedDate, getInProgressIds, getWaitingIds, getUnsetIds, getBaseFilteredList, matchesCommonFilters, getSegmentsForDate, pruneSelection, renderChipList, renderGroupedChips, setExpanderCount, setExpanderCountPair, jpDateOnly, parseSlashDateOnly } = ctx;

    /**
     * カテゴリ／ステータス／プロジェクト（親ID）／日付それぞれが未設定のタスクを、領域ごとに分けて返す（重複あり）。
     * 優先度は高・低だけを付け普通は空欄にする運用のため、対象にしない（2026-10-30）。
     * 5つの領域とも、母集団は同じ：通常のタスク（繰返しテンプレートを除く）のうち、taskorg2フィルタ（ステータス・プロジェクト・その他）を満たし、
     * 完了・中断ではないもの（打ち切ったタスクには属性が不要なため。2026-10-29）。カテゴリは選択中のカテゴリに一致するか未入力のもの
     * （未入力の行もカテゴリ領域に出すため）。日付は開始予定・終了予定の少なくとも一方に日付部分が無いもの（空欄・時刻のみ）。
     */
    function getTaskorg2UnsetAttributeGroups() {
        const hasDate = v => !!parseSlashDateOnly(v);
        const pool = getMainData().filter(r =>
            isNormalTaskRow(r) && !isRecurringParentRow(r) &&
            (getCategory() === 'すべて' || !r['カテゴリ'] || r['カテゴリ'] === getCategory()) &&
            !TASKORG2_CLOSED_STATUSES.has(r['ステータス']) &&
            matchesCommonFilters(r)
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
        return getBaseFilteredList().filter(r => {
            if (!isNormalTaskRow(r) || TASKORG2_CLOSED_STATUSES.has(r['ステータス'])) return false;
            const end = parseSlashDateOnly(r['終了予定']);
            return !!end && jpDateOnly(r['終了予定']) < todayJP;
        }).sort((a, b) => compareDateAscEmptyLast(a['終了予定'], b['終了予定']));
    }

    /** ステータスが「中断」のタスクを、中断した日の新しい順に { row, date } で返す（日付の条件なし。フィルタは適用しない）。 */
    function getTaskorg2SuspendedTasks() {
        const todayJP = jpDateOnly(formatJpDatetime(new Date()));
        return getSuspendedTasksM(getMainData(), getCategory(), todayJP);
    }

    /** ステータスが「連絡待ち」で、対応中タスクに該当しないタスクを返す。 */
    function getTaskorg2WaitingContactTasks() {
        const todayJP = jpDateOnly(formatJpDatetime(new Date()));
        return getTasksByStatusM(getMainData(), getCategory(), '連絡待ち', todayJP);
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
            renderChipList(unsetCategoryEl, toChips(unsetGroups.categoryUnset), '該当なし', { selectionSet: getUnsetIds() });
            renderChipList(unsetStatusEl,   toChips(unsetGroups.statusUnset),   '該当なし', { selectionSet: getUnsetIds() });
            renderChipList(unsetProjectEl,  toChips(unsetGroups.projectUnset),  '該当なし', { selectionSet: getUnsetIds() });
        }
        setExpanderCount('calendar2-unset-category-count', unsetGroups.categoryUnset.length);
        setExpanderCount('calendar2-unset-status-count',   unsetGroups.statusUnset.length);
        setExpanderCount('calendar2-unset-project-count',  unsetGroups.projectUnset.length);

        const incompleteTasks = unsetGroups.dateUnset;
        const incompleteChips = incompleteTasks.map(row => ({ row, label: row['タイトル'] || '（無題）' }));
        if (unsetOpen) renderChipList(incompleteEl, incompleteChips, '該当なし', { selectionSet: getUnsetIds() });
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
        pruneSelection(getUnsetIds(), unsetValidIds);

        const waitingContactChips = toChips(getTaskorg2WaitingContactTasks());
        // 中断：チップの先頭に中断した日を付ける（今年はMM/DD、それ以外はYYYY/MM/DD）
        const thisYear = String(new Date().getFullYear());
        const suspendedChips = getTaskorg2SuspendedTasks().map(({ row, date }) => ({
            row,
            label: `${date ? (date.startsWith(thisYear + '/') ? date.slice(5) : date) + ' ' : ''}${row['タイトル'] || '（無題）'}`,
        }));
        if (waitingOpen) {
            renderChipList(waitingContactEl, waitingContactChips, '該当なし', { selectionSet: getWaitingIds() });
            renderChipList(suspendedEl,      suspendedChips,      '該当なし', { selectionSet: getWaitingIds() });
        }
        setExpanderCount('calendar2-waitingcontact-count', waitingContactChips.length);
        setExpanderCount('calendar2-suspended-count',      suspendedChips.length);
        setExpanderCount('calendar2-waiting-total-count',
            waitingContactChips.length + suspendedChips.length);

        // このエリア（対応待ちタスク）に実在しなくなったチェック済みIDは選択から外す
        const waitingValidIds = new Set(
            [...waitingContactChips, ...suspendedChips].map(c => String(c.row['ID']))
        );
        pruneSelection(getWaitingIds(), waitingValidIds);

        if (!getSelectedDate()) {
            if (inProgressOpen) {
                if (unscheduledEl)  unscheduledEl.innerHTML = '';
                if (dayplanAddedEl) dayplanAddedEl.innerHTML = '';
            }
            setExpanderCountPair('calendar2-todo-dayplan-count', 0, 0);
            getInProgressIds().clear();
            return;
        }

        // 期限切れ（選択日ではなく今日を基準にする）
        const overdueChips = toChips(getTaskorg2OverdueTasks());
        if (inProgressOpen) renderChipList(overdueEl, overdueChips, '該当なし', { selectionSet: getInProgressIds() });
        setExpanderCount('calendar2-overdue-count', overdueChips.length);
        overdueLabelEl?.classList.toggle('calendar-section-label--overdue', overdueChips.length > 0);

        const { timed, unscheduled, referenced } = getSegmentsForDate(getSelectedDate());
        const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const chipEntries = [
            ...unscheduled.map(row => ({ row, label: row['タイトル'] || '（無題）' })),
            ...timed.filter(seg => seg.row['ID'] != null && !seg.isDayPlanBlock)
                    .map(seg => ({ row: seg.row, label: `${fmt(seg.startMin)}–${fmt(seg.endMin)} ${seg.row['タイトル'] || '（無題）'}` })),
        ];
        chipEntries.sort((a, b) => compareDateAscEmptyLast(a.row['終了予定'], b.row['終了予定']));

        const referencedChips = referenced.map(row => ({ row, label: row['タイトル'] || '（無題）' }));
        if (inProgressOpen) {
            renderGroupedChips(unscheduledEl, chipEntries, 'この日のタスクはありません', { showAddButton: true, selectionSet: getInProgressIds() });
            renderGroupedChips(dayplanAddedEl, referencedChips, 'まだありません', { selectionSet: getInProgressIds() });
        }

        setExpanderCountPair('calendar2-todo-dayplan-count', chipEntries.length, referencedChips.length);

        // このエリア（対応中タスク）に実在しなくなったチェック済みIDは選択から外す
        const inProgressValidIds = new Set([...chipEntries, ...referencedChips, ...overdueChips].map(c => String(c.row['ID'])));
        pruneSelection(getInProgressIds(), inProgressValidIds);
    }

    return { render: renderTaskorg2UnsetSection };
}
