// (1) インポート — なし（純粋な文字列/オブジェクト変換のみ）

export const MAIN_DATA_COLUMNS = [
    'ID', 'システム', 'タイトル', '内容', '作成日時', '更新日時',
    'カテゴリ', 'ステータス', '優先度',
    '開始予定', '終了予定', '完了日', '見積時間', '実績時間', 'タイムスタンプログ', '補正時間',
    '繰返し識別子', '繰返し基準日', '繰返し頻度_月', '繰返し頻度_日', '繰返し頻度_曜日',
    '親ID'
];

// アプリ管理用の列。行の種別（1日タスク・報告・勤務カレンダー等）など、利用者が直接編集しない情報をオブジェクトで持つ。
// 通常のタスクは空欄（保存時は省かれる）。2026-10-28に「データ区分」「PARA区分」を廃止してここへ統合した。
export const SYSTEM_COLUMN = 'システム';

/** セルの値を表示・比較用の文字列にする（システム列などのオブジェクトはJSON文字列にする）。 */
export function formatCellValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return Object.keys(v).length === 0 ? '' : JSON.stringify(v);
    return String(v);
}

export const MASTER_DATA_COLUMNS = [
    '(M)変数名', '(M)変数分類', '(M)変数説明', '(M)カテゴリ',
    '(M)ステータス', '(M)優先度', '(M)繰返し頻度_月',
    '(M)繰返し頻度_日', '(M)繰返し頻度_曜日'
];

/**
 * mainData の1行を、MAIN_DATA_COLUMNS の順に全列そろえた新しいオブジェクトにして返す
 * （欠けている列は空文字で補う。定義外の列は値を保ったまま後ろに残す）。
 * 保存時は空欄の列を省くため（compactMainRow）、読込時にこれで元の「全列ある」形に戻し、アプリ側の処理は従来どおり全列がある前提で扱えるようにする。
 */
export function normalizeMainRow(row) {
    const out = {};
    MAIN_DATA_COLUMNS.forEach(col => { out[col] = row[col] ?? ''; });
    Object.keys(row).forEach(k => { if (!(k in out)) out[k] = row[k]; });
    // システム列はオブジェクトで持つ。Excel入力やAI秘書の書き込みでJSON文字列になっている場合はオブジェクトへ戻す
    const sys = out[SYSTEM_COLUMN];
    if (typeof sys === 'string' && sys.trim().startsWith('{')) {
        try { out[SYSTEM_COLUMN] = JSON.parse(sys); } catch { /* 解析できない値はそのまま残す */ }
    }
    return out;
}

/**
 * 保存用に、mainData の1行から空欄（空文字・null・undefined）の列を省いた新しいオブジェクトを返す（列順は normalizeMainRow と同じ）。
 * Why: 全列を空文字付きで保存すると、データの半分以上が空欄になりファイルが肥大化するため（2026-10-28時点で約45%削減）。
 */
export function compactMainRow(row) {
    const out = {};
    Object.entries(normalizeMainRow(row)).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined) return;
        if (typeof v === 'object' && Object.keys(v).length === 0) return; // 空のシステム列（{}）も空欄扱い
        out[k] = v;
    });
    return out;
}

/**
 * masterData の1行を現在の列構成にそろえる（旧形式の変換）。
 * 2026-10-28に「(M)ステータス_親」（値は常に「タスク」）を廃止し、「(M)ステータス_子」を「(M)ステータス」へ改名した。
 * 同日、タグを廃止し「(M)タグ_親」「(M)タグ_子」の列を削除した。
 * 旧形式の行（旧バージョンの端末のキャッシュ・Excel入力など）は、読み込むたびにここで変換する。旧形式のキーが無い行はそのまま返す。
 */
export function normalizeMasterRow(row) {
    const LEGACY_KEYS = ['(M)ステータス_親', '(M)ステータス_子', '(M)タグ_親', '(M)タグ_子'];
    if (!row || typeof row !== 'object' || !LEGACY_KEYS.some(k => k in row)) return row;
    const src = { ...row };
    delete src['(M)タグ_親'];
    delete src['(M)タグ_子'];
    if (!src['(M)ステータス'] && src['(M)ステータス_子']) src['(M)ステータス'] = src['(M)ステータス_子'];
    delete src['(M)ステータス_親'];
    delete src['(M)ステータス_子'];
    // キー順をMASTER_DATA_COLUMNSにそろえる（一覧に無いキーは末尾）
    const out = {};
    MASTER_DATA_COLUMNS.forEach(c => { if (c in src) out[c] = src[c]; else if (c === '(M)ステータス') out[c] = ''; });
    Object.keys(src).forEach(k => { if (!(k in out)) out[k] = src[k]; });
    return out;
}

/**
 * MarkdownのFront MatterからmainDataとmasterDataを抽出する。
 *
 * (2) インプット: mdText — Front Matterを含む可能性があるMarkdown文字列
 * (3) メイン: "---\n...\n---" の正規表現でFront Matter部分を取り出し JSON.parse
 * (4) アウトプット: { mainData: Array（各行は normalizeMainRow で全列そろえた形）, masterData: Array（各行は normalizeMasterRow で旧形式を変換した形） }
 */
export function parseMarkdown(mdText) {
    const match = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { mainData: [], masterData: [] };

    try {
        const parsed = JSON.parse(match[1]);
        return {
            mainData:   Array.isArray(parsed.mainData)   ? parsed.mainData.map(normalizeMainRow) : [],
            masterData: Array.isArray(parsed.masterData) ? parsed.masterData.map(normalizeMasterRow) : []
        };
    } catch {
        return { mainData: [], masterData: [] };
    }
}

/**
 * mainData / masterData オブジェクトをFront Matter形式のMarkdown文字列に変換する。
 *
 * (2) インプット: mainData — メインデータ配列, masterData — マスタデータ配列
 * (3) メイン: mainData の各行は空欄の列を省き（compactMainRow）、JSON.stringify でシリアライズして --- で囲むFront Matter構造を組み立てる
 * (4) アウトプット: Front Matter付きMarkdown文字列
 */
export function stringifyMarkdown(mainData, masterData) {
    const payload = JSON.stringify({ mainData: mainData.map(compactMainRow), masterData }, null, 2);
    return `---\n${payload}\n---\n\n# タスク一覧\n`;
}
