// 日別タイムライン＋1日タスク（DAYPLAN）ビュー。選択日のタイムライン表示・ドラッグ・1日タスクの作成／保存／削除・1日タスクへの追加。2026-10-30にapp.jsから分離
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { MAIN_DATA_COLUMNS } from '../modules/dataModel.js?v=63';
import { formatJpDatetime } from '../modules/task.js?v=63';
import { KIND_DAYPLAN, isDayPlanRow, getTasksForDate as getTasksForDateM, getDayPlanTask as getDayPlanTaskM, parseDayPlanContent, extractTimeOnDate, assignCalendarColumns, DAYPLAN_COLUMN_COUNT, getCalendarStatusClass, computeDayPlanTimeSlot, getTaskScheduledTimeOnDate, sortDayPlanBlocks, stringifyDayPlanBlocks, placeDayPlanBlock } from '../modules/calendar.js?v=63';

/**
 * (2) インプット: ctx = {
 *   getMainData                — 現在のmainData（配列。行の追加はこの配列を直接書き換える）
 *   setMainData                — mainDataを差し替える（1日タスクの削除）
 *   getCategory                — 選択中カテゴリ（「すべて」もあり）
 *   getSelectedDate            — 選択中の日（YYYY/MM/DD）
 *   getTasksForDate            — その日に表示するタスク（フィルタ適用済み）
 *   persistLocalCache          — 端末キャッシュへ保存
 *   isChipSelected             — 編集フォームで単独選択中のタスクか
 *   selectTask                 — タスクを単独選択して編集フォームに読み込む
 *   renderCalendar2            — タスク管理タブ全体を再描画
 *   renderDateChange           — 選択日に依存する部分を再描画
 *   renderUnsetSection         — 対応中／対応待ち／属性未設定の一覧を再描画
 * }
 * (4) アウトプット: { getSegmentsForDate, renderTimeline, addToDayPlan }
 */
