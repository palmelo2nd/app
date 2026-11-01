// (1) インポート — なし（Web標準APIのみ使用）

/** CSVの1行を、ダブルクォート・カンマのエスケープを考慮しつつ値の配列にパースする。 */
export function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') { current += '"'; i++; }
                else { inQuotes = false; }
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            values.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    values.push(current);
    return values;
}

/**
 * CSV文字列をパースし、1行目をヘッダーとしたオブジェクトの配列を返す。
 *
 * (2) インプット: text — CSV文字列（1行目はヘッダー行）
 * (3) メイン: 行ごとにparseCsvLineで分解し、ヘッダー名をキーにしたオブジェクトへ変換
 * (4) アウトプット: Array<Object>（空行は無視する）
 */
export function parseCsv(text) {
    // ダブルクォート内の改行（ラベル点検のメモ欄など。stringifyCsvは改行を含む値をクォートして書く）は1つの値として扱うため、
    // クォートが閉じていない（"の数が奇数の）行は次の行とつなげる。空行は無視する（クォート内の空行は残す）
    const lines = [];
    let pending = null;
    (text || '').split(/\r?\n/).forEach(line => {
        if (pending === null) {
            if (line.length === 0) return;
            pending = line;
        } else {
            pending += '\n' + line;
        }
        if ((pending.match(/"/g) || []).length % 2 === 0) { lines.push(pending); pending = null; }
    });
    if (pending !== null) lines.push(pending);
    if (lines.length === 0) return [];

    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map(line => {
        const values = parseCsvLine(line);
        return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
    });
}

/**
 * オブジェクトの配列をCSV文字列に変換する（parseCsvの逆変換）。1行目はheadersをそのままヘッダー行にする。
 * 値にカンマ・ダブルクォート・改行が含まれる場合はダブルクォートでエスケープする。
 *
 * (2) インプット: rows — Array<Object>、headers — 出力する列名の配列（この順序で出力する）
 * (3) メイン: 各行を headers の順に取り出し、必要な値だけエスケープしてカンマ区切りに組み立てる
 * (4) アウトプット: CSV文字列（各行末に改行。末尾にも改行を1つ付与）
 */
export function stringifyCsv(rows, headers) {
    const escapeValue = (value) => {
        const s = value == null ? '' : String(value);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escapeValue).join(',')];
    rows.forEach(row => {
        lines.push(headers.map(h => escapeValue(row[h])).join(','));
    });
    return lines.join('\n') + '\n';
}
