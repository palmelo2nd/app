// (1) インポート — なし（Web標準APIのみ使用）

const TOKEN_KEY = 'kanzi_pat_token';
const DATA_KEY  = 'kanzi_cached_data';
const SHA_KEY   = 'kanzi_cached_sha';
const DEV_REVIEW_EDITS_KEY = 'kanzi_dev_review_edits';
const DEV_KANJI_REVIEW_EDITS_KEY = 'kanzi_dev_kanji_review_edits';
const DEV_OKURIGANA_REVIEW_EDITS_KEY = 'kanzi_dev_okurigana_review_edits';
const DEV_READING_EXAMPLE_REVIEW_EDITS_KEY = 'kanzi_dev_reading_example_review_edits';

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みトークン or null
export function loadToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// (2) インプット: token  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — { content, sha } or null
export function loadCache() {
    const content = localStorage.getItem(DATA_KEY);
    const sha     = localStorage.getItem(SHA_KEY);
    if (!content) return null;
    return { content, sha };
}

// (2) インプット: content, sha  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveCache(content, sha) {
    localStorage.setItem(DATA_KEY, content);
    localStorage.setItem(SHA_KEY,  sha);
}

// 開発者用レビュー機能（例文・対象級の承認/保留/却下・内容編集）の未保存の変更を、
// GitHubへ保存するまでの間ローカルに退避しておくためのキャッシュ。
// 外出先など断続的な作業でもタブを閉じたり再読み込みしたりしても変更が失われない。
// 形式: { [熟語ID]: { 例文?: string, 対象級?: string, 例文_確認状態?: string, 対象級_確認状態?: string } }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みの編集差分オブジェクト（無ければ空オブジェクト）
export function loadDevReviewEdits() {
    const raw = localStorage.getItem(DEV_REVIEW_EDITS_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// (2) インプット: edits  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveDevReviewEdits(edits) {
    localStorage.setItem(DEV_REVIEW_EDITS_KEY, JSON.stringify(edits));
}

// (2) インプット — なし  (3) メイン — localStorage削除  (4) アウトプット — なし
export function clearDevReviewEdits() {
    localStorage.removeItem(DEV_REVIEW_EDITS_KEY);
}

// 開発タブの読み・書きレビュー（kanjiMaster.json、漢字1字単位）の未保存の変更のローカル退避。
// 形式: { [漢字ID]: { 読み_確認状態?: string, 書き_確認状態?: string, 音読み?: string[], 訓読み?: string[] } }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みの編集差分オブジェクト（無ければ空オブジェクト）
export function loadKanjiReviewEdits() {
    const raw = localStorage.getItem(DEV_KANJI_REVIEW_EDITS_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// (2) インプット: edits  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveKanjiReviewEdits(edits) {
    localStorage.setItem(DEV_KANJI_REVIEW_EDITS_KEY, JSON.stringify(edits));
}

// (2) インプット — なし  (3) メイン — localStorage削除  (4) アウトプット — なし
export function clearKanjiReviewEdits() {
    localStorage.removeItem(DEV_KANJI_REVIEW_EDITS_KEY);
}

// 開発タブの送り仮名レビュー（kanjiMaster.json、送り仮名例1件単位）の未保存の変更のローカル退避。
// 形式: { "漢字ID:配列index": { 語?: string, 読み?: string, 確認状態?: string } }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みの編集差分オブジェクト（無ければ空オブジェクト）
export function loadOkuriganaReviewEdits() {
    const raw = localStorage.getItem(DEV_OKURIGANA_REVIEW_EDITS_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// (2) インプット: edits  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveOkuriganaReviewEdits(edits) {
    localStorage.setItem(DEV_OKURIGANA_REVIEW_EDITS_KEY, JSON.stringify(edits));
}

// (2) インプット — なし  (3) メイン — localStorage削除  (4) アウトプット — なし
export function clearOkuriganaReviewEdits() {
    localStorage.removeItem(DEV_OKURIGANA_REVIEW_EDITS_KEY);
}

// 開発タブの読み例レビュー（kanjiMaster.json、読み例1件単位）の未保存の変更のローカル退避。
// loadOkuriganaReviewEdits系と全く同じ枠組み（キー形式も同じ "漢字ID:配列index"）。
// 形式: { "漢字ID:配列index": { 語?: string, 読み?: string, 例文?: string, 確認状態?: string } }

// (2) インプット — なし  (3) メイン — localStorage読み取り  (4) アウトプット — 保存済みの編集差分オブジェクト（無ければ空オブジェクト）
export function loadReadingExampleReviewEdits() {
    const raw = localStorage.getItem(DEV_READING_EXAMPLE_REVIEW_EDITS_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// (2) インプット: edits  (3) メイン — localStorage書き込み  (4) アウトプット — なし
export function saveReadingExampleReviewEdits(edits) {
    localStorage.setItem(DEV_READING_EXAMPLE_REVIEW_EDITS_KEY, JSON.stringify(edits));
}

// (2) インプット — なし  (3) メイン — localStorage削除  (4) アウトプット — なし
export function clearReadingExampleReviewEdits() {
    localStorage.removeItem(DEV_READING_EXAMPLE_REVIEW_EDITS_KEY);
}
