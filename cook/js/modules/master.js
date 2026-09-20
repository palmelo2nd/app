// (1) インポート — cook.js のリスト系フィールドパーサーのみ使用
import { parseListField } from './cook.js?v=6';

/**
 * 各テーブルの固定列と、実データの各行に実際に存在するキーとの和集合を返す。
 * Excelで新しい列を追加した場合でも、この関数経由でチェックすればdataModel.jsを手動修正しなくても認識できる。
 */
export function getAllKnownColumns(tables, columnDefs, masterData, masterColumns) {
    const columns = new Set(masterColumns);
    columnDefs.forEach(cols => cols.forEach(c => columns.add(c)));
    tables.forEach(rows => rows.forEach(row => Object.keys(row).forEach(k => columns.add(k))));
    masterData.forEach(row => Object.keys(row).forEach(k => columns.add(k)));
    return [...columns];
}

/**
 * 各テーブル・マスタデータを照合して警告リストを返す。
 *
 * (2) インプット:
 *   ingredientData, toolData, dishData, mealPlanData, masterData — 各テーブルの配列
 *   columnDefs — [INGREDIENT_COLUMNS, TOOL_COLUMNS, DISH_COLUMNS, MEALPLAN_COLUMNS]
 *   masterColumns — MASTER_DATA_COLUMNS
 * (3) メイン:
 *   - 固定列にあるが masterData 未登録の変数 / masterData にあるが固定列に存在しない変数名
 *   - (M)変数名が入っている行（列名登録行）で、(M)変数分類/(M)変数説明が空の行
 *   - 料理の材料リストが実在しない食材IDを参照している
 *   - 料理の使用調理器具が実在しない調理器具IDを参照している
 *   - 献立の構成料理リストが実在しない料理IDを参照している
 * (4) アウトプット: warnings（string[]）
 */
export function computeMasterWarnings({ ingredientData, toolData, dishData, mealPlanData, masterData }, columnDefs, masterColumns) {
    const warnings = [];
    const ALL_COLUMNS = getAllKnownColumns([ingredientData, toolData, dishData, mealPlanData], columnDefs, masterData, masterColumns);
    const registered  = masterData.map(r => r['(M)変数名']).filter(Boolean);

    const unregistered = ALL_COLUMNS.filter(col => !registered.includes(col));
    if (unregistered.length > 0) {
        warnings.push(`マスタ未登録の変数が ${unregistered.length} 件あります（例: ${unregistered[0]}）`);
    }

    const invalid = registered.filter(name => !ALL_COLUMNS.includes(name));
    if (invalid.length > 0) {
        warnings.push(`存在しない変数名が ${invalid.length} 件あります（例: ${invalid[0]}）`);
    }

    // 「(M)変数名」が入っている行＝列名を登録する目的の行のみを対象にする。
    // カテゴリ/時間帯タグ/ステータスの選択肢を1件1行で登録する行は(M)変数名を空欄のままにする設計のため対象外。
    const incomplete = masterData.filter(r => r['(M)変数名'] && (!r['(M)変数分類'] || !r['(M)変数説明']));
    if (incomplete.length > 0) {
        warnings.push(`列名登録行で未入力の項目がある行が ${incomplete.length} 件あります`);
    }

    const ingredientIds = new Set(ingredientData.map(r => String(r['ID'])));
    const toolIds       = new Set(toolData.map(r => String(r['ID'])));
    const dishIds       = new Set(dishData.map(r => String(r['ID'])));

    const dishesWithMissingIngredient = dishData.filter(row =>
        parseListField(row['材料リスト']).some(item => item.食材ID && !ingredientIds.has(String(item.食材ID)))
    );
    if (dishesWithMissingIngredient.length > 0) {
        warnings.push(`存在しない食材IDを参照している料理が ${dishesWithMissingIngredient.length} 件あります（例: ${dishesWithMissingIngredient[0]['タイトル']}）`);
    }

    const dishesWithMissingTool = dishData.filter(row =>
        parseListField(row['使用調理器具']).some(id => id && !toolIds.has(String(id)))
    );
    if (dishesWithMissingTool.length > 0) {
        warnings.push(`存在しない調理器具IDを参照している料理が ${dishesWithMissingTool.length} 件あります（例: ${dishesWithMissingTool[0]['タイトル']}）`);
    }

    const mealPlansWithMissingDish = mealPlanData.filter(row =>
        parseListField(row['構成料理リスト']).some(item => item.料理ID && !dishIds.has(String(item.料理ID)))
    );
    if (mealPlansWithMissingDish.length > 0) {
        warnings.push(`存在しない料理IDを参照している献立が ${mealPlansWithMissingDish.length} 件あります（例: ${mealPlansWithMissingDish[0]['タイトル']}）`);
    }

    return warnings;
}

/** masterColumns の全キーを空文字で初期化したマスタデータの空行を生成する。 */
export function createEmptyMasterRow(masterColumns) {
    return Object.fromEntries(masterColumns.map(c => [c, '']));
}
