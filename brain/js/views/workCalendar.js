// 勤務歴ビュー（年ごとの休日の例外を月単位で表示・一括編集する。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { parseExceptions, stringifyExceptions, computeMonthCalendar, computeMonthStats } from '../modules/workCalendar.js?v=66';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * (2) インプット: ctx = {
 *   getWorkCalendarContent(year)        — その年の勤務カレンダーの内容テキスト（データはapp.js側）
 *   saveWorkCalendarContent(year, text) — 内容を保存（行が無ければ作る）
 *   onSaved()                           — 月一括適用の後に呼ぶ（月間カレンダーの色を更新するため）
 * }
 * (4) アウトプット: { render }
 */
export function createWorkCalendarView(ctx) {
    const { getWorkCalendarContent, saveWorkCalendarContent, onSaved } = ctx;

    // 表示中の年月（勤務歴ビュー独自。タスク管理のカレンダーとは共有しない）
    let year  = new Date().getFullYear();
    let month = new Date().getMonth();

    /** 勤務カレンダービュー全体を描画する。 */
    function render() {
        const content = getWorkCalendarContent(year);
        const days    = computeMonthCalendar(content, year, month);
        const stats   = computeMonthStats(days);

        const yearLabel  = document.getElementById('work-cal-year-label');
        const monthLabel = document.getElementById('work-cal-month-label');
        if (yearLabel)  yearLabel.textContent  = `${year}年`;
        if (monthLabel) monthLabel.textContent = `${month + 1}月`;

        // カレンダーグリッド（視覚参照用）
        const grid = document.getElementById('work-cal-grid');
        if (grid) {
            grid.innerHTML = '';
            DOW_LABELS.forEach(d => {
                const el = document.createElement('div');
                el.className   = 'work-cal-dow-header';
                el.textContent = d;
                grid.appendChild(el);
            });
            const firstDow = new Date(year, month, 1).getDay();
            for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement('div'));
            days.forEach(day => {
                const cell = document.createElement('div');
                cell.className = `work-cal-day work-cal-day--${day.type}`;
                if (day.isException) cell.classList.add('work-cal-day--exception');
                const numEl = document.createElement('span');
                numEl.className   = 'work-cal-day-num';
                numEl.textContent = String(parseInt(day.date.slice(-2), 10));
                cell.appendChild(numEl);
                if (day.note) {
                    const noteEl = document.createElement('span');
                    noteEl.className   = 'work-cal-day-note';
                    noteEl.textContent = day.note;
                    cell.appendChild(noteEl);
                }
                grid.appendChild(cell);
            });
        }

        // 月次サマリー
        const statsEl = document.getElementById('work-cal-stats');
        if (statsEl) {
            statsEl.innerHTML = Object.entries(stats)
                .map(([k, v]) =>
                    `<span class="work-cal-stat">` +
                    `<span class="work-cal-stat-swatch work-cal--${k}"></span>` +
                    `${k}: <strong>${v}</strong>日</span>`
                ).join('');
        }

        // 月一括編集フォーム
        renderMonthForm(days);
    }

    /** 月一括編集テーブルを描画する（1行=1日、種別select＋備考input）。 */
    function renderMonthForm(days) {
        const table = document.getElementById('work-cal-month-table');
        if (!table) return;
        table.className = 'data-table work-cal-month-table';

        const thead = document.createElement('thead');
        const hRow  = document.createElement('tr');
        ['日付', '種別', '備考'].forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            hRow.appendChild(th);
        });
        thead.appendChild(hRow);

        const tbody = document.createElement('tbody');
        days.forEach(day => {
            const tr = document.createElement('tr');
            if (day.type !== '出勤日') tr.className = `work-row--${day.type}`;

            // 日付（読み取り専用）
            const dateTd = document.createElement('td');
            dateTd.textContent = `${day.date}（${DOW_LABELS[day.dayOfWeek]}）`;
            dateTd.className   = 'work-cal-date-cell';
            tr.appendChild(dateTd);

            // 種別（select）
            const typeTd = document.createElement('td');
            const sel    = document.createElement('select');
            sel.className    = 'work-cal-type-select';
            sel.dataset.date = day.date;
            const defOpt = document.createElement('option');
            defOpt.value       = '';
            defOpt.textContent = `（デフォルト: ${day.defaultType}）`;
            sel.appendChild(defOpt);
            ['出勤日', '休日', '有給', '特別休暇'].forEach(t => {
                const opt = document.createElement('option');
                opt.value = opt.textContent = t;
                sel.appendChild(opt);
            });
            sel.value = day.isException ? day.type : '';
            typeTd.appendChild(sel);
            tr.appendChild(typeTd);

            // 備考（text input）
            const noteTd = document.createElement('td');
            const inp    = document.createElement('input');
            inp.type        = 'text';
            inp.className   = 'work-cal-note-input';
            inp.dataset.date = day.date;
            inp.value       = day.note;
            inp.placeholder = '（省略可）';
            noteTd.appendChild(inp);
            tr.appendChild(noteTd);

            tbody.appendChild(tr);
        });

        table.replaceChildren(thead, tbody);
    }

    // ---- 年月ナビゲーション ----

    document.getElementById('work-cal-prev-year')?.addEventListener('click', () => {
        year--;
        render();
    });
    document.getElementById('work-cal-next-year')?.addEventListener('click', () => {
        year++;
        render();
    });
    document.getElementById('work-cal-prev-month')?.addEventListener('click', () => {
        month--;
        if (month < 0) { month = 11; year--; }
        render();
    });
    document.getElementById('work-cal-next-month')?.addEventListener('click', () => {
        month++;
        if (month > 11) { month = 0; year++; }
        render();
    });

    // ---- 月一括適用 ----

    document.getElementById('work-cal-month-apply-btn')?.addEventListener('click', () => {
        // 全年分の例外を読み込み、今月分だけ差し替える
        const allExceptions = parseExceptions(getWorkCalendarContent(year));
        const mm = String(month + 1).padStart(2, '0');
        const monthPrefix = `${year}/${mm}/`;
        for (const key of [...allExceptions.keys()]) {
            if (key.startsWith(monthPrefix)) allExceptions.delete(key);
        }

        document.querySelectorAll('#work-cal-month-table tbody tr').forEach(tr => {
            const sel = tr.querySelector('.work-cal-type-select');
            const inp = tr.querySelector('.work-cal-note-input');
            if (!sel) return;
            const date = sel.dataset.date;
            const type = sel.value;
            const note = inp?.value.trim() ?? '';
            if (type) allExceptions.set(date, { type, note });
        });

        saveWorkCalendarContent(year, stringifyExceptions(allExceptions));
        render();
        onSaved();
    });

    return { render };
}
