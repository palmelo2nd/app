// 現在のバージョン: 2
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（diary/book等と同じ方式）。
import {
    loadToken, saveToken, loadIndex, saveIndex, loadFile, saveFileCache, removeFileCache,
    loadPending, setPending, loadDrafts, setDraft
} from './modules/storage.js?v=2';
import { listFiles, fetchFile, saveFile } from './modules/github.js?v=2';
import {
    NOTE_DIR, CATEGORIES, parseNote, stringifyNote, noteTitle, noteTags, parseTagInput,
    nowStamp, newNoteId, makeNotePath, normalizeForSearch, matchesSearch, snippetFor
} from './modules/noteModel.js?v=2';
import { renderMarkdown } from './modules/markdown.js?v=2';

// 画面右上の「vバッジ」表示（import.meta.urlの?v=Nから取得。diary/bookと同じ方式）
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
// 読むデータリポジトリ。用途別INDEX（index_my／index_fam／index_save）が開いたときに保存した値。未設定ならapp_data（diaryと同じ）
const REPO  = (() => { try { return localStorage.getItem('app_data_repo') || 'app_data'; } catch { return 'app_data'; } })();
const FETCH_CONCURRENCY = 6; // 変わったノートを取り直すときの同時通信数

// ===== 状態 =====
// note = { path, sha, meta, body, isNew, pending, conflict, searchText }
//   sha：GitHub上の最新として知っているSHA（新規で未送信ならnull）
//   pending：端末にだけある保存（GitHubへ未送信）。conflict：送ろうとしたら他端末で変わっていた
let notes = new Map();      // パス -> note
let selectedPath = '';      // 開いているノート
let editState = null;       // 編集中なら { path, baseSha }。baseSha＝編集を始めたときのSHA（保存時の衝突検出に使う）
let filterCategory = '';    // '' = すべて
let searchQuery = '';

const layoutEl   = document.getElementById('layout');
const listEl     = document.getElementById('note-list');
const countEl    = document.getElementById('list-count');
const chipsEl    = document.getElementById('category-chips');
const searchEl   = document.getElementById('search-input');
const notePaneEl = document.getElementById('note-pane');
const tokenInput = document.getElementById('token-input-top');

