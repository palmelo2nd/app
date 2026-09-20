// ES modules（import文）はURLごとにブラウザキャッシュされるため、更新後もブラウザが古いモジュールを
// 使い続けてしまうことがある（brain/stock/kanziと同じ問題）。全importに「?v=N」を付け、バージョンを
// 上げるたびに全モジュールが新しいURLとして再取得されるようにする。JS/CSSを編集した際は、index.htmlの
// css/style.css・js/app.js参照、および下記の全import文の「?v=N」を同じ新しい値に一括で書き換えること。
// 現在のバージョン: 6
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=6';
import { fetchFile, saveFile } from './modules/github.js?v=6';
import {
    parseMarkdown, stringifyMarkdown,
    INGREDIENT_COLUMNS, TOOL_COLUMNS, DISH_COLUMNS, MEALPLAN_COLUMNS, MASTER_DATA_COLUMNS
} from './modules/dataModel.js?v=6';
import { exportToExcel, importFromExcel } from './modules/excel.js?v=6';
import { computeMasterWarnings } from './modules/master.js?v=6';
import {
    parseListField, stringifyListField,
    findDishesUsingIngredient, findDishesUsingTool, findMealPlansUsingDish,
    computeDishTotalTime, computeShoppingList, computeMealPlanTimeline,
    filterRows, formatNowJp
} from './modules/cook.js?v=6';

// 画面右上の「vバッジ」表示。import.meta.urlはこのモジュール自身の完全URL（?v=N込み）を返すため、
// バッジ表示のための追加の同期作業は不要（?v=N更新時、ここは自動で追従する）。
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const PATH  = 'cook/data.md';

const CODE_REPO   = 'app';
const README_PATH = 'cook/README.md';

const $ = id => document.getElementById(id);

// ===== グローバル状態 =====
// 食材・調理器具・料理・献立は列構成が大きく異なるため別テーブル（別配列）として管理する。
let currentSha         = null;
let currentIngredientData = [];
let currentToolData       = [];
let currentDishData       = [];
let currentMealPlanData   = [];
let currentMasterData     = [];
let lastSyncedMarkdown = null;

let selectedIngredientId = null;
let selectedToolId       = null;
let selectedDishId       = null;
let selectedMealPlanId   = null;

let ingredientFilters = { category: '', tag: '' };
let toolFilters       = { category: '' };
let dishFilters       = { category: '', tag: '', timeTag: '', difficulty: '', status: '', maxCookTime: '' };
let mealPlanFilters   = { timeTag: '', status: '' };

let dishIngredientRows = []; // [{食材ID, 分量, 備考}]
let dishToolIds        = new Set();
let dishStepRows       = []; // [{内容, 所要時間}]

let mealPlanDishRows = []; // [{料理ID, 役割}]

const dishCheckedIds = new Set(); // 買い物リスト作成用の複数選択

let dishCookingTimerInterval  = null;
let dishCookingStartTimestamp = null;
let dishCookingChecked        = new Set();

let mealPlanCookingTimerInterval  = null;
let mealPlanCookingStartTimestamp = null;
let mealPlanCookingChecked        = new Set(); // key: `${料理ID}:${手順index}`

// ===== ユーティリティ =====
function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nextId(rows) {
    const maxId = rows.reduce((max, r) => Math.max(max, Number(r['ID']) || 0), 0);
    return maxId + 1;
}

function getMasterValues(column) {
    return [...new Set(currentMasterData.map(r => r[column]).filter(Boolean))];
}

function getStatusOptions(target) {
    return currentMasterData.filter(r => r['(M)ステータス_親'] === target).map(r => r['(M)ステータス_子']).filter(Boolean);
}

function populateDatalist(id, values) {
    $(id).innerHTML = values.map(v => `<option value="${esc(v)}"></option>`).join('');
}

