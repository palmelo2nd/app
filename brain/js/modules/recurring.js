// (1) インポート
// キャッシュバスティング用の「?v=N」はjs/app.js冒頭のコメント参照。値を変更する際はそちらと揃えること。
import { MAIN_DATA_COLUMNS } from './dataModel.js?v=62';
import { computeActualHours, getSystemInfo, setSystemField, RECURRING_FREQ_KEY } from './task.js?v=62';
export { RECURRING_FREQ_KEY };

// 曜日名（JS の getDay() と対応: 0=日）
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// 繰返し頻度の選択肢（2026-10-28まではマスタの(M)繰返し頻度_月/日/曜日に持っていた。値は変わらないためコードに固定した）
export const RECURRING_FREQ_PARTS = ['月', '日', '曜日'];
export const RECURRING_FREQ_OPTIONS = {
    '月':   Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
    '日':   Array.from({ length: 31 }, (_, i) => `${i + 1}日`),
    '曜日': ['月', '火', '水', '木', '金', '土', '日'],
};

// 生成した実行タスク（子）のシステム列で、同時生成した一群（バッチ）を識別する基準日（yyyy/mm/dd）を持つ項目名（2026-10-28までは「繰返し基準日」列）
export const RECURRING_BASE_DATE_KEY = '繰返し基準日';

// (2) インプット関数定義

/** 繰返しテンプレート（親）の頻度のうち、part（'月'|'日'|'曜日'）で選んでいる値の配列を返す（未設定・親でなければ空配列）。 */
export function getRecurringFrequencyList(row, part) {
    const freq = getSystemInfo(row)[RECURRING_FREQ_KEY];
    const list = freq && typeof freq === 'object' ? freq[part] : null;
    return Array.isArray(list) ? list : [];
}

/**
 * 頻度の選択値（{ 月, 日, 曜日 } それぞれ配列またはSet）を、システム列に保存する形（{ 月: [], 日: [], 曜日: [] }、
 * 各配列は RECURRING_FREQ_OPTIONS の順。選択肢に無い値は末尾に元の順で残す）にして返す。
 */
export function makeRecurringFrequency(selected) {
    const out = {};
    RECURRING_FREQ_PARTS.forEach(part => {
        const values = [...new Set([...(selected?.[part] || [])].map(v => String(v).trim()).filter(Boolean))];
        const order = RECURRING_FREQ_OPTIONS[part];
        const known = order.filter(v => values.includes(v));
        out[part] = [...known, ...values.filter(v => !order.includes(v))];
    });
    return out;
}

/** 実行タスク（子）の繰返し基準日（yyyy/mm/dd）を返す（無ければ空文字）。 */
export function getRecurringBaseDate(row) {
    return getSystemInfo(row)[RECURRING_BASE_DATE_KEY] || '';
}

