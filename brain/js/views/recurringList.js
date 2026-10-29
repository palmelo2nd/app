// 繰返しタスクのビュー（タスク管理タブの「繰返しタスク」Expander：テンプレート一覧・実行タスク一覧・実行タスクの生成・実績グラフ。2026-10-30にapp.jsから分離）
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { generateChildManually, matchesSchedule, buildChildChartData, formatRecurringFrequencyLabel, getRecurringBaseDate } from '../modules/recurring.js?v=64';
import { formatJpDatetime } from '../modules/task.js?v=64';
import { getCalendarStatusClass } from '../modules/calendar.js?v=64';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData（実行タスクの生成で行を追加する）
 *   getChildIds                — 実行タスク一覧でチェック中のID集合（PJ一括編集などと共有）
 *   getParentRows              — 表示するテンプレート（フィルタ適用済み）
 *   getFilteredMainData        — 選択中カテゴリで絞り込んだmainData
 *   clearSelections            — チェックボックスの複数選択をすべて外す
 *   selectTask                 — タスクを単独選択して編集フォームに読み込む
 *   isChipSelected             — 編集フォームで単独選択中のタスクか
 *   onCheckboxChange           — チェックボックス変更の共通処理
 *   appendChipLabel            — 優先度ドット＋タイトルを付ける
 *   setExpanderCount           — Expanderの件数バッジを設定
 *   persistLocalCache          — 端末キャッシュへ保存
 * }
 * (4) アウトプット: { render, updateCount }
 */
