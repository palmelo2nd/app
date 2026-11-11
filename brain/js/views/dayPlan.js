// 日別タイムライン＋1日タスク（DAYPLAN）ビュー。選択日のタイムライン表示・ドラッグ・1日タスクの作成／反映／削除・1日タスクへの追加・選んだブロックの完了／外す・前日の残りの取り込み。2026-10-30にapp.jsから分離
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { MAIN_DATA_COLUMNS } from '../modules/dataModel.js?v=77';
import { formatJpDatetime, nextMainId } from '../modules/task.js?v=77';
import { KIND_DAYPLAN, isDayPlanRow, getTasksForDate as getTasksForDateM, getDayPlanTask as getDayPlanTaskM, parseDayPlanContent, extractTimeOnDate, assignCalendarColumns, DAYPLAN_COLUMN_COUNT, getCalendarStatusClass, computeDayPlanTimeSlot, getTaskScheduledTimeOnDate, sortDayPlanBlocks, stringifyDayPlanBlocks, placeDayPlanBlock } from '../modules/calendar.js?v=77';

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
 *   renderUnsetSection         — 対応中／対応待ち／属性未設定の一覧を再描画
 *   selectDate                 — 日を選ぶ（週ビューで別の日のブロックを押したとき）
 *   afterTimelineRender        — 日別タイムラインを描いた後に呼ぶ（週ビューの描き直し）
 * }
 * (4) アウトプット: { getSegmentsForDate, renderTimeline, addToDayPlan, renderDayLanes（1日分のブロックを描く。週ビューと共有） }
 */
