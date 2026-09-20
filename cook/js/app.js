// ES modules（import文）はURLごとにブラウザキャッシュされるため、更新後もブラウザが古いモジュールを
// 使い続けてしまうことがある（brain/stock/kanziと同じ問題）。全importに「?v=N」を付け、バージョンを
// 上げるたびに全モジュールが新しいURLとして再取得されるようにする。JS/CSSを編集した際は、index.htmlの
// css/style.css・js/app.js参照、および下記の全import文の「?v=N」を同じ新しい値に一括で書き換えること。
// 現在のバージョン: 3
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=3';
import { fetchFile, saveFile } from './modules/github.js?v=3';
import { parseMarkdown, stringifyMarkdown, MAIN_DATA_COLUMNS, MASTER_DATA_COLUMNS } from './modules/dataModel.js?v=3';
import { exportToExcel, importFromExcel } from './modules/excel.js?v=3';
import { computeMasterWarnings } from './modules/master.js?v=3';
import {
    KUBUN, isIngredientRow, isToolRow, isDishRow, isMealPlanRow,
    parseListField, stringifyListField,
    findDishesUsingIngredient, findDishesUsingTool, findMealPlansUsingDish,
    computeDishTotalTime, computeShoppingList, computeMealPlanTimeline,
    filterRows, formatNowJp
} from './modules/cook.js?v=3';

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
let currentSha         = null;
let currentMainData    = [];
let currentMasterData  = [];
let lastSyncedMarkdown = null;

let selectedIngredientId = null;
let selectedToolId       = null;
let selectedDishId       = null;
let selectedMealPlanId   = null;

let ingredientFilters = { category: '', tag: '' };
let toolFilters       = { category: '' };
let dishFilters       = { category: '', tag: '', timeTag: '', difficulty: '', status: '', maxCookTime: '' };
let mealPlanFilters   = { timeTag: '' };

let dishIngredientRows = []; // [{食材ID, 分量, 備考}]
let dishToolIds        = new Set();
let dishStepRows       = []; // [{内容, 所要時間}]
let dishLogRows        = []; // [{日時, 出来栄え, メモ, 写真URL}]

let mealPlanDishRows = []; // [{料理ID, 役割}]

const dishCheckedIds = new Set(); // 買い物リスト作成用の複数選択

let cookingTimerInterval = null;
let cookingStartTimestamp = null;
let cookingCheckedSteps = new Set();

// ===== ユーティリティ =====
function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nextId() {
    const maxId = currentMainData.reduce((max, r) => Math.max(max, Number(r['ID']) || 0), 0);
    return maxId + 1;
}

function getMasterValues(column) {
    return [...new Set(currentMasterData.map(r => r[column]).filter(Boolean))];
}

function getStatusOptions(kubun) {
    return currentMasterData.filter(r => r['(M)ステータス_親'] === kubun).map(r => r['(M)ステータス_子']).filter(Boolean);
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

function applyContent(content, sha) {
    const { mainData, masterData } = parseMarkdown(content);
    currentMainData = mainData;
    currentMasterData = masterData;
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
    const content = stringifyMarkdown(currentMainData, currentMasterData);
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
        exportToExcel(currentMainData, currentMasterData);
    });
    $('import-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        persistCurrentToken();
        const { mainData, masterData } = await importFromExcel(file);
        currentMainData = mainData;
        currentMasterData = masterData;
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
    const content = stringifyMarkdown(currentMainData, currentMasterData);
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
    const warnings = computeMasterWarnings(currentMainData, currentMasterData, MAIN_DATA_COLUMNS, MASTER_DATA_COLUMNS);
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
    populateSelectOptions('dish-status', getStatusOptions(KUBUN.DISH));
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
        const cells = columns.map(c => `<td>${esc(c.render ? c.render(row) : (row[c.key] ?? ''))}</td>`).join('');
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
    let rows = filterRows(currentMainData, KUBUN.INGREDIENT, { category: ingredientFilters.category });
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
    const row = currentMainData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillIngredientForm(row);
    renderIngredientUsedBy(id);
    renderIngredientTab();
}

function renderIngredientUsedBy(id) {
    const dishes = findDishesUsingIngredient(currentMainData, id);
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
        Object.assign(currentMainData.find(r => String(r['ID']) === String(selectedIngredientId)), payload);
    } else {
        const newRow = { 'ID': nextId(), 'データ区分': KUBUN.INGREDIENT, '作成日時': now, ...payload };
        currentMainData.push(newRow);
        selectedIngredientId = newRow['ID'];
    }
    renderAll();
    renderIngredientUsedBy(selectedIngredientId);
}