export function createDayPlanView(ctx) {
    const { getMainData, setMainData, getCategory, getSelectedDate, getTasksForDate, persistLocalCache, isChipSelected, selectTask, renderCalendar2, renderDateChange, renderUnsetSection } = ctx;

    /**
     * dateJP のtaskorg2行を「時間帯が決まっているもの（timed）」と「時間帯未定（unscheduled、今回は未表示）」に分ける。
     * 1日タスク（DAYPLAN）のブロックで参照済みの行は通常枠から除外し、DAYPLANブロック自身（リンク先タスクの有無を問わず）を timed に追加する（旧タスク整理と同一仕様）。
     * timed の各要素は { row, startMin, endMin, isDayPlanBlock?, dayPlanBlockIndex? }（分単位、0〜1440）。
     */
    function getTaskorg2SegmentsForDate(dateJP) {
        const dayPlanTask   = getDayPlanTaskM(getMainData(), dateJP);
        const dayPlanBlocks = dayPlanTask ? parseDayPlanContent(dayPlanTask['内容']) : [];
        const referencedIds = new Set(dayPlanBlocks.map(b => b.refId).filter(Boolean));

        const timed = [];
        const unscheduled = [];
        const referenced = [];

        getTasksForDate(dateJP).forEach(row => {
            if (referencedIds.has(String(row['ID']))) { referenced.push(row); return; } // 1日タスクのブロックとして別途表示するため通常枠には出さない

            const startInfo = extractTimeOnDate(row['開始予定'], dateJP);
            const endInfo   = extractTimeOnDate(row['終了予定'], dateJP);
            const hasStartTime = !!(startInfo && startInfo.hasTime);
            const hasEndTime   = !!(endInfo && endInfo.hasTime);

            if (!hasStartTime && !hasEndTime) { unscheduled.push(row); return; }

            let startMin = hasStartTime ? startInfo.minutes : endInfo.minutes - 30;
            let endMin   = hasEndTime   ? endInfo.minutes   : startInfo.minutes + 30;
            if (endMin <= startMin) endMin = startMin + 30;
            startMin = Math.max(0, Math.min(1439, startMin));
            endMin   = Math.max(startMin + 15, Math.min(1440, endMin));

            timed.push({ row, startMin, endMin });
        });

        dayPlanBlocks.forEach((b, dayPlanBlockIndex) => {
            const linkedRow = b.refId ? getMainData().find(r => String(r['ID']) === b.refId) : null;
            timed.push({
                row: linkedRow || { ID: null, タイトル: b.label || '（ラベルなし）', ステータス: null },
                startMin: b.startMin,
                endMin: b.endMin,
                isDayPlanBlock: true,
                dayPlanBlockIndex,
                column: b.column
            });
        });

        return { timed, unscheduled, referenced };
    }

    const CALENDAR_HOUR_HEIGHT = 40; // 1時間あたりの高さ(px)

    /** 1日の時間軸（0:00〜24:00の目盛り）と選択中日付のタスクの時間帯ブロックを描画する。選択中日付が無ければセクション自体を隠す。 */
    function renderTaskorg2Timeline() {
        const titleEl = document.getElementById('calendar2-detail-title');
        if (titleEl) titleEl.textContent = getSelectedDate() || '';
        if (!getSelectedDate()) return;

        const hoursEl = document.getElementById('calendar2-timeline-hours');
        const lanesEl = document.getElementById('calendar2-timeline-lanes');
        if (!hoursEl || !lanesEl) return;

        const totalHeight = CALENDAR_HOUR_HEIGHT * 24;
        hoursEl.style.height = `${totalHeight}px`;
        lanesEl.style.height = `${totalHeight}px`;

        hoursEl.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            const row = document.createElement('div');
            row.className = 'calendar-hour-row';
            row.style.height = `${CALENDAR_HOUR_HEIGHT}px`;
            row.textContent = `${String(h).padStart(2, '0')}:00`;
            hoursEl.appendChild(row);
        }

        lanesEl.innerHTML = '';
        const dateJP = getSelectedDate();
        const { timed } = getTaskorg2SegmentsForDate(dateJP);
        assignCalendarColumns(timed);

        const pxPerMin = CALENDAR_HOUR_HEIGHT / 60;

        for (let m = 0; m < 1440; m += 15) {
            const minuteOfHour = m % 60;
            const variant = minuteOfHour === 0 ? 'hour' : minuteOfHour === 30 ? 'half' : 'quarter';
            const line = document.createElement('div');
            line.className = `calendar-timeline-gridline calendar-timeline-gridline--${variant}`;
            line.style.top = `${m * pxPerMin}px`;
            lanesEl.appendChild(line);
        }

        // 固定4列（列1=決まっている予定／列2〜4=空き時間消化）の区切りを縦の点線で明示する
        for (let i = 1; i < DAYPLAN_COLUMN_COUNT; i++) {
            const divider = document.createElement('div');
            divider.className = 'calendar-timeline-column-divider';
            divider.style.left = `${(100 / DAYPLAN_COLUMN_COUNT) * i}%`;
            lanesEl.appendChild(divider);
        }

        const blockBySeg = new Map();

        timed.forEach(seg => {
            const laneWidthPct = 100 / seg.laneCount;
            const block = document.createElement('div');
            const hasLinkedTask = seg.row['ID'] != null;
            block.className = `calendar-time-block ${hasLinkedTask ? getCalendarStatusClass(seg.row['ステータス']) : 'calendar-time-block--dayplan'}`;
            if (hasLinkedTask && isChipSelected(String(seg.row['ID']))) block.classList.add('calendar-time-block--selected');
            block.style.top    = `${seg.startMin * pxPerMin}px`;
            block.style.height = `${(seg.endMin - seg.startMin) * pxPerMin}px`;
            block.style.left   = `${seg.lane * laneWidthPct}%`;
            block.style.width  = `calc(${laneWidthPct}% - 4px)`;

            const labelSpan = document.createElement('span');
            labelSpan.textContent = seg.row['タイトル'] || '（無題）';
            block.appendChild(labelSpan);

            const handle = document.createElement('div');
            handle.className = 'calendar-time-block-resize-handle';
            block.appendChild(handle);

            blockBySeg.set(seg, block);
            attachTaskorg2TimelineDragHandlers(block, handle, labelSpan, seg, dateJP, pxPerMin, hasLinkedTask);
            lanesEl.appendChild(block);
        });

        const scrollEl = document.getElementById('calendar2-timeline-scroll');
        if (scrollEl) scrollEl.scrollTop = 8 * CALENDAR_HOUR_HEIGHT;

        renderTaskorg2DayPlanSection();
    }

    const TIMELINE_SNAP_MIN = 15;         // ドラッグ操作のスナップ単位（分）
    const TIMELINE_DRAG_THRESHOLD_MIN = 8; // これ未満の移動量はクリック（属性編集を開く）として扱う

    /** 分を15分単位に丸める。 */
    function snapTimelineMinutes(min) {
        return Math.round(min / TIMELINE_SNAP_MIN) * TIMELINE_SNAP_MIN;
    }

    /**
     * タイムラインのブロックへ「移動（時刻＋列）」「リサイズ（時刻のみ）」操作を付与する。
     * ドラッグ中は自分自身の位置・高さ・列のみを更新し、他ブロックのレーン再配置は行わない
     * （ドラッグ中に他ブロックまで位置が飛んで見づらくなるのを防ぐため）。レーンの再計算は
     * ドラッグ確定後の再描画時にまとめて行われる。「移動」は縦方向で時刻、横方向で列（1〜4）を変更できる。
     * 「リサイズ」（下端ハンドル）は時刻（終了予定）のみで列は変わらない。
     */
    function attachTaskorg2TimelineDragHandlers(block, handle, labelSpan, seg, dateJP, pxPerMin, hasLinkedTask) {
        let dragMode  = null; // 'move' | 'resize'
        let pointerId = null;
        let startClientY = 0;
        let origStart  = seg.startMin;
        let origEnd    = seg.endMin;
        let origColumn = seg.lane + 1;
        let pendingStart  = seg.startMin;
        let pendingEnd    = seg.endMin;
        let pendingColumn = origColumn;

        function applyColumnStyle(column) {
            const laneWidthPct = 100 / DAYPLAN_COLUMN_COUNT;
            block.style.left  = `${(column - 1) * laneWidthPct}%`;
            block.style.width = `calc(${laneWidthPct}% - 4px)`;
        }

        function updatePreview(newStart, newEnd, newColumn) {
            pendingStart  = newStart;
            pendingEnd    = newEnd;
            pendingColumn = newColumn;
            block.style.top    = `${newStart * pxPerMin}px`;
            block.style.height = `${(newEnd - newStart) * pxPerMin}px`;
            applyColumnStyle(newColumn);
            labelSpan.textContent = seg.row['タイトル'] || '（無題）';
        }

        /** clientXが乗っている列（1〜4、コンテナ幅を4等分）を返す。block.parentElement（lanesEl）は、この関数が
         * 呼ばれる時点（ドラッグ操作時）では必ずDOMに接続済みだが、attachTaskorg2TimelineDragHandlers呼び出し時点
         * （まだlanesElへappendChildする前）ではnullのため、ここで都度取得する。 */
        function columnFromClientX(clientX) {
            const rect = block.parentElement.getBoundingClientRect();
            const laneWidthPx = rect.width / DAYPLAN_COLUMN_COUNT;
            const col = Math.floor((clientX - rect.left) / laneWidthPx) + 1;
            return Math.max(1, Math.min(DAYPLAN_COLUMN_COUNT, col));
        }

        function onPointerMove(e) {
            if (!dragMode) return;
            const deltaMin = snapTimelineMinutes((e.clientY - startClientY) / pxPerMin);

            if (dragMode === 'move') {
                const duration = origEnd - origStart;
                const newStart = Math.max(0, Math.min(1440 - duration, origStart + deltaMin));
                updatePreview(newStart, newStart + duration, columnFromClientX(e.clientX));
            } else {
                const newEnd = Math.max(origStart + TIMELINE_SNAP_MIN, Math.min(1440, origEnd + deltaMin));
                updatePreview(origStart, newEnd, origColumn); // リサイズは列を変えない
            }
        }

        function onPointerUp() {
            if (!dragMode) return;
            block.releasePointerCapture(pointerId);
            block.removeEventListener('pointermove', onPointerMove);
            block.removeEventListener('pointerup', onPointerUp);
            block.removeEventListener('pointercancel', onPointerUp);

            const movedMin      = Math.abs(pendingStart - origStart) + Math.abs(pendingEnd - origEnd);
            const columnChanged = dragMode === 'move' && pendingColumn !== origColumn;
            if (movedMin < TIMELINE_DRAG_THRESHOLD_MIN && !columnChanged) {
                updatePreview(origStart, origEnd, origColumn); // 微小な移動は元に戻す
                if (dragMode === 'move' && hasLinkedTask) selectTask(String(seg.row['ID']));
            } else {
                commitTaskorg2TimelineDrag(seg, dateJP, pendingStart, pendingEnd, pendingColumn, columnChanged);
            }
            dragMode = null;
        }

        function startDrag(mode, e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            dragMode      = mode;
            pointerId     = e.pointerId;
            startClientY  = e.clientY;
            origStart     = seg.startMin;
            origEnd       = seg.endMin;
            origColumn    = seg.lane + 1;
            pendingStart  = origStart;
            pendingEnd    = origEnd;
            pendingColumn = origColumn;
            block.setPointerCapture(pointerId);
            block.addEventListener('pointermove', onPointerMove);
            block.addEventListener('pointerup', onPointerUp);
            block.addEventListener('pointercancel', onPointerUp);
            e.preventDefault();
            e.stopPropagation();
        }

        block.addEventListener('pointerdown', (e) => startDrag('move', e));
        handle.addEventListener('pointerdown', (e) => startDrag('resize', e));
    }

    /**
     * タイムラインのドラッグ操作結果を確定保存する。ケースによって実際に変更されるデータが異なるため、
     * 再描画範囲もそれに合わせて最小限に絞る（無関係なビューまで再計算する重い処理を避けるため）。
     * targetColumnはドラッグ／リサイズ後にブロックが位置する列（1〜4）を常に渡す（列を変えていなくても渡す。
     * リサイズは常に元の列のまま）。列2〜4は placeDayPlanBlock 側で重なりを自動的に押し出して解消し、
     * 24:00を超えるようならキャンセル（何も書き換えずタイムラインだけ再描画して元の位置に戻す）。列1は重なりを気にせず
     * そのまま配置する。
     *
     * - 1日タスクのスケジュール行（isDayPlanBlock）: その行（＋押し出された同じ列の他ブロック）の時刻・列だけを書き換える。
     *   他のタスク行には一切影響しないため、タイムラインだけ再描画すれば十分。
     * - 1日タスクに未追加のタスクを列方向にドラッグ（columnChanged）: そのタスク自身の開始予定・終了予定は変えず、
     *   1日タスクへ新しい行として追加する（＝昇格）。「対応中タスク」一覧での参照状態が変わるため未設定タスク一覧も再描画。
     * - 1日タスクに未追加のタスクを縦方向のみドラッグ（時刻だけ変更）: タスク自身の開始予定・終了予定を書き換える。
     *   月間カレンダーのバッジ・ガントのマーカー・タスク一覧の該当行が変わりうるため、選択日に依存するビュー一式
     *   （renderDateChange）の再描画が必要。
     */
    function commitTaskorg2TimelineDrag(seg, dateJP, newStartMin, newEndMin, targetColumn, columnChanged) {
        const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

        if (seg.isDayPlanBlock) {
            const dayPlan = getDayPlanTaskM(getMainData(), dateJP);
            if (!dayPlan) return;
            const result = placeDayPlanBlock(dayPlan['内容'], seg.dayPlanBlockIndex, newStartMin, newEndMin, targetColumn);
            if (!result.ok) { renderTaskorg2Timeline(); return; } // 24:00を超えるためキャンセル、元の位置に戻す
            dayPlan['内容']     = result.content;
            dayPlan['更新日時'] = formatJpDatetime(new Date());
            persistLocalCache();
            renderTaskorg2Timeline(); // 1日タスクのテキストとタイムライン上のチップ位置しか変わらないため、他のビューは再描画不要
            return;
        }

        if (columnChanged) {
            let dayPlan = getTaskorg2DayPlanTask();
            if (!dayPlan) {
                createTaskorg2DayPlanTask();
                dayPlan = getTaskorg2DayPlanTask();
                if (!dayPlan) return;
            }
            const newBlock = { refId: String(seg.row['ID']), label: seg.row['タイトル'] || '（無題）' };
            const result = placeDayPlanBlock(dayPlan['内容'], null, newStartMin, newEndMin, targetColumn, newBlock);
            if (!result.ok) { renderTaskorg2Timeline(); return; } // 24:00を超えるためキャンセル、タスクは未追加のまま
            dayPlan['内容']     = result.content;
            dayPlan['更新日時'] = formatJpDatetime(new Date());
            persistLocalCache();
            renderTaskorg2Timeline();
            renderUnsetSection(); // 「対応中タスク」の未設定/参照済み区分が変わるため
            return;
        }

        const row = getMainData().find(r => String(r['ID']) === String(seg.row['ID']));
        if (!row) return;
        row['開始予定'] = `${dateJP} ${fmt(newStartMin)}`;
        row['終了予定'] = `${dateJP} ${fmt(newEndMin)}`;
        row['更新日時'] = formatJpDatetime(new Date());
        persistLocalCache();
        renderDateChange(); // タスク本体の日程が変わり、カレンダー/ガント/一覧など選択日依存のビューに影響しうる
    }

    /** 選択中日付の1日タスク行（isDayPlanRow）を返す。無ければnull。 */
    function getTaskorg2DayPlanTask() {
        return getSelectedDate() ? getDayPlanTaskM(getMainData(), getSelectedDate()) : null;
    }

    /** 1日タスクの作成ボタン／編集エリアを、選択中の日付の状態に合わせて描画する（旧タスク整理と同一仕様）。 */
    function renderTaskorg2DayPlanSection() {
        const createBtn = document.getElementById('calendar2-dayplan-create-btn');
        const editor    = document.getElementById('calendar2-dayplan-editor');
        const contentEl = document.getElementById('calendar2-dayplan-content');
        if (!createBtn || !editor || !contentEl) return;

        if (!getSelectedDate()) {
            createBtn.style.display = 'none';
            editor.style.display = 'none';
            return;
        }

        const dayPlan = getTaskorg2DayPlanTask();
        if (dayPlan) {
            createBtn.style.display = 'none';
            editor.style.display = '';
            if (document.activeElement !== contentEl) contentEl.value = dayPlan['内容'] || '';
        } else {
            createBtn.style.display = '';
            editor.style.display = 'none';
            contentEl.value = '';
        }
    }

    /** "HH:MM" 文字列を分に変換する。 */
    function parseHHMMToMinutes(str) {
        const [h, m] = str.split(':').map(Number);
        return h * 60 + m;
    }

    /**
     * 選択中日付の1日タスクを新規作成する（システム列 { 種別: '1日タスク' }、開始予定=選択中日付）。
     * 内容には既定の「09:00-09:30 メールチェック、予定整理」に加え、その日既に開始予定・終了予定が
     * 時刻まで指定されている既存タスクを取り込む（カテゴリの絞り込みは適用、プロジェクト／ステータスの絞り込みは適用しない）。
     */
    function createTaskorg2DayPlanTask() {
        if (!getSelectedDate()) return;

        const maxId = getMainData().reduce((max, row) => {
            const id = parseInt(row['ID'], 10);
            return isNaN(id) ? max : Math.max(max, id);
        }, 0);
        const ts = formatJpDatetime(new Date());

        const noFilters = { status: new Set() };
        const scheduledBlocks = getTasksForDateM(getMainData(), getCategory(), noFilters, getSelectedDate())
            .map(row => {
                const timeInfo = getTaskScheduledTimeOnDate(row, getSelectedDate());
                if (!timeInfo) return null;
                return {
                    startMin: parseHHMMToMinutes(timeInfo.startStr),
                    endMin:   parseHHMMToMinutes(timeInfo.endStr),
                    refId:    String(row['ID']),
                    label:    '',
                    column:   1
                };
            })
            .filter(Boolean);

        const defaultBlock = { startMin: 9 * 60, endMin: 9 * 60 + 30, refId: null, label: 'メールチェック、予定整理', column: 1 };
        const content = stringifyDayPlanBlocks(sortDayPlanBlocks([defaultBlock, ...scheduledBlocks]));

        const entry = Object.fromEntries(MAIN_DATA_COLUMNS.map(col => [col, '']));
        entry['ID']        = String(maxId + 1);
        entry['システム']   = { '種別': KIND_DAYPLAN };
        entry['タイトル']   = `1日タスク ${getSelectedDate()}`;
        entry['開始予定']   = getSelectedDate();
        entry['内容']       = content;
        entry['作成日時']   = ts;
        entry['更新日時']   = ts;

        getMainData().push(entry);
        persistLocalCache();
        renderCalendar2();
    }

    /** 編集エリアの内容をその日の1日タスクに保存する。 */
    function saveTaskorg2DayPlanContent() {
        if (!getSelectedDate()) return;
        const dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) return;
        const contentEl  = document.getElementById('calendar2-dayplan-content');
        const rawContent = contentEl ? contentEl.value : '';
        const sortedBlocks = sortDayPlanBlocks(parseDayPlanContent(rawContent));
        dayPlan['内容']     = stringifyDayPlanBlocks(sortedBlocks);
        dayPlan['更新日時'] = formatJpDatetime(new Date());
        if (contentEl) contentEl.value = dayPlan['内容'];
        persistLocalCache();
        renderTaskorg2Timeline();
    }

    /** 選択中日付の1日タスクを削除する。 */
    function deleteTaskorg2DayPlanTask() {
        if (!getSelectedDate()) return;
        const dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) return;
        setMainData(getMainData().filter(r => r !== dayPlan));
        persistLocalCache();
        renderCalendar2();
    }

    document.getElementById('calendar2-dayplan-create-btn')?.addEventListener('click', createTaskorg2DayPlanTask);
    document.getElementById('calendar2-dayplan-save-btn')?.addEventListener('click', saveTaskorg2DayPlanContent);
    document.getElementById('calendar2-dayplan-delete-btn')?.addEventListener('click', deleteTaskorg2DayPlanTask);

    // ===== 1日タスクへの追加（＋ボタン・ドラッグ共通） =====

    /**
     * 選択中日付の1日タスクに「[列番号] HH:MM-HH:MM #ID タイトル」の1行を追加する（1日タスクが無ければ新規作成）。
     * タイムラインでのドラッグ（列を明示的に変えた場合）と、対応中タスクの「＋」ボタンの両方から使う共通処理。
     */
    function appendTaskorg2DayPlanLine(row, startStr, endStr, column) {
        if (!getSelectedDate()) return;
        let dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) {
            createTaskorg2DayPlanTask();
            dayPlan = getTaskorg2DayPlanTask();
            if (!dayPlan) return;
        }
        const line = `[${column}] ${startStr}-${endStr} #${row['ID']} ${row['タイトル'] || '（無題）'}`;
        dayPlan['内容']     = dayPlan['内容'] ? `${dayPlan['内容']}\n${line}` : line;
        dayPlan['更新日時'] = formatJpDatetime(new Date());
    }

    /**
     * タスクを選択中日付の1日タスクに追加する（対応中タスクなどの「＋」ボタン用）。
     * 開始予定・終了予定が既にその日の時刻まで指定済みのタスク（決まっている予定）は列1に固定配置。
     * それ以外（時間未定のタスク）は、9:00起点で列2〜4の作業枠のうち最も早く空く列へ自動的に割り当てる。
     */
    function addTaskorg2ToDayPlan(row) {
        if (!getSelectedDate()) return;
        let dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) {
            createTaskorg2DayPlanTask();
            dayPlan = getTaskorg2DayPlanTask();
            if (!dayPlan) return;
        }
        const busyBlocks = parseDayPlanContent(dayPlan['内容']);
        const fixedSlot = getTaskScheduledTimeOnDate(row, getSelectedDate());
        const { startStr, endStr, column } = fixedSlot ? { ...fixedSlot, column: 1 } : computeDayPlanTimeSlot(busyBlocks);
        appendTaskorg2DayPlanLine(row, startStr, endStr, column);
        persistLocalCache();
        renderCalendar2();
    }

    /** チップ群（{row, label}の配列）を container に描画する。空なら emptyText を表示する。options.showAddButton（既定true）で1日タスクへの追加＋ボタンの有無を切り替える。 */

    return { getSegmentsForDate: getTaskorg2SegmentsForDate, renderTimeline: renderTaskorg2Timeline, addToDayPlan: addTaskorg2ToDayPlan };
}
