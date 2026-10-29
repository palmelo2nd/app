// ガントチャートビュー（カレンダーと年月・選択日を共有。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { formatJpDatetime } from '../modules/task.js?v=59';
import { getCalendarStatusClass } from '../modules/calendar.js?v=59';
import { parseExceptions, getDefaultType } from '../modules/workCalendar.js?v=59';
import { getGanttMarker, getGanttWeekColumns, getGanttWeekMarker } from '../modules/gantt.js?v=59';

/**
 * (2) インプット: ctx = {
 *   getTasks()               — 表示するタスク（フィルタ適用済み・日付のあるもの）
 *   getMonth()               — 表示中の年月 { year, month（0始まり） }（カレンダーと共有）
 *   getSelectedDate()        — 選択中の日（YYYY/MM/DD）
 *   onSelectDate(date)       — 日の列をクリックしたとき（選択日を変えて再描画）
 *   getWorkCalendarContent(year) — その年の勤務カレンダーの内容（休日の色付け用）
 *   isChipSelected(id)       — 編集フォームで単独選択中のタスクか
 *   selectTask(id)           — タスクを単独選択して編集フォームに読み込む
 *   jpDateOnly(dt)           — 日時文字列の日付部分
 * }
 * (4) アウトプット: { render, renderUnitToggle }
 */
export function createGanttView(ctx) {
    const { getTasks, getMonth, getSelectedDate, onSelectDate, getWorkCalendarContent, isChipSelected, selectTask, jpDateOnly } = ctx;

    let unit = 'day'; // 列の単位（'day' | 'week'）

    /** ガントチャートを描画する。表示範囲はカレンダーと共有の年月（ctx.getMonth）を基準とする。 */
    function render() {
        const { year, month } = getMonth();
        const selectedDate = getSelectedDate();
        const label = document.getElementById('calendar2-gantt-month-label');
        if (label) label.textContent = `${year}年${month + 1}月`;

        const table = document.getElementById('calendar2-gantt-table');
        if (!table) return;

        const todayJP = jpDateOnly(formatJpDatetime(new Date()));
        const tasks = getTasks();

        let columns;
        if (unit === 'week') {
            columns = getGanttWeekColumns(year, month).map(days => ({
                dates: days,
                label: `${Number(days[0].split('/')[1])}/${Number(days[0].split('/')[2])}`,
                isToday: days.includes(todayJP),
                isSelected: days.includes(selectedDate),
            }));
        } else {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const pad = n => String(n).padStart(2, '0');
            columns = Array.from({ length: daysInMonth }, (_, i) => {
                const d = `${year}/${pad(month + 1)}/${pad(i + 1)}`;
                return { dates: [d], label: String(i + 1), isToday: d === todayJP, isSelected: d === selectedDate };
            });
        }

        table.className = 'gantt-table';
        const thead = document.createElement('thead');
        const hRow  = document.createElement('tr');
        ['ID', 'タイトル'].forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            th.className = 'gantt-fixed-col';
            hRow.appendChild(th);
        });
        const ganttWorkExceptions = parseExceptions(getWorkCalendarContent(year));

        columns.forEach(col => {
            const th = document.createElement('th');
            th.className = unit === 'week' ? 'gantt-day-col gantt-week-col' : 'gantt-day-col';
            if (col.isToday)    th.classList.add('gantt-day-col--today');
            if (col.isSelected) th.classList.add('gantt-day-col--selected');

            if (unit === 'day') {
                const [y, m, d] = col.dates[0].split('/').map(Number);
                const wType = ganttWorkExceptions.get(col.dates[0])?.type
                    ?? getDefaultType(new Date(y, m - 1, d));
                if (wType !== '出勤日') th.classList.add(`gantt-day-col--work-${wType}`);
            }

            th.textContent = col.label;
            th.addEventListener('click', () => onSelectDate(col.dates[0]));
            hRow.appendChild(th);
        });
        thead.appendChild(hRow);

        const tbody = document.createElement('tbody');
        if (tasks.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.className = 'empty-cell';
            td.colSpan = columns.length + 2;
            td.textContent = '該当するタスクがありません';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            tasks.forEach(row => {
                const tr = document.createElement('tr');
                tr.className = 'gantt-task-row';
                if (isChipSelected(String(row['ID']))) tr.classList.add('selected-row');

                const idTd = document.createElement('td');
                idTd.className = 'gantt-fixed-col';
                idTd.textContent = row['ID'] ?? '';
                tr.appendChild(idTd);

                const statusClass = getCalendarStatusClass(row['ステータス']);

                const titleTd = document.createElement('td');
                titleTd.className = `gantt-fixed-col gantt-title-col gantt-title-text ${statusClass}`;
                titleTd.textContent = row['タイトル'] || '（無題）';
                tr.appendChild(titleTd);

                columns.forEach(col => {
                    const td = document.createElement('td');
                    td.className = 'gantt-day-col';
                    const marker = unit === 'week' ? getGanttWeekMarker(row, col.dates) : getGanttMarker(row, col.dates[0]);
                    if (marker) {
                        td.textContent = marker;
                        td.classList.add('gantt-marker', statusClass);
                    }
                    tr.appendChild(td);
                });

                tr.addEventListener('click', () => selectTask(String(row['ID'])));
                tbody.appendChild(tr);
            });
        }

        table.replaceChildren(thead, tbody);
    }

    /** 日／週切り替えボタンの表示状態を反映する。 */
    function renderUnitToggle() {
        document.getElementById('calendar2-gantt-unit-day')?.classList.toggle('gantt-unit-btn--active', unit === 'day');
        document.getElementById('calendar2-gantt-unit-week')?.classList.toggle('gantt-unit-btn--active', unit === 'week');
    }

    document.getElementById('calendar2-gantt-unit-day')?.addEventListener('click', () => {
        unit = 'day';
        renderUnitToggle();
        render();
    });
    document.getElementById('calendar2-gantt-unit-week')?.addEventListener('click', () => {
        unit = 'week';
        renderUnitToggle();
        render();
    });

    return { render, renderUnitToggle };
}
