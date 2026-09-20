// (1) インポート — dataModel.js から列定義を参照、XLSX は window.XLSX (CDN) を使用
// キャッシュバスティング用の「?v=N」はjs/app.js冒頭のコメント参照。値を変更する際はそちらと揃えること。
import { INGREDIENT_COLUMNS, TOOL_COLUMNS, DISH_COLUMNS, MEALPLAN_COLUMNS, MASTER_DATA_COLUMNS } from './dataModel.js?v=6';

// Excelの1セルあたりの文字数上限（これを超えると書き込み時にエラーになる）
const EXCEL_CELL_MAX_LENGTH = 32767;

/** 行配列の各セル値のうち、文字列でEXCEL_CELL_MAX_LENGTHを超えるものを切り詰めた複製を返す（元データは変更しない）。 */
function truncateLongCells(rows) {
    return rows.map(row => {
        const copy = { ...row };
        Object.keys(copy).forEach(key => {
            const val = copy[key];
            if (typeof val === 'string' && val.length > EXCEL_CELL_MAX_LENGTH) {
                copy[key] = val.slice(0, EXCEL_CELL_MAX_LENGTH);
            }
        });
        return copy;
    });
}

function buildSheet(wb, rows, fixedColumns, sheetName) {
    const header = [...new Set([...fixedColumns, ...rows.flatMap(r => Object.keys(r))])];
    const safeRows = truncateLongCells(rows);
    const ws = safeRows.length > 0
        ? window.XLSX.utils.json_to_sheet(safeRows, { header })
        : window.XLSX.utils.aoa_to_sheet([header]);
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

/**
 * 5テーブル（食材・調理器具・料理・献立・マスタ）を5シート構成の Excelファイルとしてダウンロードさせる。
 *
 * (2) インプット: data — { ingredientData, toolData, dishData, mealPlanData, masterData }
 * (3) メイン: SheetJS でワークブックを生成し、テーブルごとにシートへ書き込む
 *             データが空でも列ヘッダー行は必ず出力する
 * (4) アウトプット: なし（writeFile がブラウザのダウンロードを直接発火）
 */
export function exportToExcel({ ingredientData, toolData, dishData, mealPlanData, masterData }) {
    const wb = window.XLSX.utils.book_new();

    buildSheet(wb, ingredientData, INGREDIENT_COLUMNS, '食材');
    buildSheet(wb, toolData,       TOOL_COLUMNS,       '調理器具');
    buildSheet(wb, dishData,       DISH_COLUMNS,       '料理');
    buildSheet(wb, mealPlanData,   MEALPLAN_COLUMNS,   '献立');
    buildSheet(wb, masterData,     MASTER_DATA_COLUMNS, 'マスタデータ');

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts  = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
              + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    window.XLSX.writeFile(wb, `${ts}_cook.xlsx`);
}

/**
 * 選択された .xlsx ファイルを読み込み、5テーブルに変換して返す。
 *
 * (2) インプット: file — File オブジェクト（input[type=file] の files[0]）
 * (3) メイン: FileReader で ArrayBuffer に読み込み、SheetJS でパース
 *             シート名「食材／調理器具／料理／献立／マスタデータ」からそれぞれ JSON 配列を生成
 * (4) アウトプット: Promise<{ ingredientData, toolData, dishData, mealPlanData, masterData }>
 */
export function importFromExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const wb   = window.XLSX.read(data, { type: 'array' });
            const sheetToJson = name => wb.Sheets[name] ? window.XLSX.utils.sheet_to_json(wb.Sheets[name]) : [];

            resolve({
                ingredientData: sheetToJson('食材'),
                toolData:       sheetToJson('調理器具'),
                dishData:       sheetToJson('料理'),
                mealPlanData:   sheetToJson('献立'),
                masterData:     sheetToJson('マスタデータ')
            });
        };

        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}
