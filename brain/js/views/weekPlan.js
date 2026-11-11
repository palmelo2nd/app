// 週ビュー。1日タスクのタイムラインを数日分（PC 7日・スマホ2日）横に並べ、その期間のタスクのチップを下にまとめて出す。2026-11-09新設
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。
// 1日分のブロックの描画・ドラッグは dayPlan.js の renderDayLanes を使い回す（書き換えるのは1日タスク行だけ。brain/CLAUDE.md 2章）。

// (1) インポート
import { getDayPlanTask, parseDayPlanContent } from '../modules/calendar.js?v=78';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData
 *   getSelectedDate            — 選択中の日（YYYY/MM/DD）
 *   selectDate                 — 日を選ぶ（カレンダー・下の日別の欄も同じ日になる）
 *   getTasksForDate            — その日に出すタスク（対応中タスクと同じ判定、フィルタ適用済み）
 *   renderDayLanes             — 1日分のブロックを描く（dayPlan.js）
 *   renderGroupedChips         — ステータスごとにまとめたチップ一覧を描画（共通）
 *   getWorkType                — その日の勤務区分（出勤日／休日／有給／特別休暇）
 *   getTodayJP                 — 今日（YYYY/MM/DD）
 * }
 * (4) アウトプット: { render, shift, goToday }
 */
