// プロジェクトツリービュー（親ID方式の階層を折りたたみ可能なインデント付きツリーで一覧表示。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { getCalendarStatusClass } from '../modules/calendar.js?v=63';

// 子タスクの並び順（同じ親の配下での表示順）。この順にグループ化し、リストに無いステータス・空欄は最後尾。
const PROJECT_TREE_CHILD_STATUS_ORDER = ['完了', '連絡待ち', '中断', '進行中', '未着手'];

/** ステータス名の子タスク表示順ランクを返す（完了→連絡待ち→中断→進行中→未着手→その他（未設定含む）の順）。 */
function projectTreeChildStatusRank(status) {
    const idx = PROJECT_TREE_CHILD_STATUS_ORDER.indexOf(status);
    return idx !== -1 ? idx : PROJECT_TREE_CHILD_STATUS_ORDER.length;
}

/** 子タスク配列（表示順ソート済み）をステータスごとにグループ化し、PROJECT_TREE_CHILD_STATUS_ORDER順で返す。グループ内の順序は元の並びを維持する。 */
function groupProjectTreeChildrenByStatus(rows) {
    const groups = new Map();
    rows.forEach(row => {
        const status = row['ステータス'] || '（未設定）';
        if (!groups.has(status)) groups.set(status, []);
        groups.get(status).push(row);
    });
    return [...groups.keys()]
        .sort((a, b) => projectTreeChildStatusRank(a) - projectTreeChildStatusRank(b))
        .map(status => ({ status, rows: groups.get(status) }));
}

/**
 * (2) インプット: ctx = {
 *   getPool()                       — 表示対象の行（フィルタ適用済み。app.jsのgetTaskorg2ProjectTreePool）
 *   getMainData()                   — 現在のmainData（子孫総数の集計に使う。フィルタ非適用）
 *   getSelectedIds()                — チェック中のID集合（PJ一括編集の対象。app.js側で持つ）
 *   pruneSelection(set, validIds)   — 表示されなくなったIDを集合から外す
 *   onCheckboxChange(set, id, checked) — チェックボックス変更の共通処理
 *   isChipSelected(id)              — 編集フォームで単独選択中のタスクか
 *   appendChipLabel(el, row, text)  — 優先度ドット＋タイトルを付ける
 *   selectTask(id)                  — タスクを単独選択して編集フォームに読み込む
 * }
 * (4) アウトプット: { render } — ツリー全体を再描画する関数
 */
