// 操作ノート（2026-11-18、brain #1706）。スマホ・パソコンで教えた操作を、分類ごとに1項目＝1ページで残す本のようなノート。
// 本文（題・問い・答え・本文）はbookスレッドがデータに書く。アプリからは各項目にメモを書き足すだけ。
// データは用途のデータリポジトリ（save向けはsave_data）の opnote/notes.md。
// JS/CSSを変更した際は、index.html・このファイルのimportの?v=Nを全部同じ新しい値に揃えること（brain等と同じ方式）。
import { fetchFile, saveFile } from './modules/github.js?v=2';
import { loadToken, saveToken, loadMyName, saveMyName, loadCache, saveCache, loadLast, saveLast } from './modules/storage.js?v=2';
import { emptyNote, parseFrontMatter, stringify, sortedCategories, itemsOf, applyOp } from './modules/noteModel.js?v=2';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
// 読むデータリポジトリ。Index（index_save など）が用途に合わせて書き込む。未設定ならapp_data
const REPO = (() => { try { return localStorage.getItem('app_data_repo') || 'app_data'; } catch { return 'app_data'; } })();
const NOTE_PATH = 'opnote/notes.md';

let note = null;
let categoryId = '';
let itemId = '';
let busy = false;

const view = document.getElementById('note-view');

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getToken() {
    return document.querySelector('.js-token-input')?.value.trim() || '';
}

function setNetworkStatus(html) {
    const el = document.getElementById('network-status-top');
    if (el) el.innerHTML = html;
}

function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

