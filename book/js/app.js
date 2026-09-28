// 現在のバージョン: 14
// JS/CSSを変更した際は、index.htmlの参照とこのファイル自身の?v=Nを同じ値に揃えること（brain/cook等と同じ方式）。
import { loadToken, saveToken, loadCache, saveCache } from './modules/storage.js?v=2';
import { fetchFile, saveFile } from './modules/github.js?v=2';
import {
    parseFrontMatter, stringifyBookFile,
    getSortedChapters, getSortedPages, computeProgress
} from './modules/dataModel.js?v=4';

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
let bookDetailCache = {};   // 本ID -> { chapterData, pageData, tail, sha }

let selectedBook    = null;
let selectedPages   = [];
let selectedPageIdx = 0;
let activeTab       = 'content'; // 'summary' | 'content'
let hasUnsavedChanges = false;
// マーカーは色ごとに意味を持たせる（on/offではなく「今どの色で引くか」を選ぶ方式）
const MARKER_COLORS = {
    yellow: { label: '黄色', meaning: '後で考察', bg: '#fff3a0' },
    blue:   { label: '青',   meaning: '覚えておくこと', bg: '#bfdbfe' },
    green:  { label: '緑',   meaning: '要点（体系的な抜き出し）', bg: '#bbf7d0' },
    pink:   { label: 'ピンク', meaning: '本文にラインがあるだけ', bg: '#fbcfe8' },
};
let markerColor = null; // null=オフ、それ以外はMARKER_COLORSのキー
let pendingMarkClick = null; // { text, offset, color } クリックしたマーカーの操作バナー表示用

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
        const { content: text } = await fetchFile(token, OWNER, REPO, BOOKS_PATH);
        currentBookData = parseFrontMatter(text).data.bookData || [];
        saveCache('books', text, '');
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        renderSidebar();
    } catch (error) {
        console.error(error);
        const cached = loadCache('books');
        if (cached) {
            currentBookData = parseFrontMatter(cached.content).data.bookData || [];
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
        const { data, tail } = parseFrontMatter(text);
        const detail = { chapterData: data.chapterData || [], pageData: data.pageData || [], tail, sha };
        bookDetailCache[bookId] = detail;
        saveCache(bookId, text, sha);
        return detail;
    } catch (error) {
        console.error(error);
        const cached = loadCache(bookId);
        if (cached) {
            const { data, tail } = parseFrontMatter(cached.content);
            const detail = { chapterData: data.chapterData || [], pageData: data.pageData || [], tail, sha: cached.sha };
            bookDetailCache[bookId] = detail;
            return detail;
        }
        alert(`本文の読み込みに失敗しました（${error.message}）。`);
        return { chapterData: [], pageData: [], tail: '', sha: null };
    }
}

// ===== 保存（トークンのローカル保存＋既読状態などの未保存変更をGitHubへ書き込み） =====

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const token = getTokenValue();
        if (!token) { alert('トークンを入力してください'); return; }
        saveToken(token);

        if (!selectedBook || !hasUnsavedChanges) {
            btn.textContent = '保存しました';
            setTimeout(() => { btn.textContent = '保存'; }, 1200);
            return;
        }

        const detail = bookDetailCache[selectedBook['ID']];
        const path = bookFilePath(selectedBook['ID']);
        const newContent = stringifyBookFile(detail.chapterData, detail.pageData, detail.tail);

        try {
            const { newSha } = await saveFile(token, OWNER, REPO, path, newContent, detail.sha);
            detail.sha = newSha;
            saveCache(selectedBook['ID'], newContent, newSha);
            hasUnsavedChanges = false;
            setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
            btn.textContent = '保存しました';
            setTimeout(() => { btn.textContent = '保存'; }, 1200);
        } catch (error) {
            console.error(error);
            if (error.status === 409) {
                alert('他の端末で更新されています。「読込」してから既読チェックをつけ直してください。');
            } else {
                alert(`保存に失敗しました（${error.message}）。`);
            }
        }
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
            activeTab = 'content';
            openBook(book, idx >= 0 ? idx : 0);
        });
        holder.appendChild(btn);
    }
}

async function openBook(book, pageIdx) {
    if (selectedBook?.['ID'] !== book['ID']) {
        hasUnsavedChanges = false; // 別の本に切り替える時だけリセット（同じ本の章ジャンプ等では保持する）
        pendingMarkClick = null;
        editingHighlight = null;
    }
    selectedBook = book;
    content.innerHTML = '<p class="loading">読み込み中...</p>';

    const detail = await loadBookDetail(book['ID']);
    selectedPages = getSortedPages(detail.pageData);
    selectedPageIdx = Math.min(Math.max(pageIdx, 0), Math.max(selectedPages.length - 1, 0));
    renderContentArea();
    renderChapterList(book);
}

