// 現在のバージョン: 1
// JS/CSSを変更した際は、index.htmlの参照とこのファイル自身の?v=Nを同じ値に揃えること（book/brain等と同じ方式）。
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=1';
import { fetchFile } from './modules/github.js?v=1';
import { parseFrontMatter, getSortedChapters, getSortedPages } from './modules/dataModel.js?v=1';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const DREAMS_PATH = 'dream/dreams.md';
const dreamFilePath = (dreamId) => `dream/${dreamId}.md`;

let currentDreamData = [];   // dreams.md由来（一覧のみ）
let dreamDetailCache = {};   // マップ集ID -> { chapterData, pageData }

let selectedDream   = null;
let selectedPages   = [];
let selectedPageIdx = 0;

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');
const layoutEl = document.querySelector('.layout');

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== トークン・ネットワークステータス =====

function getTokenValue() {
    return document.querySelector('.js-token-input')?.value.trim() || '';
}

function setTokenInput(value) {
    const el = document.querySelector('.js-token-input');
    if (el) el.value = value;
}

function setNetworkStatus(html) {
    const el = document.getElementById('network-status-top');
    if (el) el.innerHTML = html;
}

// ===== dreams.md（マップ集の一覧）読込 =====

async function loadDreams(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }

    try {
        const { content: text } = await fetchFile(token, OWNER, REPO, DREAMS_PATH);
        currentDreamData = parseFrontMatter(text).data.dreamData || [];
        saveCache('dreams', text, '');
        dreamDetailCache = {}; // 読込のたびに最新を取り直す
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        renderShelf();
    } catch (error) {
        console.error(error);
        const cached = loadCache('dreams');
        if (cached) {
            currentDreamData = parseFrontMatter(cached.content).data.dreamData || [];
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
    btn.addEventListener('click', () => loadDreams(getTokenValue()));
});

// ===== マップ集ごとのファイル読込（クリック時に遅延読込・キャッシュ） =====

async function loadDreamDetail(dreamId) {
    if (dreamDetailCache[dreamId]) return dreamDetailCache[dreamId];

    const token = getTokenValue();
    try {
        const { content: text, sha } = await fetchFile(token, OWNER, REPO, dreamFilePath(dreamId));
        const { data } = parseFrontMatter(text);
        const detail = { chapterData: data.chapterData || [], pageData: data.pageData || [] };
        dreamDetailCache[dreamId] = detail;
        saveCache(dreamId, text, sha);
        return detail;
    } catch (error) {
        console.error(error);
        const cached = loadCache(dreamId);
        if (cached) {
            const { data } = parseFrontMatter(cached.content);
            const detail = { chapterData: data.chapterData || [], pageData: data.pageData || [] };
            dreamDetailCache[dreamId] = detail;
            return detail;
        }
        alert(`本文の読み込みに失敗しました（${error.message}）。`);
        return { chapterData: [], pageData: [] };
    }
}

// ===== 保存（dreamは読み取り専用のため、トークンのローカル保存のみ） =====

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getTokenValue();
        if (!token) { alert('トークンを入力してください'); return; }
        saveToken(token);
        btn.textContent = '保存しました';
        setTimeout(() => { btn.textContent = '保存'; }, 1200);
    });
});

// ===== キャッシュ更新（bookと同一実装：アプリコードの強制リフレッシュ） =====

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

// ===== 一覧（マップ集をカードで表示する入口画面） =====

