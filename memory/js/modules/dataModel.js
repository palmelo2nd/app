// (1) インポート — なし（純粋な文字列/オブジェクト変換のみ）

export const MAIN_DATA_COLUMNS = [
    'ID', '種別', '表面', '裏面', 'タグ', '出典', '作成日時', '更新日時',
    '箱番号', '次回復習日', '正解回数', '不正解回数', '学習履歴'
];

export const MASTER_DATA_COLUMNS = ['(M)種別'];

/**
 * MarkdownのFront MatterからmainDataとmasterDataを抽出する。
 * brainアプリのdataModel.jsと同じ正規表現・構造（他アプリと同じ読み書き方式に揃えるため）。
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
    return `---\n${payload}\n---\n\n# 記憶カード一覧\n`;
}
