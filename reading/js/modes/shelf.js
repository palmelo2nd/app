// readingの「dream」「rules」「log」が共通で使う、棚（一覧）→目次付きページの読み取り専用ビューア。
// 旧dreamアプリ（v2）を2026-11-17に移し、データの置き場所を引数で受け取るようにした（brain #1695）。
// JS/CSSを変更した際は、index.html・js/app.js・各modeの?v=Nを同じ値に揃えること。
import { loadToken, saveToken, loadCache, saveCache } from '../modules/shelfStorage.js?v=7';
import { fetchFile } from '../modules/github.js?v=7';
import { parseFrontMatter, getSortedChapters, getSortedPages } from '../modules/dataModel.js?v=7';
import { makeDiagramsZoomable } from '../modules/diagramZoom.js?v=7';
import * as offline from '../modules/offline.js?v=7';
import {
    getShelfEntry, getSavedText, saveShelf, refreshShelf, removeShelf, estimateShelfSize,
    shelfEntrySize, shelfFileCount, loadMermaid
} from '../modules/shelfOffline.js?v=7';

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';

// startShelf()で設定する
let DIR = '';           // 例: reading/02_dream
let LIST_PATH = '';     // 一覧ファイル（例: reading/02_dream/dreams.md）
let LIST_KEY = '';      // 一覧ファイルのJSONのキー（例: dreamData）
let SHELF_TITLE = '';
let CACHE_PREFIX = '';  // 端末内キャッシュのid接頭辞（機能ごとに分ける）
let MODE = '';
const dreamFilePath = (dreamId) => `${DIR}/${dreamId}.md`;

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
        const { content: text } = await fetchFile(token, OWNER, REPO, LIST_PATH);
        currentDreamData = parseFrontMatter(text).data[LIST_KEY] || [];
        if (!getShelfEntry(MODE)) saveCache(CACHE_PREFIX + 'list', text, ''); // 端末に保存してあれば、LocalStorageには入れない
        dreamDetailCache = {}; // 読込のたびに最新を取り直す
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        renderShelf();
        refreshSavedCopy(token);
    } catch (error) {
        console.error(error);
        // 読む順番：GitHub → 端末に保存した分（まとめて保存） → LocalStorageの一時キャッシュ
        const saved = await getSavedText(MODE, LIST_PATH);
        const cached = saved != null ? { content: saved } : loadCache(CACHE_PREFIX + 'list');
        if (cached) {
            currentDreamData = parseFrontMatter(cached.content).data[LIST_KEY] || [];
            setNetworkStatus(saved != null
                ? '<span class="status-badge offline-badge">オフライン（端末に保存した分）</span>'
                : '<span class="status-badge offline-badge">オフライン（未同期）</span>');
            if (!silent) alert(saved != null
                ? '通信できませんでした。端末に保存した分を表示します。'
                : '通信できませんでした。デバイス内に一時保存されている前回のデータを表示します。');
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
        if (!getShelfEntry(MODE)?.files?.[dreamFilePath(dreamId)]) saveCache(CACHE_PREFIX + dreamId, text, sha);
        return detail;
    } catch (error) {
        console.error(error);
        const saved = await getSavedText(MODE, dreamFilePath(dreamId));
        const cached = saved != null ? { content: saved } : loadCache(CACHE_PREFIX + dreamId);
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

// ===== キャッシュ更新（アプリコードの強制リフレッシュ） =====

document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
        try {
            if ('caches' in window) {
                // アプリ本体（reading-shell）だけを消す。端末に保存した本（reading-offline）と他のアプリのキャッシュは残す
                await caches.delete('reading-shell');
            }
            if ('serviceWorker' in navigator) {
                // 他のアプリのService Workerは解除しない
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.filter(r => r.scope.startsWith(new URL('./', location.href).href)).map(r => r.unregister()));
            }
        } catch (error) {
            console.error(error);
        }
        location.href = location.pathname + `?m=${MODE}&nocache=` + Date.now();
    });
});

// ===== 端末に保存（機能ごとにまとめて。2026-11-27、brain #-107） =====
// 保存先はbookの本と同じCache Storage「reading-offline」（modules/shelfOffline.js）。一覧の上の欄から保存・削除し、
// bookの本棚の下の「端末に保存した本」にも並ぶ。電波のある所で開いたら、変わったファイルだけ差し替える。

function formatDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

let refreshing = false;
async function refreshSavedCopy(token) {
    if (!getShelfEntry(MODE) || refreshing) return;
    refreshing = true;
    try {
        if (await refreshShelf(token, MODE)) dreamDetailCache = {}; // 次に開くとき、差し替えた本文を読む
    } catch (error) {
        console.error('端末に保存した分の更新に失敗しました', error);
    }
    refreshing = false;
    if (!selectedDream) renderShelfOfflineBox();
}

