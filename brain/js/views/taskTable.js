// タスク一覧（表）とPJ一括編集のビュー（タスク管理タブ下部。チェックしたタスクの親IDをまとめて付け替える。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { formatJpDatetime, getChildren as getChildrenM } from '../modules/task.js?v=66';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData
 *   getListIds                 — タスク一覧でチェック中のID集合（PJ一括編集などと共有）
 *   getNewPjMark               — 親プルダウンの「＋ 新規PJを追加」選択肢の特殊値
 *   getFilteredList            — 一覧に出すタスク（フィルタ適用済み）
 *   getBulkSelectedIds         — 全一覧でチェック中のIDの和集合
 *   clearSelections            — チェックボックスの複数選択をすべて外す
 *   pruneSelection             — 表示されなくなったIDを集合から外す
 *   onCheckboxChange           — チェックボックス変更の共通処理
 *   isChipSelected             — 編集フォームで単独選択中のタスクか
 *   selectTask                 — タスクを単独選択して編集フォームに読み込む
 *   getParentEligibleRows      — 親にできる行の一覧
 *   isParentRowFast            — 子を持つ行か
 *   buildProjectPathFromId     — 親ID → ルートからのID列
 *   sortProjectOptions         — 子孫の多い順に並べる
 *   decorateProjectOptions     — 選択肢に【PJ】を付けて並べる
 *   appendDropdownRow          — 階層プルダウン1段を追加
 *   createNewProjectViaPrompt  — その場で新規プロジェクトを作る
 *   checkParentCycleOrAlert    — 親の付け替えが循環しないか確認（循環ならアラート）
 *   renderParentDropdowns      — 編集フォームの親プルダウンを描き直す
 *   persistLocalCache          — 端末キャッシュへ保存
 *   renderCalendar2            — タスク管理タブ全体を再描画
 * }
 * (4) アウトプット: { render, renderBulkPjDropdowns }
 */
export function createTaskTableView(ctx) {
    const { getMainData, getListIds, getNewPjMark, getFilteredList, getBulkSelectedIds, clearSelections, pruneSelection, onCheckboxChange, isChipSelected, selectTask, getParentEligibleRows, isParentRowFast, buildProjectPathFromId, sortProjectOptions, decorateProjectOptions, appendDropdownRow, createNewProjectViaPrompt, checkParentCycleOrAlert, renderParentDropdowns, persistLocalCache, renderCalendar2 } = ctx;

    let taskorg2BulkPjPath = [];        // タスク整理「PJ一括編集」の階層プルダウンで選択中のID列（個別編集フォームのdayedit2ParentPathとは独立）

    /**
     * タスク整理一番下の「タスク一覧」表を描画する。行クリックで編集対象を切り替える。
     * 左端にチェックボックスを配置し、複数選択→編集エリアの「適用」でPJ(n層)などをまとめて変更したり、
     * 「削除」でまとめて削除したりできる（階層整理の「兄弟を選択して一括移動」の代替）。
     */
    function renderTaskorg2List() {
        const table = document.getElementById('calendar2-task-list-table');
        if (!table) return;

        const tasks = getFilteredList();
        table.className = 'data-table';
        const cols = ['ID', 'タイトル', 'ステータス', '親ID', '開始予定', '終了予定', '完了日'];

        // このエリアに実在しなくなったチェック済みIDは選択から外す（フィルタ変更等で一覧から消えたタスク対策）
        pruneSelection(getListIds(), new Set(tasks.map(r => String(r['ID']))));

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
            if (isChipSelected(rowId)) tr.classList.add('selected-row');

            const tdCheck = document.createElement('td');
            tdCheck.style.textAlign = 'center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = getListIds().has(rowId);
            checkbox.addEventListener('click', (e) => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                onCheckboxChange(getListIds(), rowId, checkbox.checked);
            });
            tdCheck.appendChild(checkbox);
            tr.appendChild(tdCheck);

            cols.forEach(col => { const td = document.createElement('td'); td.textContent = row[col] ?? ''; tr.appendChild(td); });
            tr.addEventListener('click', () => selectTask(rowId));
            tbody.appendChild(tr);
        });

        table.replaceChildren(thead, tbody);
    }

    /**
     * タスク整理「PJ一括編集」の PJ(n層) 階層プルダウンを描画する。編集エリアの階層プルダウン
     * （renderParentDropdowns）と同じ操作感（どの階層でも「＋ 新規PJを追加」でその場に新規プロジェクトを
     * 作成できる）だが、選択状態は taskorg2BulkPjPath として個別編集フォームとは独立に持つ。
     * 「PJ一括編集」ボタンはここで選んだ親IDだけをチェックボックス選択中の全タスクへ適用し、
     * タイトル・ステータスなど他の属性には一切触れない。
     */
    function renderTaskorg2BulkPjDropdowns() {
        const container = document.getElementById('calendar2-bulk-pj-dropdowns');
        if (!container) return;
        container.innerHTML = '';

        const eligibleRows = getParentEligibleRows(null);
        const newPjExtraOption = [{ value: getNewPjMark(), label: '＋ 新規PJを追加' }];

        let level = 0;
        let parentId = ''; // 空文字ならこのレベルはルート階層（親ID空欄）の選択肢を出す
        for (;;) {
            const options = sortProjectOptions(level === 0
                ? eligibleRows.filter(r => !r['親ID'] && (isParentRowFast(r['ID']) || String(r['ID']) === taskorg2BulkPjPath[0]))
                : getChildrenM(eligibleRows, parentId));

            const currentValue = taskorg2BulkPjPath[level] || '';
            const levelForClosure = level;
            const parentIdForClosure = parentId;
            appendDropdownRow(container, `PJ(${level + 1}層)`, decorateProjectOptions(options), currentValue, value => {
                if (value === getNewPjMark()) {
                    const newId = createNewProjectViaPrompt(parentIdForClosure);
                    if (newId) taskorg2BulkPjPath = [...taskorg2BulkPjPath.slice(0, levelForClosure), newId];
                    renderTaskorg2BulkPjDropdowns();
                    return;
                }
                taskorg2BulkPjPath = value ? buildProjectPathFromId(value) : taskorg2BulkPjPath.slice(0, levelForClosure);
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
        const bulkIds = getBulkSelectedIds();
        if (bulkIds.size === 0) { alert('先にタスク一覧などでタスクにチェックを入れてください'); return; }

        const parentId = taskorg2BulkPjPath[taskorg2BulkPjPath.length - 1] || '';
        const rows = [...bulkIds].map(id => getMainData().find(r => String(r['ID']) === id)).filter(Boolean);
        if (rows.some(row => !checkParentCycleOrAlert(row['ID'], parentId))) return;

        const ts = formatJpDatetime(new Date());
        rows.forEach(row => { row['親ID'] = parentId; row['更新日時'] = ts; });
        clearSelections(); // 適用後はチェックボックスを解除し、次回の一括操作に前回の選択が持ち越されないようにする
        persistLocalCache();
        renderCalendar2();
    });

    return { render: renderTaskorg2List, renderBulkPjDropdowns: renderTaskorg2BulkPjDropdowns };
}