function renderShelf() {
    selectedDream = null;
    layoutEl?.classList.add('shelf-mode');
    sidebar.innerHTML = '<p class="placeholder">マップ集を選ぶと、ここに目次が表示されます。</p>';

    if (currentDreamData.length === 0) {
        content.innerHTML = '<p class="placeholder">まだマップ集が登録されていません。</p>';
        return;
    }

    content.innerHTML = `
        <h2 class="shelf-title">dream</h2>
        <div class="shelf-grid" id="shelf-grid"></div>
    `;
    const grid = document.getElementById('shelf-grid');

    for (const dream of currentDreamData) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'shelf-card';
        card.innerHTML = `
            <div class="shelf-card-cover">
                <span class="shelf-card-cover-placeholder">${escapeHtml((dream['名前'] || dream['ID'])[0] || '?')}</span>
            </div>
            <div class="shelf-card-info">
                <div class="shelf-card-title">${escapeHtml(dream['名前'] || dream['ID'])}</div>
                <div class="shelf-card-meta">${escapeHtml([dream['概要'], dream['ステータス']].filter(Boolean).join(' ・ '))}</div>
            </div>
        `;
        card.addEventListener('click', () => openDream(dream, 0));
        grid.appendChild(card);
    }
}

// ===== 選択中のマップ集（一覧へ戻るボタン＋目次） =====

function renderDreamSidebarShell(dream) {
    sidebar.innerHTML = `
        <button type="button" class="shelf-back-btn" id="shelf-back-btn">← 一覧</button>
        <div class="book-block">
            <div class="book-title">${escapeHtml(dream['名前'] || dream['ID'])}</div>
            <div class="book-meta">${escapeHtml([dream['概要'], dream['ステータス']].filter(Boolean).join(' ・ '))}</div>
            <details class="chapter-toc" open>
                <summary class="chapter-toc-summary">目次</summary>
                <div class="chapter-holder" id="chapter-holder"></div>
            </details>
        </div>
    `;
    document.getElementById('shelf-back-btn').addEventListener('click', renderShelf);
}

function renderChapterList(detail) {
    const holder = document.getElementById('chapter-holder');
    if (!holder) return;
    const chapters = getSortedChapters(detail.chapterData);
    const pages = getSortedPages(detail.pageData);

    holder.innerHTML = '';
    chapters.forEach((chapter, chapterIdx) => {
        const btn = document.createElement('button');
        btn.className = 'chapter-item';
        btn.dataset.chapterIndex = String(chapterIdx);
        btn.textContent = chapter['章タイトル'];
        btn.addEventListener('click', () => {
            const idx = pages.findIndex(p => (p['順序'] || 0) >= (chapter['開始順序'] || 0));
            selectedPageIdx = idx >= 0 ? idx : 0;
            renderPageView();
        });
        holder.appendChild(btn);
    });
    markActiveChapter();
}

// 表示中のページが属する章を目次でハイライトする
function markActiveChapter() {
    const detail = selectedDream && dreamDetailCache[selectedDream['ID']];
    const page = selectedPages[selectedPageIdx];
    if (!detail || !page) return;
    const chapters = getSortedChapters(detail.chapterData);
    let activeIdx = -1;
    chapters.forEach((c, i) => { if ((c['開始順序'] || 0) <= (page['順序'] || 0)) activeIdx = i; });
    document.querySelectorAll('#chapter-holder .chapter-item').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.chapterIndex) === activeIdx);
    });
}

async function openDream(dream, pageIdx = 0) {
    selectedDream = dream;
    layoutEl?.classList.remove('shelf-mode');
    content.innerHTML = '<p class="loading">読み込み中...</p>';
    renderDreamSidebarShell(dream);

    const detail = await loadDreamDetail(dream['ID']);
    selectedPages = getSortedPages(detail.pageData);
    selectedPageIdx = Math.min(Math.max(pageIdx, 0), Math.max(selectedPages.length - 1, 0));
    renderChapterList(detail);
    renderPageView();
}

// ===== ページ表示 =====

