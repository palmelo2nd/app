// Infoビュー（README表示・メインデータ／マスタデータの生テーブル。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。
// 外部ライブラリ marked.js は index.html でCDNロードし、window.marked 経由で使う。

// (1) インポート
import { MAIN_DATA_COLUMNS, MASTER_DATA_COLUMNS, formatCellValue } from '../modules/dataModel.js?v=66';
import { createEmptyMasterRow } from '../modules/master.js?v=66';

/**
 * (2) インプット: ctx = {
 *   getToken()                — 入力中のGitHubトークン
 *   fetchReadme(token)        — コードリポジトリのREADME.mdを取得（{ content }を返す）
 *   getMainData() / getMasterData() — 現在のmainData・masterData（配列。行の追加・編集はこの配列を直接書き換える）
 *   getFilteredMainData()     — 選択中カテゴリで絞り込んだmainData
 *   getCategory()             — 選択中カテゴリ（「すべて」もあり）
 *   persistLocalCache()       — 端末キャッシュへ保存
 *   refreshWarnings()         — マスタの整合性警告を描き直す
 *   renderProjectAdminTable() — プロジェクト管理表を描き直す（マスタ編集時）
 * }
 * (4) アウトプット: { renderDataTables } — 開いているデータ表だけを描画する
 */
export function createInfoView(ctx) {
    const { getToken, fetchReadme, getMainData, getMasterData, getFilteredMainData, getCategory, persistLocalCache, refreshWarnings, renderProjectAdminTable } = ctx;

    /** コードリポジトリのREADME.md（アプリ概要）を取得しMarkdownとして表示する。 */
    async function loadInfoReadme() {
        const el = document.getElementById('info-content');
        const token = getToken();
        if (!token) { el.textContent = 'トークンを入力してください。'; return; }

        el.textContent = '読み込み中...';

        try {
            const { content } = await fetchReadme(token);
            el.innerHTML = window.marked.parse(content);
        } catch (error) {
            console.error(error);
            el.textContent = `読み込みに失敗しました: ${error.message}`;
        }
    }

    // Infoタブを開いたとき、トークンが入力済みなら自動的に読み込む
    // READMEは「アプリ概要」Expanderを開いたときに読み込む（既定は閉じているため、タブを開いただけでは取得しない）
    document.getElementById('info-readme-toggle')?.addEventListener('toggle', (e) => {
        if (e.target.open && getToken()) loadInfoReadme();
    });

    /**
     * InfoタブのメインデータExpander・マスタデータExpanderのうち、開いているものだけ表を描画する
     * （メインデータは800行超あり重いため、閉じている間は描画しない。開いた瞬間はtoggleイベント側で描画）。
     */
    function renderDataTables() {
        if (document.getElementById('info-main-toggle')?.open) {
            renderDataTable('table-main', 'summary-main', getFilteredMainData(), MAIN_DATA_COLUMNS, 'メインデータ', { editable: true, idColumn: 'ID' });
        }
        if (document.getElementById('info-master-toggle')?.open) {
            renderDataTable('table-master', 'summary-master', getMasterData(), MASTER_DATA_COLUMNS, 'マスタデータ', { editable: true, onEdit: () => { refreshWarnings(); renderProjectAdminTable(); } });
        }
    }
    ['info-main-toggle', 'info-master-toggle'].forEach(id => {
        document.getElementById(id)?.addEventListener('toggle', (e) => { if (e.target.open) renderDataTables(); });
    });

    document.getElementById('info-reload-btn')?.addEventListener('click', loadInfoReadme);

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

    /** 空のマスタデータ行を1件追加し、マスタデータ一覧テーブルを再描画する。 */
    function addMasterRow() {
        getMasterData().push(createEmptyMasterRow(MASTER_DATA_COLUMNS));
        persistLocalCache();
        renderDataTable('table-master', 'summary-master', getMasterData(), MASTER_DATA_COLUMNS, 'マスタデータ', { editable: true, onEdit: () => refreshWarnings() });
        refreshWarnings();
    }

    document.getElementById('add-master-data-row-btn')?.addEventListener('click', addMasterRow);

    /** 空のメインデータ行を1件追加し、メインデータ一覧テーブルを再描画する。 */
    document.getElementById('add-main-row-btn')?.addEventListener('click', () => {
        const mainData = getMainData();
        const maxId = mainData.reduce((max, row) => {
            const id = parseInt(row['ID'], 10);
            return isNaN(id) ? max : Math.max(max, id);
        }, 0);

        const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
        entry['ID']      = String(maxId + 1);
        const category = getCategory();
        entry['カテゴリ'] = category === 'すべて' ? '' : category;

        mainData.push(entry);
        persistLocalCache();

        renderDataTable('table-main', 'summary-main', getFilteredMainData(), MAIN_DATA_COLUMNS, 'メインデータ', { editable: true, idColumn: 'ID' });
    });

    return { renderDataTables };
}
