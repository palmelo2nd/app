// 報告ビュー（テーマ × 報告先のマトリクス。2026-10-14に再設計、2026-10-30にapp.jsから分離）
// 報告先＝構造行（1件）、テーマ＝テーマ行、成果＝エントリ行（システム列のテーマID・報告状態=報告先ごとの状態）、
// 報告先ごとの日付と下書き＝タイミング行。データ構造の詳細は js/modules/report.js 冒頭を参照。
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import { MAIN_DATA_COLUMNS } from '../modules/dataModel.js?v=60';
import { formatJpDatetime } from '../modules/task.js?v=60';
import {
    REPORT_PARA_STRUCTURE,
    REPORT_PARA_THEME,
    REPORT_PARA_ENTRY,
    REPORT_PARA_OCCASION,
    REPORT_STATE_PLANNED,
    REPORT_STATE_DONE,
    REPORT_STATE_SKIPPED,
    isReportStructureRow,
    isReportThemeRow,
    isReportEntryRow,
    isReportOccasionRow,
    splitReportIds,
    createReportRow,
    parseReportStructure,
    assignReportNodeIds,
    stringifyReportStructure,
    flattenReportTree,
    getReportThemes,
    getReportEntryThemeId,
    parseReportStates,
    stringifyReportStates,
    nextReportState,
    hasUnfinishedReportState,
    getReportOccasionsForVenue,
    getNextReportOccasion,
    buildReportDraft,
    REPORT_KEY_VENUES,
    REPORT_KEY_THEME,
    REPORT_KEY_STATES,
    getReportField,
    setReportField
} from '../modules/report.js?v=60';

/**
 * (2) インプット: ctx = {
 *   getMainData()        — 現在のmainData（配列。行の追加・編集はこの配列を直接書き換える）
 *   setMainData(rows)    — mainDataを差し替える（行の削除で filter した配列を戻すときに使う）
 *   persistLocalCache()  — 端末キャッシュへ保存
 *   jpDateOnly(dt)       — 日時文字列の日付部分
 *   isoToJP(d)           — "YYYY-MM-DD" → "YYYY/MM/DD"
 * }
 * (4) アウトプット: { render } — 報告タブ全体を再描画する
 */
