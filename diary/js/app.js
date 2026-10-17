// 現在のバージョン: 1
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import { loadToken, saveToken, loadCache, saveCache, loadLastAuthor, saveLastAuthor } from './modules/storage.js?v=1';
import { fetchFile, saveFile, listFileNames } from './modules/github.js?v=1';
import {
    parseFrontMatter, stringifyDiaryFile, getSortedEntries, getDayPages, countChars, computeStats
} from './modules/dataModel.js?v=1';

// 画面右上の「vバッジ」表示（import.meta.urlの?v=Nから取得。brain/bookと同じ方式）
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const DIR   = 'diary';
const yearPath = (year) => `${DIR}/${year}.md`;

let yearList = [];          // ['2026', '2025', ...]（新しい順）
let yearDetailCache = {};   // 年 -> { diaryData, tail, sha }

let selectedYear   = null;
let selectedPages  = [];    // 選択中の年の「日ページ」[{ date, entries }]
let selectedPageIdx = 0;
let activeTab = 'content';  // 'summary' | 'content'
let currentView = 'read';   // 'read' | 'write'

const sidebar  = document.getElementById('sidebar');
const content  = document.getElementById('content');
const layoutEl = document.getElementById('read-view');
const writeEl  = document.getElementById('write-view');

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
function fmtNum(n) { return n.toLocaleString('ja-JP'); }

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function dateLabel(dateStr) { // 'YYYY/MM/DD' -> 'YYYY/MM/DD(曜)'
    const [y, m, d] = dateStr.split('/').map(Number);
    if (!y) return dateStr;
    return `${dateStr}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}
function todayStr() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// ===== トークン・ネットワークステータス =====

function getTokenValue() { return document.querySelector('.js-token-input')?.value.trim() || ''; }
function setTokenInput(value) { const el = document.querySelector('.js-token-input'); if (el) el.value = value; }
function setNetworkStatus(html) { const el = document.getElementById('network-status-top'); if (el) el.innerHTML = html; }

// ===== 年一覧（diary/配下の<西暦>.mdを検出）読込 =====

function parseYears(names) {
    return names.map(n => (n.match(/^(\d{4})\.md$/) || [])[1]).filter(Boolean).sort().reverse();
}

async function loadYears(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }

    try {
        const names = await listFileNames(token, OWNER, REPO, DIR);
        yearList = parseYears(names);
        saveCache('years', JSON.stringify(names), '');
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        yearDetailCache = {}; // 読込のたびに最新を取り直す
        renderShelf();
    } catch (error) {
        console.error(error);
        const cached = loadCache('years');
        if (cached) {
            yearList = parseYears(JSON.parse(cached.content));
            setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
            if (!silent) alert('通信できませんでした。デバイス内に一時保存されている前回のデータを表示します。');
            renderShelf();
        } else {
            setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
            if (!silent) alert(`GitHubからの読み込みに失敗しました（${error.message}）。トークンが「${OWNER}/${REPO}」への読み書き権限を持っているか確認してください。`);
        }
    }
}

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => loadYears(getTokenValue()));
});

// ===== 年ごとのファイル読込（クリック時に遅延読込・キャッシュ） =====

function toDetail(text, sha) {
    const { data, tail } = parseFrontMatter(text);
    return { diaryData: data.diaryData || [], tail, sha };
}

async function loadYearDetail(year) {
    if (yearDetailCache[year]) return yearDetailCache[year];
    const token = getTokenValue();
    try {
        const { content: text, sha } = await fetchFile(token, OWNER, REPO, yearPath(year));
        const detail = toDetail(text, sha);
        yearDetailCache[year] = detail;
        saveCache(year, text, sha);
        return detail;
    } catch (error) {
        console.error(error);
        const cached = loadCache(year);
        if (cached) {
            const detail = toDetail(cached.content, cached.sha);
            yearDetailCache[year] = detail;
            return detail;
        }
        alert(`日記の読み込みに失敗しました（${error.message}）。`);
        return { diaryData: [], tail: '', sha: null };
    }
}

// ===== 保存（閲覧側に未保存の変更は無いため、トークンのローカル保存のみ） =====

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getTokenValue();
        if (!token) { alert('トークンを入力してください'); return; }
        saveToken(token);
        btn.textContent = '保存しました';
        setTimeout(() => { btn.textContent = '保存'; }, 1200);
    });
});

// ===== キャッシュ更新（brain/bookと同一実装） =====

document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
        } catch (error) {
            console.error(error);
        }
        location.href = location.pathname + '?nocache=' + Date.now();
    });
});

// ===== 閲覧／入力の切り替え =====

function setView(view) {
    currentView = view;
    document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    layoutEl.hidden = view !== 'read';
    writeEl.hidden  = view !== 'write';
    if (view === 'write') refreshWriteForm();
}
document.querySelectorAll('.view-tab-btn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ===== 一覧（年のカード） =====

function renderShelf() {
    selectedYear = null;
    layoutEl.classList.add('shelf-mode');
    sidebar.innerHTML = '<p class="placeholder">年を選ぶと、ここに月の一覧が表示されます。</p>';

    if (yearList.length === 0) {
        content.innerHTML = '<p class="placeholder">まだ日記がありません。「入力」タブから投稿してください。</p>';
        return;
    }

    content.innerHTML = `
        <h2 class="shelf-title">日記</h2>
        <div class="shelf-grid" id="shelf-grid"></div>
    `;
    const grid = document.getElementById('shelf-grid');

    for (const year of yearList) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'shelf-card';
        card.dataset.year = year;
        card.innerHTML = `
            <div class="shelf-card-cover"><span class="shelf-card-cover-placeholder">${year.slice(2)}</span></div>
            <div class="shelf-card-info">
                <div class="shelf-card-title">${year}年</div>
                <div class="shelf-card-meta"></div>
                <span class="shelf-card-progress-text">未読込（開くと表示されます）</span>
            </div>
        `;
        card.addEventListener('click', () => openYear(year, null));
        grid.appendChild(card);
        fillShelfCardStats(card, year); // 通信なし・デバイス内キャッシュのみ
    }
}

function fillShelfCardStats(card, year) {
    const cached = loadCache(year);
    if (!cached) return;
    try {
        const { diaryData } = toDetail(cached.content, cached.sha);
        const s = computeStats(diaryData).total;
        card.querySelector('.shelf-card-meta').textContent = `${s.days}日 ・ ${s.entries}件`;
        card.querySelector('.shelf-card-progress-text').textContent = `${fmtNum(s.chars)}文字`;
    } catch (error) {
        console.error(error);
    }
}

// ===== 選択中の年のサイドバー（一覧へ戻るボタン＋月の目次） =====

function renderYearSidebarShell(year) {
    sidebar.innerHTML = `
        <button type="button" class="shelf-back-btn" id="shelf-back-btn">← 年一覧</button>
        <div class="book-block">
            <div class="book-title">${year}年</div>
            <div class="book-meta" id="year-meta"></div>
            <details class="chapter-toc" open>
                <summary class="chapter-toc-summary">月<span class="chapter-toc-progress" id="chapter-toc-progress"></span></summary>
                <div class="chapter-holder" id="month-holder"></div>
            </details>
        </div>
    `;
    document.getElementById('shelf-back-btn').addEventListener('click', renderShelf);
}

function renderMonthList(year) {
    const detail = yearDetailCache[year];
    if (!detail) return;
    const stats = computeStats(detail.diaryData);
    document.getElementById('chapter-toc-progress').textContent = `　${stats.total.days}日 / ${stats.total.entries}件`;

    const holder = document.getElementById('month-holder');
    holder.innerHTML = '';
    const months = Object.keys(stats.months).sort();
    if (months.length === 0) {
        holder.innerHTML = '<div class="book-meta">（日記がありません）</div>';
        return;
    }
    const currentMonth = selectedPages[selectedPageIdx]?.date.slice(5, 7);
    for (const mm of months) {
        const btn = document.createElement('button');
        btn.className = 'chapter-item' + (activeTab === 'content' && mm === currentMonth ? ' active' : '');
        btn.dataset.month = mm;
        btn.innerHTML = `${Number(mm)}月<span class="month-item-count">${stats.months[mm].days}日 ・ ${fmtNum(stats.months[mm].chars)}字</span>`;
        btn.addEventListener('click', () => {
            const idx = selectedPages.findIndex(p => p.date.slice(5, 7) === mm);
            activeTab = 'content';
            selectedPageIdx = Math.max(idx, 0);
            renderContentArea();
        });
        holder.appendChild(btn);
    }
}

async function openYear(year, pageIdx = null) {
    selectedYear = year;
    layoutEl.classList.remove('shelf-mode');
    content.innerHTML = '<p class="loading">読み込み中...</p>';
    renderYearSidebarShell(year);

    const detail = await loadYearDetail(year);
    selectedPages = getDayPages(detail.diaryData);
    // 初回は最新の日記から開く
    selectedPageIdx = pageIdx === null ? Math.max(selectedPages.length - 1, 0) : pageIdx;
    renderContentArea();
}

// ===== コンテンツ領域（上部タブ：サマリー／日記） =====

const TABS = [
    { key: 'summary', label: 'サマリー', render: renderSummaryView },
    { key: 'content', label: '日記',     render: renderPageView },
];

function renderContentArea() {
    if (!selectedYear) return;

    content.innerHTML = `
        <div class="content-tabs">
            ${TABS.map(t => `<button type="button" class="content-tab-btn ${activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
        </div>
        <div class="content-tab-body" id="content-tab-body"></div>
    `;
    content.querySelectorAll('.content-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => { activeTab = btn.dataset.tab; renderContentArea(); });
    });

    (TABS.find(t => t.key === activeTab) || TABS[1]).render();
    renderMonthList(selectedYear);
}

// ===== サマリー：年・月別・投稿者別の集計 =====

function renderSummaryView() {
    const holder = document.getElementById('content-tab-body');
    const detail = yearDetailCache[selectedYear];
    const stats = computeStats(detail.diaryData);

    let html = `<h2 class="summary-title">${selectedYear}年</h2>`;
    html += `<p class="book-meta">${stats.total.days}日 ・ ${stats.total.entries}件 ・ ${fmtNum(stats.total.chars)}文字（改行・空白除く）</p>`;

    const months = Object.keys(stats.months).sort();
    if (months.length > 0) {
        html += `
            <h3 class="summary-subtitle">月別</h3>
            <table class="progress-table">
                <thead><tr><th>月</th><th>日数</th><th>件数</th><th>文字数</th></tr></thead>
                <tbody>${months.map(mm => `
                    <tr><td>${Number(mm)}月</td><td class="progress-cell">${stats.months[mm].days}</td>
                    <td class="progress-cell">${stats.months[mm].entries}</td>
                    <td class="progress-cell">${fmtNum(stats.months[mm].chars)}</td></tr>`).join('')}
                </tbody>
            </table>
            <h3 class="summary-subtitle">投稿者別</h3>
            <table class="progress-table">
                <thead><tr><th>投稿者</th><th>件数</th><th>文字数</th></tr></thead>
                <tbody>${Object.entries(stats.authors).map(([name, a]) => `
                    <tr><td>${escapeHtml(name)}</td><td class="progress-cell">${a.entries}</td>
                    <td class="progress-cell">${fmtNum(a.chars)}</td></tr>`).join('')}
                </tbody>
            </table>`;
    }
    holder.innerHTML = html;
}

// ===== 日記：1日＝1ページの前へ／次へ送り =====

function renderPageView() {
    const holder = document.getElementById('content-tab-body');
    if (selectedPages.length === 0) {
        holder.innerHTML = '<p class="placeholder">まだ日記がありません。</p>';
        return;
    }

    const page = selectedPages[selectedPageIdx];
    const posLabel = `${selectedPageIdx + 1} / ${selectedPages.length}`;
    const navHtml = (suffix) => `
        <div class="page-nav ${suffix ? 'page-nav--bottom' : ''}">
            <button type="button" class="page-nav-btn" id="page-prev-btn${suffix}" ${selectedPageIdx === 0 ? 'disabled' : ''}>← 前の日</button>
            ${suffix ? '' : `<span class="page-indicator">${dateLabel(page.date)}（${posLabel}）</span>`}
            <button type="button" class="page-nav-btn" id="page-next-btn${suffix}" ${selectedPageIdx === selectedPages.length - 1 ? 'disabled' : ''}>次の日 →</button>
        </div>`;

    holder.innerHTML = navHtml('') + page.entries.map(e => {
        const c = countChars(e['本文']);
        const time = (e['投稿日時'] || '').slice(11, 16);
        return `
            <div class="diary-entry">
                <div class="diary-entry-head">
                    <span class="diary-author">${escapeHtml(e['投稿者'] || '(不明)')}</span>
                    ${time ? `<span>${escapeHtml(time)}</span>` : ''}
                    <span>${fmtNum(c.plain)}文字</span>
                </div>
                <div class="diary-body">${escapeHtml(e['本文'])}</div>
            </div>`;
    }).join('') + navHtml('-bottom');

    const go = (delta) => {
        const next = selectedPageIdx + delta;
        if (next < 0 || next >= selectedPages.length) return;
        selectedPageIdx = next;
        renderPageView();
        renderMonthList(selectedYear);
        holder.scrollTo(0, 0);
    };
    ['', '-bottom'].forEach(s => {
        document.getElementById(`page-prev-btn${s}`)?.addEventListener('click', () => go(-1));
        document.getElementById(`page-next-btn${s}`)?.addEventListener('click', () => go(1));
    });
}

// キーボードの左右矢印でも日送りできる（閲覧・日記タブ表示中のみ）
document.addEventListener('keydown', (e) => {
    if (currentView !== 'read' || activeTab !== 'content' || selectedPages.length === 0) return;
    if (['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowRight') document.getElementById('page-next-btn')?.click();
    if (e.key === 'ArrowLeft')  document.getElementById('page-prev-btn')?.click();
});

// ===== 入力（文字数カウント・投稿者確認・投稿） =====

const dateInput   = document.getElementById('diary-date');
const authorInput = document.getElementById('diary-author');
const bodyInput   = document.getElementById('diary-body');
const countEl     = document.getElementById('char-count');
const confirmEl   = document.getElementById('write-confirm');
const statusEl    = document.getElementById('write-status');
const postBtn     = document.getElementById('post-btn');

function updateCharCount() {
    const c = countChars(bodyInput.value);
    countEl.innerHTML = `${fmtNum(c.all)} 文字 <small>（改行・空白を除く ${fmtNum(c.plain)} 文字）</small>`;
}

function updateConfirm() {
    const name = authorInput.value.trim();
    confirmEl.innerHTML = name ? `投稿者：<b>${escapeHtml(name)}</b>` : '投稿者が未入力です';
}

function setWriteStatus(text, cls = '') {
    statusEl.textContent = text;
    statusEl.className = 'write-status ' + cls;
}

function refreshWriteForm() {
    if (!dateInput.value) dateInput.value = todayStr();
    if (!authorInput.value) authorInput.value = loadLastAuthor();
    // 投稿者の候補：読込済みの年データに含まれる名前
    const names = new Set();
    Object.values(yearDetailCache).forEach(d => d.diaryData.forEach(e => e['投稿者'] && names.add(e['投稿者'])));
    document.getElementById('diary-author-list').innerHTML = [...names].map(n => `<option value="${escapeAttr(n)}">`).join('');
    updateCharCount();
    updateConfirm();
}

bodyInput.addEventListener('input', updateCharCount);
authorInput.addEventListener('input', updateConfirm);

// 投稿：対象年のファイルを最新で取得→追記→保存（競合409は取り直して1回だけ再試行）
async function appendEntry(token, entry) {
    const year = entry['日付'].slice(0, 4);
    for (let attempt = 0; attempt < 2; attempt++) {
        let diaryData = [], tail = '\n', sha;
        try {
            const { content: text, sha: s } = await fetchFile(token, OWNER, REPO, yearPath(year));
            ({ diaryData, tail } = toDetail(text, s));
            sha = s;
        } catch (error) {
            if (error.status !== 404) throw error; // 404＝その年の初投稿（新規作成）
        }
        diaryData.push(entry);
        const newText = stringifyDiaryFile(diaryData, tail);
        try {
            const { newSha } = await saveFile(token, OWNER, REPO, yearPath(year), newText, sha);
            saveCache(year, newText, newSha);
            yearDetailCache[year] = { diaryData, tail, sha: newSha };
            if (!yearList.includes(year)) yearList = [...yearList, year].sort().reverse();
            return;
        } catch (error) {
            if (error.status === 409 && attempt === 0) continue;
            throw error;
        }
    }
}

postBtn.addEventListener('click', async () => {
    const token  = getTokenValue();
    const author = authorInput.value.trim();
    const body   = bodyInput.value.replace(/\s+$/, '');
    if (!token)  return setWriteStatus('トークンを入力してください', 'err');
    if (!dateInput.value) return setWriteStatus('日付を入力してください', 'err');
    if (!author) return setWriteStatus('投稿者を入力してください', 'err');
    if (!body.trim()) return setWriteStatus('本文を入力してください', 'err');

    const date = dateInput.value.replace(/-/g, '/');
    const now = new Date();
    const stamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ` +
                  `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const entry = { 'ID': `${date.replace(/\//g, '')}-${now.getTime()}`, '日付': date, '投稿者': author, '本文': body, '投稿日時': stamp };

    postBtn.disabled = true;
    setWriteStatus('投稿中…');
    try {
        saveToken(token);
        await appendEntry(token, entry);
        saveLastAuthor(author);
        bodyInput.value = '';
        updateCharCount();
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        setWriteStatus(`${dateLabel(date)} の日記を投稿しました（投稿者：${author}）`, 'ok');
    } catch (error) {
        console.error(error);
        setWriteStatus(`投稿に失敗しました（${error.message}）。本文は残してあります。通信状況を確認して再度「投稿」を押してください。`, 'err');
    } finally {
        postBtn.disabled = false;
    }
});

// 未投稿の本文がある状態でページを離れる前に知らせる
window.addEventListener('beforeunload', (e) => {
    if (bodyInput.value.trim()) { e.preventDefault(); e.returnValue = ''; }
});

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    dateInput.value = todayStr();
    authorInput.value = loadLastAuthor();
    updateCharCount();
    updateConfirm();
    const saved = loadToken();
    if (saved) {
        setTokenInput(saved);
        loadYears(saved, true);
    }
});