// ===== コンテンツ領域（上部タブ：サマリー／本文／TIPS／要点／QA） =====

const TABS = [
    { key: 'summary', label: 'サマリー', render: renderSummaryView },
    { key: 'content', label: '本文',     render: renderPageView },
    { key: 'tips',    label: 'TIPS',    render: () => renderMarkerListView('yellow', 'tips') },
    { key: 'points',  label: '要点',    render: () => renderMarkerListView('green', 'points') },
    { key: 'qa',      label: 'QA',      render: () => renderMarkerListView('blue', 'qa') },
];

function renderContentArea() {
    if (!selectedBook) {
        content.innerHTML = '<p class="placeholder">左の一覧から本を選んでください。</p>';
        return;
    }

    content.innerHTML = `
        <div class="content-tabs">
            ${TABS.map(t => `<button type="button" class="content-tab-btn ${activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
        </div>
        <div class="content-tab-body" id="content-tab-body"></div>
    `;

    document.querySelectorAll('.content-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => { activeTab = btn.dataset.tab; renderContentArea(); });
    });

    const tab = TABS.find(t => t.key === activeTab) || TABS[1];
    tab.render();
}

// ===== サマリー：全体／章ごとの既読進捗バー =====

function progressBarHtml(label, total, read) {
    const percent = total > 0 ? Math.round((read / total) * 100) : 0;
    return `
        <div class="progress-row">
            <div class="progress-label">${label}<span class="progress-count">${read} / ${total}（${percent}%）</span></div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${percent}%"></div></div>
        </div>
    `;
}

function progressCellText(total, read) {
    const percent = total > 0 ? Math.round((read / total) * 100) : 0;
    return `${read} / ${total}（${percent}%）`;
}

function renderSummaryView() {
    const holder = document.getElementById('content-tab-body');
    const detail = bookDetailCache[selectedBook['ID']];
    const { overall, chapters } = computeProgress(detail.chapterData, detail.pageData);

    let html = `<h2 class="summary-title">${selectedBook['書名']}</h2>`;
    html += progressBarHtml('全体', overall.total, overall.read);

    if (chapters.length > 0) {
        html += `
            <h3 class="summary-subtitle">目次</h3>
            <table class="progress-table">
                <thead><tr><th>章</th><th>進捗</th></tr></thead>
                <tbody>
                    ${chapters.map(c => `
                        <tr>
                            <td>${c.chapter['章タイトル']}</td>
                            <td class="progress-cell">${progressCellText(c.total, c.read)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    holder.innerHTML = html;
}

// ===== マーカー（わかりにくかった箇所のハイライト） =====
// 本文（page['本文']）そのものは書き換えず、page['ハイライト']（{text, offset}の配列）を
// 別途持たせ、表示時にだけ<mark>で挟み込む。本文の書き込みはbook-readingスキル側の役割のまま。
// offsetは選択時点の.page-body内での文字位置（近似値）で、同じ文字列が複数箇所にある場合に
// どの出現箇所を光らせるかの判定と、あとで見返す時のおおよその位置の目安に使う。
// textも一緒に保持しているのは、後で検索・一覧表示したい時のため。

function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightTextOf(h) { return typeof h === 'string' ? h : h.text; }
function highlightOffsetOf(h) { return typeof h === 'string' ? undefined : h.offset; }
function highlightColorOf(h) { return typeof h === 'string' ? 'yellow' : (h.color || 'yellow'); } // 色追加前の旧データは黄色扱い

// DOM上の<mark>要素群から、指定したtext/offsetに対応するものを探す（編集開始時に使う）
function findMarkElement(container, text, offset) {
    return [...container.querySelectorAll('.reader-highlight')].find(el => {
        if (el.dataset.highlight !== text) return false;
        const elOffsetRaw = el.dataset.highlightOffset;
        const elOffset = elOffsetRaw === '' ? undefined : Number(elOffsetRaw);
        return elOffset === offset;
    });
}

// containerの先頭からrangeの開始位置までのプレーンテキスト文字数を返す（選択位置の近似オフセット）
function computeOffsetWithinContainer(container, range) {
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
}

// text中でtargetが複数回出現する場合、hintOffsetに最も近い出現箇所だけを<mark>で挟む
function wrapNearestOccurrence(text, target, hintOffset, color) {
    const indices = [];
    let idx = text.indexOf(target);
    while (idx !== -1) {
        indices.push(idx);
        idx = text.indexOf(target, idx + target.length);
    }
    if (indices.length === 0) return text;

    let bestIdx = indices[0];
    if (typeof hintOffset === 'number') {
        let bestDist = Math.abs(indices[0] - hintOffset);
        for (const i of indices) {
            const d = Math.abs(i - hintOffset);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
    }

    const offsetAttr = typeof hintOffset === 'number' ? hintOffset : '';
    const wrapped = `<mark class="reader-highlight reader-highlight-${color}" data-highlight="${escapeAttr(target)}" data-highlight-offset="${offsetAttr}" data-highlight-color="${color}">${target}</mark>`;
    return text.slice(0, bestIdx) + wrapped + text.slice(bestIdx + target.length);
}

function withHighlightMarks(text, highlights) {
    let out = text;
    for (const h of (highlights || [])) {
        const hText = highlightTextOf(h);
        if (!hText) continue;
        out = wrapNearestOccurrence(out, hText, highlightOffsetOf(h), highlightColorOf(h));
    }
    return out;
}

function markUnsaved() {
    hasUnsavedChanges = true;
    setNetworkStatus('<span class="status-badge unsaved-badge">オンライン（更新あり）</span>');
}

function getCurrentPage() {
    return selectedPages[selectedPageIdx] || null;
}

// 既存マーカーの「編集」中は、確定時に古いエントリを新しい範囲へ差し替える
let editingHighlight = null; // { text, offset } 編集対象として除去予定の既存エントリ

function commitHighlightText(text, offset, color) {
    const page = getCurrentPage();
    if (!page || !text || !color) return;
    page['ハイライト'] = page['ハイライト'] || [];

    if (editingHighlight) {
        page['ハイライト'] = page['ハイライト'].filter(h => !(highlightTextOf(h) === editingHighlight.text && highlightOffsetOf(h) === editingHighlight.offset));
        editingHighlight = null;
    }

    const alreadyExists = page['ハイライト'].some(h => highlightTextOf(h) === text && highlightOffsetOf(h) === offset);
    if (!alreadyExists) {
        page['ハイライト'].push({ text, offset, color });
        markUnsaved();
    }
    if (activeTab === 'content') renderPageView();
}

// iOSなどのモバイルブラウザでは、選択後に別のボタンをタップすると、その最初のタップが
// 「選択解除（コピー等のメニューを閉じる）」に使われてしまい、ボタンのclickハンドラに
// 到達しないことがある（preventDefault等のJS側の対策では防げないOSレベルの挙動）。
// そのため、マーカーの確定はボタンのタップを介さず、「選択が終わったタイミング」＝
// selectionchangeで選択が空（isCollapsed）に戻った瞬間に、直前まで保持していた選択内容
// （pendingHighlight）を確定する。広い範囲を選ぶ間（選択が変化し続けている間）はいつまでも
// 確定されないため、途中で意図しない範囲が確定されることもない。
// 万一、環境によって選択解除イベントが来ない場合に備え、長めのフォールバックタイマーも残す。
let pendingHighlight = null; // { text, offset, color } 選択中でまだ確定していない内容
let markerFallbackTimer = null;
const MARKER_FALLBACK_DELAY = 3000;

function commitPendingHighlight() {
    if (!pendingHighlight) return;
    const { text, offset, color } = pendingHighlight;
    pendingHighlight = null;
    commitHighlightText(text, offset, color);
}

document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();

    if (!sel || sel.isCollapsed) {
        // 選択が終わった（タップして選択解除された、等）タイミングで確定する
        if (markerFallbackTimer) { clearTimeout(markerFallbackTimer); markerFallbackTimer = null; }
        if (pendingHighlight) commitPendingHighlight();
        return;
    }

    if (!markerColor) return;
    const text = sel.toString().trim();
    if (!text) return;
    const pageBodyEl = document.querySelector('.page-body');
    if (!pageBodyEl || !sel.anchorNode || !pageBodyEl.contains(sel.anchorNode)) return;

    const offset = computeOffsetWithinContainer(pageBodyEl, sel.getRangeAt(0));
    pendingHighlight = { text, offset, color: markerColor };

    if (markerFallbackTimer) clearTimeout(markerFallbackTimer);
    markerFallbackTimer = setTimeout(() => commitPendingHighlight(), MARKER_FALLBACK_DELAY);
});

// ===== TIPS／要点／QAタブ：色ごとのマーカー一覧＋メモ入力 =====
// 黄=TIPS（前提・考察・実験メモ）、緑=要点（本文からの体系的な抜き出し）、青=QA（一問一答）
// いずれも本の全ページを横断してその色のマーカーを集め、引用＋メモ欄を並べる。
// メモ欄の入力は直接page['ハイライト']内の該当オブジェクトを書き換える（配列は共有参照のため）。

function renderMarkerListView(color, mode) {
    const holder = document.getElementById('content-tab-body');
    if (!selectedBook || selectedPages.length === 0) {
        holder.innerHTML = '<p class="placeholder">まだページが登録されていません。</p>';
        return;
    }

    const entries = [];
    selectedPages.forEach((page, pageIdx) => {
        (page['ハイライト'] || []).forEach(h => {
            if (highlightColorOf(h) === color) entries.push({ page, pageIdx, h });
        });
    });

    if (entries.length === 0) {
        holder.innerHTML = `<p class="placeholder">まだ${MARKER_COLORS[color].label}マーカーがありません。本文タブでマーカーを引くとここに表示されます。</p>`;
        return;
    }

    holder.innerHTML = entries.map((entry, i) => {
        const label = entry.page['表示ページ'] || `#${entry.pageIdx + 1}`;
        const editor = mode === 'qa'
            ? `
                <label class="marker-field-label">問い</label>
                <textarea class="marker-note-input" data-entry="${i}" data-field="question" rows="2">${escapeHtml(entry.h.question)}</textarea>
                <label class="marker-field-label">答え</label>
                <textarea class="marker-note-input" data-entry="${i}" data-field="answer" rows="2">${escapeHtml(entry.h.answer)}</textarea>
              `
            : `
                <label class="marker-field-label">メモ</label>
                <textarea class="marker-note-input" data-entry="${i}" data-field="note" rows="3" placeholder="前提・考察・実験メモなど">${escapeHtml(entry.h.note)}</textarea>
              `;

        return `
            <div class="marker-entry">
                <div class="marker-entry-head">
                    <button type="button" class="page-nav-btn marker-jump-btn" data-page-idx="${entry.pageIdx}">p.${label}へ移動</button>
                </div>
                <blockquote class="marker-quote">${escapeHtml(entry.h.text)}</blockquote>
                ${editor}
            </div>
        `;
    }).join('');

    holder.querySelectorAll('.marker-jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedPageIdx = Number(btn.dataset.pageIdx);
            activeTab = 'content';
            renderContentArea();
        });
    });

    holder.querySelectorAll('.marker-note-input').forEach(input => {
        input.addEventListener('input', () => {
            const entry = entries[Number(input.dataset.entry)];
            entry.h[input.dataset.field] = input.value;
            markUnsaved();
        });
    });
}

