// (1) インポート — なし（純粋な文字列/オブジェクト変換のみ）

// kanjiData（data/kanjiMaster.json、コードリポジトリに同梱される固定の参照データ）の列定義。
// 漢字そのものの情報はユーザーごとに変わらないため、GitHubデータリポジトリ（進捗のみ）には含めない。
// 熟語（二字熟語〜四字熟語・故事諺）は複数の漢字にまたがるため、ここには含めずjukugoData（jukugo.json）側で持つ。
// 送り仮名例の各要素は { 語, 読み, 確認状態 }（確認状態は例ごとに個別レビューするため）。
// 読み_確認状態・書き_確認状態は漢字1字単位（音読み・訓読みのセット全体に対するレビュー用、js/modules/devReview.jsのREVIEW_STATUSESと対応）。
export const KANJI_COLUMNS = ['ID', '漢字', '級', '学年', '画数', '部首', '部首名', '音読み', '訓読み', '意味', '送り仮名例', '意味_機械翻訳', '読み_確認状態', '書き_確認状態', '筆順_確認状態'];

// jukugoData（data/jukugo.json）の列定義。複数の漢字にまたがる語（使用漢字IDは配列）。
// 例文_確認状態・対象級_確認状態は '未確認'|'承認'|'保留'|'却下' の4値（js/modules/devReview.jsのREVIEW_STATUSESと対応）。
// ふりがな: 例文中で対象語以外に対象級より高度な漢字が出てくる場合の読み注記。[[文字, 読み], ...]の配列（同じ文字が複数回出る場合は出現順に対応）。
// 該当が無いエントリにはキー自体が存在しない（全件に空配列を持たせない）。
export const JUKUGO_COLUMNS = ['ID', '種別', '語', '読み', '意味', '例文', '使用漢字ID', '対象級', '構成', '対象級_確認状態', '熟字訓', '類義語', '対義語', '意味_機械翻訳', '例文_確認状態', 'ふりがな'];

// 学年（1〜6）と漢検の級（10級〜5級）のおおまかな対応（00_市場調査/出題範囲（公式基準）.mdで確認済み）。
// 注意: 実際の認定級は学年から機械的に決まらない例外が一部ある（mimneko/kanji-dataとの照合で37字確認済み）。
// 個々の字の正確な級はkanjiMaster.jsonの「級」フィールドを見ること。このマップは参考値・デフォルト値としてのみ使う。
export const GRADE_TO_KYU = { 1: '10級', 2: '9級', 3: '8級', 4: '7級', 5: '6級', 6: '5級' };

// progressData: 漢字ごとの学習記録（IDをキーに1漢字1行。未学習の漢字は行が存在しない）
export const PROGRESS_COLUMNS = ['ID', '出題回数', '正解回数', '連続正解', '最終学習日時'];

/**
 * MarkdownのFront MatterからprogressData（学習進捗）を抽出する。
 *
 * (2) インプット: mdText — Front Matterを含む可能性があるMarkdown文字列
 * (3) メイン: "---\n...\n---" の正規表現でFront Matter部分を取り出し JSON.parse
 * (4) アウトプット: { progressData: Array }
 */
export function parseMarkdown(mdText) {
    const match = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { progressData: [] };

    try {
        const parsed = JSON.parse(match[1]);
        return {
            progressData: Array.isArray(parsed.progressData) ? parsed.progressData : []
        };
    } catch {
        return { progressData: [] };
    }
}

/**
 * progressData を Front Matter形式のMarkdown文字列に変換する。
 *
 * (2) インプット: progressData — 学習記録配列
 * (3) メイン: JSON.stringify でシリアライズし、--- で囲むFront Matter構造を組み立てる
 * (4) アウトプット: Front Matter付きMarkdown文字列
 */
export function stringifyMarkdown(progressData) {
    const payload = JSON.stringify({ progressData }, null, 2);
    return `---\n${payload}\n---\n\n# 漢字学習 進捗データ\n`;
}