function md(text) {
    return window.marked ? window.marked.parse(text || '') : `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

// ===== 読込 =====

async function loadNote(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }
    try {
        const { content, sha } = await fetchFile(token, OWNER, REPO, NOTE_PATH);
        note = parseFrontMatter(content).data;
        saveCache(content, sha);
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
    } catch (error) {
        if (error.status === 404) {
            note = emptyNote();
            setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        } else {
            console.error(error);
            const cached = loadCache();
            if (cached) {
                note = parseFrontMatter(cached.content).data;
                setNetworkStatus('<span class="status-badge offline-badge">オフライン（見るだけ）</span>');
                if (!silent) alert('通信できませんでした。この端末に残っている前回の内容を出します（メモは電波のある所で）。');
            } else {
                setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
                if (!silent) alert(`読み込みに失敗しました（${error.message}）。トークンが「${OWNER}/${REPO}」を読めるか確認してください。`);
                return;
            }
        }
    }
    // 前回の続きから。URLの ?c=分類 があればそれを優先（スキルマップからのリンク用）
    const last = loadLast();
    const cats = sortedCategories(note);
    const wanted = new URLSearchParams(location.search).get('c');
    categoryId = [wanted, last.categoryId].find(c => cats.some(x => x.ID === c)) || cats[0]?.ID || '';
    const items = itemsOf(note, categoryId);
    itemId = items.some(it => it.ID === last.itemId) ? last.itemId : items[0]?.ID || '';
    render();
}

// ===== メモの書き込み：取り直して当てて保存（2人が同時に書いても消し合わないため） =====

async function commit(op, message) {
    const token = getToken();
    if (!token) { alert('トークンを入力してください'); return false; }
    if (!loadMyName()) { alert('先に「設定」で自分の名前を入れてください'); return false; }
    if (busy) return false;
    busy = true;
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const file = await fetchFile(token, OWNER, REPO, NOTE_PATH);
            const { data, tail } = parseFrontMatter(file.content);
            const next = applyOp(data, op, loadMyName());
            const text = stringify(next, tail);
            try {
                const { newSha } = await saveFile(token, OWNER, REPO, NOTE_PATH, text, file.sha, `docs: 操作ノート ${message}`);
                note = next;
                saveCache(text, newSha);
                setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
                return true;
            } catch (error) {
                if (error.status === 409 && attempt === 0) continue; // 他の人が同時に保存した：取り直してもう一度
                throw error;
            }
        }
    } catch (error) {
        console.error(error);
        alert(`保存できませんでした（${error.message}）。電波のある所でもう一度お試しください。`);
    } finally {
        busy = false;
    }
    return false;
}

// ===== 表示 =====

function renderTabs() {
    return `<div class="cat-tabs">${sortedCategories(note).map(c => `
        <button type="button" class="cat-tab${c.ID === categoryId ? ' active' : ''}" data-cat="${c.ID}">
            ${escapeHtml(c['名前'])}<span class="cat-count">${itemsOf(note, c.ID).length}</span>
        </button>`).join('')}</div>`;
}

function renderList(items) {
    if (!items.length) return '<p class="sub">まだ項目がありません。教えた操作が、ここに増えていきます。</p>';
    return `<ol class="item-list">${items.map(it => `
        <li><button type="button" class="item-link${it.ID === itemId ? ' active' : ''}" data-item="${it.ID}">
            ${escapeHtml(it['題'])}${(it['メモ'] || []).length ? `<span class="memo-count">メモ${it['メモ'].length}</span>` : ''}
        </button></li>`).join('')}</ol>`;
}

function renderPage(items) {
    const idx = items.findIndex(it => it.ID === itemId);
    if (idx < 0) return '';
    const it = items[idx];
    const me = loadMyName();
    const memos = (it['メモ'] || []).map(m => `
        <div class="memo">
            <div class="memo-head">${escapeHtml(m['書いた人'])}・${escapeHtml(m['日時'])}
                ${m['書いた人'] === me ? `<button type="button" class="link-btn" data-del-memo="${m.ID}">削除</button>` : ''}</div>
            <div class="memo-body">${escapeHtml(m['本文']).replace(/\n/g, '<br>')}</div>
        </div>`).join('');
    const nav = (where) => `<div class="page-nav ${where}">
        <button type="button" class="nav-btn" data-go="${idx - 1}" ${idx === 0 ? 'disabled' : ''}>← 前</button>
        <span class="page-pos">${idx + 1} / ${items.length}</span>
        <button type="button" class="nav-btn" data-go="${idx + 1}" ${idx === items.length - 1 ? 'disabled' : ''}>次 →</button>
    </div>`;
    return `<article class="panel page">
        ${nav('top')}
        <h2 class="page-title">${escapeHtml(it['題'])}</h2>
        ${it['問い'] || it['答え'] ? `<div class="qa">
            ${it['問い'] ? `<div class="qa-row"><span class="qa-label q">問い</span><span>${escapeHtml(it['問い'])}</span></div>` : ''}
            ${it['答え'] ? `<div class="qa-row"><span class="qa-label a">答え</span><span class="qa-answer">${escapeHtml(it['答え'])}</span></div>` : ''}
        </div>` : ''}
        <div class="page-body">${md(it['本文'])}</div>
        ${it['登録日'] ? `<div class="sub">教えた日：${escapeHtml(it['登録日'])}</div>` : ''}
        <section class="memos">
            <div class="field-label">メモ（気づいたこと・つまずいたこと）</div>
            ${memos || '<p class="sub">まだメモはありません。</p>'}
            <textarea id="memo-input" rows="3" maxlength="500" placeholder="例：右クリックでもコピーできた"></textarea>
            <button type="button" class="primary-btn" id="memo-add-btn">メモを追加</button>
        </section>
        ${nav('bottom')}
    </article>`;
}

function renderSettings() {
    return `<details class="panel settings">
        <summary>設定・使い方</summary>
        <div class="field-label">自分の名前（メモを書いた人として残ります）</div>
        <div class="row">
            <input type="text" id="my-name-input" value="${escapeHtml(loadMyName())}" maxlength="20">
            <button type="button" class="sub-btn" id="my-name-btn">保存</button>
        </div>
        <ul class="help">
            <li>上の「スマホ」「パソコン」で分類を切り替え、一覧から項目を選びます</li>
            <li>「前」「次」で1項目ずつめくれます</li>
            <li>やってみて気づいたことは、各項目の「メモ」に書き足せます（消せるのは自分のメモだけ）</li>
        </ul>
    </details>`;
}

function render() {
    if (!note) return;
    const items = itemsOf(note, categoryId);
    if (!items.some(it => it.ID === itemId)) itemId = items[0]?.ID || '';
    saveLast({ categoryId, itemId });
    const current = items.find(it => it.ID === itemId);
    view.innerHTML = `
        ${renderTabs()}
        <div class="layout">
            <details class="panel list-panel" ${current ? '' : 'open'}>
                <summary>項目の一覧（${items.length}）</summary>
                ${renderList(items)}
            </details>
            <div class="main-col">${renderPage(items)}</div>
        </div>
        ${renderSettings()}
    `;
    // 広い画面では一覧を常に開いておく
    if (window.matchMedia('(min-width: 760px)').matches) view.querySelector('.list-panel')?.setAttribute('open', '');
    bindEvents(items);
}

function bindEvents(items) {
    view.querySelectorAll('.cat-tab').forEach(b => b.addEventListener('click', () => {
        categoryId = b.dataset.cat; itemId = ''; render();
    }));
    view.querySelectorAll('.item-link').forEach(b => b.addEventListener('click', () => {
        itemId = b.dataset.item; render();
        view.querySelector('.page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    view.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => {
        const it = items[Number(b.dataset.go)];
        if (it) { itemId = it.ID; render(); view.querySelector('.page')?.scrollIntoView({ block: 'start' }); }
    }));
    document.getElementById('memo-add-btn')?.addEventListener('click', async () => {
        const body = document.getElementById('memo-input').value.trim();
        if (!body) { alert('メモを書いてください'); return; }
        if (await commit({ type: 'addMemo', itemId, body }, 'メモを追加')) { render(); toast('メモを追加しました'); }
    });
    view.querySelectorAll('[data-del-memo]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('このメモを消します。よろしいですか？')) return;
        if (await commit({ type: 'deleteMemo', itemId, memoId: b.dataset.delMemo }, 'メモを削除')) { render(); toast('消しました'); }
    }));
    document.getElementById('my-name-btn')?.addEventListener('click', () => {
        saveMyName(document.getElementById('my-name-input').value.trim());
        toast('名前を保存しました');
        render();
    });
}

// ===== 上のバー =====

document.querySelectorAll('.js-load-btn').forEach(btn => btn.addEventListener('click', () => loadNote(getToken())));

document.querySelectorAll('.js-save-btn').forEach(btn => btn.addEventListener('click', () => {
    const token = getToken();
    if (!token) { alert('トークンを入力してください'); return; }
    saveToken(token);
    btn.textContent = '保存しました';
    setTimeout(() => { btn.textContent = '保存'; }, 1200);
}));

document.querySelectorAll('.js-cache-reset-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
    try {
        // 自分の名前で始まるキャッシュとService Workerだけを消す（ルートCLAUDE.mdの決まり。今は使っていない）
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter(k => k.startsWith('opnote-')).map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.filter(r => r.scope.startsWith(new URL('./', location.href).href)).map(r => r.unregister()));
        }
    } catch (error) {
        console.error(error);
    }
    location.href = location.pathname + '?nocache=' + Date.now();
}));

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        document.querySelector('.js-token-input').value = saved;
        loadNote(saved, true);
    } else {
        view.innerHTML = '<div class="panel"><p class="sub">トークンを入れて「読込」を押してください。</p></div>';
    }
});
