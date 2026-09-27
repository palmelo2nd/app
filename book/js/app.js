// 現在のバージョン: 3
// JS/CSSを変更した際は、index.htmlの参照とこのファイル自身の?v=Nを同じ値に揃えること（brain/cook等と同じ方式）。
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=2';
import { fetchFile } from './modules/github.js?v=1';
import { parseFrontMatter, getSortedChapters, getSortedPages } from './modules/dataModel.js?v=3';

// 画面右上の「vバッジ」表示。import.meta.urlはこのモジュール自身の完全URL（?v=N込み）を返すため、
// キャッシュバスティングの値を別途手入力・同期する必要がない（brainと同じ方式）。
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const BOOKS_PATH = 'book/books.md';
const bookFilePath = (bookId) => `book/${bookId}.md`;

let currentBookData = [];   // books.md由来（一覧のみ）
let bookDetailCache = {};   // 本ID -> { chapterData, pageData }（一度読み込んだ本ごとのファイルをメモリ保持）

let selectedBook  = null;
let selectedPages = [];
let selectedPageIdx = 0;

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');

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

// ===== books.md（本の一覧）読込 =====

async function loadBooks(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }

    try {
        const { content: text, sha } = await fetchFile(token, OWNER, REPO, BOOKS_PATH);
        currentBookData = parseFrontMatter(text).bookData || [];
        saveCache('books', text, sha);
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        renderSidebar();
    } catch (error) {
        console.error(error);
        const cached = loadCache('books');
        if (cached) {
            currentBookData = parseFrontMatter(cached.content).bookData || [];
            setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
            if (!silent) alert('通信できませんでした。デバイス内に一時保存されている前回のデータを表示します。');
            renderSidebar();
        } else {
            setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
            if (!silent) alert(`GitHubからの読み込みに失敗しました（${error.message}）。トークンが「${OWNER}/${REPO}」への読み書き権限を持っているか確認してください。`);
        }
    }
}

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => loadBooks(getTokenValue()));
});

// ===== 本ごとのファイル読込（クリック時に遅延読込・キャッシュ） =====

async function loadBookDetail(bookId) {
    if (bookDetailCache[bookId]) return bookDetailCache[bookId];

    const token = getTokenValue();
    const path  = bookFilePath(bookId);

    try {
        const { content: text, sha } = await fetchFile(token, OWNER, REPO, path);
        const parsed = parseFrontMatter(text);
        const detail = { chapterData: parsed.chapterData || [], pageData: parsed.pageData || [] };
        bookDetailCache[bookId] = detail;
        saveCache(bookId, text, sha);
        return detail;
    } catch (error) {
        console.error(error);
        const cached = loadCache(bookId);
        if (cached) {
            const parsed = parseFrontMatter(cached.content);
            const detail = { chapterData: parsed.chapterData || [], pageData: parsed.pageData || [] };
            bookDetailCache[bookId] = detail;
            return detail;
        }
        alert(`本文の読み込みに失敗しました（${error.message}）。`);
        return { chapterData: [], pageData: [] };
    }
}

// ===== 保存（bookアプリは読み取り専用のため、ここではトークンのローカル保存のみを行う） =====

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getTokenValue();
        if (!token) { alert('トークンを入力してください'); return; }
        saveToken(token);
        btn.textContent = '保存しました';
        setTimeout(() => { btn.textContent = '保存'; }, 1200);
    });
});

// ===== キャッシュ更新（brainと同一実装：アプリコードの強制リフレッシュ） =====

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

// ===== サイドバー（本の一覧。クリックで本文を遅延読込） =====

function renderSidebar() {
    sidebar.innerHTML = '';

    if (currentBookData.length === 0) {
        sidebar.innerHTML = '<p class="placeholder">まだ本が登録されていません。</p>';
        return;
    }

    for (const book of currentBookData) {
        const block = document.createElement('div');
        block.className = 'book-block';

        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = book['書名'] || book['ID'];
        title.style.cursor = 'pointer';
        title.addEventListener('click', () => openBook(book, 0));
        block.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'book-meta';
        meta.textContent = [book['著者'], book['ステータス']].filter(Boolean).join(' ・ ');
        block.appendChild(meta);

        const chapterHolder = document.createElement('div');
        chapterHolder.className = 'chapter-holder';
        chapterHolder.dataset.bookId = book['ID'];
        block.appendChild(chapterHolder);

        sidebar.appendChild(block);
    }

    // 未選択なら最初の本を自動で開く
    if (!selectedBook && currentBookData[0]) {
        openBook(currentBookData[0], 0);
    }
}

