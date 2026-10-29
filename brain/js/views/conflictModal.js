// 競合解決モーダル（保存・読込時のマージで、真の競合を実データで見比べてユーザーに選ばせる。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態は使わないため ctx は無く、resolveMergeConflicts だけを export する。

// (1) インポート
import { MAIN_DATA_COLUMNS, formatCellValue } from '../modules/dataModel.js?v=64';
import { pickNewer, reassignDuplicatedParentChildren } from '../modules/merge.js?v=64';

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
export async function resolveMergeConflicts(merged, conflicts, localRows, remoteRows, silent) {
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