export function createReportView(ctx) {
    const { getMainData, setMainData, persistLocalCache, jpDateOnly, isoToJP } = ctx;

    let reportSelectedVenueId    = null;  // 報告タブ：準備画面を開いている報告先ID（sN）
    const reportChosenOccasionIds = new Map(); // 報告タブ：報告先ID → 日付チップで選んだタイミング行ID（端末内の一時状態。保存しない）
    let reportOnlyUnfinished     = false; // 報告タブ：成果一覧を「予定・見送りが残るもの」だけに絞る
    let reportEditingEntryId     = null;  // 報告タブ：成果一覧でインライン編集中のエントリID
    const reportCollapsedThemeIds = new Set(); // 報告タブ：成果一覧で折りたたみ中のテーマID（テーマ未設定グループは''）
    const REPORT_LAST_THEME_KEY = 'brain_report_last_theme';

    function reportTodayJP() { return jpDateOnly(formatJpDatetime(new Date())); }

    /** "yyyy/mm/dd" を "M/D" 表記にする。パース不可なら空文字。 */
    function reportShortDate(dateJP) {
        const m = /^\d{4}\/(\d{1,2})\/(\d{1,2})/.exec(dateJP || '');
        return m ? `${+m[1]}/${+m[2]}` : '';
    }

    function reportEntryShortText(row, maxLen = 30) {
        const t = (row['内容'] || row['タイトル'] || '（無題）').replace(/\s+/g, ' ');
        return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
    }

    function loadReportLastThemeId() {
        try { return localStorage.getItem(REPORT_LAST_THEME_KEY) || ''; } catch (_) { return ''; }
    }
    function saveReportLastThemeId(id) {
        try { localStorage.setItem(REPORT_LAST_THEME_KEY, id); } catch (_) { /* 保存できなくても動作に影響しない */ }
    }

    /**
     * 報告先の「対象の回」（タイミング行）を返す。表の状態セルで「済」にするときの日付と、報告準備の画面の両方がこれを使う。
     * 決め方：日付チップで選んだ回 → 次回（今日以降で最も近い回） → 直近の過去の回。回が1つも無ければnull。
     */
    function getReportTargetOccasion(venueId, today) {
        const occasions = getReportOccasionsForVenue(getMainData(), venueId);
        const chosenId = reportChosenOccasionIds.get(venueId);
        return occasions.find(o => String(o['ID']) === chosenId)
            || getNextReportOccasion(getMainData(), venueId, today)
            || occasions[0] || null;
    }

    /** 報告構造行（システム列 { 種別: '報告', 報告区分: '構造' }）を返す。存在しなければ空のものを新規作成してmainDataに追加する。 */
    function getOrCreateReportStructureRow() {
        let row = getMainData().find(isReportStructureRow);
        if (row) return row;
        row = createReportRow(getMainData(), MAIN_DATA_COLUMNS, formatJpDatetime(new Date()),
            REPORT_PARA_STRUCTURE, { 'タイトル': '報告構造' });
        getMainData().push(row);
        return row;
    }

    /** 報告先（マトリクスの列）を { id, label }[] で返す。 */
    function getReportVenues() {
        const row = getOrCreateReportStructureRow();
        return flattenReportTree(parseReportStructure(row['内容']));
    }

    function createReportThemeRow(name) {
        const row = createReportRow(getMainData(), MAIN_DATA_COLUMNS, formatJpDatetime(new Date()),
            REPORT_PARA_THEME, { 'タイトル': name });
        getMainData().push(row);
        persistLocalCache();
        return row;
    }

    /** エントリの報告先ごとの状態を書き換える（state が空文字なら対象外に戻す）。保存（persistLocalCache）は呼び出し側で行う。 */
    function setReportEntryState(entry, venueId, state, date) {
        const states = parseReportStates(getReportField(entry, REPORT_KEY_STATES));
        if (state) states.set(venueId, { state, date: state === REPORT_STATE_DONE ? date : '' });
        else states.delete(venueId);
        setReportField(entry, REPORT_KEY_STATES, stringifyReportStates(states));
        entry['更新日時'] = formatJpDatetime(new Date());
    }

    /** 指定報告先で指定状態のエントリを、作成日時の古い順で返す。 */
    function getReportEntriesByVenueState(venueId, state) {
        return getMainData().filter(isReportEntryRow)
            .filter(r => parseReportStates(getReportField(r, REPORT_KEY_STATES)).get(venueId)?.state === state)
            .sort((a, b) => (a['作成日時'] || '').localeCompare(b['作成日時'] || ''));
    }

    /** 報告タブ全体を再描画する。taskorg2View==='report'の時だけ呼ばれる想定。 */
    function renderReportTab() {
        renderReportQuickCapture();
        renderReportMatrix();
        renderReportVenuePanel();
        renderReportSettings();
    }

    // ----- クイック追記 -----

    function renderReportQuickCapture() {
        const sel = document.getElementById('report-quick-capture-theme');
        if (!sel) return;
        const themes = getReportThemes(getMainData());
        let chosen = (sel.value && sel.value !== '__new__') ? sel.value : loadReportLastThemeId();
        if (!themes.some(t => String(t['ID']) === chosen)) chosen = themes.length > 0 ? String(themes[0]['ID']) : '';

        sel.innerHTML = '';
        themes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = String(t['ID']);
            opt.textContent = t['タイトル'] || '（無題）';
            sel.appendChild(opt);
        });
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = '＋ 新しいテーマを作成…';
        sel.appendChild(newOpt);
        sel.value = chosen || '__new__';
        updateReportQuickCaptureHint();
    }

    function updateReportQuickCaptureHint() {
        const sel    = document.getElementById('report-quick-capture-theme');
        const hintEl = document.getElementById('report-quick-capture-hint');
        if (!sel || !hintEl) return;
        const theme = getMainData().find(r => isReportThemeRow(r) && String(r['ID']) === sel.value);
        if (!theme) { hintEl.textContent = 'テーマを選ぶか、新しく作成してください'; return; }
        const venues = getReportVenues();
        const labels = splitReportIds(getReportField(theme, REPORT_KEY_VENUES)).map(id => venues.find(v => v.id === id)?.label).filter(Boolean);
        hintEl.textContent = labels.length > 0
            ? `追記すると「${labels.join('、')}」の報告が自動で「予定」になります`
            : '既定の報告先が未設定です（「報告先・テーマの設定」で選ぶと、追記時に自動で「予定」になります）';
    }

    document.getElementById('report-quick-capture-theme')?.addEventListener('change', (e) => {
        const sel = e.target;
        if (sel.value === '__new__') {
            const name = (prompt('新しいテーマの名称を入力してください') || '').trim();
            if (name) saveReportLastThemeId(String(createReportThemeRow(name)['ID']));
            renderReportTab();
            return;
        }
        saveReportLastThemeId(sel.value);
        updateReportQuickCaptureHint();
    });

    function addReportQuickCaptureEntry() {
        const textEl = document.getElementById('report-quick-capture-text');
        const sel    = document.getElementById('report-quick-capture-theme');
        const text = (textEl?.value || '').trim();
        if (!text) return;
        const theme = getMainData().find(r => isReportThemeRow(r) && String(r['ID']) === sel?.value);
        if (!theme) { alert('テーマを選択してください'); return; }

        const venueIds = new Set(getReportVenues().map(v => v.id));
        const states = new Map();
        splitReportIds(getReportField(theme, REPORT_KEY_VENUES)).filter(id => venueIds.has(id))
            .forEach(id => states.set(id, { state: REPORT_STATE_PLANNED, date: '' }));

        const entry = createReportRow(getMainData(), MAIN_DATA_COLUMNS, formatJpDatetime(new Date()), REPORT_PARA_ENTRY, {
            'タイトル': text.slice(0, 20),
            '内容':     text,
        }, {
            [REPORT_KEY_THEME]:  String(theme['ID']),
            [REPORT_KEY_STATES]: stringifyReportStates(states),
        });
        getMainData().push(entry);
        persistLocalCache();

        textEl.value = '';
        renderReportMatrix();
        renderReportVenuePanel();
    }
    document.getElementById('report-quick-capture-add-btn')?.addEventListener('click', addReportQuickCaptureEntry);
    document.getElementById('report-quick-capture-text')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addReportQuickCaptureEntry(); }
    });

    // ----- 成果一覧（テーマ × 報告先のマトリクス） -----

    document.getElementById('report-only-unfinished')?.addEventListener('change', (e) => {
        reportOnlyUnfinished = e.target.checked;
        renderReportMatrix();
    });

    function renderReportMatrix() {
        const wrap = document.getElementById('report-matrix-wrapper');
        if (!wrap) return;
        const scrollTop = wrap.scrollTop, scrollLeft = wrap.scrollLeft;
        wrap.innerHTML = '';

        const venues = getReportVenues();
        if (venues.length === 0) {
            wrap.innerHTML = '<p class="calendar-empty-text">「報告先・テーマの設定」で報告先（会議・月報など）を登録してください</p>';
            return;
        }
        const themes  = getReportThemes(getMainData());
        const entries = getMainData().filter(isReportEntryRow);
        const today   = reportTodayJP();
        const targetByVenue = new Map(); // 報告先ID → 対象の回（見出しの描画時に決める）

        const table = document.createElement('table');
        table.className = 'report-matrix';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const thText = document.createElement('th');
        thText.className = 'report-col-text';
        thText.textContent = '成果';
        headRow.appendChild(thText);
        venues.forEach(v => {
            const th = document.createElement('th');
            th.className = 'report-col-venue';
            if (v.id === reportSelectedVenueId) th.classList.add('report-col-venue--active');
            const next   = getNextReportOccasion(getMainData(), v.id, today);
            const target = getReportTargetOccasion(v.id, today);
            targetByVenue.set(v.id, target);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'report-venue-head-btn';
            const nameEl = document.createElement('span');
            nameEl.textContent = v.label;
            const dateEl = document.createElement('span');
            dateEl.className = 'report-venue-head-date';
            if (!target) dateEl.textContent = '日程未定';
            else if (target === next) dateEl.textContent = `次回 ${reportShortDate(target['開始予定'])}`;
            else if (reportChosenOccasionIds.has(v.id)) {
                dateEl.textContent = `${reportShortDate(target['開始予定'])}の回`;
                dateEl.classList.add('report-venue-head-date--chosen');
            } else dateEl.textContent = `前回 ${reportShortDate(target['開始予定'])}`;
            btn.append(nameEl, dateEl);
            btn.addEventListener('click', () => {
                reportSelectedVenueId = v.id;
                renderReportMatrix();
                renderReportVenuePanel();
                document.getElementById('report-venue-section')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
            th.appendChild(btn);
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const themeIdSet = new Set(themes.map(t => String(t['ID'])));
        const groups = themes.map(t => ({ id: String(t['ID']), name: t['タイトル'] || '（無題）', orphan: false }));
        if (entries.some(e => !themeIdSet.has(getReportEntryThemeId(e)))) {
            groups.push({ id: '', name: '（テーマ未設定）', orphan: true });
        }

        let shownGroups = 0;
        groups.forEach(g => {
            const all = entries.filter(e => g.orphan
                ? !themeIdSet.has(getReportEntryThemeId(e))
                : getReportEntryThemeId(e) === g.id);
            const items = (reportOnlyUnfinished ? all.filter(hasUnfinishedReportState) : all)
                .sort((a, b) => (b['作成日時'] || '').localeCompare(a['作成日時'] || ''));
            if (reportOnlyUnfinished && items.length === 0) return;
            shownGroups++;

            const collapsed = reportCollapsedThemeIds.has(g.id);
            const headTr = document.createElement('tr');
            headTr.className = 'report-theme-header-row';
            const headTd = document.createElement('td');
            headTd.colSpan = venues.length + 1;
            headTd.textContent = `${collapsed ? '▶' : '▼'} ${g.name}（${items.length}件）`;
            headTd.addEventListener('click', () => {
                if (collapsed) reportCollapsedThemeIds.delete(g.id); else reportCollapsedThemeIds.add(g.id);
                renderReportMatrix();
            });
            headTr.appendChild(headTd);
            tbody.appendChild(headTr);

            if (!collapsed) items.forEach(e => tbody.appendChild(buildReportEntryRow(e, venues, themes, targetByVenue)));
        });
        if (shownGroups === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = venues.length + 1;
            td.className = 'calendar-empty-text';
            td.textContent = themes.length === 0 && entries.length === 0
                ? '上の「クイック追記」から、テーマを作って最初の成果を記録してください'
                : '該当する成果はありません';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        wrap.scrollTop = scrollTop;
        wrap.scrollLeft = scrollLeft;
    }

    /** マトリクスの成果1行（本文＋報告先ごとの状態セル）を組み立てる。targetByVenue：報告先ID → 対象の回（タイミング行またはnull）。 */
    function buildReportEntryRow(entry, venues, themes, targetByVenue) {
        const entryId = String(entry['ID']);
        const tr = document.createElement('tr');
        const tdText = document.createElement('td');
        tdText.className = 'report-col-text';

        if (entryId === reportEditingEntryId) {
            const textarea = document.createElement('textarea');
            textarea.className = 'calendar-dayplan-textarea';
            textarea.rows = 3;
            textarea.value = entry['内容'] || '';
            tdText.appendChild(textarea);

            const themeSel = document.createElement('select');
            const currentTheme = getReportEntryThemeId(entry);
            if (!themes.some(t => String(t['ID']) === currentTheme)) {
                const opt = document.createElement('option');
                opt.value = currentTheme;
                opt.textContent = '（テーマ未設定）';
                themeSel.appendChild(opt);
            }
            themes.forEach(t => {
                const opt = document.createElement('option');
                opt.value = String(t['ID']);
                opt.textContent = t['タイトル'] || '（無題）';
                themeSel.appendChild(opt);
            });
            themeSel.value = currentTheme;
            tdText.appendChild(themeSel);

            const actions = document.createElement('div');
            actions.className = 'report-entry-edit-actions';
            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'calendar-add-btn';
            saveBtn.textContent = '保存';
            saveBtn.addEventListener('click', () => {
                const text = textarea.value.trim();
                if (!text) { alert('成果の内容を入力してください（削除する場合は「削除」を押してください）'); return; }
                entry['内容']     = text;
                entry['タイトル'] = text.slice(0, 20);
                setReportField(entry, REPORT_KEY_THEME, themeSel.value);
                entry['更新日時'] = formatJpDatetime(new Date());
                persistLocalCache();
                reportEditingEntryId = null;
                renderReportMatrix();
                renderReportVenuePanel();
            });
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'calendar-filter-bulk-btn';
            cancelBtn.textContent = 'キャンセル';
            cancelBtn.addEventListener('click', () => { reportEditingEntryId = null; renderReportMatrix(); });
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'calendar-danger-btn';
            deleteBtn.textContent = '削除';
            deleteBtn.addEventListener('click', () => {
                if (!confirm(`「${reportEntryShortText(entry)}」を削除します。よろしいですか？（この操作は取り消せません）`)) return;
                setMainData(getMainData().filter(r => r !== entry));
                persistLocalCache();
                reportEditingEntryId = null;
                renderReportMatrix();
                renderReportVenuePanel();
            });
            actions.append(saveBtn, cancelBtn, deleteBtn);
            tdText.appendChild(actions);
        } else {
            const span = document.createElement('span');
            span.className = 'report-entry-text';
            span.textContent = entry['内容'] || entry['タイトル'] || '（無題）';
            span.title = 'クリックで編集';
            span.addEventListener('click', () => { reportEditingEntryId = entryId; renderReportMatrix(); });
            tdText.appendChild(span);
        }
        tr.appendChild(tdText);

        const states = parseReportStates(getReportField(entry, REPORT_KEY_STATES));
        venues.forEach(v => {
            const td = document.createElement('td');
            td.className = 'report-col-venue';
            const cur = states.get(v.id);
            const state = cur ? cur.state : '';
            const target = targetByVenue.get(v.id) || null;
            const targetDate = target ? (target['開始予定'] || '') : '';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'report-state-btn';
            if (state === REPORT_STATE_PLANNED) { btn.classList.add('report-state--planned'); btn.textContent = '予定'; }
            else if (state === REPORT_STATE_DONE) {
                btn.classList.add('report-state--done');
                btn.textContent = `✓ ${reportShortDate(cur.date) || '済'}`;
                btn.title = `報告済み ${cur.date || ''}`;
                if (cur.date !== targetDate) btn.classList.add('report-state--done-other'); // 対象の回とは別の回で報告済み
            }
            else if (state === REPORT_STATE_SKIPPED) { btn.classList.add('report-state--skipped'); btn.textContent = '見送り'; }
            else { btn.classList.add('report-state--empty'); btn.textContent = '・'; }
            btn.addEventListener('click', () => {
                let nextState = nextReportState(state);
                if (nextState === REPORT_STATE_DONE && !targetDate) {
                    // 「済」の日付には対象の回の日付を入れるため、回が無い報告先では「済」を飛ばす
                    alert(`「${v.label}」の日付がまだありません。報告済みにするには、報告準備で日付を登録してください`);
                    nextState = nextReportState(nextState);
                }
                setReportEntryState(entry, v.id, nextState, targetDate);
                persistLocalCache();
                renderReportMatrix();
                renderReportVenuePanel();
            });
            td.appendChild(btn);
            tr.appendChild(td);
        });
        return tr;
    }

    // ----- 報告先ごとの準備画面（日付・予定の成果・下書き） -----

    /** 報告準備の画面で開いている報告先の、対象の回（getReportTargetOccasion）を返す。 */
    function getSelectedReportOccasion() {
        return reportSelectedVenueId ? getReportTargetOccasion(reportSelectedVenueId, reportTodayJP()) : null;
    }

    function renderReportVenuePanel() {
        const section = document.getElementById('report-venue-section');
        if (!section) return;
        const venue = getReportVenues().find(v => v.id === reportSelectedVenueId);
        if (!venue) { section.style.display = 'none'; return; }
        section.style.display = '';
        document.getElementById('report-venue-title').textContent = `${venue.label} の報告準備`;

        const today = reportTodayJP();
        const occasions = getReportOccasionsForVenue(getMainData(), venue.id);
        const next = getNextReportOccasion(getMainData(), venue.id, today);
        const occasion = getSelectedReportOccasion();

        const dateInput = document.getElementById('report-occasion-new-date');
        if (dateInput && !dateInput.value) dateInput.value = today.replace(/\//g, '-');

        const occListEl = document.getElementById('report-occasion-list');
        occListEl.innerHTML = '';
        if (occasions.length === 0) {
            occListEl.innerHTML = '<p class="calendar-empty-text">日付がまだありません。「＋ 日付を追加」で登録してください</p>';
        }
        occasions.forEach(o => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'report-occasion-chip';
            if (o === occasion) chip.classList.add('report-occasion-chip--active');
            chip.textContent = `${o['開始予定'] || '（日付なし）'}${next && o === next ? '（次回）' : ''}`;
            chip.addEventListener('click', () => {
                reportChosenOccasionIds.set(venue.id, String(o['ID'])); // 上の表の列もこの回を基準に表示する
                renderReportMatrix();
                renderReportVenuePanel();
            });
            occListEl.appendChild(chip);
        });

        const doneDate = occasion ? (occasion['開始予定'] || today) : today;
        const themes = getReportThemes(getMainData());
        const themeName = (entry) => themes.find(t => String(t['ID']) === getReportEntryThemeId(entry))?.['タイトル'] || '（テーマ未設定）';

        const planned = getReportEntriesByVenueState(venue.id, REPORT_STATE_PLANNED);
        const plannedEl = document.getElementById('report-planned-list');
        plannedEl.innerHTML = '';
        if (planned.length === 0) plannedEl.innerHTML = '<p class="calendar-empty-text">予定の成果はありません</p>';
        planned.forEach(entry => {
            const line = document.createElement('div');
            line.className = 'report-pool-row';
            const tag = document.createElement('span');
            tag.className = 'report-theme-tag';
            tag.textContent = themeName(entry);
            const text = document.createElement('span');
            text.className = 'report-pool-row-title';
            text.textContent = reportEntryShortText(entry, 80);
            text.title = entry['内容'] || '';
            const actions = document.createElement('span');
            actions.className = 'report-pool-row-actions';
            [
                ['済', REPORT_STATE_DONE, `${doneDate} 付けで報告済みにします`],
                ['見送り', REPORT_STATE_SKIPPED, ''],
                ['予定を外す', '', ''],
            ].forEach(([label, state, tip]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'calendar-filter-bulk-btn';
                b.textContent = label;
                if (tip) b.title = tip;
                b.addEventListener('click', () => {
                    setReportEntryState(entry, venue.id, state, doneDate);
                    persistLocalCache();
                    renderReportMatrix();
                    renderReportVenuePanel();
                });
                actions.appendChild(b);
            });
            line.append(tag, text, actions);
            plannedEl.appendChild(line);
        });
        document.getElementById('report-bulk-done-btn').disabled = planned.length === 0;

        const detailEl = document.getElementById('report-occasion-detail');
        if (!occasion) { detailEl.style.display = 'none'; return; }
        detailEl.style.display = '';
        document.getElementById('report-occasion-detail-title').textContent = `${occasion['開始予定'] || ''} の報告`;
        const draftEl = document.getElementById('report-detail-draft');
        if (document.activeElement !== draftEl) draftEl.value = occasion['内容'] || '';

        const reportedEl = document.getElementById('report-reported-list');
        reportedEl.innerHTML = '';
        const reported = getMainData().filter(isReportEntryRow).filter(r => {
            const st = parseReportStates(getReportField(r, REPORT_KEY_STATES)).get(venue.id);
            return st && st.state === REPORT_STATE_DONE && st.date === occasion['開始予定'];
        });
        if (reported.length === 0) reportedEl.innerHTML = '<p class="calendar-empty-text">まだありません</p>';
        reported.forEach(entry => {
            const chip = document.createElement('span');
            chip.className = 'calendar-unscheduled-chip calendar-unscheduled-chip--solo';
            chip.style.background = '#28a745';
            chip.textContent = `${themeName(entry)}：${reportEntryShortText(entry, 20)}`;
            chip.title = entry['内容'] || '';
            reportedEl.appendChild(chip);
        });
    }

    document.getElementById('report-occasion-add-btn')?.addEventListener('click', () => {
        const venue = getReportVenues().find(v => v.id === reportSelectedVenueId);
        if (!venue) return;
        const dateInput = document.getElementById('report-occasion-new-date');
        const dateJP = dateInput?.value ? isoToJP(dateInput.value) : reportTodayJP();
        const occasion = createReportRow(getMainData(), MAIN_DATA_COLUMNS, formatJpDatetime(new Date()), REPORT_PARA_OCCASION, {
            '開始予定': dateJP,
            'タイトル': `報告 ${venue.label} ${dateJP}`,
        }, { [REPORT_KEY_VENUES]: venue.id });
        getMainData().push(occasion);
        persistLocalCache();
        reportChosenOccasionIds.set(venue.id, String(occasion['ID']));
        renderReportMatrix();
        renderReportVenuePanel();
    });

    function saveReportDraft() {
        const occasion = getSelectedReportOccasion();
        if (!occasion) return;
        occasion['内容']     = document.getElementById('report-detail-draft').value;
        occasion['更新日時'] = formatJpDatetime(new Date());
        persistLocalCache();
    }

    document.getElementById('report-detail-save-btn')?.addEventListener('click', () => {
        saveReportDraft();
        renderReportVenuePanel();
    });

    document.getElementById('report-draft-generate-btn')?.addEventListener('click', () => {
        if (!getSelectedReportOccasion()) return;
        const draft = buildReportDraft(getMainData(), reportSelectedVenueId);
        if (!draft) { alert('予定の成果がありません'); return; }
        const draftEl = document.getElementById('report-detail-draft');
        if (draftEl.value.trim() && !confirm('現在の下書きを、予定の成果から作った内容で置き換えます。よろしいですか？')) return;
        draftEl.value = draft;
        saveReportDraft();
        renderReportVenuePanel();
    });

    document.getElementById('report-bulk-done-btn')?.addEventListener('click', () => {
        const venueId = reportSelectedVenueId;
        const planned = getReportEntriesByVenueState(venueId, REPORT_STATE_PLANNED);
        if (planned.length === 0) return;
        const occasion = getSelectedReportOccasion();
        const doneDate = occasion ? (occasion['開始予定'] || reportTodayJP()) : reportTodayJP();
        if (!confirm(`予定の成果 ${planned.length} 件を、${doneDate} 付けで報告済みにします。よろしいですか？`)) return;

        if (occasion && !(occasion['内容'] || '').trim()) {
            occasion['内容']     = buildReportDraft(getMainData(), venueId);
            occasion['更新日時'] = formatJpDatetime(new Date());
        }
        planned.forEach(entry => setReportEntryState(entry, venueId, REPORT_STATE_DONE, doneDate));
        persistLocalCache();
        renderReportMatrix();
        renderReportVenuePanel();
    });

    document.getElementById('report-occasion-delete-btn')?.addEventListener('click', () => {
        const occasion = getSelectedReportOccasion();
        if (!occasion) return;
        if (!confirm(`「${occasion['開始予定'] || occasion['タイトル']}」を削除します。報告済みの記録（成果側の日付）は残ります。よろしいですか？`)) return;
        setMainData(getMainData().filter(r => r !== occasion));
        reportChosenOccasionIds.delete(reportSelectedVenueId);
        persistLocalCache();
        renderReportMatrix();
        renderReportVenuePanel();
    });

    // ----- 設定（報告先・テーマ） -----

    function renderReportSettings() {
        const editor = document.getElementById('report-venue-editor-text');
        if (editor && document.activeElement !== editor) {
            editor.value = getOrCreateReportStructureRow()['内容'] || '';
        }

        const listEl = document.getElementById('report-theme-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        const venues  = getReportVenues();
        const themes  = getReportThemes(getMainData());
        const entries = getMainData().filter(isReportEntryRow);
        if (themes.length === 0) listEl.innerHTML = '<p class="calendar-empty-text">テーマがまだありません</p>';

        themes.forEach(theme => {
            const themeId = String(theme['ID']);
            const box = document.createElement('div');
            box.className = 'report-theme-item';

            const head = document.createElement('div');
            head.className = 'report-theme-item-head';
            const nameBtn = document.createElement('button');
            nameBtn.type = 'button';
            nameBtn.className = 'report-theme-name-btn';
            nameBtn.textContent = theme['タイトル'] || '（無題）';
            nameBtn.title = 'クリックで名称変更';
            nameBtn.addEventListener('click', () => {
                const name = (prompt('新しい名称を入力してください', theme['タイトル'] || '') || '').trim();
                if (!name) return;
                theme['タイトル'] = name;
                theme['更新日時'] = formatJpDatetime(new Date());
                persistLocalCache();
                renderReportTab();
            });
            const count = entries.filter(e => getReportEntryThemeId(e) === themeId).length;
            const countEl = document.createElement('span');
            countEl.className = 'report-theme-count';
            countEl.textContent = `${count}件`;
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'calendar-danger-btn';
            delBtn.textContent = '削除';
            delBtn.addEventListener('click', () => {
                const msg = count > 0
                    ? `テーマ「${theme['タイトル']}」と、配下の成果 ${count} 件を削除します。よろしいですか？（この操作は取り消せません）`
                    : `テーマ「${theme['タイトル']}」を削除します。よろしいですか？`;
                if (!confirm(msg)) return;
                setMainData(getMainData().filter(r => r !== theme && !(isReportEntryRow(r) && getReportEntryThemeId(r) === themeId)));
                persistLocalCache();
                renderReportTab();
            });
            head.append(nameBtn, countEl, delBtn);
            box.appendChild(head);

            const defaults = new Set(splitReportIds(getReportField(theme, REPORT_KEY_VENUES)));
            const checks = document.createElement('div');
            checks.className = 'report-tag-checkboxes';
            const caption = document.createElement('span');
            caption.className = 'calendar-dayplan-hint';
            caption.textContent = '既定の報告先：';
            checks.appendChild(caption);
            venues.forEach(v => {
                const label = document.createElement('label');
                label.className = 'report-tag-checkbox';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = defaults.has(v.id);
                cb.addEventListener('change', () => {
                    if (cb.checked) defaults.add(v.id); else defaults.delete(v.id);
                    setReportField(theme, REPORT_KEY_VENUES, venues.map(x => x.id).filter(id => defaults.has(id)).join(','));
                    theme['更新日時'] = formatJpDatetime(new Date());
                    persistLocalCache();
                    updateReportQuickCaptureHint();
                });
                label.append(cb, document.createTextNode(v.label));
                checks.appendChild(label);
            });
            box.appendChild(checks);
            listEl.appendChild(box);
        });
    }

    document.getElementById('report-theme-add-btn')?.addEventListener('click', () => {
        const name = (prompt('テーマの名称を入力してください') || '').trim();
        if (!name) return;
        createReportThemeRow(name);
        renderReportTab();
    });

    document.getElementById('report-venue-editor-save-btn')?.addEventListener('click', () => {
        const editor = document.getElementById('report-venue-editor-text');
        const tree = assignReportNodeIds(parseReportStructure(editor.value));
        const newIds = new Set(flattenReportTree(tree).map(n => n.id));
        const removed = getReportVenues().filter(v => !newIds.has(v.id));
        if (removed.length > 0) {
            const removedIds = new Set(removed.map(v => v.id));
            const occCount = getMainData().filter(r => isReportOccasionRow(r) && removedIds.has(getReportField(r, REPORT_KEY_VENUES))).length;
            const msg = `報告先「${removed.map(v => v.label).join('、')}」を削除します。紐づく日付 ${occCount} 件と、成果に記録された状態も削除されます。よろしいですか？（この操作は取り消せません）`;
            if (!confirm(msg)) return;
            setMainData(getMainData().filter(r => !(isReportOccasionRow(r) && removedIds.has(getReportField(r, REPORT_KEY_VENUES)))));
            getMainData().filter(isReportEntryRow).forEach(entry => {
                const states = parseReportStates(getReportField(entry, REPORT_KEY_STATES));
                removedIds.forEach(id => states.delete(id));
                setReportField(entry, REPORT_KEY_STATES, stringifyReportStates(states));
            });
            removedIds.forEach(id => reportChosenOccasionIds.delete(id));
            if (removedIds.has(reportSelectedVenueId)) reportSelectedVenueId = null;
        }
        const row = getOrCreateReportStructureRow();
        row['内容']     = stringifyReportStructure(tree);
        row['更新日時'] = formatJpDatetime(new Date());
        persistLocalCache();
        editor.blur();
        renderReportTab();
    });

    return { render: renderReportTab };
}