export function createRecurringListView(ctx) {
    const { getMainData, getChildIds, getParentRows, getFilteredMainData, clearSelections, selectTask, isChipSelected, onCheckboxChange, appendChipLabel, setExpanderCount, persistLocalCache } = ctx;

    /** タスク整理「繰返しタスク」Expanderの「基準日」入力欄が未設定の場合のみ、当日をデフォルト値としてセットする。 */
    function ensureCalendar2RecurringManualDateDefault() {
        const el = document.getElementById('calendar2-recurring-manual-date');
        if (!el || el.value) return;
        const t = new Date();
        const pad = n => String(n).padStart(2, '0');
        el.value = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    }

    /** タスク整理「繰返しタスク」Expanderの「基準日」入力欄の値をDateオブジェクトで返す（未入力時は今日）。 */
    function getCalendar2RecurringManualDate() {
        const value = document.getElementById('calendar2-recurring-manual-date')?.value || '';
        const [y, m, d] = value.split('-').map(Number);
        return (y && m && d) ? new Date(y, m - 1, d) : new Date();
    }

    // タスク整理「繰返しタスク」Expanderで、右側（子タスク一覧）の表示対象として選択中の親タスクID
    let selectedTaskorg2RecurringParentId = null;
    let taskorg2RecurringChart = null;
    let taskorg2RecurringChartVisible = false; // 実績グラフは既定非表示。「実績グラフ」ボタンで表示切り替え
    /**
     * 「繰返しタスク」Expanderの件数バッジだけを更新する。Expanderが閉じている間も件数は常に見えるようにするため、
     * 中身（親子一覧・チャート）を描画する renderTaskorg2RecurringList とは別に、軽量に呼べるようにしている。
     */
    function updateTaskorg2RecurringCount() {
        setExpanderCount('calendar2-recurring-count', getParentRows().length);
    }

    /**
     * タスク整理「繰返しタスク」Expanderを描画する。繰返しエリアと同様に左＝親タスク・右＝選択中の親の
     * 子タスクをボタン（チップ）形式で配置する。ボタンのクリックはタスク整理の編集エリアと選択状態を
     * リンクする（通常タスクの一覧・カレンダーと同じ選択状態を共有する）。
     * 頻度が今日に該当する親タスクは赤枠（calendar-unscheduled-chip--today-match）で強調する。
     */
    function renderTaskorg2RecurringList() {
        const parentListEl = document.getElementById('calendar2-recurring-parent-list');
        const childListEl  = document.getElementById('calendar2-recurring-child-list');
        if (!parentListEl || !childListEl) return;

        ensureCalendar2RecurringManualDateDefault();
        renderTaskorg2RecurringChart();
        const today = new Date();
        const pool = getFilteredMainData();
        const childCountOf = parentId => pool.filter(r => r['親ID'] === parentId).length;

        // 表示順: 頻度が今日に該当するもの（赤枠）を先頭に、その中では子タスクが多いものほど上に来るようにする
        const parents = getParentRows().sort((a, b) => {
            const todayDiff = Number(matchesSchedule(b, today)) - Number(matchesSchedule(a, today));
            if (todayDiff !== 0) return todayDiff;
            return childCountOf(String(b['ID'])) - childCountOf(String(a['ID']));
        });
        setExpanderCount('calendar2-recurring-count', parents.length);

        // 選択中の親タスクがフィルタ等で一覧から外れた場合は選択解除する
        if (selectedTaskorg2RecurringParentId && !parents.some(r => String(r['ID']) === selectedTaskorg2RecurringParentId)) {
            selectedTaskorg2RecurringParentId = null;
        }

        parentListEl.innerHTML = '';
        if (parents.length === 0) {
            const p = document.createElement('p');
            p.className = 'calendar-empty-text';
            p.textContent = '登録済みの繰り返しタスクがありません';
            parentListEl.appendChild(p);
        } else {
            parents.forEach(row => {
                const rowId = String(row['ID']);

                const wrap = document.createElement('span');
                wrap.className = 'calendar-unscheduled-chip-wrap';

                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `calendar-unscheduled-chip ${getCalendarStatusClass(row['ステータス'])}`;
                if (matchesSchedule(row, today)) chip.classList.add('calendar-unscheduled-chip--today-match');
                // 右側（子タスク一覧）の表示対象になっている親タスクを、太い黒枠でひと目でわかるようにする
                if (rowId === selectedTaskorg2RecurringParentId) chip.classList.add('calendar-unscheduled-chip--active-outline');
                chip.title = `${row['タイトル'] || '（無題）'}（${formatRecurringFrequencyLabel(row)}）`;
                appendChipLabel(chip, row, row['タイトル'] || '（無題）');
                chip.addEventListener('click', () => {
                    clearSelections(); // チップの選択とチェックボックスの複数選択は同時に使わない（チップを選んだらチェックは外す）
                    if (selectedTaskorg2RecurringParentId !== rowId) getChildIds().clear(); // 親を切り替えたら子の複数選択はリセットする
                    selectedTaskorg2RecurringParentId = rowId;
                    selectTask(rowId);
                });
                wrap.appendChild(chip);

                // 「基準日」入力欄の日付を基準に子タスクを「進行中」で生成する（繰返しエリアの実行タスク生成と同じ挙動）
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'calendar-unscheduled-chip-add calendar-unscheduled-chip-add--green';
                addBtn.title = '基準日を基準に実行タスクを「進行中」で生成';
                addBtn.textContent = '+';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const children = generateChildManually(row, getMainData(), getCalendar2RecurringManualDate());
                    if (children.length === 0) { alert('指定日分は既に生成済みです'); return; }
                    const ts = formatJpDatetime(new Date());
                    children.forEach(child => { child['ステータス'] = '進行中'; child['更新日時'] = ts; });
                    getMainData().push(...children);
                    persistLocalCache();
                    selectedTaskorg2RecurringParentId = rowId;
                    renderTaskorg2RecurringList();
                });
                wrap.appendChild(addBtn);

                parentListEl.appendChild(wrap);
            });
        }

        childListEl.innerHTML = '';
        if (!selectedTaskorg2RecurringParentId) {
            const p = document.createElement('p');
            p.className = 'calendar-empty-text';
            p.textContent = 'テンプレートを選択してください';
            childListEl.appendChild(p);
            return;
        }

        // 基準日が新しいものが上に来るよう並べる（基準日未設定の行はIDの降順で末尾にまとめる）
        const children = getFilteredMainData()
            .filter(r => r['親ID'] === selectedTaskorg2RecurringParentId)
            .sort((a, b) => {
                const da = getRecurringBaseDate(a), db = getRecurringBaseDate(b);
                if (!da && !db) return parseInt(b['ID'], 10) - parseInt(a['ID'], 10);
                if (!da) return 1;
                if (!db) return -1;
                return db.localeCompare(da);
            });

        // 表示対象外になった子タスクのチェックは外しておく（親を切り替えた後の混入防止）
        const childIds = new Set(children.map(r => String(r['ID'])));
        [...getChildIds()].forEach(id => { if (!childIds.has(id)) getChildIds().delete(id); });

        if (children.length === 0) {
            const p = document.createElement('p');
            p.className = 'calendar-empty-text';
            p.textContent = '実行タスクがありません';
            childListEl.appendChild(p);
            return;
        }

        children.forEach(row => {
            const rowId = String(row['ID']);

            // チェックボックスは、チップ側のoverflow:hidden（角丸クリップ）で見切れないよう、チップの外側（同じ行内）に配置する
            const line = document.createElement('span');
            line.className = 'calendar-unscheduled-chip-line';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'calendar-unscheduled-chip-checkbox';
            checkbox.checked = getChildIds().has(rowId);
            checkbox.addEventListener('click', (e) => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                onCheckboxChange(getChildIds(), rowId, checkbox.checked);
            });
            line.appendChild(checkbox);

            const wrap = document.createElement('span');
            wrap.className = 'calendar-unscheduled-chip-wrap';

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `calendar-unscheduled-chip calendar-unscheduled-chip--solo ${getCalendarStatusClass(row['ステータス'])}`;
            // 編集エリアのアクティブ対象になっている子タスクを、親タスクと同様に太い黒枠で強調する
            if (isChipSelected(rowId)) chip.classList.add('calendar-unscheduled-chip--active-outline');
            chip.title = row['タイトル'] || '（無題）';
            appendChipLabel(chip, row, row['タイトル'] || '（無題）');
            chip.addEventListener('click', () => {
                selectTask(rowId);
            });
            wrap.appendChild(chip);
            line.appendChild(wrap);

            childListEl.appendChild(line);
        });
    }

    /**
     * タスク整理「繰返しタスク」Expanderの実績グラフを描画する（繰返しエリアの実績グラフと同じロジックを移植）。
     * 選択中の親タスクの子タスクの実績時間推移をChart.jsで表示する。「実績グラフ」ボタンで表示中のときのみ描画する。
     */
    function renderTaskorg2RecurringChart() {
        const wrap = document.getElementById('calendar2-recurring-chart-wrap');
        if (!wrap) return;

        if (taskorg2RecurringChart) { taskorg2RecurringChart.destroy(); taskorg2RecurringChart = null; }
        wrap.innerHTML = '';
        wrap.style.display = taskorg2RecurringChartVisible ? '' : 'none';
        if (!taskorg2RecurringChartVisible) return;

        if (!selectedTaskorg2RecurringParentId) {
            const p = document.createElement('p');
            p.className   = 'placeholder-text';
            p.textContent = 'テンプレートを選択するとグラフが表示されます';
            wrap.appendChild(p);
            return;
        }

        const children  = getMainData().filter(r => r['親ID'] === selectedTaskorg2RecurringParentId);
        const chartData = buildChildChartData(children);
        const dataMinutes = chartData.data.map(h => Math.round(h * 60));

        if (chartData.labels.length > 0 && window.Chart) {
            const canvas = document.createElement('canvas');
            wrap.appendChild(canvas);
            taskorg2RecurringChart = new window.Chart(canvas, {
                type: 'line',
                data: {
                    labels: chartData.labels,
                    datasets: [{
                        label: '実績時間 (分)',
                        data:  dataMinutes,
                        borderColor: '#4a90d9',
                        backgroundColor: 'rgba(74,144,217,0.1)',
                        tension: 0.3,
                        pointRadius: 4,
                        fill: true,
                    }],
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { title: { display: true, text: '日付' } },
                        y: { title: { display: true, text: '実績時間 (分)' }, beginAtZero: true },
                    },
                },
            });
        } else {
            const p = document.createElement('p');
            p.className   = 'placeholder-text';
            p.textContent = chartData.labels.length === 0
                ? '実行タスクに実績データがありません'
                : 'Chart.js が読み込まれていません';
            wrap.appendChild(p);
        }
    }

    document.getElementById('calendar2-recurring-chart-toggle-btn')?.addEventListener('click', () => {
        taskorg2RecurringChartVisible = !taskorg2RecurringChartVisible;
        renderTaskorg2RecurringChart();
    });

    return { render: renderTaskorg2RecurringList, updateCount: updateTaskorg2RecurringCount };
}