// ===== 小道具 =====

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateLabel(stamp) { // 'YYYY/MM/DD HH:MM' -> 今年なら 'M/D'、それ以外は 'YYYY/M/D'
    const m = String(stamp || '').match(/^(\d{4})\/(\d{2})\/(\d{2})/);
    if (!m) return '';
    return Number(m[1]) === new Date().getFullYear() ? `${Number(m[2])}/${Number(m[3])}` : `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

let toastTimer = null;
function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.toggle('toast--error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
}

function getToken() { return tokenInput.value.trim() || loadToken() || ''; }

function setNetworkStatus(html) {
    document.querySelectorAll('.js-network-status').forEach(el => { el.innerHTML = html; });
}

/** 通信できなかった（圏外など）エラーか。HTTPの応答があったエラーはstatusを持つ。 */
function isNetworkError(error) { return !error.status; }

/** 同時通信数を絞って順に処理する。 */
async function runPool(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) await worker(items[next++]);
    });
    await Promise.all(runners);
}

function makeNote(path, text, sha) {
    const { meta, body } = parseNote(text);
    return { path, sha, meta, body, isNew: false, pending: false, conflict: false, searchText: null };
}

function findNoteByKey(key) {
    if (!key) return null;
    for (const note of notes.values()) if (note.meta.id === key || note.path === key) return note;
    return null;
}

function noteKey(note) { return note.meta.id || note.path; }

function pendingCount() { return [...notes.values()].filter(n => n.pending).length; }

function showStatus(online) {
    const count = pendingCount();
    if (count) setNetworkStatus(`<span class="status-badge unsaved-badge">未送信 ${count}件</span>`);
    else if (online) setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
    else setNetworkStatus('<span class="status-badge offline-badge">オフライン（端末内のデータ）</span>');
}

// ===== 読み込み =====

/** 端末に保存してあるノート（＋未送信の保存・新規の下書き）から状態を作る。 */
function loadFromCache() {
    const index = loadIndex();
    const pending = loadPending();
    const next = new Map();
    Object.entries(index).forEach(([path, sha]) => {
        const text = loadFile(path);
        if (text !== null) next.set(path, makeNote(path, text, sha));
    });
    Object.entries(pending).forEach(([path, p]) => {
        const note = makeNote(path, p.text, next.get(path)?.sha ?? null);
        note.isNew = !next.has(path) && !p.baseSha;
        note.pending = true;
        note.conflict = !!p.conflict;
        next.set(path, note);
    });
    Object.entries(loadDrafts()).forEach(([path, d]) => {
        if (d.isNew && !next.has(path)) {
            const note = { path, sha: null, meta: { ...d.meta }, body: d.body || '', isNew: true, pending: false, conflict: false, searchText: null };
            next.set(path, note);
        }
    });
    notes = next;
}

/**
 * GitHubから一覧（SHA付き）を取り、SHAが変わったノートだけ本文を取り直す。そのあと未送信の保存を送る。
 * (2) インプット: token, silent（trueなら失敗時にalertを出さない）
 */
async function loadAll(token, silent = true) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }
    setNetworkStatus('<span class="status-badge offline-badge">読み込み中…</span>');
    try {
        const files = (await listFiles(token, OWNER, REPO, NOTE_DIR)).filter(f => /\.md$/i.test(f.name));
        const oldIndex = loadIndex();
        const fetched = new Map();
        const changed = files.filter(f => oldIndex[f.path] !== f.sha || loadFile(f.path) === null);
        await runPool(changed, FETCH_CONCURRENCY, async (f) => {
            const { content, sha } = await fetchFile(token, OWNER, REPO, f.path);
            fetched.set(f.path, { content, sha });
        });

        const pending = loadPending();
        const newIndex = {};
        const next = new Map();
        files.forEach(f => {
            const got = fetched.get(f.path);
            const text = got ? got.content : loadFile(f.path);
            const sha = got ? got.sha : f.sha;
            if (got) saveFileCache(f.path, text);
            newIndex[f.path] = sha;
            const note = makeNote(f.path, text, sha);
            if (pending[f.path]) { // 端末の未送信の保存を優先して表示する（送るときに衝突を調べる）
                Object.assign(note, parseNote(pending[f.path].text), { pending: true, conflict: !!pending[f.path].conflict });
            }
            next.set(f.path, note);
        });
        Object.keys(oldIndex).forEach(path => { if (!(path in newIndex)) removeFileCache(path); }); // 他端末で消されたノート
        // GitHubにまだ無い新規ノート（未送信・下書き）は残す
        notes.forEach((note, path) => { if (!next.has(path) && note.isNew) next.set(path, note); });
        saveIndex(newIndex);
        notes = next;

        await flushPending(token);
        showStatus(true);
    } catch (error) {
        console.error(error);
        if (isNetworkError(error)) {
            showStatus(false);
            if (!silent) alert('通信できませんでした。端末内に保存されているノートを表示します。');
        } else {
            setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
            if (!silent) alert(`読み込めませんでした（${error.message}）。トークンの権限（${OWNER}/${REPO}）を確認してください。`);
        }
    }
    renderAll();
}

// ===== 保存 =====

/**
 * 1件をGitHubへ送る。成功したら端末の一覧とSHAを更新する。
 * (2) インプット: token, note, text（ファイル全文）, baseSha（編集前のSHA。新規はnull）
 * (4) アウトプット: 'saved' | 'offline' | 'conflict'
 */
async function pushNote(token, note, text, baseSha) {
    try {
        const { newSha } = await saveFile(token, OWNER, REPO, note.path, text, baseSha,
            `docs: ナレッジアプリから${baseSha ? '更新' : '追加'}（${noteTitle(note)}）`);
        note.sha = newSha;
        note.isNew = false;
        note.pending = false;
        note.conflict = false;
        saveFileCache(note.path, text);
        const index = loadIndex();
        index[note.path] = newSha;
        saveIndex(index);
        setPending(note.path, null);
        return 'saved';
    } catch (error) {
        if (isNetworkError(error)) return 'offline';
        if (error.status === 409 || error.status === 422) return 'conflict';
        throw error;
    }
}

/** 端末に残っている未送信の保存を、古いものから順に送る。圏外なら途中でやめる。 */
async function flushPending(token) {
    const pending = loadPending();
    for (const [path, p] of Object.entries(pending)) {
        const note = notes.get(path);
        if (!note || p.conflict) continue;
        const result = await pushNote(token, note, p.text, p.baseSha);
        if (result === 'offline') break;
        if (result === 'conflict') {
            note.conflict = true;
            setPending(path, { ...p, conflict: true });
        }
    }
}

/**
 * 編集した内容を保存する。まず端末に反映し、GitHubへ送れなければ「未送信」として残す。
 * (2) インプット: note, meta（新しい属性）, body
 */
async function saveNote(note, meta, body) {
    const baseSha = editState?.baseSha ?? note.sha ?? null;
    meta.updated = nowStamp();
    if (!meta.created) meta.created = meta.updated;

    if (note.isNew) { // 新規は保存のときにファイル名を決める（題名を入れ直しても追従する）
        const newPath = makeNotePath(meta.id, meta.title);
        if (newPath !== note.path) {
            setDraft(note.path, null);
            notes.delete(note.path);
            note.path = uniquePath(newPath);
            notes.set(note.path, note);
        }
    }

    const text = stringifyNote(meta, body);
    note.meta = meta;
    note.body = body;
    note.searchText = null;
    note.pending = true;
    // 未送信が既にあるなら、最初の未送信のときの基準SHAを使い続ける（途中の版はGitHubに無いため）
    const prev = loadPending()[note.path];
    const pendingBase = prev ? prev.baseSha : baseSha;
    setPending(note.path, { text, baseSha: pendingBase });
    setDraft(note.path, null);
    editState = null;
    selectedPath = note.path;

    const token = getToken();
    if (!token) {
        toast('トークンが無いため、端末にだけ保存しました');
        showStatus(false);
        return;
    }
    const result = await pushNote(token, note, text, pendingBase);
    if (result === 'saved') toast('保存しました');
    else if (result === 'offline') toast('圏外のため端末に保存しました。次に読込・保存したときに送ります');
    else {
        note.conflict = true;
        setPending(note.path, { text, baseSha: pendingBase, conflict: true });
        toast('他の端末で変更されていたため、送れませんでした', true);
    }
    showStatus(result !== 'offline');
}

/** 同じパスのノートが既にあれば「 2」「 3」…を付ける（新規作成で同じ秒・同じ題名が重なったとき用）。 */
function uniquePath(path) {
    if (!notes.has(path)) return path;
    for (let n = 2; ; n++) {
        const candidate = path.replace(/\.md$/, ` ${n}.md`);
        if (!notes.has(candidate)) return candidate;
    }
}

/**
 * 衝突の解消。
 * (2) インプット: note, choice — 'theirs'：GitHubの版を読み込む（端末の変更は捨てる）／'mine'：端末の版を別のノートとして保存し、元のノートはGitHubの版にする
 */
async function resolveConflict(note, choice) {
    const token = getToken();
    if (!token) return alert('トークンを入力してください');
    const mine = loadPending()[note.path];
    try {
        const remote = await fetchFile(token, OWNER, REPO, note.path);
        if (choice === 'mine' && mine) {
            const { meta, body } = parseNote(mine.text);
            const copyMeta = { ...meta, id: newNoteId(), title: `${meta.title || noteTitle(note)}（自分の版）`, created: '' };
            const copy = { path: '', sha: null, meta: copyMeta, body, isNew: true, pending: false, conflict: false, searchText: null };
            copy.path = uniquePath(makeNotePath(copyMeta.id, copyMeta.title));
            notes.set(copy.path, copy);
            editState = null;
            await saveNote(copy, copyMeta, body);
        }
        const fresh = makeNote(note.path, remote.content, remote.sha);
        notes.set(note.path, fresh);
        saveFileCache(note.path, remote.content);
        const index = loadIndex();
        index[note.path] = remote.sha;
        saveIndex(index);
        setPending(note.path, null);
        if (choice === 'theirs') selectedPath = note.path;
        toast(choice === 'mine' ? '自分の版を別のノートとして保存しました' : 'GitHubの版を読み込みました');
    } catch (error) {
        console.error(error);
        toast('解消できませんでした：' + error.message, true);
    }
    showStatus(true);
    renderAll();
}

// ===== 描画：一覧 =====

function searchTerms() {
    return searchQuery.split(/\s+/).map(normalizeForSearch).filter(Boolean);
}

function visibleNotes() {
    const terms = searchTerms();
    return [...notes.values()]
        .filter(n => !filterCategory || n.meta.category === filterCategory)
        .filter(n => matchesSearch(n, terms))
        .sort((a, b) => String(b.meta.updated || '').localeCompare(String(a.meta.updated || '')) || noteTitle(a).localeCompare(noteTitle(b), 'ja'));
}

function renderCategoryChips() {
    const all = [...notes.values()];
    const options = [['', 'すべて', all.length], ...CATEGORIES.map(c => [c, c, all.filter(n => n.meta.category === c).length])];
    chipsEl.innerHTML = options.map(([value, label, count]) =>
        `<button type="button" class="chip${filterCategory === value ? ' active' : ''}" data-category="${escapeHtml(value)}">${escapeHtml(label)} ${count}</button>`
    ).join('');
}

function renderList() {
    renderCategoryChips();
    const list = visibleNotes();
    const firstTerm = searchQuery.trim().split(/\s+/)[0] || '';
    countEl.textContent = searchQuery.trim() ? `${list.length}件が見つかりました` : `${list.length}件`;
    if (list.length === 0) {
        listEl.innerHTML = `<p class="placeholder">${notes.size === 0 ? 'ノートがありません。トークンを入れて「読込」を押すか、「新規」で作ってください。' : '見つかりませんでした。'}</p>`;
        return;
    }
    listEl.innerHTML = list.map(n => {
        const tags = noteTags(n).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
        const mark = n.conflict ? '<span class="pending-mark">衝突</span>' : n.pending ? '<span class="pending-mark">未送信</span>' : n.isNew ? '<span class="pending-mark">下書き</span>' : '';
        return `<button type="button" class="note-row${n.path === selectedPath ? ' active' : ''}" data-key="${escapeHtml(noteKey(n))}">
            <div class="note-row-head"><span class="note-row-title">${escapeHtml(noteTitle(n) || '（無題）')}</span><span class="note-row-date">${escapeHtml(dateLabel(n.meta.updated))}</span></div>
            <div class="note-row-sub">${mark}${tags}<span class="note-row-snippet">${escapeHtml(snippetFor(n.body, firstTerm))}</span></div>
        </button>`;
    }).join('');
}

// ===== 描画：ノート =====

function renderNote() {
    const note = notes.get(selectedPath);
    layoutEl.classList.toggle('show-note', !!note);
    if (!note || !(editState && editState.path === note.path)) delete notePaneEl.dataset.editing;
    if (!note) {
        notePaneEl.innerHTML = '<div class="panel"><p class="placeholder">一覧からノートを選んでください。</p></div>';
        return;
    }
    if (editState && editState.path === note.path) {
        // 編集フォームを表示中なら描き直さない（読込が裏で終わっても、入力中の文字やカーソルを消さないため）
        if (notePaneEl.dataset.editing !== note.path) renderEditor(note);
    } else {
        renderViewer(note);
    }
}

function backButtonHtml() {
    return '<button type="button" class="btn btn-sub btn-small back-btn" data-action="back">← 一覧</button>';
}

function renderViewer(note) {
    const draft = loadDrafts()[note.path];
    const tags = noteTags(note).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    const notices = [];
    if (note.conflict) {
        notices.push(`<div class="notice">他の端末でこのノートが変更されていたため、この端末の保存を送れていません（今表示しているのはこの端末の版です）。
            <div class="edit-actions">
              <button type="button" class="btn btn-sub btn-small" data-action="conflict-theirs">GitHubの版を読み込む（この端末の変更は捨てる）</button>
              <button type="button" class="btn btn-primary btn-small" data-action="conflict-mine">この端末の版を別のノートとして保存</button>
            </div></div>`);
    } else if (note.pending) {
        notices.push('<div class="notice">この端末にだけ保存されています（GitHubへ未送信）。オンラインで「保存」か「読込」を押すと送ります。</div>');
    }
    if (draft && !note.isNew) {
        notices.push(`<div class="notice">保存していない編集の下書きがあります。
            <div class="edit-actions">
              <button type="button" class="btn btn-sub btn-small" data-action="discard-draft">下書きを捨てる</button>
              <button type="button" class="btn btn-primary btn-small" data-action="edit">下書きの続きを編集</button>
            </div></div>`);
    }
    notePaneEl.innerHTML = `<div class="panel">
        <div class="note-head">${backButtonHtml()}<h2 class="note-title">${escapeHtml(noteTitle(note) || '（無題）')}</h2>
          <button type="button" class="btn btn-sub btn-small" data-action="edit">編集</button></div>
        <div class="note-meta">${note.meta.category ? `<span>${escapeHtml(note.meta.category)}</span>` : ''}${tags}
          ${note.meta.updated ? `<span>更新 ${escapeHtml(note.meta.updated)}</span>` : ''}</div>
        ${notices.join('')}
        <div class="md">${renderMarkdown(note.body) || '<p class="placeholder">（本文なし）</p>'}</div>
      </div>`;
}

function renderEditor(note) {
    const draft = loadDrafts()[note.path];
    const meta = draft ? draft.meta : note.meta;
    const body = draft ? draft.body : note.body;
    const categoryOptions = CATEGORIES.map(c => `<option value="${escapeHtml(c)}"${meta.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    notePaneEl.innerHTML = `<div class="panel">
        <div class="edit-row">${backButtonHtml()}
          <input type="text" class="form-input edit-title" id="edit-title" placeholder="題名" value="${escapeHtml(meta.title || (note.isNew ? '' : noteTitle(note)))}"></div>
        <div class="edit-row">
          <select class="form-select" id="edit-category">${categoryOptions}</select>
          <input type="text" class="form-input edit-tags" id="edit-tags" placeholder="タグ（カンマ区切り）" value="${escapeHtml(noteTags({ meta }).join(', '))}">
        </div>
        <textarea class="form-textarea edit-body" id="edit-body" placeholder="本文（Markdown）">${escapeHtml(body)}</textarea>
        <div class="edit-actions">
          <button type="button" class="btn btn-sub" data-action="cancel-edit">キャンセル</button>
          <button type="button" class="btn btn-primary" data-action="save">保存</button>
        </div>
        <p class="edit-note">書きかけの内容は、この端末に下書きとして自動で残ります。</p>
      </div>`;
    notePaneEl.dataset.editing = note.path;
    if (note.isNew && !meta.title) document.getElementById('edit-title').focus();
}

/** 編集フォームの今の値（属性と本文）。 */
function readEditor(note) {
    const meta = { ...note.meta };
    meta.title = document.getElementById('edit-title').value.trim();
    meta.category = document.getElementById('edit-category').value;
    meta.tags = parseTagInput(document.getElementById('edit-tags').value);
    return { meta, body: document.getElementById('edit-body').value };
}

function renderAll() {
    renderList();
    renderNote();
}

// ===== 画面の切り替え（URLの#でノートを指す。iPhoneの戻る操作で一覧に戻れるように） =====

function openNote(key) {
    const target = `#${encodeURIComponent(key)}`;
    if (location.hash === target) route();
    else location.hash = target;
}

function route() {
    const key = decodeURIComponent(location.hash.slice(1));
    const note = findNoteByKey(key);
    const nextPath = note ? note.path : '';
    if (editState && editState.path !== nextPath) editState = null; // 別のノートへ移ったら編集をやめる（下書きは残る）
    selectedPath = nextPath;
    renderAll();
    if (note) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

// ===== 操作 =====

searchEl.addEventListener('input', () => { searchQuery = searchEl.value; renderList(); });

chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    filterCategory = btn.dataset.category;
    renderList();
});

listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.note-row');
    if (row) openNote(row.dataset.key);
});

document.getElementById('new-btn').addEventListener('click', () => {
    const id = newNoteId();
    const meta = { id, title: '', category: filterCategory || CATEGORIES[0], tags: [] };
    const note = { path: uniquePath(makeNotePath(id, '')), sha: null, meta, body: '', isNew: true, pending: false, conflict: false, searchText: null };
    notes.set(note.path, note);
    editState = { path: note.path, baseSha: null };
    setDraft(note.path, { meta, body: '', isNew: true });
    openNote(noteKey(note));
});

notePaneEl.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.md-copy-btn');
    if (copyBtn) return copyCode(copyBtn);

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const note = notes.get(selectedPath);
    const action = btn.dataset.action;

    if (action === 'back') {
        if (history.length > 1 && location.hash) history.back();
        else location.hash = '';
        return;
    }
    if (!note) return;

    if (action === 'edit') {
        editState = { path: note.path, baseSha: note.pending ? (loadPending()[note.path]?.baseSha ?? null) : note.sha };
        renderNote();
    } else if (action === 'cancel-edit') {
        const draft = loadDrafts()[note.path];
        const { meta, body } = readEditor(note);
        const changed = body !== note.body || meta.title !== (note.meta.title || '') || meta.category !== note.meta.category
            || noteTags({ meta }).join(',') !== noteTags(note).join(',');
        if ((changed || draft) && !confirm('編集した内容を捨てますか？')) return;
        setDraft(note.path, null);
        editState = null;
        if (note.isNew && !note.pending) { // 一度も保存していない新規は消す
            notes.delete(note.path);
            location.hash = '';
            return;
        }
        renderAll();
    } else if (action === 'save') {
        const { meta, body } = readEditor(note);
        if (!meta.title) meta.title = '無題';
        btn.disabled = true;
        try {
            await saveNote(note, meta, body);
        } catch (error) {
            console.error(error);
            toast('保存できませんでした：' + error.message, true);
        }
        const key = noteKey(note);
        if (location.hash !== `#${encodeURIComponent(key)}`) history.replaceState(null, '', `#${encodeURIComponent(key)}`);
        renderAll();
    } else if (action === 'discard-draft') {
        if (!confirm('下書きを捨てますか？')) return;
        setDraft(note.path, null);
        renderNote();
    } else if (action === 'conflict-theirs') {
        if (!confirm('この端末の変更を捨てて、GitHubの版を読み込みますか？')) return;
        await resolveConflict(note, 'theirs');
    } else if (action === 'conflict-mine') {
        await resolveConflict(note, 'mine');
    }
});

