// タスク管理タブのフィルタの描画（ステータス・その他フィルタ・プロジェクト・PJ(n層)ドリルダウン。上部と下部の2か所に同じ状態の複製を描く。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { getChildren as getChildrenM } from '../modules/task.js?v=65';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData
 *   getFilters                 — フィルタの状態（status・project の集合と表示ON/OFF。中身はこのビューが書き換える）
 *   getKnownOptions            — これまでに見た選択肢（新しい選択肢だけを既定でONにするため）
 *   getDrilldownPath           — PJ(n層)ドリルダウンで選択中のID列
 *   setDrilldownPath           — PJ(n層)ドリルダウンの選択を変える
 *   getRootProjectRows         — プロジェクト（最上位の親）の行一覧
 *   renderCalendar2            — タスク管理タブ全体を再描画
 *   createMultiFilter          — 複数選択フィルタの部品を作る
 *   seedFilterOptionSet        — 新しい選択肢を既定でONにする
 *   getFilteredTaskStatuses    — ステータスの選択肢
 *   sortByTotalCountDesc       — 件数の多い順に並べる
 *   countActiveTasksByField    — 未完了の件数
 *   countTasksByField          — 全件数
 *   countProjectTasks          — プロジェクト配下のタスク件数
 *   sortProjectOptions         — 子孫の多い順に並べる
 *   decorateProjectOptions     — 選択肢に【PJ】を付けて並べる
 *   appendDropdownRow          — 階層プルダウン1段を追加
 * }
 * (4) アウトプット: { render }
 */
export function createFiltersView(ctx) {
    const { getMainData, getFilters, getKnownOptions, getDrilldownPath, setDrilldownPath, getRootProjectRows, renderCalendar2, createMultiFilter, seedFilterOptionSet, getFilteredTaskStatuses, sortByTotalCountDesc, countActiveTasksByField, countTasksByField, countProjectTasks, sortProjectOptions, decorateProjectOptions, appendDropdownRow } = ctx;

    /**
     * 新タスク整理のフィルタを描画する。上部（カレンダーエリア）と下部（タスク一覧の直上）の2箇所に、
     * 同じ状態（getFilters()／getDrilldownPath()）を参照する複製フィルタとして描画することで、
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

            const ctrl = createMultiFilter(options, selectedSet, buildLabel, () => renderCalendar2());
            row.append(lbl, selectAllBtn, deselectAllBtn, ctrl);
            area.appendChild(row);
        }

        const statusOptions = sortByTotalCountDesc(getFilteredTaskStatuses(), 'ステータス');
        seedFilterOptionSet(statusOptions, getFilters().status, getKnownOptions().status);
        makeRow('ステータス', statusOptions, getFilters().status, v => `${v} (${countActiveTasksByField('ステータス', v)}/${countTasksByField('ステータス', v)})`);

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
            cb.checked = getFilters()[key];
            cb.addEventListener('change', () => {
                getFilters()[key] = cb.checked;
                renderCalendar2();
            });
            cbLabel.append(cb, document.createTextNode(label));
            otherRow.appendChild(cbLabel);
        });
        area.appendChild(otherRow);

        // プロジェクト＝最上位の親IDのタイトルをボタンとして表示（中間階層の親IDは束ねてカウント、旧タスク整理と同様の選び方）
        const projectRowsSorted = [...getRootProjectRows()]
            .sort((a, b) => countProjectTasks(String(b['ID']), false) - countProjectTasks(String(a['ID']), false));
        const projectIds = projectRowsSorted.map(r => String(r['ID']));
        seedFilterOptionSet(projectIds, getFilters().project, getKnownOptions().project);
        makeRow('プロジェクト', projectIds, getFilters().project, id => {
            const row = projectRowsSorted.find(r => String(r['ID']) === id);
            return `${row ? (row['タイトル'] || `#${id}`) : `#${id}`} (${countProjectTasks(id, true)}/${countProjectTasks(id, false)})`;
        });

        const drilldownContainer = document.createElement('div');
        drilldownContainer.className = 'calendar-project-drilldown';
        area.appendChild(drilldownContainer);
        // PJ(1層)の選択肢は、プロジェクトのチェックボックスで選択中のものだけに絞る
        const checkedRootProjectRows = projectRowsSorted.filter(r => getFilters().project.has(String(r['ID'])));
        // チェックを外した結果、ドリルダウンの選択中PJ(1層)が選択肢から外れた場合は選択状態をクリアする
        if (getDrilldownPath()[0] && !checkedRootProjectRows.some(r => String(r['ID']) === getDrilldownPath()[0])) {
            setDrilldownPath([]);
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
                : sortProjectOptions(getChildrenM(getMainData(), parentId));
            const currentValue = getDrilldownPath()[level] || '';
            const levelForClosure = level;

            appendDropdownRow(container, `PJ(${level + 1}層)`, decorateProjectOptions(options), currentValue, value => {
                setDrilldownPath(value
                    ? [...getDrilldownPath().slice(0, levelForClosure), value]
                    : getDrilldownPath().slice(0, levelForClosure));
                renderCalendar2();
            });

            if (!currentValue) break; // このレベルで何も選ばれていなければ、これ以上下の階層は出さない
            parentId = currentValue;
            level++;
        }
    }

    /** 新タスク整理のタスク一覧テーブルを描画する。行クリックで編集対象を切り替える。 */

    return { render: renderTaskorg2Filters };
}