// ===== 本文：ページ表示（既読チェック・マーカー・前へ／次へ送り） =====

function renderPageView() {
    const holder = document.getElementById('content-tab-body');

    if (!selectedBook || selectedPages.length === 0) {
        holder.innerHTML = '<p class="placeholder">まだページが登録されていません。</p>';
        return;
    }

    const page = selectedPages[selectedPageIdx];
    const label = page['表示ページ'] || `#${selectedPageIdx + 1}`;
    const posLabel = `${selectedPageIdx + 1} / ${selectedPages.length}`;

    holder.innerHTML = `
        <div class="page-nav">
            <button type="button" class="page-nav-btn" id="page-prev-btn" ${selectedPageIdx === 0 ? 'disabled' : ''}>← 前のページ</button>
            <span class="page-indicator">${selectedBook['書名']} ／ p.${label}（${posLabel}）</span>
            <label class="page-read-check">
                <input type="checkbox" id="page-read-checkbox" ${page['既読'] ? 'checked' : ''}>
                読み終わった
            </label>
            <button type="button" class="page-nav-btn" id="page-next-btn" ${selectedPageIdx === selectedPages.length - 1 ? 'disabled' : ''}>次のページ →</button>
        </div>
        <div class="highlight-toolbar">
            ${Object.entries(MARKER_COLORS).map(([key, c]) => `
                <button type="button" class="marker-color-btn ${markerColor === key ? 'marker-color-btn-active' : ''}"
                        style="--marker-color:${c.bg}" data-color="${key}" title="${c.meaning}">${c.label}</button>
            `).join('')}
            <span class="highlight-hint">${markerColor ? `「${MARKER_COLORS[markerColor].label}」（${MARKER_COLORS[markerColor].meaning}）で選択中。範囲を選び終わって指を離す（別の場所をタップする）とマーカーが確定します。ハンドルで範囲を調整してから離してもOK` : '色を選ぶとマーカーモードになります。既存のマーカーをタップすると編集・削除できます'}</span>
        </div>
        ${pendingMarkClick ? `
            <div class="marker-edit-banner">
                このマーカーをどうしますか？
                <button type="button" class="page-nav-btn" id="marker-edit-btn">編集（範囲を調整）</button>
                <button type="button" class="page-nav-btn" id="marker-delete-btn">削除</button>
                <button type="button" class="page-nav-btn" id="marker-cancel-btn">キャンセル</button>
            </div>
        ` : ''}
        <div class="page-body ${markerColor ? 'marker-mode' : ''}" style="${markerColor ? `--marker-preview:${MARKER_COLORS[markerColor].bg}` : ''}">${marked.parse(withHighlightMarks(page['本文'] || '', page['ハイライト']))}</div>
        <div class="page-nav page-nav--bottom">
            <button type="button" class="page-nav-btn" id="page-prev-btn-bottom" ${selectedPageIdx === 0 ? 'disabled' : ''}>← 前のページ</button>
            <button type="button" class="page-nav-btn" id="page-next-btn-bottom" ${selectedPageIdx === selectedPages.length - 1 ? 'disabled' : ''}>次のページ →</button>
        </div>
    `;

    const goPrev = () => { if (selectedPageIdx > 0) { selectedPageIdx--; renderPageView(); holder.scrollTo(0, 0); } };
    const goNext = () => { if (selectedPageIdx < selectedPages.length - 1) { selectedPageIdx++; renderPageView(); holder.scrollTo(0, 0); } };

    document.getElementById('page-prev-btn')?.addEventListener('click', goPrev);
    document.getElementById('page-next-btn')?.addEventListener('click', goNext);
    document.getElementById('page-prev-btn-bottom')?.addEventListener('click', goPrev);
    document.getElementById('page-next-btn-bottom')?.addEventListener('click', goNext);

    document.getElementById('page-read-checkbox')?.addEventListener('change', (e) => {
        page['既読'] = e.target.checked;
        markUnsaved();
    });

    holder.querySelectorAll('.marker-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.color;
            markerColor = markerColor === key ? null : key; // もう一度押すとオフ
            renderPageView();
        });
    });

    document.getElementById('marker-delete-btn')?.addEventListener('click', () => {
        if (!pendingMarkClick) return;
        const { text, offset } = pendingMarkClick;
        page['ハイライト'] = (page['ハイライト'] || []).filter(h => !(highlightTextOf(h) === text && highlightOffsetOf(h) === offset));
        pendingMarkClick = null;
        markUnsaved();
        renderPageView();
    });

    document.getElementById('marker-cancel-btn')?.addEventListener('click', () => {
        pendingMarkClick = null;
        renderPageView();
    });

    document.getElementById('marker-edit-btn')?.addEventListener('click', () => {
        if (!pendingMarkClick) return;
        const { text, offset, color } = pendingMarkClick;
        const markEl = findMarkElement(holder, text, offset);
        pendingMarkClick = null;
        if (!markEl) { renderPageView(); return; }

        // ここではrenderPageView()を呼ばない：呼ぶとDOM全体が作り直され、
        // これから作るテキスト選択（ネイティブの開始・終了ハンドル）が消えてしまうため。
        markerColor = color;
        editingHighlight = { text, offset };

        const range = document.createRange();
        range.selectNodeContents(markEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    holder.querySelector('.page-body')?.addEventListener('click', (e) => {
        const mark = e.target.closest('.reader-highlight');
        if (!mark) return;
        const text = mark.dataset.highlight;
        const offsetAttr = mark.dataset.highlightOffset;
        const offset = offsetAttr === '' ? undefined : Number(offsetAttr);
        const color = mark.dataset.highlightColor;
        pendingMarkClick = { text, offset, color };
        renderPageView();
    });
}

// キーボードの左右矢印でもページ送りできるようにする（本文タブ表示中のみ）
document.addEventListener('keydown', (e) => {
    if (activeTab !== 'content' || selectedPages.length === 0) return;
    if (e.key === 'ArrowRight') document.getElementById('page-next-btn')?.click();
    if (e.key === 'ArrowLeft')  document.getElementById('page-prev-btn')?.click();
});

// ページ移動前に未保存の既読チェックがあれば知らせる
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
});

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        setTokenInput(saved);
        loadBooks(saved, true);
    }
});
