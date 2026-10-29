// プロジェクト管理表ビュー（タスク管理タブ下部の「プロジェクト管理」。名前変更・統合・削除・下階層のドリルダウン。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { formatJpDatetime, getChildren as getChildrenM, wouldCreateCycle as wouldCreateCycleM, isRecurringParentRow } from '../modules/task.js?v=63';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData
 *   setMainData                — mainDataを差し替える（プロジェクトの削除）
 *   getCategory                — 選択中カテゴリ（「すべて」もあり）
 *   isParentRowFast            — 子を持つ行か（キャッシュ利用）
 *   collectDescendants         — 子孫（全階層）の行一覧
 *   decorateProjectOptions     — プロジェクトの選択肢に【PJ】を付けて子孫数の多い順に並べる
 *   persistLocalCache          — 端末キャッシュへ保存
 * }
 * (4) アウトプット: { render }
 */
export function createProjectAdminView(ctx) {
    const { getMainData, setMainData, getCategory, isParentRowFast, collectDescendants, decorateProjectOptions, persistLocalCache } = ctx;

    // プロジェクト管理表で「下階層」ドリルダウン中の子プロジェクトID（rowId(string) -> 選択中の子プロジェクトID）。
    // 各行は一度に1つの子だけ展開でき、選択し直すと別の子に切り替わる。
    let project2AdminDrilldown = new Map();
    let project2AdminDeletePending = null;      // プロジェクト管理表で「削除」を押して再割り当て/未割り当ての選択待ちになっている行ID

    /** プロジェクト管理表用：他行から親IDとして参照されている「最上位（ルート）」の行を全件返す（繰返しテンプレートは除く）。 */
    function getProject2AllParentRowsForAdmin() {
        let rows = getMainData().filter(r => !r['親ID'] && isParentRowFast(r['ID']) && !isRecurringParentRow(r));
        if (getCategory() !== 'すべて') rows = rows.filter(r => r['カテゴリ'] === getCategory());
        return rows;
    }

    /** プロジェクト管理表の「統合先」「削除時の再割り当て先」の選択肢用：階層を問わず全プロジェクト（子を持つ行）を返す（繰返しテンプレートは除く）。 */
    function getProject2AllProjectRowsFlat() {
        let rows = getMainData().filter(r => isParentRowFast(r['ID']) && !isRecurringParentRow(r));
        if (getCategory() !== 'すべて') rows = rows.filter(r => r['カテゴリ'] === getCategory());
        return rows;
    }


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
        tdCount.textContent = String(collectDescendants(id).length);
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
            const childCount = getChildrenM(getMainData(), id).length;
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
        const subProjects = decorateProjectOptions(getChildrenM(getMainData(), id)).filter(r => r.__childCount > 0);
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
            const childRow = getMainData().find(r => String(r['ID']) === drilledId);
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
            .sort((a, b) => collectDescendants(String(b['ID'])).length - collectDescendants(String(a['ID'])).length);
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
        if (wouldCreateCycleM(getMainData(), sourceId, targetId)) {
            alert('この統合は循環参照になるため実行できません。');
            return;
        }
        const ts = formatJpDatetime(new Date());
        getChildrenM(getMainData(), sourceId).forEach(child => {
            child['親ID']   = targetId;
            child['更新日時'] = ts;
        });
        const sourceRow = getMainData().find(r => String(r['ID']) === sourceId);
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
        getChildrenM(getMainData(), projectId).forEach(child => {
            child['親ID']   = reassignToId || '';
            child['更新日時'] = ts;
        });
        setMainData(getMainData().filter(r => String(r['ID']) !== projectId));
        persistLocalCache();

        project2AdminDeletePending = null;
        project2AdminDrilldown.clear(); // 削除で階層が変わるため、プロジェクト管理表のドリルダウン状態はリセットする
        renderProject2AdminTable();
    }

    return { render: renderProject2AdminTable };
}