export function createWeekPlanView(ctx) {
    const { getMainData, getSelectedDate, selectDate, getTasksForDate, renderDayLanes, renderGroupedChips, getWorkType, getTodayJP } = ctx;

    const WEEK_HOUR_HEIGHT = 30;     // 1時間の高さ(px)。日別タイムライン（40px）より低くして、1画面に多くの時間を入れる
    const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
    let startDate = null;             // 表示の始まりの日。選んだ日が表示の外に出たら、選んだ日に合わせる
    let lastStartDate = null;         // 始まりの日を変えたときだけ8:00へスクロールするため

    /** 並べる日数（スマホの幅では2日。3日でもブロックが約25pxで題名が読めなかったため）。 */
    function getDayCount() {
        return window.matchMedia('(max-width: 640px)').matches ? 2 : 7;
    }

    /** YYYY/MM/DD に n 日足した日。 */
    function addDays(dateJP, n) {
        const [y, m, d] = dateJP.split('/').map(Number);
        const dt = new Date(y, m - 1, d + n);
        return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
    }

    function getDates() {
        const selected = getSelectedDate() || getTodayJP();
        const count = getDayCount();
        if (!startDate || selected < startDate || selected > addDays(startDate, count - 1)) startDate = selected;
        return Array.from({ length: count }, (_, i) => addDays(startDate, i));
    }

    /** 「11/09(日)」の形。 */
    function formatDay(dateJP) {
        const [y, m, d] = dateJP.split('/').map(Number);
        return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
    }

    /** ‹ ›：始まりの日と選んだ日を1日ずつずらす。 */
    function shift(n) {
        const selected = getSelectedDate() || getTodayJP();
        startDate = addDays(startDate || selected, n);
        selectDate(addDays(selected, n));
    }

    function goToday() {
        startDate = getTodayJP();
        selectDate(startDate);
    }

    function render() {
        const headEl   = document.getElementById('week2-head');
        const bodyEl   = document.getElementById('week2-body');
        const scrollEl = document.getElementById('week2-scroll');
        if (!headEl || !bodyEl || !scrollEl) return;

        const dates    = getDates();
        const selected = getSelectedDate();
        const todayJP  = getTodayJP();
        const cols     = `40px repeat(${dates.length}, minmax(0, 1fr))`;

        const label = document.getElementById('week2-range-label');
        if (label) label.textContent = `${formatDay(dates[0])} 〜 ${formatDay(dates[dates.length - 1])}`;

        // 日付の見出し（押すとその日を選ぶ。＋の追加先になる）
        headEl.style.gridTemplateColumns = cols;
        headEl.innerHTML = '<div></div>';
        dates.forEach(dateJP => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'week-day-head';
            cell.dataset.date = dateJP;
            const workType = getWorkType(dateJP);
            if (workType !== '出勤日') cell.classList.add(`calendar-day--work-${workType}`);
            if (dateJP === todayJP)  cell.classList.add('week-day-head--today');
            if (dateJP === selected) cell.classList.add('week-day-head--selected');
            const hasPlan = !!getDayPlanTask(getMainData(), dateJP);
            cell.textContent = formatDay(dateJP);
            cell.title = hasPlan ? `${dateJP}（1日タスクあり）` : `${dateJP}（1日タスクなし）`;
            if (!hasPlan) cell.classList.add('week-day-head--noplan');
            cell.addEventListener('click', () => selectDate(dateJP));
            headEl.appendChild(cell);
        });

        // 時刻の目盛り（左に1本）と、日ごとのブロック
        bodyEl.style.gridTemplateColumns = cols;
        bodyEl.innerHTML = '';
        const hoursEl = document.createElement('div');
        hoursEl.className = 'calendar-timeline-hours week-hours';
        for (let h = 0; h < 24; h++) {
            const row = document.createElement('div');
            row.className = 'calendar-hour-row';
            row.style.height = `${WEEK_HOUR_HEIGHT}px`;
            row.textContent = `${h}:00`;
            hoursEl.appendChild(row);
        }
        bodyEl.appendChild(hoursEl);
        dates.forEach(dateJP => {
            const lanesEl = document.createElement('div');
            lanesEl.className = 'calendar-timeline-lanes week-lanes';
            if (dateJP === selected) lanesEl.classList.add('week-lanes--selected');
            lanesEl.dataset.date = dateJP;
            lanesEl.style.setProperty('--week-hour', `${WEEK_HOUR_HEIGHT}px`);
            bodyEl.appendChild(lanesEl);
            renderDayLanes(lanesEl, dateJP, { hourHeight: WEEK_HOUR_HEIGHT, gridBackground: true });
        });
        if (startDate !== lastStartDate) scrollEl.scrollTop = 8 * WEEK_HOUR_HEIGHT;
        lastStartDate = startDate;

        renderChips(dates, selected);
    }

    /**
     * 期間のタスク：表示中のどれかの日で getTasksForDate に入るタスクの和（重複なし）。
     * 選んだ日の1日タスクにまだ無いものを上（＋で選んだ日へ足す）、もう入っているものを下にまとめる。
     */
    function renderChips(dates, selected) {
        const listEl  = document.getElementById('week2-chip-list');
        const addedEl = document.getElementById('week2-added-list');
        if (!listEl || !addedEl) return;

        const rows = new Map();
        dates.forEach(dateJP => getTasksForDate(dateJP).forEach(row => rows.set(String(row['ID']), row)));
        const plan = selected ? getDayPlanTask(getMainData(), selected) : null;
        const inPlan = new Set(parseDayPlanContent(plan ? plan['内容'] : '').map(b => b.refId).filter(Boolean));

        const toEntry = row => ({ row, label: row['タイトル'] || '（無題）' });
        const pending = [...rows.values()].filter(r => !inPlan.has(String(r['ID']))).map(toEntry);
        const added   = [...rows.values()].filter(r =>  inPlan.has(String(r['ID']))).map(toEntry);
        renderGroupedChips(listEl, pending, 'この期間のタスクはありません', { showAddButton: true });
        renderGroupedChips(addedEl, added, 'まだありません', { showAddButton: false });

        const countEl = document.getElementById('week2-chip-count');
        if (countEl) countEl.textContent = `${pending.length} 件 / ${added.length} 件`;
        const targetEl = document.getElementById('week2-target-label');
        if (targetEl) targetEl.textContent = selected ? formatDay(selected) : '';
    }

    document.getElementById('week2-prev-btn')?.addEventListener('click', () => shift(-1));
    document.getElementById('week2-next-btn')?.addEventListener('click', () => shift(1));
    document.getElementById('week2-today-btn')?.addEventListener('click', goToday);

    return { render, shift, goToday };
}
