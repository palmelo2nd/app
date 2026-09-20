// (1) インポート — なし（純粋な文字列/オブジェクト変換のみ）

// 食材・調理器具・料理・献立は、それぞれ列構成が大きく異なるため別テーブル（別配列）として管理する
// （brainのタスク/ナレッジのように列を共用する場合と異なり、混在させると各行がスカスカになるため）。
export const INGREDIENT_COLUMNS = [
    'ID', 'タイトル', 'カテゴリ', 'タグ',
    '前処理・切り方ノウハウ', '保存方法・注意点', '代替食材',
    '作成日時', '更新日時', '備考'
];

export const TOOL_COLUMNS = [
    'ID', 'タイトル', 'カテゴリ', '使い方・注意点',
    '作成日時', '更新日時', '備考'
];

export const DISH_COLUMNS = [
    'ID', 'タイトル', 'カテゴリ', 'タグ', '時間帯タグ', '想定人数',
    '調理時間', '難易度', 'ステータス',
    '材料リスト', '使用調理器具', '前処理', '調理手順', '調理ログ',
    '作成日時', '更新日時', '備考'
];

export const MEALPLAN_COLUMNS = [
    'ID', 'タイトル', '時間帯タグ', '想定人数', 'ステータス',
    '構成料理リスト',
    '作成日時', '更新日時', '備考'
];

export const MASTER_DATA_COLUMNS = [
    '(M)変数名', '(M)変数分類', '(M)変数説明',
    '(M)カテゴリ_食材', '(M)カテゴリ_調理器具', '(M)カテゴリ_料理',
    '(M)タグ候補',
    '(M)時間帯タグ',
    '(M)ステータス_親', '(M)ステータス_子',
    '(M)難易度'
];

/**
 * MarkdownのFront Matterから5つのテーブル（食材・調理器具・料理・献立・マスタ）を抽出する。
 *
 * (2) インプット: mdText — Front Matterを含む可能性があるMarkdown文字列
 * (3) メイン: "---\n...\n---" の正規表現でFront Matter部分を取り出し JSON.parse
 * (4) アウトプット: { ingredientData, toolData, dishData, mealPlanData, masterData }（いずれもArray）
 */
export function parseMarkdown(mdText) {
    const empty = { ingredientData: [], toolData: [], dishData: [], mealPlanData: [], masterData: [] };

    const match = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return empty;

    try {
        const parsed = JSON.parse(match[1]);
        return {
            ingredientData: Array.isArray(parsed.ingredientData) ? parsed.ingredientData : [],
            toolData:       Array.isArray(parsed.toolData)       ? parsed.toolData       : [],
            dishData:       Array.isArray(parsed.dishData)       ? parsed.dishData       : [],
            mealPlanData:   Array.isArray(parsed.mealPlanData)   ? parsed.mealPlanData   : [],
            masterData:     Array.isArray(parsed.masterData)     ? parsed.masterData     : []
        };
    } catch {
        return empty;
    }
}

/**
 * 5つのテーブルをFront Matter形式のMarkdown文字列に変換する。
 *
 * (2) インプット: data — { ingredientData, toolData, dishData, mealPlanData, masterData }
 * (3) メイン: JSON.stringify でシリアライズし、--- で囲むFront Matter構造を組み立てる
 * (4) アウトプット: Front Matter付きMarkdown文字列
 */
export function stringifyMarkdown(data) {
    const payload = JSON.stringify(data, null, 2);
    return `---\n${payload}\n---\n\n# 料理データ一覧\n`;
}