export function createProjectTreeView(ctx) {
    const { getPool, getMainData, getSelectedIds, pruneSelection, onCheckboxChange, isChipSelected, appendChipLabel, selectTask } = ctx;

    // ユーザーが手動で開閉した行ID→折りたたみ中か（true=折りたたみ）。既定は子を持つ行をすべて折りたたむ
    const manualStateIds = new Map();

    /**
     * 新タスク整理の「プロジェクト」ツリービューを描画する。行クリックで下の編集フォームに読み込み、▶/▼クリックで子の展開・折りたたみを切り替える。
     * 各行の左端にチェックボックスを配置し、選択中IDは ctx.getSelectedIds() の集合（app.jsのgetTaskorg2BulkSelectedIds経由でPJ一括編集の対象）に加える。
     * 親・子どちらの階層行でもチェック可能で、「PJ一括編集」バーのPJ(n層)プルダウンで選んだ親IDを一括適用できる。
     * ルート階層・各親の配下いずれも、完了→連絡待ち→中断→進行中→未着手→（未設定）の順にステータスで
     * グループ化するのを最優先の並び順とし、各グループ内は子孫総数（子・孫以降を含む総数）が多い順に並べる
     * （見出し行は表示せず、並び順のみに使う）。
     */
    function render() {
        const container = document.getElementById('calendar2-project-tree');
        if (!container) return;
        container.innerHTML = '';

        const pool = getPool();
        const selectedIds = getSelectedIds();
        pruneSelection(selectedIds, new Set(pool.map(r => String(r['ID']))));

        // 表示対象（フィルタ適用後）の「親ID→子一覧」を1回の走査だけでインデックス化する（画面に出す階層構造用）。
        const poolChildrenIndex = new Map();
        pool.forEach(r => {
            const key = String(r['親ID'] || '');
            if (!poolChildrenIndex.has(key)) poolChildrenIndex.set(key, []);
            poolChildrenIndex.get(key).push(r);
        });

        // 子孫総数（フィルタ非適用・全データ基準。従来のcollectProject2Descendantsと同じ集計対象）も、
        // 「親ID→子一覧」インデックス＋メモ化で1回の走査だけで求める（並び順・件数表示の両方に使い回す）。
        // pool.filter+collectProject2Descendantsを行ごとに呼ぶ従来実装はノード数の2乗規模で重かったための対策。
        const allChildrenIndex = new Map();
        getMainData().forEach(r => {
            const key = String(r['親ID'] || '');
            if (!allChildrenIndex.has(key)) allChildrenIndex.set(key, []);
            allChildrenIndex.get(key).push(r);
        });
        const descendantCountCache = new Map();
        const countDescendants = (id, visited = new Set()) => {
            const key = String(id);
            if (descendantCountCache.has(key)) return descendantCountCache.get(key);
            if (visited.has(key)) return 0; // 循環データ保護
            visited.add(key);
            const kids = allChildrenIndex.get(key) || [];
            let total = kids.length;
            kids.forEach(child => { total += countDescendants(child['ID'], visited); });
            descendantCountCache.set(key, total);
            return total;
        };

        const childrenOf = parentId => {
            const kids = poolChildrenIndex.get(String(parentId || '')) || [];
            return [...kids].sort((a, b) => countDescendants(b['ID']) - countDescendants(a['ID']));
        };
        const roots = childrenOf('');

        if (roots.length === 0) {
            container.innerHTML = '<p class="empty-cell">該当するタスクがありません</p>';
            return;
        }

        /**
         * rows（同じ親を持つ行の配列。事前に子孫総数の多い順にソート済み）を、完了→連絡待ち→中断→
         * 進行中→未着手→（未設定）の順にステータスでグループ化し、depth階層のインデントで区切り見出し行を描画する。
         * groupKeyPrefix はルート階層なら 'root'、子階層なら親行のIDを渡す（開閉状態のキーを親ごとに独立させるため）。
         */
        const renderStatusGroupedRows = (rows, depth, buildRow) => {
            groupProjectTreeChildrenByStatus(rows).forEach(group => {
                group.rows.forEach(child => buildRow(child, depth));
            });
        };

        const buildRow = (row, depth) => {
            const id = String(row['ID']);
            const kids = childrenOf(id);
            const hasKids = kids.length > 0;
            // 既定では子を持つ行はすべて折りたたんでおく。手動で開閉した行はその状態を優先する。
            const defaultCollapsed = hasKids;
            const collapsed = manualStateIds.has(id) ? manualStateIds.get(id) : defaultCollapsed;

            const line = document.createElement('div');
            line.className = 'project-tree-row';
            if (isChipSelected(id)) line.classList.add('selected-row');
            line.style.paddingLeft = `${depth * 20}px`;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'project-tree-checkbox';
            checkbox.checked = selectedIds.has(id);
            checkbox.addEventListener('click', e => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                onCheckboxChange(selectedIds, id, checkbox.checked);
            });
            line.appendChild(checkbox);

            const toggle = document.createElement('span');
            toggle.className = 'project-tree-toggle';
            toggle.textContent = hasKids ? (collapsed ? '▶' : '▼') : '';
            if (hasKids) {
                toggle.addEventListener('click', e => {
                    e.stopPropagation();
                    manualStateIds.set(id, !collapsed);
                    render();
                });
            }
            line.appendChild(toggle);

            const descendantCount = countDescendants(id); // 直属の子だけでなく孫以降も含めた総数（メモ化済み）
            const label = document.createElement('span');
            label.className = `project-tree-label ${getCalendarStatusClass(row['ステータス'])}`;
            appendChipLabel(label, row, (row['タイトル'] || '（無題）') + (descendantCount > 0 ? ` (${descendantCount})` : ''));
            line.appendChild(label);

            line.addEventListener('click', () => selectTask(id));

            container.appendChild(line);

            if (hasKids && !collapsed) renderStatusGroupedRows(kids, depth + 1, buildRow);
        };

        renderStatusGroupedRows(roots, 0, buildRow);
    }

    return { render };
}
