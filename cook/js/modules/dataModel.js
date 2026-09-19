// (1) インポート — なし（純粋な文字列/オブジェクト変換のみ）

// mainData: 食材／調理器具／料理／献立を「データ区分」列で区別し1テーブルに混在させる（brainのタスク/ナレッジ混在と同じ考え方）
export const MAIN_DATA_COLUMNS = [
    'ID', 'データ区分', 'タイトル', 'カテゴリ', 'タグ', 'ステータス', '作成日時', '更新日時', '備考',
    // 食材
    '前処理・切り方ノウハウ', '保存方法・注意点', '代替食材',
    // 調理器具
    '使い方・注意点',
    // 料理・献立 共通
    '想定人数', '時間帯タグ',
    // 料理
    '調理時間', '難易度', '材料リスト', '使用調理器具', '前処理', '調理手順', '調理ログ',
    // 献立
    '構成料理リスト'
];

export const MASTER_DATA_COLUMNS = [
    '(M)変数名', '(M)変数分類', '(M)変数説明', '(M)データ区分',
    '(M)カテゴリ_食材', '(M)カテゴリ_調理器具', '(M)カテゴリ_料理',
    '(M)タグ候補',
    '(M)時間帯タグ',
    '(M)ステータス_親', '(M)ステータス_子',
    '(M)難易度'
];

/**
 * MarkdownのFront MatterからmainDataとmasterDataを抽出する。
 *
 * (2) インプット: mdText — Front Matterを含む可能性があるMarkdown文字列
 * (3) メイン: "---\n...\n---" の正規表現でFront Matter部分を取り出し JSON.parse
 * (4) アウトプット: { mainData: Array, masterData: Array }
 */
export function parseMarkdown(mdText) {
    const match = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { mainData: [], masterData: [] };

    try {
        const parsed = JSON.parse(match[1]);
        return {
            mainData:   Array.isArray(parsed.mainData)   ? parsed.mainData   : [],
            masterData: Array.isArray(parsed.masterData) ? parsed.masterData : []
        };
    } catch {
        return { mainData: [], masterData: [] };
    }
}

/**
 * mainData / masterData オブジェクトをFront Matter形式のMarkdown文字列に変換する。
 *
 * (2) インプット: mainData — メインデータ配列, masterData — マスタデータ配列
 * (3) メイン: JSON.stringify でシリアライズし、--- で囲むFront Matter構造を組み立てる
 * (4) アウトプット: Front Matter付きMarkdown文字列
 */
export function stringifyMarkdown(mainData, masterData) {
    const payload = JSON.stringify({ mainData, masterData }, null, 2);
    return `---\n${payload}\n---\n\n# 料理データ一覧\n`;
}