function populateSelectOptions(id, values, { emptyLabel = '未設定' } = {}) {
    const el = $(id);
    const current = el.value;
    el.innerHTML = `<option value="">${emptyLabel}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (values.includes(current)) el.value = current;
}

const STATUS_BADGE_CLASS = { '下書き': 'status-badge--draft', '試作中': 'status-badge--trial', '完成': 'status-badge--done', '定番': 'status-badge--staple' };

/** ステータス値を色分けバッジのHTMLにする（一覧で下書き等を一目で判別できるようにする）。renderDataTableのraw列として使う。 */
function statusBadgeHtml(status) {
    if (!status) return '';
    const cls = STATUS_BADGE_CLASS[status] || 'status-badge--default';
    return `<span class="status-badge ${cls}">${esc(status)}</span>`;
}

// ===== 上部バー：トークン・読込・保存・Excel =====
function setTokenInputs(value) {
    document.querySelectorAll('.js-token-input').forEach(el => { el.value = value; });
}

function persistCurrentToken() {
    const token = $('token-input').value.trim();
    if (token) saveToken(token);
}

function setSyncStatus(state) {
    const el = $('sync-status');
    if (state === 'ok') {
        el.textContent = 'オンライン（最新）';
        el.className = 'sync-status sync-status--ok';
    } else {
        el.textContent = 'オフライン（未同期）';
        el.className = 'sync-status sync-status--offline';
    }
}

function currentDataBundle() {
    return {
        ingredientData: currentIngredientData,
        toolData: currentToolData,
        dishData: currentDishData,
        mealPlanData: currentMealPlanData,
        masterData: currentMasterData
    };
}

function applyContent(content, sha) {
    const data = parseMarkdown(content);
    currentIngredientData = data.ingredientData;
    currentToolData       = data.toolData;
    currentDishData       = data.dishData;
    currentMealPlanData   = data.mealPlanData;
    currentMasterData     = data.masterData;
    currentSha = sha;
    lastSyncedMarkdown = content;
    renderAll();
}

async function loadFromGitproject(token, silent) {
    try {
        const { content, sha } = await fetchFile(token, OWNER, REPO, PATH);
        applyContent(content, sha);
        saveCache(content, sha);
        setSyncStatus('ok');
    } catch (err) {
        const cache = loadCache();
        if (cache) {
            applyContent(cache.content, cache.sha);
            setSyncStatus('offline');
            if (!silent) alert(`読込に失敗しました。キャッシュから復元しました。(${err.message})`);
        } else {
            setSyncStatus('offline');
            if (!silent) alert(`読込に失敗しました。キャッシュもありません。(${err.message})`);
        }
    }
}

async function saveToGithub() {
    const token = $('token-input').value.trim();
    if (!token) { alert('トークンを入力してください'); return; }
    const content = stringifyMarkdown(currentDataBundle());
    saveCache(content, currentSha);
    try {
        const { newSha } = await saveFile(token, OWNER, REPO, PATH, content, currentSha);
        currentSha = newSha;
        lastSyncedMarkdown = content;
        saveCache(content, newSha);
        setSyncStatus('ok');
    } catch (err) {
        if (err.status === 409) {
            alert('他の端末で更新されています。「読込」してから編集内容を確認し、保存し直してください。');
        } else {
            alert(`保存に失敗しました。データはローカルには保持されています。(${err.message})`);
        }
        setSyncStatus('offline');
    }
}

function wireTopBar() {
    $('load-btn').addEventListener('click', () => {
        persistCurrentToken();
        loadFromGitproject($('token-input').value.trim(), false);
    });
    $('save-btn').addEventListener('click', () => {
        persistCurrentToken();
        saveToGithub();
    });
    $('export-btn').addEventListener('click', () => {
        persistCurrentToken();
        exportToExcel(currentDataBundle());
    });
    $('import-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        persistCurrentToken();
        const data = await importFromExcel(file);
        currentIngredientData = data.ingredientData;
        currentToolData       = data.toolData;
        currentDishData       = data.dishData;
        currentMealPlanData   = data.mealPlanData;
        currentMasterData     = data.masterData;
        renderAll();
        e.target.value = '';
    });
    $('cache-reset-btn').addEventListener('click', () => {
        location.href = location.pathname + '?cachebust=' + Date.now();
    });
}

// 1分ごとに、トークン設定済み・データ読込済みかつ変更がある場合のみ自動保存する
setInterval(() => {
    const token = loadToken();
    if (!token || currentSha === null) return;
    const content = stringifyMarkdown(currentDataBundle());
    if (content === lastSyncedMarkdown) return;
    saveToGithub();
}, 60000);

// ===== タブ切り替え =====
function wireTabNav() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-btn--active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== `tab-${tab}`; });
    if (tab === 'info') loadReadme();
}

// ===== マスタ整合性チェック =====
function renderWarnings() {
    const warnings = computeMasterWarnings(
        currentDataBundle(),
        [INGREDIENT_COLUMNS, TOOL_COLUMNS, DISH_COLUMNS, MEALPLAN_COLUMNS],
        MASTER_DATA_COLUMNS
    );
    const el = $('warning-banner');
    if (warnings.length > 0) {
        el.hidden = false;
        el.innerHTML = warnings.map(w => `・${esc(w)}`).join('<br>');
    } else {
        el.hidden = true;
        el.innerHTML = '';
    }
}

function populateMasterOptions() {
    populateDatalist('ingredient-category-options', getMasterValues('(M)カテゴリ_食材'));
    populateDatalist('tool-category-options', getMasterValues('(M)カテゴリ_調理器具'));
    populateDatalist('dish-category-options', getMasterValues('(M)カテゴリ_料理'));
    populateSelectOptions('dish-status', getStatusOptions('料理'));
    populateSelectOptions('mealplan-status', getStatusOptions('献立'));
}

function renderAll() {
    renderWarnings();
    populateMasterOptions();
    renderIngredientTab();
    renderToolTab();
    renderDishTab();
    renderMealPlanTab();
}

// ===== 共通：一覧テーブル描画 =====
function renderDataTable(containerId, rows, columns, { onRowClick, selectedId, checkboxIds } = {}) {
    const container = $(containerId);
    if (rows.length === 0) { container.innerHTML = '<p>データがありません。</p>'; return; }

    const theadCells = (checkboxIds ? '<th></th>' : '') + columns.map(c => `<th>${esc(c.label)}</th>`).join('');
    const bodyRows = rows.map(row => {
        const checkboxCell = checkboxIds
            ? `<td><input type="checkbox" class="row-checkbox" data-id="${row['ID']}" ${checkboxIds.has(String(row['ID'])) ? 'checked' : ''}></td>`
            : '';
        const cells = columns.map(c => {
            const value = c.render ? c.render(row) : (row[c.key] ?? '');
            return `<td>${c.raw ? value : esc(value)}</td>`;
        }).join('');
        const selectedClass = String(row['ID']) === String(selectedId) ? 'row--selected' : '';
        return `<tr data-id="${row['ID']}" class="${selectedClass}">${checkboxCell}${cells}</tr>`;
    }).join('');

    container.innerHTML = `<table class="data-table"><thead><tr>${theadCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;

    container.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', (e) => {
            if (e.target.classList.contains('row-checkbox')) return;
            onRowClick(tr.dataset.id);
        });
    });

    if (checkboxIds) {
        container.querySelectorAll('.row-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) checkboxIds.add(cb.dataset.id); else checkboxIds.delete(cb.dataset.id);
            });
        });
    }
}

