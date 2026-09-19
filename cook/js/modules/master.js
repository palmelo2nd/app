// (1) インポート — cook.js のリスト系フィールドパーサーのみ使用
import { isDishRow, isMealPlanRow, isIngredientRow, isToolRow, parseListField } from './cook.js?v=2';

/**
 * dataModel.js の固定列と、実データ（mainData/masterData）の各行に実際に存在するキーとの和集合を返す。
 * Excelで新しい列を追加した場合でも、この関数経由でチェックすればdataModel.jsを手動修正しなくても認識できる。
 */
export function getAllKnownColumns(mainData, masterData, mainColumns, masterColumns) {
    const columns = new Set([...mainColumns, ...masterColumns]);
    mainData.forEach(row => Object.keys(row).forEach(k => columns.add(k)));
    masterData.forEach(row => Object.keys(row).forEach(k => columns.add(k)));
    return [...columns];
}

/**
 * mainColumns/masterColumns と masterData・mainData を照合して警告リストを返す。
 * - 固定列にあるが masterData 未登録の変数 / masterData にあるが固定列に存在しない変数名
 * - (M)変数名/(M)変数分類/(M)変数説明のいずれかが空の行
 * - 料理の材料リストが実在しない食材IDを参照している
 * - 料理の使用調理器具が実在しない調理器具IDを参照している
 * - 献立の構成料理リストが実在しない料理IDを参照している
 */
export function computeMasterWarnings(mainData, masterData, mainColumns, masterColumns) {
    const warnings = [];
    const ALL_COLUMNS = getAllKnownColumns(mainData, masterData, mainColumns, masterColumns);
    const registered  = masterData.map(r => r['(M)変数名']).filter(Boolean);

    const unregistered = ALL_COLUMNS.filter(col => !registered.includes(col));
    if (unregistered.length > 0) {
        warnings.push(`マスタ未登録の変数が ${unregistered.length} 件あります（例: ${unregistered[0]}）`);
    }

    const invalid = registered.filter(name => !ALL_COLUMNS.includes(name));
    if (invalid.length > 0) {
        warnings.push(`存在しない変数名が ${invalid.length} 件あります（例: ${invalid[0]}）`);
    }

    const incomplete = masterData.filter(r =>
        !r['(M)変数名'] || !r['(M)変数分類'] || !r['(M)変数説明']
    );
    if (incomplete.length > 0) {
        warnings.push(`未入力の項目がある行が ${incomplete.length} 件あります`);
    }

    const ingredientIds = new Set(mainData.filter(isIngredientRow).map(r => String(r['ID'])));
    const toolIds       = new Set(mainData.filter(isToolRow).map(r => String(r['ID'])));
    const dishIds       = new Set(mainData.filter(isDishRow).map(r => String(r['ID'])));

    const dishesWithMissingIngredient = mainData.filter(row =>
        isDishRow(row) && parseListField(row['材料リスト']).some(item => item.食材ID && !ingredientIds.has(String(item.食材ID)))
    );
    if (dishesWithMissingIngredient.length > 0) {
        warnings.push(`存在しない食材IDを参照している料理が ${dishesWithMissingIngredient.length} 件あります（例: ${dishesWithMissingIngredient[0]['タイトル']}）`);
    }

    const dishesWithMissingTool = mainData.filter(row =>
        isDishRow(row) && parseListField(row['使用調理器具']).some(id => id && !toolIds.has(String(id)))
    );
    if (dishesWithMissingTool.length > 0) {
        warnings.push(`存在しない調理器具IDを参照している料理が ${dishesWithMissingTool.length} 件あります（例: ${dishesWithMissingTool[0]['タイトル']}）`);
    }

    const mealPlansWithMissingDish = mainData.filter(row =>
        isMealPlanRow(row) && parseListField(row['構成料理リスト']).some(item => item.料理ID && !dishIds.has(String(item.料理ID)))
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