// 編集中の内容は入力のたびに下書きとして端末に残す（iPhoneでタブが再読み込みされても消えないように）
notePaneEl.addEventListener('input', (e) => {
    if (!editState || !e.target.closest('#edit-title, #edit-category, #edit-tags, #edit-body')) return;
    const note = notes.get(editState.path);
    if (!note) return;
    const { meta, body } = readEditor(note);
    setDraft(note.path, { meta, body, isNew: note.isNew });
});

async function copyCode(btn) {
    const code = btn.parentElement.querySelector('code')?.textContent ?? '';
    try {
        await navigator.clipboard.writeText(code);
    } catch (_) { // 古い環境向け
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    btn.textContent = 'コピーしました';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'コピー'; btn.classList.remove('done'); }, 1500);
}

// ===== 上部バー =====

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getToken();
        if (!token) return alert('トークンを入力してください');
        tokenInput.value = token;
        saveToken(token);
        loadAll(token, false);
    });
});

// 「保存」：トークンを端末に覚え、未送信の保存があれば送る
document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const token = tokenInput.value.trim();
        if (!token) return alert('トークンを入力してください');
        saveToken(token);
        if (pendingCount() === 0) { toast('トークンを保存しました'); return; }
        try {
            await flushPending(token);
        } catch (error) {
            console.error(error);
            toast('送れませんでした：' + error.message, true);
        }
        const left = pendingCount();
        toast(left ? `未送信が${left}件残っています` : '未送信の保存をすべて送りました', !!left);
        showStatus(true);
        renderAll();
    });
});

document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？（ノートと未送信の保存は消えません）')) return;
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

// ===== 起動 =====
{
    const saved = loadToken();
    if (saved) tokenInput.value = saved;
    loadFromCache();
    showStatus(false);
    route();
    if (saved) loadAll(saved, true);
}