async function renderChapterList(book) {
    const holder = sidebar.querySelector(`.chapter-holder[data-book-id="${CSS.escape(book['ID'])}"]`);
    if (!holder) return;

    const detail = await loadBookDetail(book['ID']);
    const chapters = getSortedChapters(detail.chapterData);
    const pages = getSortedPages(detail.pageData);

    holder.innerHTML = '';
    if (chapters.length === 0 && pages.length > 0) {
        const hint = document.createElement('div');
        hint.className = 'book-meta';
        hint.textContent = `（章の区切りは未登録。全${pages.length}ページ）`;
        holder.appendChild(hint);
        return;
    }

    for (const chapter of chapters) {
        const btn = document.createElement('button');
        btn.className = 'chapter-item';
        btn.textContent = chapter['章タイトル'];
        btn.addEventListener('click', () => {
            const idx = pages.findIndex(p => (p['順序'] || 0) >= (chapter['開始順序'] || 0));
            openBook(book, idx >= 0 ? idx : 0);
        });
        holder.appendChild(btn);
    }
}

async function openBook(book, pageIdx) {
    selectedBook = book;
    content.innerHTML = '<p class="loading">読み込み中...</p>';

    const detail = await loadBookDetail(book['ID']);
    selectedPages = getSortedPages(detail.pageData);
    selectedPageIdx = Math.min(Math.max(pageIdx, 0), Math.max(selectedPages.length - 1, 0));
    renderPage();
    renderChapterList(book);
}

// ===== ページ表示（前へ／次へ送り） =====

function renderPage() {
    if (!selectedBook || selectedPages.length === 0) {
        content.innerHTML = '<p class="placeholder">まだページが登録されていません。</p>';
        return;
    }

    const page = selectedPages[selectedPageIdx];
    const label = page['表示ページ'] || `#${selectedPageIdx + 1}`;
    const posLabel = `${selectedPageIdx + 1} / ${selectedPages.length}`;

    content.innerHTML = `
        <div class="page-nav">
            <button type="button" class="page-nav-btn" id="page-prev-btn" ${selectedPageIdx === 0 ? 'disabled' : ''}>← 前のページ</button>
            <span class="page-indicator">${selectedBook['書名']} ／ p.${label}（${posLabel}）</span>
            <button type="button" class="page-nav-btn" id="page-next-btn" ${selectedPageIdx === selectedPages.length - 1 ? 'disabled' : ''}>次のページ →</button>
        </div>
        <div class="page-body">${marked.parse(page['本文'] || '')}</div>
        <div class="page-nav page-nav--bottom">
            <button type="button" class="page-nav-btn" id="page-prev-btn-bottom" ${selectedPageIdx === 0 ? 'disabled' : ''}>← 前のページ</button>
            <button type="button" class="page-nav-btn" id="page-next-btn-bottom" ${selectedPageIdx === selectedPages.length - 1 ? 'disabled' : ''}>次のページ →</button>
        </div>
    `;

    const goPrev = () => { if (selectedPageIdx > 0) { selectedPageIdx--; renderPage(); content.scrollTo(0, 0); } };
    const goNext = () => { if (selectedPageIdx < selectedPages.length - 1) { selectedPageIdx++; renderPage(); content.scrollTo(0, 0); } };

    document.getElementById('page-prev-btn')?.addEventListener('click', goPrev);
    document.getElementById('page-next-btn')?.addEventListener('click', goNext);
    document.getElementById('page-prev-btn-bottom')?.addEventListener('click', goPrev);
    document.getElementById('page-next-btn-bottom')?.addEventListener('click', goNext);
}

// キーボードの左右矢印でもページ送りできるようにする
document.addEventListener('keydown', (e) => {
    if (selectedPages.length === 0) return;
    if (e.key === 'ArrowRight') document.getElementById('page-next-btn')?.click();
    if (e.key === 'ArrowLeft')  document.getElementById('page-prev-btn')?.click();
});

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        setTokenInput(saved);
        loadBooks(saved, true);
    }
});