export function createDayPlanView(ctx) {
    const { getMainData, setMainData, getCategory, getSelectedDate, getTasksForDate, persistLocalCache, isChipSelected, selectTask, renderCalendar2, renderUnsetSection, selectDate, afterTimelineRender } = ctx;

    let selectedBlockIndex = null;  // タイムラインで選んだ1日タスクのブロック（内容欄の有効な行の何番目か）。内容が変わると番号がずれるので、変えたら外す
    let lastRenderedDate   = null;  // 日付を変えたときだけスクロールを8:00へ戻すため
    let editorDirty        = false; // テキスト欄を書き換えて、まだ反映していない
    const CARRY_CLOSED_STATUSES = ['完了', '中断']; // 前日の残りとして取り込まないステータス

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
        if (dateJP !== lastRenderedDate) {
            selectedBlockIndex = null;
            editorDirty = false;
            const statusEl = document.getElementById('calendar2-dayplan-carry-status');
            if (statusEl) statusEl.textContent = '';
        }
        renderDayLanes(lanesEl, dateJP, { hourHeight: CALENDAR_HOUR_HEIGHT });

        // 日付を変えたときだけ8:00へ戻す。ドラッグや追加の後は今の位置のまま（続けて操作しやすいように）
        const scrollEl = document.getElementById('calendar2-timeline-scroll');
        if (scrollEl && dateJP !== lastRenderedDate) scrollEl.scrollTop = 8 * CALENDAR_HOUR_HEIGHT;
        lastRenderedDate = dateJP;

        renderTaskorg2DayPlanSection();
        renderDayPlanBlockActions();
        afterTimelineRender?.(); // 週ビューが表示中なら描き直す（1日タスクを変える操作は、すべてここを通る）
    }

    /**
     * dateJP の1日分のブロック（目盛り・列の区切り・ブロックとドラッグ）を lanesEl に描く。日別タイムラインと週ビューで共有する。
     * hourHeight：1時間の高さ(px)。gridBackground：目盛りをdivではなくCSSの背景で描く（週ビュー用）。
     */
    function renderDayLanes(lanesEl, dateJP, { hourHeight = CALENDAR_HOUR_HEIGHT, gridBackground = false } = {}) {
        lanesEl.innerHTML = '';
        lanesEl.style.height = `${hourHeight * 24}px`;
        const { timed } = getTaskorg2SegmentsForDate(dateJP);
        assignCalendarColumns(timed);

        const pxPerMin = hourHeight / 60;

        // 週ビュー（gridBackground）は線をCSSの背景で描く（7日分で約700本のdivを作らないため）
        if (gridBackground) lanesEl.classList.add('calendar-timeline-lanes--bg');
        else for (let m = 0; m < 1440; m += 15) {
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

        timed.forEach(seg => {
            const laneWidthPct = 100 / seg.laneCount;
            const block = document.createElement('div');
            const hasLinkedTask = seg.row['ID'] != null;
            block.className = `calendar-time-block ${hasLinkedTask ? getCalendarStatusClass(seg.row['ステータス']) : 'calendar-time-block--dayplan'}`;
            if (hasLinkedTask && isChipSelected(String(seg.row['ID']))) block.classList.add('calendar-time-block--selected');
            if (seg.isDayPlanBlock && seg.dayPlanBlockIndex === selectedBlockIndex && dateJP === getSelectedDate()) block.classList.add('calendar-time-block--selected');
            block.style.top    = `${seg.startMin * pxPerMin}px`;
            block.style.height = `${(seg.endMin - seg.startMin) * pxPerMin}px`;
            block.style.left   = `${seg.lane * laneWidthPct}%`;
            block.style.width  = `calc(${laneWidthPct}% - 4px)`;

            const labelSpan = document.createElement('span');
            labelSpan.textContent = seg.row['タイトル'] || '（無題）';
            block.appendChild(labelSpan);
            if (gridBackground) block.title = labelSpan.textContent; // 週ビューは列が狭く題名が切れるため

            const handle = document.createElement('div');
            handle.className = 'calendar-time-block-resize-handle';
            block.appendChild(handle);

            attachTaskorg2TimelineDragHandlers(block, handle, labelSpan, seg, dateJP, pxPerMin, hasLinkedTask);
            lanesEl.appendChild(block);
        });
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
                if (dragMode === 'move') {
                    // 1日タスクのブロックなら選んで操作帯（完了・外す）を出す。タスクにつながっていれば編集フォームにも読み込む
                    if (dateJP !== getSelectedDate()) selectDate?.(dateJP); // 週ビューで別の日のブロックを押したとき
                    selectedBlockIndex = seg.isDayPlanBlock ? seg.dayPlanBlockIndex : null;
                    if (hasLinkedTask) selectTask(String(seg.row['ID']));
                    else renderTaskorg2Timeline();
                }
            } else {
                commitTaskorg2TimelineDrag(seg, dateJP, pendingStart, pendingEnd, pendingColumn);
            }
            dragMode = null;
        }

        function startDrag(mode, e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            // テキスト欄を書き換えたままドラッグしたら、先に反映する（ブロックを押してもテキスト欄のフォーカスは外れないため）
            if (editorDirty) {
                e.preventDefault();
                const reflected = reflectDayPlanEditor({ auto: true });
                // テキスト欄は選んだ日のもの。ほかの日（週ビュー）のブロックなら、番号は変わらないので探し直さない
                if (reflected !== 'ok' || (dateJP === getSelectedDate() && !relocateSegment(seg))) { renderTaskorg2Timeline(); return; }
            }
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
     * - 1日タスクに未追加のタスク（移動・リサイズ、列の変更の有無を問わない）: そのタスク自身の開始予定・終了予定は変えず、
     *   1日タスクへ新しい行として追加する（＝昇格）。「対応中タスク」一覧での参照状態が変わるため未設定タスク一覧も再描画。
     *   1日タスクはタスクの属性を書き換えない（CLAUDE.mdの「1日タスクのルール」）。以前は縦方向だけのドラッグで
     *   開始予定・終了予定を書き換えていたが、想定外の動きだったため2026-11-05に廃止した。
     */
    function commitTaskorg2TimelineDrag(seg, dateJP, newStartMin, newEndMin, targetColumn) {
        selectedBlockIndex = null; // 並べ替わって番号がずれるため
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

        let dayPlan = getDayPlanTaskM(getMainData(), dateJP);
        if (!dayPlan) {
            createTaskorg2DayPlanTask(dateJP);
            dayPlan = getDayPlanTaskM(getMainData(), dateJP);
            if (!dayPlan) return;
        }
        const newBlock = { refId: String(seg.row['ID']), label: seg.row['タイトル'] || '（無題）' };
        // 1日タスクを作ったときに、このタスク（その日の時刻つきの予定）が自動で取り込まれていれば、その行を動かす（同じタスクを2行にしない）
        const importedIndex = parseDayPlanContent(dayPlan['内容']).findIndex(b => b.refId === newBlock.refId);
        const result = importedIndex >= 0
            ? placeDayPlanBlock(dayPlan['内容'], importedIndex, newStartMin, newEndMin, targetColumn)
            : placeDayPlanBlock(dayPlan['内容'], null, newStartMin, newEndMin, targetColumn, newBlock);
        if (!result.ok) { renderTaskorg2Timeline(); return; } // 24:00を超えるためキャンセル、タスクは未追加のまま
        dayPlan['内容']     = result.content;
        dayPlan['更新日時'] = formatJpDatetime(new Date());
        persistLocalCache();
        renderTaskorg2Timeline();
        renderUnsetSection(); // 「対応中タスク」の未設定/参照済み区分が変わるため
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
            if (!editorDirty) contentEl.value = dayPlan['内容'] || '';
        } else {
            createBtn.style.display = '';
            editor.style.display = 'none';
            contentEl.value = '';
            editorDirty = false;
        }
        updateDayPlanEditorWarning();
        renderCarryOverButton();
    }

    // ===== 前日の残りを取り込む =====

    /**
     * 選択日より前で最も近い1日タスク（土日をはさんでも前の勤務日のものになる）から、まだ完了・中断になっていない
     * タスク（#IDのある行）を、この日の1日タスクにまだ無いものだけ返す。同じタスクが何行あっても1つにまとめる。
     */
    function getCarryOverCandidates() {
        const date = getSelectedDate();
        if (!date) return { fromDate: null, rows: [] };
        const prevPlan = getMainData()
            .filter(r => isDayPlanRow(r) && (r['開始予定'] || '').slice(0, 10) < date.slice(0, 10))
            .sort((a, b) => (b['開始予定'] || '').localeCompare(a['開始予定'] || ''))[0];
        if (!prevPlan) return { fromDate: null, rows: [] };
        const current = getTaskorg2DayPlanTask();
        const already = new Set(parseDayPlanContent(current ? current['内容'] : '').map(b => b.refId).filter(Boolean));
        const ids = [...new Set(parseDayPlanContent(prevPlan['内容']).map(b => b.refId).filter(Boolean))];
        const rows = ids
            .filter(id => !already.has(id))
            .map(id => getMainData().find(r => String(r['ID']) === id))
            .filter(r => r && !isDayPlanRow(r) && !CARRY_CLOSED_STATUSES.includes(r['ステータス']));
        return { fromDate: (prevPlan['開始予定'] || '').slice(0, 10), rows };
    }

    /** 取り込めるものがあるときだけ、件数つきでボタンを出す。 */
    function renderCarryOverButton() {
        const btn = document.getElementById('calendar2-dayplan-carry-btn');
        if (!btn) return;
        const { fromDate, rows } = getCarryOverCandidates();
        btn.style.display = rows.length ? '' : 'none';
        btn.textContent = `前日の残りを取り込む（${rows.length}件）`;
        btn.title = rows.length ? `${fromDate}の1日タスクで、まだ完了・中断になっていないタスクを、この日の作業枠に足します` : '';
    }

    /** 前日の残りを、この日の作業枠（＋ボタンと同じく列4の空き）へ足す。書き換えるのは1日タスク行だけ。 */
    function carryOverFromPreviousDay() {
        const { fromDate, rows } = getCarryOverCandidates();
        if (!rows.length) return;
        let dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) {
            createTaskorg2DayPlanTask();
            dayPlan = getTaskorg2DayPlanTask();
            if (!dayPlan) return;
        }
        rows.forEach(row => {
            if (parseDayPlanContent(dayPlan['内容']).some(b => b.refId === String(row['ID']))) return; // 作成時に列1へ取り込まれたもの
            const fixedSlot = getTaskScheduledTimeOnDate(row, getSelectedDate());
            const { startStr, endStr, column } = fixedSlot ? { ...fixedSlot, column: 1 } : computeDayPlanTimeSlot(parseDayPlanContent(dayPlan['内容']));
            appendTaskorg2DayPlanLine(row, startStr, endStr, column);
        });
        selectedBlockIndex = null;
        editorDirty = false;
        persistLocalCache();
        renderCalendar2();
        const statusEl = document.getElementById('calendar2-dayplan-carry-status');
        if (statusEl) statusEl.textContent = `${fromDate}から${rows.length}件を取り込みました`;
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
    function createTaskorg2DayPlanTask(dateJP = getSelectedDate()) {
        if (!dateJP) return;

        const ts = formatJpDatetime(new Date());

        // ステータスでは絞り込まない（null）。空のSetを渡すと「どのステータスも選ばれていない」となり、ステータスの入ったタスクがすべて外れていた（2026-11-09に修正）
        const noFilters = { status: null };
        const scheduledBlocks = getTasksForDateM(getMainData(), getCategory(), noFilters, dateJP)
            .map(row => {
                const timeInfo = getTaskScheduledTimeOnDate(row, dateJP);
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
        entry['ID']        = nextMainId(getMainData());
        entry['システム']   = { '種別': KIND_DAYPLAN };
        entry['タイトル']   = `1日タスク ${dateJP}`;
        entry['開始予定']   = dateJP;
        entry['内容']       = content;
        entry['作成日時']   = ts;
        entry['更新日時']   = ts;

        getMainData().push(entry);
        persistLocalCache();
        renderCalendar2();
    }

    /** テキスト欄の行のうち、書式に合わない（反映すると消える）行を返す。空行は数えない。 */
    function findInvalidDayPlanLines(text) {
        return (text || '').split('\n').map(line => line.trim()).filter(Boolean).filter(line => parseDayPlanContent(line).length === 0);
    }

    /** 書式に合わない行があれば、テキスト欄の下に「反映すると消える」ことを出す。 */
    function updateDayPlanEditorWarning() {
        const warnEl    = document.getElementById('calendar2-dayplan-warning');
        const contentEl = document.getElementById('calendar2-dayplan-content');
        if (!warnEl || !contentEl) return;
        const invalid = editorDirty ? findInvalidDayPlanLines(contentEl.value) : [];
        warnEl.style.display = invalid.length ? '' : 'none';
        warnEl.textContent = invalid.length
            ? `書式に合わない行が${invalid.length}行あります（${invalid.map(l => `「${l}」`).join('、')}）。直すまで自動では反映しません。「反映」を押すと、この行は消えます。`
            : '';
    }

    /**
     * テキスト欄の内容をその日の1日タスクに反映する（「反映」ボタン、テキスト欄から離れたとき、ドラッグを始めたとき）。
     * 書式に合わない行があるときは、自動（auto）では反映せず、ボタンでは消えることを確かめてから反映する。
     * 戻り値：'ok'（反映した）／'none'（変更なし）／'invalid'（反映しなかった）
     */
    function reflectDayPlanEditor({ auto }) {
        if (!getSelectedDate()) return 'none';
        const dayPlan   = getTaskorg2DayPlanTask();
        const contentEl = document.getElementById('calendar2-dayplan-content');
        if (!dayPlan || !contentEl) return 'none';
        if (auto && !editorDirty) return 'none';
        const rawContent = contentEl.value;
        const invalid = findInvalidDayPlanLines(rawContent);
        if (invalid.length) {
            if (auto) { updateDayPlanEditorWarning(); return 'invalid'; }
            if (!confirm(`次の${invalid.length}行は書式に合わないため消えます。反映しますか？\n\n${invalid.join('\n')}`)) return 'invalid';
        }
        const newContent = stringifyDayPlanBlocks(sortDayPlanBlocks(parseDayPlanContent(rawContent)));
        editorDirty = false;
        contentEl.value = newContent;
        updateDayPlanEditorWarning();
        if (newContent === (dayPlan['内容'] || '')) return 'none';
        dayPlan['内容']     = newContent;
        dayPlan['更新日時'] = formatJpDatetime(new Date());
        selectedBlockIndex = null;
        persistLocalCache();
        return 'ok';
    }

    /** ドラッグを始める直前に反映して内容が変わったとき、つかんだブロックの番号を新しい内容で探し直す。見つからなければfalse。 */
    function relocateSegment(seg) {
        if (!seg.isDayPlanBlock) return true;
        const dayPlan = getTaskorg2DayPlanTask();
        const blocks  = dayPlan ? parseDayPlanContent(dayPlan['内容']) : [];
        const refId   = seg.row['ID'] != null ? String(seg.row['ID']) : null;
        const index   = blocks.findIndex(b => b.startMin === seg.startMin && b.endMin === seg.endMin && b.refId === refId);
        if (index < 0) return false;
        seg.dayPlanBlockIndex = index;
        return true;
    }

    /** 「反映」ボタン。 */
    function saveTaskorg2DayPlanContent() {
        if (reflectDayPlanEditor({ auto: false }) === 'invalid') return;
        renderTaskorg2Timeline();
    }

    // ===== 選んだブロックの操作帯（完了・1日タスクから外す） =====

    /** 1日タスクの内容欄から、有効な行のindex番目（parseDayPlanContentの順）だけを消す。ほかの行はそのまま残す。 */
    function removeDayPlanLine(content, index) {
        let n = -1;
        return (content || '').split('\n').filter(line => {
            if (!line.trim() || parseDayPlanContent(line).length === 0) return true;
            n++;
            return n !== index;
        }).join('\n');
    }

    /** 選んだブロックの情報を返す。選んでいない・番号が古いときはnull。 */
    function getSelectedDayPlanBlock() {
        if (selectedBlockIndex === null) return null;
        const dayPlan = getTaskorg2DayPlanTask();
        const block = dayPlan ? parseDayPlanContent(dayPlan['内容'])[selectedBlockIndex] : null;
        if (!block) return null;
        const row = block.refId ? getMainData().find(r => String(r['ID']) === block.refId) || null : null;
        return { dayPlan, block, row };
    }

    /** タイムラインの下に、選んだブロックの「完了」「1日タスクから外す」を出す。 */
    function renderDayPlanBlockActions() {
        const bar = document.getElementById('calendar2-dayplan-actions');
        if (!bar) return;
        let selected = getSelectedDayPlanBlock();
        // タスクにつながったブロックは、ほかのチップなどで別のタスクを選んだら選択を外す
        if (selected?.row && !isChipSelected(String(selected.row['ID']))) { selectedBlockIndex = null; selected = null; }
        bar.innerHTML = '';
        if (!selected) { bar.style.display = 'none'; return; }

        const { block, row } = selected;
        const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        bar.style.display = '';
        const label = document.createElement('span');
        label.className = 'calendar-dayplan-actions-label';
        label.textContent = `${fmt(block.startMin)}-${fmt(block.endMin)} ${row ? (row['タイトル'] || '（無題）') : (block.label || '（ラベルなし）')}`;
        bar.appendChild(label);

        if (row) {
            const isDone = row['ステータス'] === '完了';
            const doneBtn = document.createElement('button');
            doneBtn.id = 'calendar2-dayplan-done-btn';
            doneBtn.className = 'calendar-add-btn';
            doneBtn.textContent = isDone ? '完了済み' : '完了';
            doneBtn.disabled = isDone;
            doneBtn.addEventListener('click', () => completeDayPlanTask(row));
            bar.appendChild(doneBtn);
        }
        const removeBtn = document.createElement('button');
        removeBtn.id = 'calendar2-dayplan-remove-btn';
        removeBtn.className = 'calendar-danger-btn';
        removeBtn.textContent = '1日タスクから外す';
        removeBtn.addEventListener('click', removeSelectedDayPlanBlock);
        bar.appendChild(removeBtn);
    }

    /** 選んだブロックを1日タスクから外す。書き換えるのは1日タスク行だけ（タスク本体は変えない）。 */
    function removeSelectedDayPlanBlock() {
        const selected = getSelectedDayPlanBlock();
        if (!selected) return;
        selected.dayPlan['内容']     = removeDayPlanLine(selected.dayPlan['内容'], selectedBlockIndex);
        selected.dayPlan['更新日時'] = formatJpDatetime(new Date());
        selectedBlockIndex = null;
        editorDirty = false;
        persistLocalCache();
        renderCalendar2(); // 「対応中タスク」の未設定／設定済みの振り分けも変わるため
    }

    /**
     * タイムラインから、つながったタスクを完了にする（確認つき）。完了日が空なら今日を入れる（編集フォームと同じ）。
     * 「1日タスクはタスクを書き換えない」ルールの例外（2026-11-09ユーザー判断。よく使うため）。CLAUDE.md 2章参照。
     */
    function completeDayPlanTask(row) {
        if (!confirm(`「${row['タイトル'] || '（無題）'}」を完了にしますか？`)) return;
        const today = new Date();
        const pad = n => String(n).padStart(2, '0');
        row['ステータス'] = '完了';
        if (!row['完了日']) row['完了日'] = `${today.getFullYear()}/${pad(today.getMonth() + 1)}/${pad(today.getDate())}`;
        row['更新日時'] = formatJpDatetime(today);
        persistLocalCache();
        renderCalendar2();
    }

    /** 選択中日付の1日タスクを削除する。 */
    function deleteTaskorg2DayPlanTask() {
        if (!getSelectedDate()) return;
        const dayPlan = getTaskorg2DayPlanTask();
        if (!dayPlan) return;
        setMainData(getMainData().filter(r => r !== dayPlan));
        selectedBlockIndex = null;
        editorDirty = false;
        persistLocalCache();
        renderCalendar2();
    }

    document.getElementById('calendar2-dayplan-create-btn')?.addEventListener('click', () => createTaskorg2DayPlanTask());
    document.getElementById('calendar2-dayplan-carry-btn')?.addEventListener('click', carryOverFromPreviousDay);
    document.getElementById('calendar2-dayplan-save-btn')?.addEventListener('click', saveTaskorg2DayPlanContent);
    const editorEl = document.getElementById('calendar2-dayplan-content');
    editorEl?.addEventListener('input', () => { editorDirty = true; updateDayPlanEditorWarning(); });
    editorEl?.addEventListener('blur', () => { if (reflectDayPlanEditor({ auto: true }) === 'ok') renderTaskorg2Timeline(); }); // テキスト欄から離れたら自動で反映
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
        if (busyBlocks.some(b => b.refId === String(row['ID']))) { persistLocalCache(); renderCalendar2(); return; } // 1日タスクの作成時に取り込まれた（同じタスクを2行にしない）
        const fixedSlot = getTaskScheduledTimeOnDate(row, getSelectedDate());
        const { startStr, endStr, column } = fixedSlot ? { ...fixedSlot, column: 1 } : computeDayPlanTimeSlot(busyBlocks);
        appendTaskorg2DayPlanLine(row, startStr, endStr, column);
        selectedBlockIndex = null;
        persistLocalCache();
        renderCalendar2();
    }

    /** チップ群（{row, label}の配列）を container に描画する。空なら emptyText を表示する。options.showAddButton（既定true）で1日タスクへの追加＋ボタンの有無を切り替える。 */

    return { getSegmentsForDate: getTaskorg2SegmentsForDate, renderTimeline: renderTaskorg2Timeline, addToDayPlan: addTaskorg2ToDayPlan, renderDayLanes };
}