function deleteIngredient() {
    if (!selectedIngredientId) return;
    if (!confirm('この食材を削除しますか？関連する料理の材料リストからも削除されます。')) return;
    currentMainData.forEach(row => {
        if (isDishRow(row)) {
            const list = parseListField(row['材料リスト']).filter(item => String(item.食材ID) !== String(selectedIngredientId));
            row['材料リスト'] = stringifyListField(list);
        }
    });
    currentMainData = currentMainData.filter(r => String(r['ID']) !== String(selectedIngredientId));
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
    const rows = filterRows(currentMainData, KUBUN.TOOL, { category: toolFilters.category });
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
    const row = currentMainData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillToolForm(row);
    renderToolUsedBy(id);
    renderToolTab();
}

function renderToolUsedBy(id) {
    const dishes = findDishesUsingTool(currentMainData, id);
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
        Object.assign(currentMainData.find(r => String(r['ID']) === String(selectedToolId)), payload);
    } else {
        const newRow = { 'ID': nextId(), 'データ区分': KUBUN.TOOL, '作成日時': now, ...payload };
        currentMainData.push(newRow);
        selectedToolId = newRow['ID'];
    }
    renderAll();
    renderToolUsedBy(selectedToolId);
}

function deleteTool() {
    if (!selectedToolId) return;
    if (!confirm('この調理器具を削除しますか？関連する料理の使用調理器具からも削除されます。')) return;
    currentMainData.forEach(row => {
        if (isDishRow(row)) {
            const list = parseListField(row['使用調理器具']).filter(toolId => String(toolId) !== String(selectedToolId));
            row['使用調理器具'] = stringifyListField(list);
        }
    });
    currentMainData = currentMainData.filter(r => String(r['ID']) !== String(selectedToolId));
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
    const statuses      = getStatusOptions(KUBUN.DISH);

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
    let rows = filterRows(currentMainData, KUBUN.DISH, dishFilters);
    if (dishFilters.tag) rows = rows.filter(r => (r['タグ'] || '').includes(dishFilters.tag));
    renderDataTable('dish-table-wrapper', rows, [
        { label: '名称', key: 'タイトル' },
        { label: 'カテゴリ', key: 'カテゴリ' },
        { label: '時間帯', key: '時間帯タグ' },
        { label: '調理時間', render: r => r['調理時間'] ? `${r['調理時間']}分` : '' },
        { label: '難易度', key: '難易度' },
        { label: 'ステータス', key: 'ステータス' },
        { label: '作った回数', render: r => parseListField(r['調理ログ']).length }
    ], { onRowClick: selectDish, selectedId: selectedDishId, checkboxIds: dishCheckedIds });
}

function fillDishBasicForm(row) {
    $('dish-title').value = row ? row['タイトル'] || '' : '';
    $('dish-category').value = row ? row['カテゴリ'] || '' : '';
    $('dish-tag').value = row ? row['タグ'] || '' : '';
    $('dish-timetag').value = row ? row['時間帯タグ'] || '' : '';
    $('dish-servings').value = row ? row['想定人数'] || '' : '';
    $('dish-cooktime').value = row ? row['調理時間'] || '' : '';
    $('dish-difficulty').value = row ? row['難易度'] || '' : '';
    populateSelectOptions('dish-status', getStatusOptions(KUBUN.DISH));
    $('dish-status').value = row ? row['ステータス'] || '' : '';
    $('dish-prep').value = row ? row['前処理'] || '' : '';
    $('dish-remarks').value = row ? row['備考'] || '' : '';
}

function selectDish(id) {
    selectedDishId = id;
    const row = currentMainData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillDishBasicForm(row);
    dishIngredientRows = parseListField(row['材料リスト']);
    dishToolIds = new Set(parseListField(row['使用調理器具']).map(String));
    dishStepRows = parseListField(row['調理手順']);
    dishLogRows = parseListField(row['調理ログ']);
    renderDishIngredientRows();
    renderDishToolCheckboxes();
    renderDishStepRows();
    renderDishLogList();
    renderDishUsedBy(id);
    $('dish-cook-panel').hidden = true;
    renderDishTab();
}

