// 現在のバージョン: 1
// JS/CSSを変更した際は、index.htmlの参照とこのファイル自身の?v=Nを同じ値に揃えること（brain/cook等と同じ方式）。
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=1';
import { fetchFile } from './modules/github.js?v=1';
import { parseMarkdown, getChaptersForBook } from './modules/dataModel.js?v=1';

// 画面右上の「vバッジ」表示。import.meta.urlはこのモジュール自身の完全URL（?v=N込み）を返すため、
// キャッシュバスティングの値を別途手入力・同期する必要がない（brainと同じ方式）。
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const PATH  = 'book/data.md';

let currentBookData    = [];
let currentChapterData = [];
let selectedChapterKey = null; // "本ID::章ID" 形式（sidebarボタンのactive管理用）

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');

// ===== トークン・ネットワークステータス（brainの常時表示バーと同一の挙動） =====

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

// ===== データ読込（読み取り専用のため、brainのような3-wayマージ・保存機能は無し） =====

function applyContent(content) {
    const { bookData, chapterData } = parseMarkdown(content);
    currentBookData    = bookData;
    currentChapterData = chapterData;
    renderSidebar();
}

async function loadFromGithub(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }

    try {
        const { content: text, sha } = await fetchFile(token, OWNER, REPO, PATH);
        applyContent(text);
        saveCache(text, sha);
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
    } catch (error) {
        console.error(error);
        const cached = loadCache();
        if (cached) {
            applyContent(cached.content);
            setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
            if (!silent) alert('通信できませんでした。デバイス内に一時保存されている前回のデータを表示します。');
        } else {
            setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
            if (!silent) alert(`GitHubからの読み込みに失敗しました（${error.message}）。トークンが「${OWNER}/${REPO}」への読み書き権限を持っているか確認してください。`);
        }
    }
}

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => loadFromGithub(getTokenValue()));
});

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

// ===== サイドバー（本→章の一覧） =====

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
        block.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'book-meta';
        meta.textContent = [book['著者'], book['ステータス']].filter(Boolean).join(' ・ ');
        block.appendChild(meta);

        const chapters = getChaptersForBook(currentChapterData, book['ID']);
        for (const chapter of chapters) {
            const btn = document.createElement('button');
            btn.className = 'chapter-item';
            btn.textContent = chapter['章タイトル'];
            const key = `${book['ID']}::${chapter['ID']}`;
            if (key === selectedChapterKey) btn.classList.add('active');
            btn.addEventListener('click', () => selectChapter(book, chapter, key, btn));
            block.appendChild(btn);
        }

        sidebar.appendChild(block);
    }

    // 未選択なら最初の本の最初の章を自動表示
    if (!selectedChapterKey && currentBookData[0]) {
        const firstBook = currentBookData[0];
        const firstChapter = getChaptersForBook(currentChapterData, firstBook['ID'])[0];
        const firstBtn = sidebar.querySelector('.chapter-item');
        if (firstChapter && firstBtn) {
            const key = `${firstBook['ID']}::${firstChapter['ID']}`;
            selectChapter(firstBook, firstChapter, key, firstBtn);
        }
    }
}

function selectChapter(book, chapter, key, btnEl) {
    selectedChapterKey = key;
    document.querySelectorAll('.chapter-item.active').forEach(el => el.classList.remove('active'));
    btnEl.classList.add('active');

    const sourceLine = `${book['書名']} / ${chapter['章タイトル']}${chapter['ページ範囲'] ? '（' + chapter['ページ範囲'] + '）' : ''}`;
    content.innerHTML = `<div class="chapter-source">${sourceLine}</div>` + marked.parse(chapter['本文'] || '');
}

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        setTokenInput(saved);
        loadFromGithub(saved, true);
    }
});