// ========================================================================
// 食材タブ
// ========================================================================
function renderIngredientFilterArea() {
    const categories = getMasterValues('(M)カテゴリ_食材');
    $('ingredient-filter-area').innerHTML = `
        <label>カテゴリ
            <select id="ingredient-filter-category">
                <option value="">すべて</option>
                ${categories.map(c => `<option value="${esc(c)}" ${ingredientFilters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
        </label>
        <label>タグ検索 <input type="text" id="ingredient-filter-tag" value="${esc(ingredientFilters.tag)}"></label>
    `;
    $('ingredient-filter-category').addEventListener('change', e => { ingredientFilters.category = e.target.value; renderIngredientTab(); });
    $('ingredient-filter-tag').addEventListener('input', e => { ingredientFilters.tag = e.target.value; renderIngredientTab(); });
}

function renderIngredientTab() {
    renderIngredientFilterArea();
    let rows = filterRows(currentIngredientData, { category: ingredientFilters.category });
    if (ingredientFilters.tag) rows = rows.filter(r => (r['タグ'] || '').includes(ingredientFilters.tag));
    renderDataTable('ingredient-table-wrapper', rows, [
        { label: '名称', key: 'タイトル' },
        { label: 'カテゴリ', key: 'カテゴリ' },
        { label: 'タグ', key: 'タグ' },
        { label: '代替食材', key: '代替食材' }
    ], { onRowClick: selectIngredient, selectedId: selectedIngredientId });
}

function fillIngredientForm(row) {
    $('ingredient-title').value = row ? row['タイトル'] || '' : '';
    $('ingredient-category').value = row ? row['カテゴリ'] || '' : '';
    $('ingredient-tag').value = row ? row['タグ'] || '' : '';
    $('ingredient-prep-notes').value = row ? row['前処理・切り方ノウハウ'] || '' : '';
    $('ingredient-storage-notes').value = row ? row['保存方法・注意点'] || '' : '';
    $('ingredient-substitute').value = row ? row['代替食材'] || '' : '';
    $('ingredient-remarks').value = row ? row['備考'] || '' : '';
}

function selectIngredient(id) {
    selectedIngredientId = id;
    const row = currentIngredientData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillIngredientForm(row);
    renderIngredientUsedBy(id);
    renderIngredientTab();
}

function renderIngredientUsedBy(id) {
    const dishes = findDishesUsingIngredient(currentDishData, id);
    $('ingredient-usedby').innerHTML = dishes.length
        ? `<strong>この食材を使う料理:</strong><ul>${dishes.map(d => `<li>${esc(d['タイトル'])}</li>`).join('')}</ul>`
        : '';
}

function newIngredient() {
    selectedIngredientId = null;
    fillIngredientForm(null);
    $('ingredient-usedby').innerHTML = '';
    renderIngredientTab();
}

function applyIngredient() {
    const title = $('ingredient-title').value.trim();
    if (!title) { alert('名称を入力してください'); return; }
    const now = formatNowJp();
    const payload = {
        'タイトル': title,
        'カテゴリ': $('ingredient-category').value.trim(),
        'タグ': $('ingredient-tag').value.trim(),
        '前処理・切り方ノウハウ': $('ingredient-prep-notes').value,
        '保存方法・注意点': $('ingredient-storage-notes').value,
        '代替食材': $('ingredient-substitute').value.trim(),
        '備考': $('ingredient-remarks').value,
        '更新日時': now
    };
    if (selectedIngredientId) {
        Object.assign(currentIngredientData.find(r => String(r['ID']) === String(selectedIngredientId)), payload);
    } else {
        const newRow = { 'ID': nextId(currentIngredientData), '作成日時': now, ...payload };
        currentIngredientData.push(newRow);
        selectedIngredientId = newRow['ID'];
    }
    renderAll();
    renderIngredientUsedBy(selectedIngredientId);
}

function deleteIngredient() {
    if (!selectedIngredientId) return;
    if (!confirm('この食材を削除しますか？関連する料理の材料リストからも削除されます。')) return;
    currentDishData.forEach(row => {
        const list = parseListField(row['材料リスト']).filter(item => String(item.食材ID) !== String(selectedIngredientId));
        row['材料リスト'] = stringifyListField(list);
    });
    currentIngredientData = currentIngredientData.filter(r => String(r['ID']) !== String(selectedIngredientId));
    newIngredient();
    renderAll();
}

function wireIngredientForm() {
    $('ingredient-new-btn').addEventListener('click', newIngredient);
    $('ingredient-apply-btn').addEventListener('click', applyIngredient);
    $('ingredient-delete-btn').addEventListener('click', deleteIngredient);
}

// ========================================================================
// 調理器具タブ
// ========================================================================
function renderToolFilterArea() {
    const categories = getMasterValues('(M)カテゴリ_調理器具');
    $('tool-filter-area').innerHTML = `
        <label>カテゴリ
            <select id="tool-filter-category">
                <option value="">すべて</option>
                ${categories.map(c => `<option value="${esc(c)}" ${toolFilters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
        </label>
    `;
    $('tool-filter-category').addEventListener('change', e => { toolFilters.category = e.target.value; renderToolTab(); });
}

function renderToolTab() {
    renderToolFilterArea();
    const rows = filterRows(currentToolData, { category: toolFilters.category });
    renderDataTable('tool-table-wrapper', rows, [
        { label: '名称', key: 'タイトル' },
        { label: 'カテゴリ', key: 'カテゴリ' }
    ], { onRowClick: selectTool, selectedId: selectedToolId });
}

function fillToolForm(row) {
    $('tool-title').value = row ? row['タイトル'] || '' : '';
    $('tool-category').value = row ? row['カテゴリ'] || '' : '';
    $('tool-usage-notes').value = row ? row['使い方・注意点'] || '' : '';
    $('tool-remarks').value = row ? row['備考'] || '' : '';
}

function selectTool(id) {
    selectedToolId = id;
    const row = currentToolData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillToolForm(row);
    renderToolUsedBy(id);
    renderToolTab();
}

function renderToolUsedBy(id) {
    const dishes = findDishesUsingTool(currentDishData, id);
    $('tool-usedby').innerHTML = dishes.length
        ? `<strong>この調理器具を使う料理:</strong><ul>${dishes.map(d => `<li>${esc(d['タイトル'])}</li>`).join('')}</ul>`
        : '';
}

function newTool() {
    selectedToolId = null;
    fillToolForm(null);
    $('tool-usedby').innerHTML = '';
    renderToolTab();
}

function applyTool() {
    const title = $('tool-title').value.trim();
    if (!title) { alert('名称を入力してください'); return; }
    const now = formatNowJp();
    const payload = {
        'タイトル': title,
        'カテゴリ': $('tool-category').value.trim(),
        '使い方・注意点': $('tool-usage-notes').value,
        '備考': $('tool-remarks').value,
        '更新日時': now
    };
    if (selectedToolId) {
        Object.assign(currentToolData.find(r => String(r['ID']) === String(selectedToolId)), payload);
    } else {
        const newRow = { 'ID': nextId(currentToolData), '作成日時': now, ...payload };
        currentToolData.push(newRow);
        selectedToolId = newRow['ID'];
    }
    renderAll();
    renderToolUsedBy(selectedToolId);
}

function deleteTool() {
    if (!selectedToolId) return;
    if (!confirm('この調理器具を削除しますか？関連する料理の使用調理器具からも削除されます。')) return;
    currentDishData.forEach(row => {
        const list = parseListField(row['使用調理器具']).filter(toolId => String(toolId) !== String(selectedToolId));
        row['使用調理器具'] = stringifyListField(list);
    });
    currentToolData = currentToolData.filter(r => String(r['ID']) !== String(selectedToolId));
    newTool();
    renderAll();
}

function wireToolForm() {
    $('tool-new-btn').addEventListener('click', newTool);
    $('tool-apply-btn').addEventListener('click', applyTool);
    $('tool-delete-btn').addEventListener('click', deleteTool);
}

// ========================================================================
// 料理タブ
// ========================================================================
function renderDishFilterArea() {
    const categories   = getMasterValues('(M)カテゴリ_料理');
    const timeTags      = getMasterValues('(M)時間帯タグ');
    const difficulties  = ['易', '中', '難'];
    const statuses      = getStatusOptions('料理');

    $('dish-filter-area').innerHTML = `
        <label>カテゴリ
            <select id="dish-filter-category"><option value="">すべて</option>${categories.map(c => `<option value="${esc(c)}" ${dishFilters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <label>タグ検索 <input type="text" id="dish-filter-tag" value="${esc(dishFilters.tag)}"></label>
        <label>時間帯
            <select id="dish-filter-timetag"><option value="">すべて</option>${timeTags.map(t => `<option value="${esc(t)}" ${dishFilters.timeTag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </label>
        <label>難易度
            <select id="dish-filter-difficulty"><option value="">すべて</option>${difficulties.map(d => `<option value="${esc(d)}" ${dishFilters.difficulty === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        </label>
        <label>ステータス
            <select id="dish-filter-status"><option value="">すべて</option>${statuses.map(s => `<option value="${esc(s)}" ${dishFilters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        </label>
        <label>調理時間（分以内） <input type="number" id="dish-filter-maxtime" min="0" value="${esc(dishFilters.maxCookTime)}"></label>
    `;
    $('dish-filter-category').addEventListener('change', e => { dishFilters.category = e.target.value; renderDishTab(); });
    $('dish-filter-tag').addEventListener('input', e => { dishFilters.tag = e.target.value; renderDishTab(); });
    $('dish-filter-timetag').addEventListener('change', e => { dishFilters.timeTag = e.target.value; renderDishTab(); });
    $('dish-filter-difficulty').addEventListener('change', e => { dishFilters.difficulty = e.target.value; renderDishTab(); });
    $('dish-filter-status').addEventListener('change', e => { dishFilters.status = e.target.value; renderDishTab(); });
    $('dish-filter-maxtime').addEventListener('input', e => { dishFilters.maxCookTime = e.target.value; renderDishTab(); });
}

function renderDishTab() {
    renderDishFilterArea();
    let rows = filterRows(currentDishData, dishFilters);
    if (dishFilters.tag) rows = rows.filter(r => (r['タグ'] || '').includes(dishFilters.tag));
    renderDataTable('dish-table-wrapper', rows, [
        { label: '名称', key: 'タイトル' },
        { label: 'カテゴリ', key: 'カテゴリ' },
        { label: '時間帯', key: '時間帯タグ' },
        { label: '調理時間', render: r => r['調理時間'] ? `${r['調理時間']}分` : '' },
        { label: '難易度', key: '難易度' },
        { label: 'ステータス', render: r => statusBadgeHtml(r['ステータス']), raw: true },
        { label: '作った回数', render: r => parseListField(r['調理ログ']).length }
    ], { onRowClick: selectDish, selectedId: selectedDishId, checkboxIds: dishCheckedIds });
}

function fillDishEditForm(row) {
    $('dish-title').value = row ? row['タイトル'] || '' : '';
    $('dish-category').value = row ? row['カテゴリ'] || '' : '';
    $('dish-tag').value = row ? row['タグ'] || '' : '';
    $('dish-timetag').value = row ? row['時間帯タグ'] || '' : '';
    $('dish-servings').value = row ? row['想定人数'] || '' : '';
    $('dish-cooktime').value = row ? row['調理時間'] || '' : '';
    $('dish-difficulty').value = row ? row['難易度'] || '' : '';
    populateSelectOptions('dish-status', getStatusOptions('料理'));
    $('dish-status').value = row ? row['ステータス'] || '' : '';
    $('dish-prep').value = row ? row['前処理'] || '' : '';
    $('dish-remarks').value = row ? row['備考'] || '' : '';
}

/** 調理中の状態（タイマー・チェック済み手順）を初期化し、パネルを閉じる。料理を選び直す/新規にする際は必ず呼ぶ（裏でタイマーが残るのを防ぐ）。 */
function resetDishCookingState() {
    if (dishCookingTimerInterval) { clearInterval(dishCookingTimerInterval); dishCookingTimerInterval = null; }
    dishCookingChecked = new Set();
    $('dish-cook-panel').hidden = true;
    $('dish-cook-panel').innerHTML = '';
}

function selectDish(id) {
    selectedDishId = id;
    const row = currentDishData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillDishEditForm(row);
    dishIngredientRows = parseListField(row['材料リスト']);
    dishToolIds = new Set(parseListField(row['使用調理器具']).map(String));
    dishStepRows = parseListField(row['調理手順']);
    renderDishIngredientRows();
    renderDishToolCheckboxes();
    renderDishStepRows();
    resetDishCookingState();
    $('dish-edit-expander').open = false; // 選択時は「見る」を既定にし、編集したい時だけ開く
    renderDishViewPanel(row);
    renderDishTab();
}

function renderDishViewPanel(row) {
    if (!row) { $('dish-view-panel').innerHTML = ''; return; }

    const ingredients = parseListField(row['材料リスト']).map(item => {
        const ing = currentIngredientData.find(r => String(r['ID']) === String(item.食材ID));
        const name = ing ? ing['タイトル'] : `不明な食材 #${item.食材ID}`;
        const parts = [item.分量, item.備考].filter(Boolean).join('・');
        return `<li>${esc(name)}${parts ? `　${esc(parts)}` : ''}</li>`;
    }).join('');

    const toolNames = parseListField(row['使用調理器具']).map(id => {
        const tool = currentToolData.find(r => String(r['ID']) === String(id));
        return tool ? tool['タイトル'] : `不明な調理器具 #${id}`;
    });

    const steps = parseListField(row['調理手順']);
    const stepsHtml = steps.length
        ? `<ol class="view-list">${steps.map(s => `<li>${esc(s.内容 || '')}${s.所要時間 ? `（${esc(s.所要時間)}分）` : ''}</li>`).join('')}</ol>`
        : '<p>手順は未登録です。</p>';

    const logs = parseListField(row['調理ログ']).slice().sort((a, b) => (b.日時 || '').localeCompare(a.日時 || ''));
    const mealPlans = findMealPlansUsingDish(currentMealPlanData, row['ID']);

    const metaParts = [
        row['カテゴリ'] && `カテゴリ: ${esc(row['カテゴリ'])}`,
        row['時間帯タグ'] && `時間帯: ${esc(row['時間帯タグ'])}`,
        row['想定人数'] && `${esc(row['想定人数'])}人分`,
        row['調理時間'] && `${esc(row['調理時間'])}分`,
        row['難易度'] && `難易度: ${esc(row['難易度'])}`,
        row['ステータス'] && `ステータス: ${esc(row['ステータス'])}`
    ].filter(Boolean).join('　／　');

    $('dish-view-panel').innerHTML = `
        <div class="view-header">
            <h3>${esc(row['タイトル'])}</h3>
            <div class="view-meta">${metaParts}</div>
        </div>
        <div class="view-section">
            <h4>材料</h4>
            ${ingredients ? `<ul class="view-list">${ingredients}</ul>` : '<p>材料は未登録です。</p>'}
        </div>
        ${toolNames.length ? `<div class="view-section"><h4>使う調理器具</h4><p>${esc(toolNames.join('、'))}</p></div>` : ''}
        ${row['前処理'] ? `<div class="view-section"><h4>前処理</h4><p>${esc(row['前処理'])}</p></div>` : ''}
        <div class="view-section">
            <h4>作り方</h4>
            ${stepsHtml}
        </div>
        <div class="form-buttons">
            <button type="button" id="dish-cook-start-btn" class="btn btn--accent">▶ 調理を開始</button>
        </div>
        <div class="view-section">
            <h4>調理ログ<span class="field-hint">作った回数: ${logs.length}回</span></h4>
            <div class="log-list">
                ${logs.length ? logs.map(log => `
                    <div class="log-entry">
                        <span>${esc(log.日時 || '')}　${'★'.repeat(Number(log.出来栄え) || 0)}　${esc(log.メモ || '')}${log.写真URL ? ` <a href="${esc(log.写真URL)}" target="_blank" rel="noopener">写真</a>` : ''}</span>
                    </div>
                `).join('') : '<p>まだ記録がありません。</p>'}
            </div>
            <div class="log-add-form">
                <input type="text" id="dish-log-date" placeholder="日時（空欄で現在時刻）">
                <select id="dish-log-rating">
                    <option value="">出来栄え</option>
                    <option value="5">★★★★★</option>
                    <option value="4">★★★★</option>
                    <option value="3">★★★</option>
                    <option value="2">★★</option>
                    <option value="1">★</option>
                </select>
                <input type="text" id="dish-log-memo" placeholder="メモ（変えた点・気づき等）">
                <input type="text" id="dish-log-photo" placeholder="写真URL（任意）">
                <button type="button" id="dish-log-record-btn" class="btn btn--sm btn--primary">記録する</button>
            </div>
        </div>
        ${mealPlans.length ? `<div class="backlink-area"><strong>この料理を含む献立:</strong><ul>${mealPlans.map(m => `<li>${esc(m['タイトル'])}</li>`).join('')}</ul></div>` : ''}
    `;

    $('dish-cook-start-btn').addEventListener('click', startDishCooking);
    $('dish-log-record-btn').addEventListener('click', recordDishLog);
}

/** 調理ログを直接データへ即時保存する（「適用」を別途押す必要がない一手で完結する記録操作）。 */
function recordDishLog() {
    const row = currentDishData.find(r => String(r['ID']) === String(selectedDishId));
    if (!row) return;
    const date = $('dish-log-date').value.trim() || formatNowJp();
    const rating = $('dish-log-rating').value;
    const memo = $('dish-log-memo').value.trim();
    const photo = $('dish-log-photo').value.trim();

    const logs = parseListField(row['調理ログ']);
    logs.push({ '日時': date, '出来栄え': rating, 'メモ': memo, '写真URL': photo });
    row['調理ログ'] = stringifyListField(logs);
    row['更新日時'] = formatNowJp();

    renderDishTab();
    renderDishViewPanel(row);
}

function newDish() {
    selectedDishId = null;
    fillDishEditForm(null);
    dishIngredientRows = [];
    dishToolIds = new Set();
    dishStepRows = [];
    renderDishIngredientRows();
    renderDishToolCheckboxes();
    renderDishStepRows();
    resetDishCookingState();
    $('dish-edit-expander').open = true; // 新規登録時は編集エリアを開いたままにする
    renderDishViewPanel(null);
    renderDishTab();
}

function applyDish() {
    const title = $('dish-title').value.trim();
    if (!title) { alert('名称を入力してください'); return; }
    const now = formatNowJp();
    const payload = {
        'タイトル': title,
        'カテゴリ': $('dish-category').value.trim(),
        'タグ': $('dish-tag').value.trim(),
        '時間帯タグ': $('dish-timetag').value.trim(),
        '想定人数': $('dish-servings').value,
        '調理時間': $('dish-cooktime').value,
        '難易度': $('dish-difficulty').value,
        'ステータス': $('dish-status').value,
        '材料リスト': stringifyListField(dishIngredientRows.filter(r => r.食材ID)),
        '使用調理器具': stringifyListField([...dishToolIds]),
        '前処理': $('dish-prep').value,
        '調理手順': stringifyListField(dishStepRows),
        '備考': $('dish-remarks').value,
        '更新日時': now
    };
    let targetId = selectedDishId;
    if (targetId) {
        Object.assign(currentDishData.find(r => String(r['ID']) === String(targetId)), payload);
    } else {
        const newRow = { 'ID': nextId(currentDishData), '作成日時': now, '調理ログ': '[]', ...payload };
        currentDishData.push(newRow);
        targetId = newRow['ID'];
    }
    renderAll();
    selectDish(targetId);
}

function deleteDish() {
    if (!selectedDishId) return;
    if (!confirm('この料理を削除しますか？関連する献立の構成料理リストからも削除されます。')) return;
    currentMealPlanData.forEach(row => {
        const list = parseListField(row['構成料理リスト']).filter(item => String(item.料理ID) !== String(selectedDishId));
        row['構成料理リスト'] = stringifyListField(list);
    });
    currentDishData = currentDishData.filter(r => String(r['ID']) !== String(selectedDishId));
    dishCheckedIds.delete(String(selectedDishId));
    newDish();
    renderAll();
}

// ----- 料理：材料リスト行編集（編集エリア内） -----
function renderDishIngredientRows() {
    const container = $('dish-ingredient-rows');
    container.innerHTML = dishIngredientRows.map((item, idx) => `
        <div class="sub-row" data-idx="${idx}">
            <select class="di-ingredient">
                <option value="">食材を選択</option>
                ${currentIngredientData.map(ing => `<option value="${ing['ID']}" ${String(ing['ID']) === String(item.食材ID) ? 'selected' : ''}>${esc(ing['タイトル'])}</option>`).join('')}
            </select>
            <input type="text" class="di-qty" placeholder="分量" value="${esc(item.分量 || '')}">
            <input type="text" class="di-note" placeholder="備考" value="${esc(item.備考 || '')}">
            <button type="button" class="di-remove">削除</button>
        </div>
    `).join('');
    container.querySelectorAll('.sub-row').forEach(rowEl => {
        const idx = Number(rowEl.dataset.idx);
        rowEl.querySelector('.di-ingredient').addEventListener('change', e => { dishIngredientRows[idx].食材ID = e.target.value; });
        rowEl.querySelector('.di-qty').addEventListener('input', e => { dishIngredientRows[idx].分量 = e.target.value; });
        rowEl.querySelector('.di-note').addEventListener('input', e => { dishIngredientRows[idx].備考 = e.target.value; });
        rowEl.querySelector('.di-remove').addEventListener('click', () => { dishIngredientRows.splice(idx, 1); renderDishIngredientRows(); });
    });
}

// ----- 料理：使用調理器具チェックボックス（編集エリア内） -----
function renderDishToolCheckboxes() {
    const container = $('dish-tool-checkboxes');
    container.innerHTML = currentToolData.length
        ? currentToolData.map(tool => `<label><input type="checkbox" class="dt-check" value="${tool['ID']}" ${dishToolIds.has(String(tool['ID'])) ? 'checked' : ''}> ${esc(tool['タイトル'])}</label>`).join('')
        : '<p>調理器具が登録されていません。</p>';
    container.querySelectorAll('.dt-check').forEach(cb => {
        cb.addEventListener('change', () => { if (cb.checked) dishToolIds.add(cb.value); else dishToolIds.delete(cb.value); });
    });
}

// ----- 料理：調理手順行編集（編集エリア内） -----
function renderDishStepRows() {
    const container = $('dish-step-rows');
    container.innerHTML = dishStepRows.map((step, idx) => `
        <div class="sub-row" data-idx="${idx}">
            <span>${idx + 1}.</span>
            <input type="text" class="ds-content" placeholder="内容" value="${esc(step.内容 || '')}">
            <input type="number" class="ds-time" placeholder="分" min="0" value="${esc(step.所要時間 || '')}">
            <button type="button" class="ds-remove">削除</button>
        </div>
    `).join('');
    container.querySelectorAll('.sub-row').forEach(rowEl => {
        const idx = Number(rowEl.dataset.idx);
        rowEl.querySelector('.ds-content').addEventListener('input', e => { dishStepRows[idx].内容 = e.target.value; });
        rowEl.querySelector('.ds-time').addEventListener('input', e => { dishStepRows[idx].所要時間 = e.target.value; updateDishTotalTime(); });
        rowEl.querySelector('.ds-remove').addEventListener('click', () => { dishStepRows.splice(idx, 1); renderDishStepRows(); updateDishTotalTime(); });
    });
    updateDishTotalTime();
}

function updateDishTotalTime() {
    $('dish-total-time').textContent = computeDishTotalTime(dishStepRows);
}

// ----- 料理：調理進行モード -----
function startDishCooking() {
    if (dishStepRows.length === 0) { alert('調理手順が登録されていません。'); return; }
    dishCookingChecked = new Set();
    dishCookingStartTimestamp = Date.now();
    renderDishCookPanel();
    if (dishCookingTimerInterval) clearInterval(dishCookingTimerInterval);
    dishCookingTimerInterval = setInterval(updateDishCookTimer, 1000);
}

function renderDishCookPanel() {
    const panel = $('dish-cook-panel');
    panel.hidden = false;
    panel.innerHTML = `
        <p>経過時間: <span id="dish-cook-elapsed">0:00</span>／合計目安: ${computeDishTotalTime(dishStepRows)}分</p>
        <ol>${dishStepRows.map((s, idx) => `<li><label><input type="checkbox" class="cook-step-check" data-idx="${idx}" ${dishCookingChecked.has(idx) ? 'checked' : ''}> ${esc(s.内容 || '')}（${esc(s.所要時間 || 0)}分）</label></li>`).join('')}</ol>
        <button type="button" id="dish-cook-finish-btn" class="btn btn--sm btn--muted">終了する</button>
    `;
    panel.querySelectorAll('.cook-step-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = Number(cb.dataset.idx);
            if (cb.checked) dishCookingChecked.add(idx); else dishCookingChecked.delete(idx);
        });
    });
    $('dish-cook-finish-btn').addEventListener('click', () => {
        resetDishCookingState();
        $('dish-log-date').value = formatNowJp();
        $('dish-log-memo').focus();
    });
}

function updateDishCookTimer() {
    const elapsedSec = Math.floor((Date.now() - dishCookingStartTimestamp) / 1000);
    const m = Math.floor(elapsedSec / 60), s = elapsedSec % 60;
    const el = $('dish-cook-elapsed');
    if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

// ----- 料理：買い物リスト（一覧のチェック行から） -----
function renderShoppingListPanel(panelId, dishIds) {
    const list = computeShoppingList(currentDishData, currentIngredientData, dishIds);
    const panel = $(panelId);
    panel.hidden = false;
    panel.innerHTML = list.length ? `
        <table>
            <thead><tr><th></th><th>食材</th><th>用途（料理: 分量）</th></tr></thead>
            <tbody>
                ${list.map(item => `<tr><td><input type="checkbox"></td><td>${esc(item.食材名)}</td><td>${item.uses.map(u => `${esc(u.料理名)}: ${esc(u.分量)}`).join(' ／ ')}</td></tr>`).join('')}
            </tbody>
        </table>
    ` : '<p>材料が登録されていません。</p>';
}

/**
 * 気になったレシピをその場で一言だけ残す軽い入口。カテゴリ等は一切問わず、
 * 内容から自動でタイトルを作り、全文を備考に、ステータスを「下書き」にして即保存する
 * （brainのINBOXと同じ「テキストエリア＋ボタン1つ」の発想）。
 */
function quickCaptureDish() {
    const text = $('dish-quickmemo-input').value.trim();
    if (!text) return;
    const now = formatNowJp();
    const title = text.length > 20 ? `${text.slice(0, 20)}…` : text;
    const statusOptions = getStatusOptions('料理');
    const status = statusOptions.includes('下書き') ? '下書き' : (statusOptions[0] || '');

    currentDishData.push({
        'ID': nextId(currentDishData),
        'タイトル': title,
        'ステータス': status,
        '備考': text,
        '調理ログ': '[]',
        '作成日時': now,
        '更新日時': now
    });

    $('dish-quickmemo-input').value = '';
    renderAll();
}

function wireDishForm() {
    $('dish-quickmemo-btn').addEventListener('click', quickCaptureDish);
    $('dish-draft-filter-btn').addEventListener('click', () => { dishFilters.status = '下書き'; renderDishTab(); });
    $('dish-new-btn').addEventListener('click', newDish);
    $('dish-apply-btn').addEventListener('click', applyDish);
    $('dish-delete-btn').addEventListener('click', deleteDish);
    $('dish-ingredient-add-btn').addEventListener('click', () => { dishIngredientRows.push({ 食材ID: '', 分量: '', 備考: '' }); renderDishIngredientRows(); });
    $('dish-step-add-btn').addEventListener('click', () => { dishStepRows.push({ 内容: '', 所要時間: '' }); renderDishStepRows(); });
    $('dish-shoppinglist-btn').addEventListener('click', () => {
        if (dishCheckedIds.size === 0) { alert('料理一覧でチェックした行から買い物リストを作ります。'); return; }
        renderShoppingListPanel('dish-shoppinglist-panel', [...dishCheckedIds]);
    });
}

// ========================================================================
// 献立タブ
// ========================================================================
function renderMealPlanFilterArea() {
    const timeTags = getMasterValues('(M)時間帯タグ');
    const statuses = getStatusOptions('献立');
    $('mealplan-filter-area').innerHTML = `
        <label>時間帯
            <select id="mealplan-filter-timetag"><option value="">すべて</option>${timeTags.map(t => `<option value="${esc(t)}" ${mealPlanFilters.timeTag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </label>
        <label>ステータス
            <select id="mealplan-filter-status"><option value="">すべて</option>${statuses.map(s => `<option value="${esc(s)}" ${mealPlanFilters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        </label>
    `;
    $('mealplan-filter-timetag').addEventListener('change', e => { mealPlanFilters.timeTag = e.target.value; renderMealPlanTab(); });
    $('mealplan-filter-status').addEventListener('change', e => { mealPlanFilters.status = e.target.value; renderMealPlanTab(); });
}

function renderMealPlanTab() {
    renderMealPlanFilterArea();
    const rows = filterRows(currentMealPlanData, mealPlanFilters);
    renderDataTable('mealplan-table-wrapper', rows, [
        { label: '名称', key: 'タイトル' },
        { label: '時間帯', key: '時間帯タグ' },
        { label: '想定人数', key: '想定人数' },
        { label: 'ステータス', render: r => statusBadgeHtml(r['ステータス']), raw: true },
        { label: '構成料理数', render: r => parseListField(r['構成料理リスト']).length }
    ], { onRowClick: selectMealPlan, selectedId: selectedMealPlanId });
}

function fillMealPlanEditForm(row) {
    $('mealplan-title').value = row ? row['タイトル'] || '' : '';
    $('mealplan-timetag').value = row ? row['時間帯タグ'] || '' : '';
    $('mealplan-servings').value = row ? row['想定人数'] || '' : '';
    populateSelectOptions('mealplan-status', getStatusOptions('献立'));
    $('mealplan-status').value = row ? row['ステータス'] || '' : '';
    $('mealplan-remarks').value = row ? row['備考'] || '' : '';
}

function resetMealPlanCookingState() {
    if (mealPlanCookingTimerInterval) { clearInterval(mealPlanCookingTimerInterval); mealPlanCookingTimerInterval = null; }
    mealPlanCookingChecked = new Set();
    $('mealplan-cook-panel').hidden = true;
    $('mealplan-cook-panel').innerHTML = '';
    $('mealplan-shoppinglist-panel').hidden = true;
    $('mealplan-shoppinglist-panel').innerHTML = '';
}

function selectMealPlan(id) {
    selectedMealPlanId = id;
    const row = currentMealPlanData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillMealPlanEditForm(row);
    mealPlanDishRows = parseListField(row['構成料理リスト']);
    renderMealPlanDishRows();
    resetMealPlanCookingState();
    $('mealplan-edit-expander').open = false;
    renderMealPlanViewPanel(row);
    renderMealPlanTab();
}

function renderMealPlanViewPanel(row) {
    if (!row) { $('mealplan-view-panel').innerHTML = ''; return; }

    const dishes = parseListField(row['構成料理リスト']).map(item => {
        const dish = currentDishData.find(r => String(r['ID']) === String(item.料理ID));
        const name = dish ? dish['タイトル'] : `不明な料理 #${item.料理ID}`;
        return `<li>${esc(name)}${item.役割 ? `　（${esc(item.役割)}）` : ''}</li>`;
    }).join('');

    const metaParts = [
        row['時間帯タグ'] && `時間帯: ${esc(row['時間帯タグ'])}`,
        row['想定人数'] && `${esc(row['想定人数'])}人分`,
        row['ステータス'] && `ステータス: ${esc(row['ステータス'])}`
    ].filter(Boolean).join('　／　');

    $('mealplan-view-panel').innerHTML = `
        <div class="view-header">
            <h3>${esc(row['タイトル'])}</h3>
            <div class="view-meta">${metaParts}</div>
        </div>
        <div class="view-section">
            <h4>構成する料理</h4>
            ${dishes ? `<ul class="view-list">${dishes}</ul>` : '<p>料理は未登録です。</p>'}
        </div>
        <div class="form-buttons">
            <button type="button" id="mealplan-cook-start-btn" class="btn btn--accent">▶ この献立を作る</button>
            <button type="button" id="mealplan-shoppinglist-btn" class="btn btn--muted">買い物リストを作る</button>
        </div>
    `;

    $('mealplan-cook-start-btn').addEventListener('click', startMealPlanCooking);
    $('mealplan-shoppinglist-btn').addEventListener('click', showMealPlanShoppingList);
}

function newMealPlan() {
    selectedMealPlanId = null;
    fillMealPlanEditForm(null);
    mealPlanDishRows = [];
    renderMealPlanDishRows();
    resetMealPlanCookingState();
    $('mealplan-edit-expander').open = true;
    renderMealPlanViewPanel(null);
    renderMealPlanTab();
}

function applyMealPlan() {
    const title = $('mealplan-title').value.trim();
    if (!title) { alert('名称を入力してください'); return; }
    const now = formatNowJp();
    const payload = {
        'タイトル': title,
        '時間帯タグ': $('mealplan-timetag').value.trim(),
        '想定人数': $('mealplan-servings').value,
        'ステータス': $('mealplan-status').value,
        '構成料理リスト': stringifyListField(mealPlanDishRows.filter(r => r.料理ID)),
        '備考': $('mealplan-remarks').value,
        '更新日時': now
    };
    let targetId = selectedMealPlanId;
    if (targetId) {
        Object.assign(currentMealPlanData.find(r => String(r['ID']) === String(targetId)), payload);
    } else {
        const newRow = { 'ID': nextId(currentMealPlanData), '作成日時': now, ...payload };
        currentMealPlanData.push(newRow);
        targetId = newRow['ID'];
    }
    renderAll();
    selectMealPlan(targetId);
}

function deleteMealPlan() {
    if (!selectedMealPlanId) return;
    if (!confirm('この献立を削除しますか？')) return;
    currentMealPlanData = currentMealPlanData.filter(r => String(r['ID']) !== String(selectedMealPlanId));
    newMealPlan();
    renderAll();
}

// ----- 献立：構成する料理の行編集（編集エリア内） -----
function renderMealPlanDishRows() {
    const container = $('mealplan-dish-rows');
    container.innerHTML = mealPlanDishRows.map((item, idx) => `
        <div class="sub-row" data-idx="${idx}">
            <select class="md-dish">
                <option value="">料理を選択</option>
                ${currentDishData.map(d => `<option value="${d['ID']}" ${String(d['ID']) === String(item.料理ID) ? 'selected' : ''}>${esc(d['タイトル'])}</option>`).join('')}
            </select>
            <input type="text" class="md-role" list="mealplan-role-options" placeholder="役割（主菜等）" value="${esc(item.役割 || '')}">
            <button type="button" class="md-remove">削除</button>
        </div>
    `).join('');
    container.querySelectorAll('.sub-row').forEach(rowEl => {
        const idx = Number(rowEl.dataset.idx);
        rowEl.querySelector('.md-dish').addEventListener('change', e => { mealPlanDishRows[idx].料理ID = e.target.value; });
        rowEl.querySelector('.md-role').addEventListener('input', e => { mealPlanDishRows[idx].役割 = e.target.value; });
        rowEl.querySelector('.md-remove').addEventListener('click', () => { mealPlanDishRows.splice(idx, 1); renderMealPlanDishRows(); });
    });
}

// ----- 献立：調理進行モード（構成する各料理のチェックリストをまとめて表示） -----
function startMealPlanCooking() {
    const row = currentMealPlanData.find(r => String(r['ID']) === String(selectedMealPlanId));
    if (!row) { alert('先に保存済みの献立を選択してください。'); return; }
    const timeline = computeMealPlanTimeline(currentDishData, row);
    mealPlanCookingChecked = new Set();
    mealPlanCookingStartTimestamp = Date.now();
    renderMealPlanCookPanel(timeline);
    if (mealPlanCookingTimerInterval) clearInterval(mealPlanCookingTimerInterval);
    mealPlanCookingTimerInterval = setInterval(updateMealPlanCookTimer, 1000);
}

function renderMealPlanCookPanel(timeline) {
    const panel = $('mealplan-cook-panel');
    panel.hidden = false;
    panel.innerHTML = `
        <p>経過時間: <span id="mealplan-cook-elapsed">0:00</span></p>
        ${timeline.map(e => `
            <div class="cook-dish-block">
                <h4><span>${esc(e.料理名)}${e.役割 ? `（${esc(e.役割)}）` : ''}</span><span class="field-hint">${e.開始オフセット分 > 0 ? `開始から${e.開始オフセット分}分後に着手` : '最初に着手'}／合計${e.合計時間}分</span></h4>
                <ol>${e.手順.length ? e.手順.map((s, idx) => `<li><label><input type="checkbox" class="mp-cook-step-check" data-key="${e.料理ID}:${idx}" ${mealPlanCookingChecked.has(`${e.料理ID}:${idx}`) ? 'checked' : ''}> ${esc(s.内容 || '')}（${esc(s.所要時間 || 0)}分）</label></li>`).join('') : '<li>（手順未登録）</li>'}</ol>
            </div>
        `).join('')}
        <button type="button" id="mealplan-cook-finish-btn" class="btn btn--sm btn--muted">終了する</button>
    `;
    panel.querySelectorAll('.mp-cook-step-check').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) mealPlanCookingChecked.add(cb.dataset.key); else mealPlanCookingChecked.delete(cb.dataset.key);
        });
    });
    $('mealplan-cook-finish-btn').addEventListener('click', resetMealPlanCookingState);
}

function updateMealPlanCookTimer() {
    const elapsedSec = Math.floor((Date.now() - mealPlanCookingStartTimestamp) / 1000);
    const m = Math.floor(elapsedSec / 60), s = elapsedSec % 60;
    const el = $('mealplan-cook-elapsed');
    if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function showMealPlanShoppingList() {
    const row = currentMealPlanData.find(r => String(r['ID']) === String(selectedMealPlanId));
    if (!row) { alert('先に保存済みの献立を選択してください。'); return; }
    const dishIds = parseListField(row['構成料理リスト']).map(item => item.料理ID);
    renderShoppingListPanel('mealplan-shoppinglist-panel', dishIds);
}

function wireMealPlanForm() {
    $('mealplan-new-btn').addEventListener('click', newMealPlan);
    $('mealplan-apply-btn').addEventListener('click', applyMealPlan);
    $('mealplan-delete-btn').addEventListener('click', deleteMealPlan);
    $('mealplan-dish-add-btn').addEventListener('click', () => { mealPlanDishRows.push({ 料理ID: '', 役割: '' }); renderMealPlanDishRows(); });
}

// ========================================================================
// Infoタブ
// ========================================================================
async function loadReadme() {
    const token = $('token-input').value.trim();
    const el = $('info-content');
    if (!token) { el.innerHTML = '<p>トークンを入力してください。</p>'; return; }
    try {
        const { content } = await fetchFile(token, OWNER, CODE_REPO, README_PATH);
        el.innerHTML = window.marked.parse(content);
    } catch (err) {
        el.innerHTML = `<p>読込に失敗しました。(${err.message})</p>`;
    }
}

function wireInfoTab() {
    $('info-reload-btn').addEventListener('click', loadReadme);
}

// ===== 初期化 =====
window.addEventListener('DOMContentLoaded', () => {
    wireTopBar();
    wireTabNav();
    wireIngredientForm();
    wireToolForm();
    wireDishForm();
    wireMealPlanForm();
    wireInfoTab();

    const saved = loadToken();
    if (saved) {
        setTokenInputs(saved);
        loadFromGitproject(saved, true);
    }
    renderAll();
});