function renderPageView() {
    if (!selectedDream) return;
    if (selectedPages.length === 0) {
        content.innerHTML = '<p class="placeholder">まだページが登録されていません。</p>';
        return;
    }

    const page = selectedPages[selectedPageIdx];
    const label = page['表示ページ'] || `#${selectedPageIdx + 1}`;
    const posLabel = `${selectedPageIdx + 1} / ${selectedPages.length}`;
    const atFirst = selectedPageIdx === 0;
    const atLast = selectedPageIdx === selectedPages.length - 1;

    content.innerHTML = `
        <div class="page-nav">
            <button type="button" class="page-nav-btn" id="page-prev-btn" ${atFirst ? 'disabled' : ''}>← 前のページ</button>
            <span class="page-indicator">${escapeHtml(label)}（${posLabel}）</span>
            <button type="button" class="page-nav-btn" id="page-next-btn" ${atLast ? 'disabled' : ''}>次のページ →</button>
        </div>
        <div class="page-body">${marked.parse(page['本文'] || '')}</div>
        <div class="page-nav page-nav--bottom">
            <button type="button" class="page-nav-btn" id="page-prev-btn-bottom" ${atFirst ? 'disabled' : ''}>← 前のページ</button>
            <button type="button" class="page-nav-btn" id="page-next-btn-bottom" ${atLast ? 'disabled' : ''}>次のページ →</button>
        </div>
    `;

    const goPrev = () => { if (selectedPageIdx > 0) { selectedPageIdx--; renderPageView(); content.scrollTo(0, 0); } };
    const goNext = () => { if (selectedPageIdx < selectedPages.length - 1) { selectedPageIdx++; renderPageView(); content.scrollTo(0, 0); } };
    document.getElementById('page-prev-btn')?.addEventListener('click', goPrev);
    document.getElementById('page-next-btn')?.addEventListener('click', goNext);
    document.getElementById('page-prev-btn-bottom')?.addEventListener('click', goPrev);
    document.getElementById('page-next-btn-bottom')?.addEventListener('click', goNext);

    markActiveChapter();
    renderMermaidBlocks(content);
}

// ===== Mermaid図（本文中の```mermaidコードブロックを図として描画） =====
// mermaidは重いため、該当ブロックを含むページを開いた時だけCDNから遅延読み込みする。
// 読み込み失敗（オフライン等）の場合はコードブロックのまま表示する。
let mermaidPromise = null;
function loadMermaid() {
    if (!mermaidPromise) {
        mermaidPromise = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
            .then(m => {
                m.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
                return m.default;
            })
            .catch(error => { mermaidPromise = null; throw error; });
    }
    return mermaidPromise;
}

async function renderMermaidBlocks(root) {
    const codes = [...root.querySelectorAll('pre > code.language-mermaid')];
    if (codes.length === 0) return;
    let mermaid;
    try {
        mermaid = await loadMermaid();
    } catch (error) {
        console.error(error);
        return;
    }
    const nodes = [];
    for (const code of codes) {
        if (!root.contains(code)) continue; // 読込待ちの間にページ送りされた場合
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = code.textContent;
        code.parentElement.replaceWith(div);
        nodes.push(div);
    }
    if (nodes.length === 0) return;
    try {
        await mermaid.run({ nodes });
    } catch (error) {
        console.error(error);
    }
    // 画面幅より広い図は縮小せず、最大720pxまで原寸に近づけて横スクロールで見る
    for (const node of nodes) {
        const svg = node.querySelector('svg');
        const natural = svg ? parseFloat(svg.style.maxWidth) : NaN;
        if (!Number.isNaN(natural) && natural > node.clientWidth) {
            svg.style.minWidth = `${Math.min(natural, 720)}px`;
            svg.style.maxWidth = 'none';
        }
    }
}

// キーボードの左右矢印でもページ送りできるようにする
document.addEventListener('keydown', (e) => {
    if (!selectedDream || selectedPages.length === 0) return;
    if (e.key === 'ArrowRight') document.getElementById('page-next-btn')?.click();
    if (e.key === 'ArrowLeft')  document.getElementById('page-prev-btn')?.click();
});

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        setTokenInput(saved);
        loadDreams(saved, true);
    }
});
