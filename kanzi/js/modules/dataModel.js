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
// 構成: 漢検「熟語の構成」の分類（'ア'同じような意味／'イ'反対・対応の意味／'ウ'上が下を修飾／'エ'下が上の目的語・補語／'オ'上が下を打ち消す。二字熟語のみが対象、三字熟語・四字熟語は対象外でnullのまま）。
// 構成_確信度: 上記`構成`分類にどれだけ確信を持てたかの3段階（'高'|'中'|'低'）。`構成`を割り当てたエントリにのみ存在する（該当が無いエントリにはキー自体が存在しない）。
// 構成_確認状態: 開発タブ「熟語の構成レビュー」用の確認状態（'未確認'|'承認'|'保留'|'却下'、devReview.jsのREVIEW_STATUSESと対応）。
// 全件データ投入完了時点では未設定（`構成`があるエントリでも省略時は'未確認'扱い）。低確信度のエントリを中心にレビュー対象として残している。
// 該当が無いエントリにはキー自体が存在しない（全件に空配列を持たせない）。
// 出典: `種別`='故事・諺'のみが持つ、典拠となった古典・故事の出所（例：「列子」）。`構成_確信度`等と同じく
// 該当が無いエントリにはキー自体が存在しない（ウィクショナリー日本語版の`由来 ○○`カテゴリタグから機械取得、
// 01_技術調査/故事諺データ調査.md参照。取得できなかった場合は空文字列）。
// 誤字候補_文字/_位置(0|1)/_読み/_視覚類似度('高'|'中'|'低')/_確認状態: 二字熟語の一方の文字を
// 同じ読みの別の漢字に機械的に差し替えた「誤字訂正」クイズ用の候補（01_技術調査/誤字訂正データ調査.md参照）。
// `構成`/`構成_確信度`と同じフラットな構成。`構成_確信度`等と同じく該当が無いエントリにはキー自体が存在しない。
export const JUKUGO_COLUMNS = ['ID', '種別', '語', '読み', '意味', '例文', '使用漢字ID', '対象級', '構成', '構成_確信度', '構成_確認状態', '対象級_確認状態', '熟字訓', '類義語', '対義語', '意味_機械翻訳', '例文_確認状態', 'ふりがな', '出典', '誤字候補_文字', '誤字候補_位置', '誤字候補_読み', '誤字候補_視覚類似度', '誤字候補_確認状態'];

// 学年（1〜6）と漢検の級（10級〜5級）のおおまかな対応（00_市場調査/出題範囲（公式基準）.mdで確認済み）。
// 注意: 実際の認定級は学年から機械的に決まらない例外が一部ある（mimneko/kanji-dataとの照合で37字確認済み）。
// 個々の字の正確な級はkanjiMaster.jsonの「級」フィールドを見ること。このマップは参考値・デフォルト値としてのみ使う。
export const GRADE_TO_KYU = { 1: '10級', 2: '9級', 3: '8級', 4: '7級', 5: '6級', 6: '5級' };

// 漢検の出題ジャンル定義（00_市場調査/出題範囲（公式基準）.md、協会公式サイトの一次情報より）。
// keyはアプリ内部の識別子、labelはタブ表示名。'reading'（漢字の読み）以外は現状クイズ未実装で、
// クイズ画面ではプレースホルダー表示になる（js/app.jsのrenderQuizView参照）。
export const QUIZ_GENRES = {
    reading:        { label: '漢字の読み' },
    writing:        { label: '漢字の書取' },
    kakusuu:        { label: '筆順・画数' },
    bushu:          { label: '部首・部首名' },
    okurigana:      { label: '送り仮名' },
    taigigo:        { label: '対義語' },
    taigigoRuigigo: { label: '対義語・類義語' },
    onji:           { label: '同じ漢字の読み' },
    doonIji:        { label: '同音異字' },
    doonDokunIji:   { label: '同音・同訓異字' },
    sanjiJukugo:    { label: '三字熟語' },
    yonjiJukugo:    { label: '四字熟語' },
    jukugoKousei:   { label: '熟語の構成' },
    gojiTeisei:     { label: '誤字訂正' },
    kojiKotowaza:   { label: '故事・諺' }
};

// 級ごとの出題ジャンル一覧（公式サイト「主な出題内容」欄の並び順のまま）。QUIZ_GENRESのkeyの配列。
export const KYU_GENRE_MAP = {
    '10級': ['reading', 'writing', 'kakusuu'],
    '9級':  ['reading', 'writing', 'kakusuu'],
    '8級':  ['reading', 'writing', 'bushu', 'kakusuu', 'okurigana', 'taigigo', 'onji'],
    '7級':  ['reading', 'writing', 'bushu', 'kakusuu', 'okurigana', 'taigigo', 'doonIji', 'sanjiJukugo'],
    '6級':  ['reading', 'writing', 'bushu', 'kakusuu', 'okurigana', 'taigigoRuigigo', 'doonDokunIji', 'sanjiJukugo', 'jukugoKousei'],
    '5級':  ['reading', 'writing', 'bushu', 'kakusuu', 'okurigana', 'taigigoRuigigo', 'doonDokunIji', 'yonjiJukugo', 'jukugoKousei', 'gojiTeisei'],
    '4級':  ['reading', 'writing', 'bushu', 'okurigana', 'taigigoRuigigo', 'doonDokunIji', 'yonjiJukugo', 'jukugoKousei', 'gojiTeisei'],
    '3級':  ['reading', 'writing', 'bushu', 'okurigana', 'taigigoRuigigo', 'doonDokunIji', 'yonjiJukugo', 'jukugoKousei', 'gojiTeisei'],
    '準2級': ['reading', 'writing', 'bushu', 'okurigana', 'taigigoRuigigo', 'doonDokunIji', 'yonjiJukugo', 'jukugoKousei', 'gojiTeisei'],
    '2級':  ['reading', 'writing', 'bushu', 'okurigana', 'taigigoRuigigo', 'doonDokunIji', 'yonjiJukugo', 'jukugoKousei', 'gojiTeisei'],
    '準1級': ['reading', 'writing', 'kojiKotowaza', 'taigigoRuigigo', 'doonDokunIji', 'gojiTeisei', 'yonjiJukugo'],
    '1級':  ['reading', 'writing', 'kojiKotowaza', 'taigigoRuigigo', 'doonDokunIji', 'gojiTeisei', 'yonjiJukugo']
};

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