function renderDishUsedBy(id) {
    const mealPlans = findMealPlansUsingDish(currentMainData, id);
    $('dish-usedby').innerHTML = mealPlans.length
        ? `<strong>この料理を含む献立:</strong><ul>${mealPlans.map(m => `<li>${esc(m['タイトル'])}</li>`).join('')}</ul>`
        : '';
}

function newDish() {
    selectedDishId = null;
    fillDishBasicForm(null);
    dishIngredientRows = [];
    dishToolIds = new Set();
    dishStepRows = [];
    dishLogRows = [];
    renderDishIngredientRows();
    renderDishToolCheckboxes();
    renderDishStepRows();
    renderDishLogList();
    $('dish-usedby').innerHTML = '';
    $('dish-cook-panel').hidden = true;
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
        '調理ログ': stringifyListField(dishLogRows),
        '備考': $('dish-remarks').value,
        '更新日時': now
    };
    if (selectedDishId) {
        Object.assign(currentMainData.find(r => String(r['ID']) === String(selectedDishId)), payload);
    } else {
        const newRow = { 'ID': nextId(), 'データ区分': KUBUN.DISH, '作成日時': now, ...payload };
        currentMainData.push(newRow);
        selectedDishId = newRow['ID'];
    }
    renderAll();
    selectDish(selectedDishId);
}

function deleteDish() {
    if (!selectedDishId) return;
    if (!confirm('この料理を削除しますか？関連する献立の構成料理リストからも削除されます。')) return;
    currentMainData.forEach(row => {
        if (isMealPlanRow(row)) {
            const list = parseListField(row['構成料理リスト']).filter(item => String(item.料理ID) !== String(selectedDishId));
            row['構成料理リスト'] = stringifyListField(list);
        }
    });
    currentMainData = currentMainData.filter(r => String(r['ID']) !== String(selectedDishId));
    newDish();
    renderAll();
}