async function renderShelfOfflineBox() {
    const box = document.getElementById('shelf-offline-box');
    if (!box) return;
    const entry = getShelfEntry(MODE);
    if (entry) {
        box.innerHTML = `
            <div class="offline-box-status">端末に保存済み・${offline.formatBytes(shelfEntrySize(entry))}（${shelfFileCount(entry)}ファイル）・${formatDate(entry.syncedAt || entry.savedAt)}${refreshing ? '・更新を確認中…' : ''}。圏外でも全部読めます</div>
            <button type="button" class="offline-small-btn danger" id="shelf-offline-remove-btn">端末から削除</button>
        `;
        document.getElementById('shelf-offline-remove-btn').addEventListener('click', async () => {
            if (!confirm(`「${SHELF_TITLE}」を端末から削除しますか？（GitHub上のデータは消えません）`)) return;
            await removeShelf(MODE);
            renderShelfOfflineBox();
        });
        return;
    }
    box.innerHTML = `
        <button type="button" class="offline-small-btn" id="shelf-offline-save-btn">まとめて端末に保存</button>
        <div class="offline-box-status" id="shelf-offline-text">保存すると、圏外でもこの一覧の全部を読めます。</div>
    `;
    const text = document.getElementById('shelf-offline-text');
    document.getElementById('shelf-offline-save-btn').addEventListener('click', async (e) => {
        const token = getTokenValue();
        if (!token) { alert('トークンを入力してください'); return; }
        e.currentTarget.disabled = true;
        try {
            await saveShelf(token, MODE, (done, total) => { text.textContent = `保存中… ${done} / ${total}`; });
            dreamDetailCache = {};
        } catch (error) {
            console.error(error);
            alert(`端末に保存できませんでした（${error.message}）。電波のある所でもう一度押してください。`);
        }
        if (!selectedDream) renderShelfOfflineBox();
    });
    if (!getTokenValue() || !navigator.onLine) return;
    try {
        const bytes = await estimateShelfSize(getTokenValue(), MODE);
        if (document.getElementById('shelf-offline-text') === text) text.textContent = `保存すると${offline.formatBytes(bytes)}。圏外でもこの一覧の全部を読めます。`;
    } catch (error) {
        console.error(error); // 目安が出せなくても保存はできる
    }
}

// ===== 一覧（マップ集をカードで表示する入口画面） =====

function renderShelf() {
    selectedDream = null;
    layoutEl?.classList.add('shelf-mode');
    sidebar.innerHTML = '<p class="placeholder">選ぶと、ここに目次が表示されます。</p>';

    if (currentDreamData.length === 0) {
        content.innerHTML = '<p class="placeholder">まだ登録されていません。</p>';
        return;
    }

    content.innerHTML = `
        <h2 class="shelf-title">${escapeHtml(SHELF_TITLE)}</h2>
        <div class="offline-box" id="shelf-offline-box"></div>
        <div class="shelf-grid" id="shelf-grid"></div>
    `;
    renderShelfOfflineBox();
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
// mermaidは重いため、該当ブロックを含むページを開いた時だけCDNから遅延読み込みする（loadMermaidはmodules/shelfOffline.js）。
// 読み込み失敗（オフライン等）の場合はコードブロックのまま表示する。
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
    // 図は画面の幅に合わせて縮めて全体を見せ、押すと全画面で拡大・移動できる（2026-11-22、brain #-19。
    // それまでは最大720pxの原寸＋横スクロールで、大きいマップは全体が見えなかった）
    makeDiagramsZoomable(nodes);
}

// キーボードの左右矢印でもページ送りできるようにする
document.addEventListener('keydown', (e) => {
    if (!selectedDream || selectedPages.length === 0) return;
    if (e.key === 'ArrowRight') document.getElementById('page-next-btn')?.click();
    if (e.key === 'ArrowLeft')  document.getElementById('page-prev-btn')?.click();
});

// ===== 初期化 =====

// 各mode（dream.js・rules.js・log.js）から、データの置き場所を渡して呼ぶ
export function startShelf(config) {
    ({ mode: MODE, dir: DIR, listFile: LIST_PATH, listKey: LIST_KEY, title: SHELF_TITLE } = config);
    LIST_PATH = `${DIR}/${LIST_PATH}`;
    CACHE_PREFIX = `${MODE}_`;
    const saved = loadToken();
    if (saved) {
        setTokenInput(saved);
        loadDreams(saved, true);
    }
}
