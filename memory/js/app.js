// 2026-09-13：ES modules（import文）はURLごとにブラウザキャッシュされるため、更新後もブラウザが古い
// モジュールを使い続けてしまうことがある。全importに「?v=N」を付け、バージョンを上げるたびに
// 全モジュールが新しいURLとして再取得されるようにする（brain/stock/kanziアプリと同じ方式）。
// JS/CSSを編集した際は、index.htmlの<link>・<script>タグも含めて同じ新しい値に一括で書き換えること。
// 現在のバージョン: 1
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=1';
import { fetchFile, saveFile } from './modules/github.js?v=1';
import { parseMarkdown, stringifyMarkdown } from './modules/dataModel.js?v=1';
import { createInitialSrsState, applyResult, formatDateTime } from './modules/srs.js?v=1';
import { getDueItems, buildQuizQueue } from './modules/quiz.js?v=1';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const PATH  = 'memory/data.md';

// ===== グローバル状態 =====
let currentSha         = null;
let currentMainData    = [];
let currentMasterData  = [];
let currentView        = 'quiz';   // 'quiz' | 'add' | 'list'
let currentKubun       = '語彙';   // '語彙' | '数学記号' | '長文'
let quizQueue          = [];
let quizIndex          = 0;
let quizRevealed       = false;

// ===== 起動時 =====
window.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        document.getElementById('token-input').value = saved;
        loadFromGithub(saved, true);
    } else {
        // トークン未設定でもキャッシュがあれば表示だけはできるようにする
        const cache = loadCache();
        if (cache) {
            applyContent(cache.content, cache.sha);
        }
    }
    render();
});

document.getElementById('load-btn').addEventListener('click', () => {
    const token = document.getElementById('token-input').value.trim();
    if (!token) { alert('トークンを入力してください'); return; }
    loadFromGithub(token);
});

document.querySelectorAll('.main-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        document.querySelectorAll('.main-nav-btn').forEach(b => b.classList.toggle('main-nav-btn--active', b === btn));
        render();
    });
});

document.querySelectorAll('.kubun-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentKubun = btn.dataset.kubun;
        document.querySelectorAll('.kubun-tab-btn').forEach(b => b.classList.toggle('kubun-tab-btn--active', b === btn));
        document.getElementById('add-kubun').value = currentKubun;
        rebuildQuizQueue();
        render();
    });
});

document.getElementById('add-submit-btn').addEventListener('click', onAddSubmit);

// ===== データ読み込み・保存 =====

function setStatus(text) {
    document.getElementById('status-line').textContent = text;
}

async function loadFromGithub(token, silent = false) {
    saveToken(token);
    setStatus('読み込み中...');
    try {
        const { content, sha } = await fetchFile(token, OWNER, REPO, PATH);
        applyContent(content, sha);
        saveCache(content, sha);
        setStatus('読み込み完了');
        render();
    } catch (error) {
        console.error(error);
        const cache = loadCache();
        if (cache) {
            applyContent(cache.content, cache.sha);
            setStatus('オフライン（キャッシュを表示中）');
            render();
        } else {
            setStatus('読み込み失敗');
            if (!silent) alert(`読み込みに失敗しました: ${error.message}`);
        }
    }
}

function applyContent(content, sha) {
    const { mainData, masterData } = parseMarkdown(content);
    currentMainData   = mainData;
    currentMasterData = masterData;
    currentSha        = sha;
    rebuildQuizQueue();
}

async function saveToGithub() {
    const token = document.getElementById('token-input').value.trim() || loadToken();
    const newMarkdown = stringifyMarkdown(currentMainData, currentMasterData);

    // オフラインファースト：まずローカルキャッシュへ即時保存し、その後GitHubへPUTする
    saveCache(newMarkdown, currentSha);

    if (!token) { setStatus('未保存（トークン未設定、ローカルのみ保存）'); return; }

    setStatus('保存中...');
    try {
        const { newSha } = await saveFile(token, OWNER, REPO, PATH, newMarkdown, currentSha);
        currentSha = newSha;
        saveCache(newMarkdown, newSha);
        setStatus('保存完了');
    } catch (error) {
        console.error(error);
        if (error.status === 409) {
            setStatus('保存失敗（他端末との競合。読み込みボタンで最新化してください）');
        } else {
            setStatus('オフライン（ローカルには保存済み、後で読み込みボタンから再送信してください）');
        }
    }
}

// ===== クイズ =====