/** "7月"や"07"のような文字列から数値部分を取り出す（マスタ表記の接尾辞・ゼロ埋めの揺れを吸収するため）。数値が無ければnull。 */
function extractNumber(str) {
    const m = String(str).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

/** 親タスクの頻度設定が date に一致するか判定する（AND ロジック・空=全て対象） */
export function matchesSchedule(parent, date) {
    const months   = getRecurringFrequencyList(parent, '月');
    const days     = getRecurringFrequencyList(parent, '日');
    const weekdays = getRecurringFrequencyList(parent, '曜日');

    const monthOK   = months.length   === 0 || months.some(v => extractNumber(v) === date.getMonth() + 1);
    const dayOK     = days.length     === 0 || days.some(v => extractNumber(v) === date.getDate());
    const weekdayOK = weekdays.length === 0 || weekdays.includes(WEEKDAY_NAMES[date.getDay()]);

    return monthOK && dayOK && weekdayOK;
}

/** date を YYMMDD 形式の文字列で返す（子タスクタイトルの日付表記に使用） */
export function formatYYYYMMDD(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** date を "YYYY/MM/DD" 形式の文字列で返す（開始予定・重複判定キーに使用） */
export function formatSlashDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

/** 親タスクの頻度設定（月/日/曜日）を一覧表示用の文字列にまとめる。すべて空欄なら「毎日」。 */
export function formatRecurringFrequencyLabel(parent) {
    const parts = [];
    RECURRING_FREQ_PARTS.forEach(part => {
        const list = getRecurringFrequencyList(parent, part);
        if (list.length > 0) parts.push(`${part}:${list.join(',')}`);
    });
    return parts.length > 0 ? parts.join(' / ') : '毎日';
}

/** 子タスク配列から Chart.js 用の labels / data（実績時間, h）を作成する */
export function buildChildChartData(children) {
    const sorted = [...children]
        .filter(r => r['完了日'] || r['作成日時'])
        .sort((a, b) => {
            const da = a['完了日'] || a['作成日時'];
            const db = b['完了日'] || b['作成日時'];
            return da.localeCompare(db);
        });

    const labels = sorted.map(r => (r['完了日'] || r['作成日時']).slice(0, 10));
    const data   = sorted.map(r => computeActualHours(r));

    return { labels, data };
}

function makeTsStr(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} `
         + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function maxIdIn(mainData) {
    return mainData.reduce((max, r) => {
        const id = parseInt(r['ID'], 10);
        return isNaN(id) ? max : Math.max(max, id);
    }, 0);
}

/** 親ID＋繰返し基準日＋タイトルで、既に同じ子タスクが生成済みかどうかを判定する（当日分・生成中の分の両方を対象）。 */
function childAlreadyGenerated(mainData, generated, parentId, matchedDateSlash, title) {
    const match = r => r['親ID'] === String(parentId) && getRecurringBaseDate(r) === matchedDateSlash && r['タイトル'] === title;
    return mainData.some(match) || generated.some(match);
}

const DEFAULT_TEMPLATES = [{ startOffsetDays: 0, endOffsetDays: 0, titleSuffix: '', content: '' }];

// 繰返しテンプレート（親タスク）のシステム列で、実行タスクテンプレートを持つ項目名（2026-10-28までは備考列にJSON文字列で保持していた）
export const RECURRING_TEMPLATE_KEY = '繰返しテンプレート';

/** 繰返しテンプレート（親タスク）の行から、実行タスクテンプレートの保存値（配列。未設定なら空文字）を返す。 */
export function getRecurringTemplatesValue(row) {
    return getSystemInfo(row)[RECURRING_TEMPLATE_KEY] ?? '';
}

/**
 * 親タスクの実行タスクテンプレートの保存値（配列、またはJSON文字列）からテンプレート配列を読み取る。
 * 空・パース不可の場合は「オフセット0の1件のみ」（従来動作）を返す。
 * 旧形式（offsetDaysのみ・開始予定と終了予定が同じ扱い）のデータが残っていた場合は、
 * startOffsetDays・endOffsetDaysの両方にoffsetDaysの値を引き継いで読み込む。
 * status/priority/category/estimate は個別上書き用の項目で、空欄（未設定）の場合は
 * 実行タスク生成時に親タスクの値を使う（buildChild側でフォールバック）。
 *
 * (2) インプット: stored — getRecurringTemplatesValue の値（配列。旧形式のJSON文字列も可）
 * (4) アウトプット: Array<{ startOffsetDays, endOffsetDays, titleSuffix, content, status, priority, category, estimate }>
 */
export function parseChildTemplates(stored) {
    if (!stored || (typeof stored === 'string' && !stored.trim())) return DEFAULT_TEMPLATES;

    try {
        const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
        if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TEMPLATES;
        return parsed.map(t => {
            const legacyOffset = Number.isFinite(t.offsetDays) ? t.offsetDays : 0;
            return {
                startOffsetDays: Number.isFinite(t.startOffsetDays) ? t.startOffsetDays : legacyOffset,
                endOffsetDays:   Number.isFinite(t.endOffsetDays)   ? t.endOffsetDays   : legacyOffset,
                titleSuffix: typeof t.titleSuffix === 'string' ? t.titleSuffix : '',
                content:     typeof t.content === 'string' ? t.content : '',
                status:   typeof t.status   === 'string' ? t.status   : '',
                priority: typeof t.priority === 'string' ? t.priority : '',
                category: typeof t.category === 'string' ? t.category : '',
                estimate: typeof t.estimate === 'string' ? t.estimate : ''
            };
        });
    } catch {
        return DEFAULT_TEMPLATES;
    }
}

/**
 * 子タスクテンプレート配列を、親タスクのシステム列に保存する形（複製した配列）にする。
 *
 * (2) インプット: templates — Array<{ startOffsetDays, endOffsetDays, titleSuffix, content, … }>
 * (4) アウトプット: 配列の複製（空配列の場合は空文字＝項目ごと削除）
 */
export function stringifyChildTemplates(templates) {
    if (!Array.isArray(templates) || templates.length === 0) return '';
    return JSON.parse(JSON.stringify(templates)); // 編集中の配列と共有しないよう複製する
}

function buildChildTitle(parent, dateStr, template) {
    return template.titleSuffix
        ? `${parent['タイトル']}_${dateStr}_${template.titleSuffix}`
        : `${parent['タイトル']}_${dateStr}`;
}

/**
 * 実行タスクを1件組み立てる。開始予定・終了予定は、いずれもこのテンプレート自身の
 * startOffsetDays／endOffsetDaysを基準日に加えた日付を個別に使う。
 */
function buildChild(parent, template, matchedDate, startDate, targetDate, id, ts) {
    const dateStr = formatYYYYMMDD(matchedDate);

    const child = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
    child['ID']           = String(id);
    child['タイトル']     = buildChildTitle(parent, dateStr, template);
    child['内容']         = template.content || parent['内容'] || '';
    child['親ID']         = String(parent['ID']); // 繰返しテンプレート自身を親IDとして指す（プロジェクトはテンプレートからさらに上を辿って判定する）
    child['ステータス']   = template.status   || parent['ステータス'] || '';
    child['優先度']       = template.priority || parent['優先度']    || '';
    child['カテゴリ']     = template.category || parent['カテゴリ']  || '';
    child['見積時間']     = template.estimate || parent['見積時間']  || '';
    child['開始予定']     = formatSlashDate(startDate);
    child['終了予定']     = formatSlashDate(targetDate);
    setSystemField(child, RECURRING_BASE_DATE_KEY, formatSlashDate(matchedDate)); // 同時生成した一群（バッチ）を識別するキー
    child['作成日時']     = ts;
    child['更新日時']     = ts;
    return child;
}

// (3) メイン機能

/**
 * 親タスクから実行タスクを任意タイミングで生成する（手動生成）。指定した日（省略時は今日）を基準日として、
 * 親のシステム列（繰返しテンプレート）で定義された実行タスクテンプレート（複数可）をすべて生成する。頻度条件はチェックしない。
 * 開始予定・終了予定は、テンプレートごとに個別のオフセット日数（startOffsetDays／endOffsetDays）を
 * 基準日に加えた日付をそれぞれ使う。
 * 生成対象が1件も無かった場合（全テンプレートが基準日分生成済み）は空配列を返す。
 *
 * (2) インプット: parent, mainData, baseDate — 基準日（省略時は今日）
 * (4) アウトプット: 生成した実行タスクオブジェクトの配列（0件の場合は空配列）
 */
export function generateChildManually(parent, mainData, baseDate = new Date()) {
    const matchedDate  = baseDate;
    const matchedSlash = formatSlashDate(matchedDate);
    let currentMaxId    = maxIdIn(mainData);
    const generated      = [];

    const templates = parseChildTemplates(getRecurringTemplatesValue(parent));

    templates.forEach(template => {
        const startDate = new Date(
            matchedDate.getFullYear(), matchedDate.getMonth(), matchedDate.getDate() + template.startOffsetDays
        );
        const targetDate = new Date(
            matchedDate.getFullYear(), matchedDate.getMonth(), matchedDate.getDate() + template.endOffsetDays
        );
        const dateStr = formatYYYYMMDD(matchedDate);
        const title   = buildChildTitle(parent, dateStr, template);

        if (childAlreadyGenerated(mainData, generated, parent['ID'], matchedSlash, title)) return;

        currentMaxId++;
        generated.push(buildChild(parent, template, matchedDate, startDate, targetDate, currentMaxId, makeTsStr(targetDate)));
    });

    return generated;
}