// ----- 料理：材料リスト行編集 -----
function renderDishIngredientRows() {
    const ingredients = currentMainData.filter(isIngredientRow);
    const container = $('dish-ingredient-rows');
    container.innerHTML = dishIngredientRows.map((item, idx) => `
        <div class="sub-row" data-idx="${idx}">
            <select class="di-ingredient">
                <option value="">食材を選択</option>
                ${ingredients.map(ing => `<option value="${ing['ID']}" ${String(ing['ID']) === String(item.食材ID) ? 'selected' : ''}>${esc(ing['タイトル'])}</option>`).join('')}
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

// ----- 料理：使用調理器具チェックボックス -----
function renderDishToolCheckboxes() {
    const tools = currentMainData.filter(isToolRow);
    const container = $('dish-tool-checkboxes');
    container.innerHTML = tools.length
        ? tools.map(tool => `<label><input type="checkbox" class="dt-check" value="${tool['ID']}" ${dishToolIds.has(String(tool['ID'])) ? 'checked' : ''}> ${esc(tool['タイトル'])}</label>`).join('')
        : '<p>調理器具が登録されていません。</p>';
    container.querySelectorAll('.dt-check').forEach(cb => {
        cb.addEventListener('change', () => { if (cb.checked) dishToolIds.add(cb.value); else dishToolIds.delete(cb.value); });
    });
}

// ----- 料理：調理手順行編集 -----
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

// ----- 料理：調理ログ -----
function updateDishLogCount() {
    $('dish-log-count').textContent = dishLogRows.length;
}

function renderDishLogList() {
    const container = $('dish-log-list');
    const sorted = dishLogRows.map((log, idx) => ({ log, idx })).sort((a, b) => (b.log.日時 || '').localeCompare(a.log.日時 || ''));
    container.innerHTML = sorted.length ? sorted.map(({ log, idx }) => `
        <div class="log-entry">
            <span>${esc(log.日時 || '')}　${'★'.repeat(Number(log.出来栄え) || 0)}　${esc(log.メモ || '')}${log.写真URL ? ` <a href="${esc(log.写真URL)}" target="_blank" rel="noopener">写真</a>` : ''}</span>
            <button type="button" class="log-remove" data-idx="${idx}">削除</button>
        </div>
    `).join('') : '<p>まだ記録がありません。</p>';
    container.querySelectorAll('.log-remove').forEach(btn => {
        btn.addEventListener('click', () => { dishLogRows.splice(Number(btn.dataset.idx), 1); renderDishLogList(); updateDishLogCount(); });
    });
    updateDishLogCount();
}

function addDishLog() {
    const date = $('dish-log-date').value.trim() || formatNowJp();
    const rating = $('dish-log-rating').value;
    const memo = $('dish-log-memo').value.trim();
    const photo = $('dish-log-photo').value.trim();
    dishLogRows.push({ '日時': date, '出来栄え': rating, 'メモ': memo, '写真URL': photo });
    ['dish-log-date', 'dish-log-rating', 'dish-log-memo', 'dish-log-photo'].forEach(id => { $(id).value = ''; });
    renderDishLogList();
}

// ----- 料理：調理進行モード -----
function startDishCooking() {
    if (dishStepRows.length === 0) { alert('調理手順が登録されていません。'); return; }
    cookingCheckedSteps = new Set();
    cookingStartTimestamp = Date.now();
    renderDishCookPanel();
    if (cookingTimerInterval) clearInterval(cookingTimerInterval);
    cookingTimerInterval = setInterval(updateDishCookTimer, 1000);
}

function renderDishCookPanel() {
    const panel = $('dish-cook-panel');
    panel.hidden = false;
    panel.innerHTML = `
        <p>経過時間: <span id="dish-cook-elapsed">0:00</span>／合計目安: ${computeDishTotalTime(dishStepRows)}分</p>
        <ol>${dishStepRows.map((s, idx) => `<li><label><input type="checkbox" class="cook-step-check" data-idx="${idx}" ${cookingCheckedSteps.has(idx) ? 'checked' : ''}> ${esc(s.内容 || '')}（${esc(s.所要時間 || 0)}分）</label></li>`).join('')}</ol>
        <button type="button" id="dish-cook-finish-btn">完了して調理ログに記録する</button>
    `;
    panel.querySelectorAll('.cook-step-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = Number(cb.dataset.idx);
            if (cb.checked) cookingCheckedSteps.add(idx); else cookingCheckedSteps.delete(idx);
        });
    });
    $('dish-cook-finish-btn').addEventListener('click', () => {
        clearInterval(cookingTimerInterval);
        panel.hidden = true;
        $('dish-log-date').value = formatNowJp();
        alert('調理お疲れ様でした。下の「調理ログ」欄で出来栄え・メモを入力し、「ログを追加」→「適用」で記録してください。');
    });
}

function updateDishCookTimer() {
    const elapsedSec = Math.floor((Date.now() - cookingStartTimestamp) / 1000);
    const m = Math.floor(elapsedSec / 60), s = elapsedSec % 60;
    const el = $('dish-cook-elapsed');
    if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

// ----- 料理：買い物リスト（一覧のチェック行から） -----
function renderShoppingListPanel(panelId, dishIds) {
    const list = computeShoppingList(currentMainData, dishIds);
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

function wireDishForm() {
    $('dish-new-btn').addEventListener('click', newDish);
    $('dish-apply-btn').addEventListener('click', applyDish);
    $('dish-delete-btn').addEventListener('click', deleteDish);
    $('dish-ingredient-add-btn').addEventListener('click', () => { dishIngredientRows.push({ 食材ID: '', 分量: '', 備考: '' }); renderDishIngredientRows(); });
    $('dish-step-add-btn').addEventListener('click', () => { dishStepRows.push({ 内容: '', 所要時間: '' }); renderDishStepRows(); });
    $('dish-log-add-btn').addEventListener('click', addDishLog);
    $('dish-cook-start-btn').addEventListener('click', startDishCooking);
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
    $('mealplan-filter-area').innerHTML = `
        <label>時間帯
            <select id="mealplan-filter-timetag"><option value="">すべて</option>${timeTags.map(t => `<option value="${esc(t)}" ${mealPlanFilters.timeTag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </label>
    `;
    $('mealplan-filter-timetag').addEventListener('change', e => { mealPlanFilters.timeTag = e.target.value; renderMealPlanTab(); });
}

function renderMealPlanTab() {
    renderMealPlanFilterArea();
    const rows = filterRows(currentMainData, KUBUN.MEALPLAN, mealPlanFilters);
    renderDataTable('mealplan-table-wrapper', rows, [
        { label: '名称', key: 'タイトル' },
        { label: '時間帯', key: '時間帯タグ' },
        { label: '想定人数', key: '想定人数' },
        { label: '構成料理数', render: r => parseListField(r['構成料理リスト']).length }
    ], { onRowClick: selectMealPlan, selectedId: selectedMealPlanId });
}

function fillMealPlanBasicForm(row) {
    $('mealplan-title').value = row ? row['タイトル'] || '' : '';
    $('mealplan-timetag').value = row ? row['時間帯タグ'] || '' : '';
    $('mealplan-servings').value = row ? row['想定人数'] || '' : '';
    $('mealplan-remarks').value = row ? row['備考'] || '' : '';
}

function selectMealPlan(id) {
    selectedMealPlanId = id;
    const row = currentMainData.find(r => String(r['ID']) === String(id));
    if (!row) return;
    fillMealPlanBasicForm(row);
    mealPlanDishRows = parseListField(row['構成料理リスト']);
    renderMealPlanDishRows();
    $('mealplan-cook-panel').hidden = true;
    $('mealplan-shoppinglist-panel').hidden = true;
    renderMealPlanTab();
}

function newMealPlan() {
    selectedMealPlanId = null;
    fillMealPlanBasicForm(null);
    mealPlanDishRows = [];
    renderMealPlanDishRows();
    $('mealplan-cook-panel').hidden = true;
    $('mealplan-shoppinglist-panel').hidden = true;
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
        '構成料理リスト': stringifyListField(mealPlanDishRows.filter(r => r.料理ID)),
        '備考': $('mealplan-remarks').value,
        '更新日時': now
    };
    if (selectedMealPlanId) {
        Object.assign(currentMainData.find(r => String(r['ID']) === String(selectedMealPlanId)), payload);
    } else {
        const newRow = { 'ID': nextId(), 'データ区分': KUBUN.MEALPLAN, '作成日時': now, ...payload };
        currentMainData.push(newRow);
        selectedMealPlanId = newRow['ID'];
    }
    renderAll();
    selectMealPlan(selectedMealPlanId);
}

function deleteMealPlan() {
    if (!selectedMealPlanId) return;
    if (!confirm('この献立を削除しますか？')) return;
    currentMainData = currentMainData.filter(r => String(r['ID']) !== String(selectedMealPlanId));
    newMealPlan();
    renderAll();
}

function renderMealPlanDishRows() {
    const dishes = currentMainData.filter(isDishRow);
    const container = $('mealplan-dish-rows');
    container.innerHTML = mealPlanDishRows.map((item, idx) => `
        <div class="sub-row" data-idx="${idx}">
            <select class="md-dish">
                <option value="">料理を選択</option>
                ${dishes.map(d => `<option value="${d['ID']}" ${String(d['ID']) === String(item.料理ID) ? 'selected' : ''}>${esc(d['タイトル'])}</option>`).join('')}
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

function startMealPlanCooking() {
    const row = currentMainData.find(r => String(r['ID']) === String(selectedMealPlanId));
    if (!row) { alert('先に保存済みの献立を選択してください。'); return; }
    const timeline = computeMealPlanTimeline(currentMainData, row);
    const panel = $('mealplan-cook-panel');
    panel.hidden = false;
    panel.innerHTML = `
        <table>
            <thead><tr><th>料理</th><th>役割</th><th>着手タイミング</th><th>所要時間</th><th>手順</th></tr></thead>
            <tbody>
                ${timeline.map(e => `<tr><td>${esc(e.料理名)}</td><td>${esc(e.役割)}</td><td>${e.開始オフセット分 > 0 ? `全体開始から${e.開始オフセット分}分後に着手` : '最初に着手'}</td><td>${e.合計時間}分</td><td>${e.手順.map(s => esc(s.内容)).join(' → ') || '（手順未登録）'}</td></tr>`).join('')}
            </tbody>
        </table>
    `;
}

function showMealPlanShoppingList() {
    const row = currentMainData.find(r => String(r['ID']) === String(selectedMealPlanId));
    if (!row) { alert('先に保存済みの献立を選択してください。'); return; }
    const dishIds = parseListField(row['構成料理リスト']).map(item => item.料理ID);
    renderShoppingListPanel('mealplan-shoppinglist-panel', dishIds);
}

function wireMealPlanForm() {
    $('mealplan-new-btn').addEventListener('click', newMealPlan);
    $('mealplan-apply-btn').addEventListener('click', applyMealPlan);
    $('mealplan-delete-btn').addEventListener('click', deleteMealPlan);
    $('mealplan-dish-add-btn').addEventListener('click', () => { mealPlanDishRows.push({ 料理ID: '', 役割: '' }); renderMealPlanDishRows(); });
    $('mealplan-cook-start-btn').addEventListener('click', startMealPlanCooking);
    $('mealplan-shoppinglist-btn').addEventListener('click', showMealPlanShoppingList);
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