function rebuildQuizQueue() {
    const due = getDueItems(currentMainData, currentKubun);
    quizQueue = buildQuizQueue(due);
    quizIndex = 0;
    quizRevealed = false;
}

function renderQuizView() {
    const remainingEl = document.getElementById('quiz-remaining');
    const bodyEl = document.getElementById('quiz-body');

    if (quizIndex >= quizQueue.length) {
        remainingEl.textContent = '';
        bodyEl.innerHTML = '<div class="quiz-empty">今は復習の必要な項目はありません。<br>「追加」タブからカードを増やしてみてください。</div>';
        return;
    }

    const item = quizQueue[quizIndex];
    remainingEl.textContent = `残り ${quizQueue.length - quizIndex} 件`;

    if (!quizRevealed) {
        bodyEl.innerHTML = `
            <div class="quiz-card">${escapeHtml(item['表面'] || '')}</div>
            <div class="quiz-actions">
                <button type="button" class="quiz-btn quiz-btn-reveal" id="quiz-reveal-btn">答えを見る</button>
            </div>
        `;
        document.getElementById('quiz-reveal-btn').addEventListener('click', () => {
            quizRevealed = true;
            renderQuizView();
        });
    } else {
        bodyEl.innerHTML = `
            <div class="quiz-card">${escapeHtml(item['表面'] || '')}</div>
            <div class="quiz-card quiz-card--back">${escapeHtml(item['裏面'] || '')}</div>
            ${item['出典'] ? `<div class="quiz-source">出典: ${escapeHtml(item['出典'])}</div>` : ''}
            <div class="quiz-actions">
                <button type="button" class="quiz-btn quiz-btn-forgot" id="quiz-forgot-btn">間違えた</button>
                <button type="button" class="quiz-btn quiz-btn-know" id="quiz-know-btn">覚えた</button>
            </div>
        `;
        document.getElementById('quiz-know-btn').addEventListener('click', () => onAnswer(item, true));
        document.getElementById('quiz-forgot-btn').addEventListener('click', () => onAnswer(item, false));
    }
}

function onAnswer(item, isCorrect) {
    const idx = currentMainData.findIndex(r => String(r['ID']) === String(item['ID']));
    if (idx !== -1) {
        currentMainData[idx] = applyResult(currentMainData[idx], isCorrect);
    }
    quizIndex += 1;
    quizRevealed = false;
    renderQuizView();
    saveToGithub();
}

// ===== 追加 =====

function onAddSubmit() {
    const kubun  = document.getElementById('add-kubun').value;
    const front  = document.getElementById('add-front').value.trim();
    const back   = document.getElementById('add-back').value.trim();
    const tag    = document.getElementById('add-tag').value.trim();
    const source = document.getElementById('add-source').value.trim();

    if (!front || !back) { alert('表面・裏面は必須です'); return; }

    const maxId = currentMainData.reduce((max, r) => Math.max(max, Number(r['ID']) || 0), 0);
    const now = formatDateTime();

    const newItem = {
        ID: String(maxId + 1),
        種別: kubun,
        表面: front,
        裏面: back,
        タグ: tag,
        出典: source,
        作成日時: now,
        更新日時: now,
        ...createInitialSrsState()
    };

    currentMainData.push(newItem);

    document.getElementById('add-front').value = '';
    document.getElementById('add-back').value = '';
    document.getElementById('add-tag').value = '';
    document.getElementById('add-source').value = '';

    if (kubun === currentKubun) rebuildQuizQueue();
    render();
    saveToGithub();
}

// ===== 一覧 =====

function renderListView() {
    const tbody = document.getElementById('list-tbody');
    const rows = currentMainData.filter(r => r['種別'] === currentKubun);

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${escapeHtml(r['表面'] || '')}</td>
            <td>${escapeHtml(r['裏面'] || '')}</td>
            <td>${r['箱番号'] ?? ''}</td>
            <td>${r['正解回数'] ?? 0}</td>
            <td>${r['不正解回数'] ?? 0}</td>
            <td>${escapeHtml(r['次回復習日'] || '')}</td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="status-line">まだカードがありません</td></tr>';
}

// ===== 共通描画 =====

function render() {
    document.getElementById('view-quiz').style.display = currentView === 'quiz' ? '' : 'none';
    document.getElementById('view-add').style.display  = currentView === 'add'  ? '' : 'none';
    document.getElementById('view-list').style.display = currentView === 'list' ? '' : 'none';

    if (currentView === 'quiz') renderQuizView();
    if (currentView === 'list') renderListView();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
