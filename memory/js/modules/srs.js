// (1) インポート — なし（日付計算とitemオブジェクトの加工のみ）

// ライトナー式の箱番号→復習間隔（日数）。箱5到達後は正解し続ける限り30日間隔を繰り返す。
export const BOX_INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

function pad2(n) {
    return String(n).padStart(2, '0');
}

// (2) インプット: date（Dateオブジェクト、省略時は現在時刻）  (3) メイン: 'YYYY/MM/DD'形式に整形  (4) アウトプット: 文字列
export function formatDateOnly(date = new Date()) {
    return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

// (2) インプット: date（Dateオブジェクト、省略時は現在時刻）  (3) メイン: 'YYYY/MM/DD HH:MM:SS'形式に整形  (4) アウトプット: 文字列
export function formatDateTime(date = new Date()) {
    return `${formatDateOnly(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * 'YYYY/MM/DD'形式の日付文字列に日数を加算する。
 *
 * (2) インプット: dateStr（'YYYY/MM/DD'）, days（加算する日数）
 * (3) メイン: 年月日を分解してDateオブジェクトで加算
 * (4) アウトプット: 加算後の'YYYY/MM/DD'文字列
 */
export function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('/').map(Number);
    const base = new Date(y, m - 1, d);
    base.setDate(base.getDate() + days);
    return formatDateOnly(base);
}

/**
 * 新規カードの初期状態を作る（追加した当日から復習対象になる）。
 *
 * (2) インプット: なし
 * (3) メイン: 箱1・次回復習日=今日・正解/不正解0件・履歴空で初期化
 * (4) アウトプット: { 箱番号, 次回復習日, 正解回数, 不正解回数, 学習履歴 }
 */
export function createInitialSrsState() {
    return {
        箱番号: 1,
        次回復習日: formatDateOnly(),
        正解回数: 0,
        不正解回数: 0,
        学習履歴: []
    };
}

/**
 * カードが復習対象（期限到来）かどうかを判定する。
 * 'YYYY/MM/DD'は各項が固定幅ゼロ埋めのため、文字列比較で日付順が保たれる。
 *
 * (2) インプット: item, todayStr（省略時は今日）
 * (3) メイン: 次回復習日 <= 今日
 * (4) アウトプット: 真偽値
 */
export function isDue(item, todayStr = formatDateOnly()) {
    return (item['次回復習日'] || '') <= todayStr;
}

/**
 * 正答率を計算する（0〜1）。未回答（正解・不正解とも0件）はnull。
 *
 * (2) インプット: item
 * (3) メイン: 正解回数 / (正解回数 + 不正解回数)
 * (4) アウトプット: 数値 or null
 */
export function calcAccuracy(item) {
    const correct = item['正解回数'] || 0;
    const wrong    = item['不正解回数'] || 0;
    const total    = correct + wrong;
    if (total === 0) return null;
    return correct / total;
}

/**
 * 1回分の回答結果を1件のカードに反映した新しいオブジェクトを作る（元オブジェクトは変更しない）。
 *
 * (2) インプット: item, isCorrect（覚えた=true／間違えた=false）, now（Dateオブジェクト、省略時は現在時刻）
 * (3) メイン: 覚えた→箱を1つ進める（上限5）、間違えた→箱1に戻す。いずれも次回復習日・回数・履歴を更新
 * (4) アウトプット: 更新後のitemオブジェクト（複製）
 */
export function applyResult(item, isCorrect, now = new Date()) {
    const currentBox = item['箱番号'] || 1;
    const newBox     = isCorrect ? Math.min(currentBox + 1, 5) : 1;
    const nextDate   = addDays(formatDateOnly(now), BOX_INTERVAL_DAYS[newBox]);

    const history = Array.isArray(item['学習履歴']) ? item['学習履歴'].slice() : [];
    history.push({ 日時: formatDateTime(now), 結果: isCorrect ? '覚えた' : '間違えた' });

    return {
        ...item,
        箱番号: newBox,
        次回復習日: nextDate,
        正解回数: (item['正解回数'] || 0) + (isCorrect ? 1 : 0),
        不正解回数: (item['不正解回数'] || 0) + (isCorrect ? 0 : 1),
        学習履歴: history,
        更新日時: formatDateTime(now)
    };
}
