// 現在のバージョン: 2
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import {
    loadToken, saveToken, loadCache, saveCache, loadMyName, saveMyName,
    loadLastSeen, saveLastSeen, loadDraft, saveDraft
} from './modules/storage.js?v=2';
import { fetchFile, saveFile, listFileNames, saveBinary, fetchBlob, deleteFile } from './modules/github.js?v=2';
import {
    parseFrontMatter, stringifyDiaryFile, countChars, nowStamp, newId, sortNewestFirst, lastTouched, collectAuthors
} from './modules/dataModel.js?v=2';
import { compressPhoto } from './modules/photo.js?v=2';

// 画面右上の「vバッジ」表示（import.meta.urlの?v=Nから取得。brain/bookと同じ方式）
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const DIR   = 'diary';
const PHOTO_DIR = `${DIR}/photos`;
const yearPath = (year) => `${DIR}/${year}.md`;

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];
const PAGE_SIZE = 20; // 一覧に一度に出す記事数（「もっと見る」で追加）

// ===== 状態 =====
let yearData = {};          // 年 -> { diaryData, tail, sha }
let filterPerson = '';      // '' = すべて
let filterDate = '';        // '' または 'YYYY/MM/DD'
let calYear, calMonth;      // カレンダーに表示中の年・月（月は1〜12）
let showCount = PAGE_SIZE;
let editingId = '';         // 編集中の記事ID
let editingCommentId = '';  // 編集中のコメントID
let newIds = new Set();     // 新着（前回開いた後に他の人が書いた/直した）記事・コメントのID
let busy = false;
let composePhoto = null;    // 新規記事に添付する写真 { blob, base64 }
let editPhoto = null;       // 編集中の記事の写真の変更 { blob, base64 } / 'remove' / null（変更なし）
const photoUrls = new Map(); // 写真のパス -> blob URL（表示用、メモリ内だけ）

const diaryEl    = document.getElementById('diary-view');
const settingsEl = document.getElementById('settings-view');

{
    const t = new Date();
    calYear = t.getFullYear();
    calMonth = t.getMonth() + 1;
}

// ===== 小道具 =====

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function dateLabel(dateStr) { // 'YYYY/MM/DD' -> 'YYYY/MM/DD(曜)'
    const [y, m, d] = dateStr.split('/').map(Number);
    if (!y) return dateStr;
    return `${dateStr}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}
function stampLabel(stamp) { // 'YYYY/MM/DD HH:MM(:SS)' -> 'M/D HH:MM'
    const m = (stamp || '').match(/^\d{4}\/(\d{2})\/(\d{2}) (\d{2}:\d{2})/);
    return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}` : (stamp || '');
}
function todayInput() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
const inputToDate = (v) => (v || '').replace(/-/g, '/');   // 'YYYY-MM-DD' -> 'YYYY/MM/DD'
const dateToInput = (v) => (v || '').replace(/\//g, '-');  // 'YYYY/MM/DD' -> 'YYYY-MM-DD'

let toastTimer = null;
function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast' + (isError ? ' toast--error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2200);
}

function myName() { return loadMyName(); }

function allEntries() {
    return Object.values(yearData).flatMap(y => y.diaryData || []);
}

function findEntry(id) {
    return allEntries().find(e => e['ID'] === id);
}

// ===== トークン・ネットワークステータス =====

const tokenInput = document.querySelector('.js-token-input');
function getToken() { return tokenInput.value.trim() || loadToken() || ''; }
function setNetworkStatus(html) { const el = document.getElementById('network-status-top'); if (el) el.innerHTML = html; }

// ===== 読込（diary/配下の<西暦>.mdを全部読む） =====

function parseYears(names) {
    return names.map(n => (n.match(/^(\d{4})\.md$/) || [])[1]).filter(Boolean).sort();
}

function loadFromCache() {
    const cached = loadCache('years');
    if (!cached) return false;
    yearData = {};
    for (const year of parseYears(JSON.parse(cached.content))) {
        const c = loadCache(year);
        if (!c) continue;
        try {
            const { data, tail } = parseFrontMatter(c.content);
            yearData[year] = { diaryData: data.diaryData || [], tail, sha: c.sha };
        } catch (error) {
            console.error(error);
        }
    }
    return true;
}

// 前回開いた時刻より後に、他の人が書いた/直した記事・コメントを新着にする（初回は印を付けない）
function markNew(since) {
    if (!since) return;
    const me = myName();
    for (const e of allEntries()) {
        if (e['投稿者'] !== me && lastTouched(e) > since) newIds.add(e['ID']);
        for (const c of e['コメント'] || []) {
            if (c['投稿者'] !== me && lastTouched(c) > since) newIds.add(c['ID']);
        }
    }
}

async function loadAll(token, silent = true) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }
    try {
        const names = await listFileNames(token, OWNER, REPO, DIR);
        const years = parseYears(names);
        const next = {};
        await Promise.all(years.map(async (year) => {
            const { content, sha } = await fetchFile(token, OWNER, REPO, yearPath(year));
            const { data, tail } = parseFrontMatter(content);
            next[year] = { diaryData: data.diaryData || [], tail, sha };
            saveCache(year, content, sha);
        }));
        saveCache('years', JSON.stringify(names), '');
        yearData = next;
        const since = loadLastSeen();
        markNew(since);
        saveLastSeen(nowStamp());
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
    } catch (error) {
        console.error(error);
        setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
        if (!silent) alert('通信できませんでした（' + error.message + '）。端末内に保存されている前回のデータを表示します。');
    }
    renderDiary();
}

/**
 * 年ファイルを取り直して変更し、保存する。競合（409）は取り直して1回だけ再試行。
 * (2) インプット: year, mutate(diaryData) — 配列を直接書き換える。戻り値はそのまま返す
 */
async function updateYear(year, mutate, message) {
    const token = getToken();
    if (!token) throw new Error('トークンが入力されていません');
    for (let attempt = 0; attempt < 2; attempt++) {
        let diaryData = [], tail = '\n', sha;
        try {
            const file = await fetchFile(token, OWNER, REPO, yearPath(year));
            const parsed = parseFrontMatter(file.content);
            diaryData = parsed.data.diaryData || [];
            tail = parsed.tail;
            sha = file.sha;
        } catch (error) {
            if (error.status !== 404) throw error; // 404＝その年の最初の記事
        }
        const result = mutate(diaryData);
        const text = stringifyDiaryFile(diaryData, tail);
        try {
            const { newSha } = await saveFile(token, OWNER, REPO, yearPath(year), text, sha, message);
            yearData[year] = { diaryData, tail, sha: newSha };
            saveCache(year, text, newSha);
            const years = Object.keys(yearData).sort();
            saveCache('years', JSON.stringify(years.map(y => `${y}.md`)), '');
            return result;
        } catch (error) {
            if (error.status === 409 && attempt === 0) continue;
            throw error;
        }
    }
}

function requireEntry(diaryData, id) {
    const entry = diaryData.find(e => e['ID'] === id);
    if (!entry) throw new Error('記事が見つかりません（ほかの人が削除した可能性があります）');
    return entry;
}

// 通信を伴う操作の共通処理（二重押し防止・エラー表示・再描画）
async function run(task, doneMessage) {
    if (busy) return;
    if (!getToken()) return alert('トークンを入力してください');
    busy = true;
    diaryEl.classList.add('is-busy');
    try {
        await task();
        if (doneMessage) toast(doneMessage);
    } catch (error) {
        console.error(error);
        toast('保存できませんでした：' + error.message, true);
    } finally {
        busy = false;
        diaryEl.classList.remove('is-busy');
        renderDiary();
    }
}

async function uploadPhoto(entryId, photo) {
    const path = `${PHOTO_DIR}/${entryId}-${Date.now()}.jpg`;
    await saveBinary(getToken(), OWNER, REPO, path, photo.base64, 'docs: 日記アプリから写真を追加');
    photoUrls.set(path, photo.url);
    return path;
}

async function removePhoto(path) {
    if (!path) return;
    try {
        await deleteFile(getToken(), OWNER, REPO, path, 'docs: 日記アプリから写真を削除');
    } catch (error) {
        console.warn('写真の削除に失敗しました（記事の保存は完了しています）', error);
    }
}

// ===== 記事の操作 =====

async function postEntry(dateStr, body) {
    const me = myName();
    const id = newId();
    const stamp = nowStamp();
    const photoPath = composePhoto ? await uploadPhoto(id, composePhoto) : '';
    const entry = {
        'ID': id, '日付': dateStr, '投稿者': me, '本文': body,
        '投稿日時': stamp, '更新日時': stamp, '写真': photoPath, 'コメント': [], 'リアクション': {},
    };
    try {
        await updateYear(dateStr.slice(0, 4), d => { d.push(entry); }, 'docs: 日記を投稿');
    } catch (error) {
        await removePhoto(photoPath); // 記事が保存できなかったら写真も消す
        throw error;
    }
    composePhoto = null;
    saveDraft('post', null);
    // 書いた記事が見えるように絞り込みを合わせる
    if (filterDate && filterDate !== dateStr) filterDate = '';
    if (filterPerson && filterPerson !== me) filterPerson = '';
}

async function saveEdit(id, dateStr, body) {
    const old = findEntry(id);
    if (!old) throw new Error('記事が見つかりません');
    const oldYear = old['日付'].slice(0, 4);
    const newYear = dateStr.slice(0, 4);
    const oldPhoto = old['写真'] || '';
    let photoPath = oldPhoto;
    if (editPhoto === 'remove') photoPath = '';
    else if (editPhoto) photoPath = await uploadPhoto(id, editPhoto);

    const apply = (e) => {
        e['日付'] = dateStr;
        e['本文'] = body;
        e['写真'] = photoPath;
        e['更新日時'] = nowStamp();
    };
    if (oldYear === newYear) {
        await updateYear(oldYear, d => apply(requireEntry(d, id)), 'docs: 日記を編集');
    } else {
        // 年をまたいで日付を変えたときは、元の年ファイルから外して新しい年ファイルへ移す
        const moved = await updateYear(oldYear, d => {
            const e = requireEntry(d, id);
            d.splice(d.indexOf(e), 1);
            return e;
        }, 'docs: 日記を編集（年の移動）');
        apply(moved);
        await updateYear(newYear, d => { d.push(moved); }, 'docs: 日記を編集（年の移動）');
    }
    if (photoPath !== oldPhoto) await removePhoto(oldPhoto);
    editingId = '';
    editPhoto = null;
}

async function deleteEntry(id) {
    const entry = findEntry(id);
    if (!entry) return;
    await updateYear(entry['日付'].slice(0, 4), d => {
        const e = requireEntry(d, id);
        d.splice(d.indexOf(e), 1);
    }, 'docs: 日記を削除');
    await removePhoto(entry['写真']);
}

async function addComment(entryId, body) {
    const entry = findEntry(entryId);
    const stamp = nowStamp();
    const comment = { 'ID': newId(), '投稿者': myName(), '本文': body, '投稿日時': stamp, '更新日時': stamp };
    await updateYear(entry['日付'].slice(0, 4), d => {
        const e = requireEntry(d, entryId);
        (e['コメント'] = e['コメント'] || []).push(comment);
    }, 'docs: 日記にコメント');
    saveDraft('comment:' + entryId, null);
}

function requireComment(entry, commentId) {
    const c = (entry['コメント'] || []).find(x => x['ID'] === commentId);
    if (!c) throw new Error('コメントが見つかりません（ほかの人が削除した可能性があります）');
    return c;
}

async function saveCommentEdit(entryId, commentId, body) {
    const entry = findEntry(entryId);
    await updateYear(entry['日付'].slice(0, 4), d => {
        const c = requireComment(requireEntry(d, entryId), commentId);
        c['本文'] = body;
        c['更新日時'] = nowStamp();
    }, 'docs: 日記のコメントを編集');
    editingCommentId = '';
}

async function deleteComment(entryId, commentId) {
    const entry = findEntry(entryId);
    await updateYear(entry['日付'].slice(0, 4), d => {
        const e = requireEntry(d, entryId);
        const c = requireComment(e, commentId);
        e['コメント'].splice(e['コメント'].indexOf(c), 1);
    }, 'docs: 日記のコメントを削除');
}

async function toggleReaction(entryId, emoji) {
    const entry = findEntry(entryId);
    const me = myName();
    await updateYear(entry['日付'].slice(0, 4), d => {
        const e = requireEntry(d, entryId);
        const rx = e['リアクション'] = e['リアクション'] || {};
        const names = rx[emoji] || [];
        rx[emoji] = names.includes(me) ? names.filter(n => n !== me) : [...names, me];
        if (rx[emoji].length === 0) delete rx[emoji];
    }, 'docs: 日記にリアクション');
}

// ===== 画面：日記 =====

function filteredEntries() {
    return sortNewestFirst(allEntries()).filter(e =>
        (!filterPerson || e['投稿者'] === filterPerson) && (!filterDate || e['日付'] === filterDate));
}

function personNames() {
    const names = collectAuthors(allEntries());
    const me = myName();
    if (me && !names.includes(me)) names.unshift(me);
    return names;
}

function renderFilters() {
    const names = personNames();
    const chip = (value, label) =>
        `<button type="button" class="chip ${filterPerson === value ? 'active' : ''}" data-action="person" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    return `<div class="chips">${chip('', 'すべて')}${names.map(n => chip(n, n)).join('')}</div>`;
}

function renderCalendar() {
    // 記事がある日（人の絞り込みは反映する）に印を付ける
    const days = new Map();
    for (const e of allEntries()) {
        if (filterPerson && e['投稿者'] !== filterPerson) continue;
        days.set(e['日付'], (days.get(e['日付']) || 0) + 1);
    }
    const first = new Date(calYear, calMonth - 1, 1);
    const lastDay = new Date(calYear, calMonth, 0).getDate();
    const today = inputToDate(todayInput());
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal-cell empty"></span>');
    for (let d = 1; d <= lastDay; d++) {
        const ds = `${calYear}/${String(calMonth).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
        const cls = ['cal-cell', days.has(ds) ? 'has' : '', ds === filterDate ? 'selected' : '', ds === today ? 'today' : ''].join(' ');
        cells.push(`<button type="button" class="${cls}" data-action="date" data-value="${ds}">${d}${days.has(ds) ? '<i class="cal-dot"></i>' : ''}</button>`);
    }
    return `
        <div class="calendar">
            <div class="cal-head">
                <button type="button" class="cal-nav" data-action="cal-prev" aria-label="前の月">‹</button>
                <span class="cal-title">${calYear}年${calMonth}月</span>
                <button type="button" class="cal-nav" data-action="cal-next" aria-label="次の月">›</button>
            </div>
            <div class="cal-grid">
                ${WEEKDAYS.map((w, i) => `<span class="cal-week ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}
                ${cells.join('')}
            </div>
        </div>`;
}

function renderCompose() {
    const me = myName();
    if (!me) return '<p class="notice">記事を書くには、「設定」で名前を入れてください。</p>';
    const draft = loadDraft('post') || {};
    const body = draft.body || '';
    const date = draft.date || todayInput();
    const chars = countChars(body);
    return `
        <details class="compose" ${body ? 'open' : ''}>
            <summary>✏️ 記事を書く（${escapeHtml(me)}）</summary>
            <div class="form-row">
                <label class="form-label" for="compose-date">日付</label>
                <input type="date" id="compose-date" class="form-input" value="${escapeHtml(date)}">
            </div>
            <textarea id="compose-body" class="form-textarea" rows="8" placeholder="今日のできごと">${escapeHtml(body)}</textarea>
            <div class="char-count" id="compose-count">${chars.all} 文字（改行・空白を除くと ${chars.plain} 文字）</div>
            ${renderPhotoPicker('compose', composePhoto ? composePhoto.url : '')}
            ${body ? '<p class="draft-note">下書きはこの端末に自動で保存されています。</p>' : ''}
            <div class="form-actions">
                <button type="button" class="btn btn-primary" data-action="post">投稿</button>
            </div>
        </details>`;
}

function renderPhotoPicker(prefix, previewUrl) {
    return `
        <div class="photo-picker">
            ${previewUrl ? `<img class="photo-preview" src="${previewUrl}" alt="添付する写真">` : ''}
            <label class="btn btn-sub">
                📷 ${previewUrl ? '写真を変える' : '写真を付ける'}
                <input type="file" accept="image/*" class="photo-input" data-prefix="${prefix}" hidden>
            </label>
            ${previewUrl ? `<button type="button" class="btn btn-sub" data-action="${prefix}-photo-remove">写真を外す</button>` : ''}
        </div>`;
}

function newBadge(id) {
    return newIds.has(id) ? '<span class="new-badge">NEW</span>' : '';
}

function renderEntry(e) {
    const me = myName();
    const mine = me && e['投稿者'] === me;
    const id = e['ID'];

    if (editingId === id) return renderEntryEdit(e);

    const updated = e['更新日時'] && e['更新日時'] !== e['投稿日時'];
    const chars = countChars(e['本文']).plain;
    const rx = e['リアクション'] || {};
    const comments = e['コメント'] || [];
    return `
        <article class="entry" data-id="${escapeHtml(id)}">
            <header class="entry-head">
                <span class="entry-date">${escapeHtml(dateLabel(e['日付']))}</span>
                <span class="entry-author">${escapeHtml(e['投稿者'])}</span>
                ${newBadge(id)}
                ${mine ? `<span class="entry-tools">
                    <button type="button" class="link-btn" data-action="edit">編集</button>
                    <button type="button" class="link-btn danger" data-action="delete">削除</button>
                </span>` : ''}
            </header>
            <div class="entry-body">${escapeHtml(e['本文'])}</div>
            ${e['写真'] ? `<div class="entry-photo" data-path="${escapeHtml(e['写真'])}"><span class="photo-loading">写真を読み込み中…</span></div>` : ''}
            <div class="entry-meta">投稿 ${escapeHtml(stampLabel(e['投稿日時']))}${updated ? `・更新 ${escapeHtml(stampLabel(e['更新日時']))}` : ''}・${chars}文字</div>
            <div class="reactions">
                ${REACTIONS.map(emoji => {
                    const names = rx[emoji] || [];
                    const active = me && names.includes(me);
                    return `<button type="button" class="rx-btn ${active ? 'active' : ''} ${names.length ? 'has' : ''}" data-action="react" data-value="${emoji}" title="${escapeHtml(names.join('、'))}" ${me ? '' : 'disabled'}>${emoji}${names.length ? `<span class="rx-count">${names.length}</span>` : ''}</button>`;
                }).join('')}
            </div>
            ${Object.keys(rx).length ? `<div class="rx-names">${REACTIONS.filter(x => rx[x]?.length).map(x => `${x} ${escapeHtml(rx[x].join('、'))}`).join('　')}</div>` : ''}
            <div class="comments">
                ${comments.map(c => renderComment(e, c)).join('')}
                ${me ? `
                <div class="comment-form">
                    <textarea class="form-textarea comment-input" rows="1" placeholder="コメントを書く" data-entry="${escapeHtml(id)}">${escapeHtml(loadDraft('comment:' + id) || '')}</textarea>
                    <button type="button" class="btn btn-primary btn-small" data-action="comment">送信</button>
                </div>` : ''}
            </div>
        </article>`;
}

function renderComment(e, c) {
    const me = myName();
    const mine = me && c['投稿者'] === me;
    const updated = c['更新日時'] && c['更新日時'] !== c['投稿日時'];
    if (editingCommentId === c['ID']) {
        return `
            <div class="comment editing" data-comment="${escapeHtml(c['ID'])}">
                <textarea class="form-textarea comment-edit-input" rows="2">${escapeHtml(c['本文'])}</textarea>
                <div class="form-actions">
                    <button type="button" class="btn btn-sub btn-small" data-action="comment-cancel">キャンセル</button>
                    <button type="button" class="btn btn-primary btn-small" data-action="comment-save">保存</button>
                </div>
            </div>`;
    }
    return `
        <div class="comment" data-comment="${escapeHtml(c['ID'])}">
            <div class="comment-head">
                <span class="comment-author">${escapeHtml(c['投稿者'])}</span>
                <span class="comment-time">${escapeHtml(stampLabel(c['投稿日時']))}${updated ? `（更新 ${escapeHtml(stampLabel(c['更新日時']))}）` : ''}</span>
                ${newBadge(c['ID'])}
                ${mine ? `<span class="entry-tools">
                    <button type="button" class="link-btn" data-action="comment-edit">編集</button>
                    <button type="button" class="link-btn danger" data-action="comment-delete">削除</button>
                </span>` : ''}
            </div>
            <div class="comment-body">${escapeHtml(c['本文'])}</div>
        </div>`;
}

function renderEntryEdit(e) {
    let previewUrl = '';
    if (editPhoto && editPhoto !== 'remove') previewUrl = editPhoto.url;
    else if (!editPhoto && e['写真']) previewUrl = photoUrls.get(e['写真']) || '';
    const hasPhoto = editPhoto ? editPhoto !== 'remove' : !!e['写真'];
    const chars = countChars(e['本文']);
    return `
        <article class="entry editing" data-id="${escapeHtml(e['ID'])}">
            <div class="form-row">
                <label class="form-label" for="edit-date">日付</label>
                <input type="date" id="edit-date" class="form-input" value="${escapeHtml(dateToInput(e['日付']))}">
            </div>
            <textarea id="edit-body" class="form-textarea" rows="8">${escapeHtml(e['本文'])}</textarea>
            <div class="char-count" id="edit-count">${chars.all} 文字（改行・空白を除くと ${chars.plain} 文字）</div>
            ${hasPhoto && !previewUrl ? '<p class="draft-note">写真あり（読み込み中のため表示できません）</p>' : ''}
            ${renderPhotoPicker('edit', previewUrl)}
            ${hasPhoto && !previewUrl ? '<button type="button" class="btn btn-sub" data-action="edit-photo-remove">写真を外す</button>' : ''}
            <div class="form-actions">
                <button type="button" class="btn btn-sub" data-action="edit-cancel">キャンセル</button>
                <button type="button" class="btn btn-primary" data-action="edit-save">保存</button>
            </div>
        </article>`;
}

function renderDiary() {
    const entries = filteredEntries();
    const shown = entries.slice(0, showCount);
    const filterLabel = [filterPerson && `${filterPerson}さん`, filterDate && dateLabel(filterDate)].filter(Boolean).join('・');
    diaryEl.innerHTML = `
        <section class="panel filters">
            ${renderFilters()}
            ${renderCalendar()}
        </section>
        <section class="panel compose-panel">${renderCompose()}</section>
        <div class="list-head">
            <span>${filterLabel ? `${escapeHtml(filterLabel)}の記事` : 'すべての記事'}（${entries.length}件）</span>
            ${filterLabel ? '<button type="button" class="link-btn" data-action="clear-filter">絞り込みを解除</button>' : ''}
        </div>
        <div class="entry-list">
            ${shown.length ? shown.map(renderEntry).join('') : `<p class="placeholder">${Object.keys(yearData).length ? '記事がありません。' : '「読込」を押してください。'}</p>`}
        </div>
        ${entries.length > showCount ? `<button type="button" class="btn btn-sub more-btn" data-action="more">もっと見る（残り${entries.length - showCount}件）</button>` : ''}
    `;
    loadPhotos();
}

// 写真は非公開リポジトリにあるので、トークン付きで取得してから表示する
function loadPhotos() {
    const token = getToken();
    diaryEl.querySelectorAll('.entry-photo[data-path]').forEach(async (box) => {
        const path = box.dataset.path;
        const show = (url) => { box.innerHTML = `<img src="${url}" alt="写真" loading="lazy">`; };
        if (photoUrls.has(path)) return show(photoUrls.get(path));
        if (!token) { box.innerHTML = '<span class="photo-loading">写真（読込すると表示されます）</span>'; return; }
        try {
            const blob = await fetchBlob(token, OWNER, REPO, path);
            photoUrls.set(path, URL.createObjectURL(blob));
            if (box.isConnected) show(photoUrls.get(path));
        } catch (error) {
            console.error(error);
            if (box.isConnected) box.innerHTML = '<span class="photo-loading">写真を表示できませんでした</span>';
        }
    });
}

function updateCount(textarea, countEl) {
    const c = countChars(textarea.value);
    countEl.textContent = `${c.all} 文字（改行・空白を除くと ${c.plain} 文字）`;
}

// --- 日記画面の操作（イベントは画面全体でまとめて受ける） ---

diaryEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const entryEl = btn.closest('.entry');
    const entryId = entryEl?.dataset.id;
    const commentId = btn.closest('.comment')?.dataset.comment;

    switch (action) {
        case 'person':
            filterPerson = btn.dataset.value;
            showCount = PAGE_SIZE;
            return renderDiary();
        case 'date':
            filterDate = filterDate === btn.dataset.value ? '' : btn.dataset.value;
            showCount = PAGE_SIZE;
            return renderDiary();
        case 'cal-prev':
        case 'cal-next': {
            const d = new Date(calYear, calMonth - 1 + (action === 'cal-prev' ? -1 : 1), 1);
            calYear = d.getFullYear();
            calMonth = d.getMonth() + 1;
            return renderDiary();
        }
        case 'clear-filter':
            filterPerson = '';
            filterDate = '';
            showCount = PAGE_SIZE;
            return renderDiary();
        case 'more':
            showCount += PAGE_SIZE;
            return renderDiary();
        case 'post': {
            const body = document.getElementById('compose-body').value.trim();
            const date = inputToDate(document.getElementById('compose-date').value);
            if (!date) return alert('日付を選んでください');
            if (!body) return alert('本文を入力してください');
            return run(() => postEntry(date, body), '投稿しました');
        }
        case 'compose-photo-remove':
            composePhoto = null;
            return renderDiary();
        case 'edit':
            editingId = entryId;
            editPhoto = null;
            return renderDiary();
        case 'edit-cancel':
            editingId = '';
            editPhoto = null;
            return renderDiary();
        case 'edit-photo-remove':
            editPhoto = 'remove';
            return rerenderKeepingEdit();
        case 'edit-save': {
            const body = document.getElementById('edit-body').value.trim();
            const date = inputToDate(document.getElementById('edit-date').value);
            if (!date) return alert('日付を選んでください');
            if (!body) return alert('本文を入力してください');
            return run(() => saveEdit(entryId, date, body), '保存しました');
        }
        case 'delete':
            if (!confirm('この記事を削除します（コメント・リアクション・写真も消えます）。よろしいですか？')) return;
            return run(() => deleteEntry(entryId), '削除しました');
        case 'react':
            return run(() => toggleReaction(entryId, btn.dataset.value));
        case 'comment': {
            const body = entryEl.querySelector('.comment-input').value.trim();
            if (!body) return;
            return run(() => addComment(entryId, body), 'コメントしました');
        }
        case 'comment-edit':
            editingCommentId = commentId;
            return renderDiary();
        case 'comment-cancel':
            editingCommentId = '';
            return renderDiary();
        case 'comment-save': {
            const body = btn.closest('.comment').querySelector('.comment-edit-input').value.trim();
            if (!body) return alert('コメントを入力してください');
            return run(() => saveCommentEdit(entryId, commentId, body), '保存しました');
        }
        case 'comment-delete':
            if (!confirm('このコメントを削除します。よろしいですか？')) return;
            return run(() => deleteComment(entryId, commentId), '削除しました');
    }
});

// 編集中の本文・日付を保ったまま描き直す（写真を変えたとき用）
function rerenderKeepingEdit() {
    const body = document.getElementById('edit-body')?.value;
    const date = document.getElementById('edit-date')?.value;
    renderDiary();
    if (body !== undefined) document.getElementById('edit-body').value = body;
    if (date !== undefined) document.getElementById('edit-date').value = date;
}

diaryEl.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'compose-body' || t.id === 'compose-date') {
        saveDraft('post', {
            date: document.getElementById('compose-date').value,
            body: document.getElementById('compose-body').value,
        });
        if (t.id === 'compose-body') updateCount(t, document.getElementById('compose-count'));
    } else if (t.id === 'edit-body') {
        updateCount(t, document.getElementById('edit-count'));
    } else if (t.classList.contains('comment-input')) {
        saveDraft('comment:' + t.dataset.entry, t.value);
    }
});

diaryEl.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (!t.classList.contains('photo-input') || !t.files?.[0]) return;
    const prefix = t.dataset.prefix;
    try {
        toast('写真を縮めています…');
        const photo = await compressPhoto(t.files[0]);
        photo.url = URL.createObjectURL(photo.blob);
        toast(`写真を縮めました（${Math.round(photo.blob.size / 1024)}KB）`);
        if (prefix === 'compose') {
            composePhoto = photo;
            renderDiary();
            document.querySelector('.compose')?.setAttribute('open', '');
        } else {
            editPhoto = photo;
            rerenderKeepingEdit();
        }
    } catch (error) {
        console.error(error);
        toast(error.message, true);
    }
});

// ===== 画面：設定 =====

function renderSettings() {
    const me = myName();
    const others = collectAuthors(allEntries()).filter(n => n !== me);
    settingsEl.innerHTML = `
        <section class="panel">
            <h2 class="panel-title">名前</h2>
            <p class="panel-note">記事・コメント・リアクションに付く名前です。この端末に記憶され、次に開いたときも使われます。</p>
            <div class="form-row">
                <input type="text" id="my-name" class="form-input" maxlength="20" placeholder="名前を入力" value="${escapeHtml(me)}" autocomplete="off">
                <button type="button" class="btn btn-primary" id="my-name-save">保存</button>
            </div>
            ${others.length ? `<div class="chips">${others.map(n => `<button type="button" class="chip" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}</div>
            <p class="panel-note">これまでの投稿者（押すと入力欄に入ります）</p>` : ''}
        </section>`;
    const input = document.getElementById('my-name');
    settingsEl.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.name; }));
    document.getElementById('my-name-save').addEventListener('click', () => {
        const name = input.value.trim();
        if (!name) return alert('名前を入力してください');
        saveMyName(name);
        toast('名前を保存しました');
        switchView('diary');
    });
}

// ===== メニュー切り替え =====

function switchView(view) {
    document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    diaryEl.hidden = view !== 'diary';
    settingsEl.hidden = view !== 'settings';
    if (view === 'diary') renderDiary(); else renderSettings();
}

document.querySelectorAll('.view-tab-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

// ===== 上部バー =====

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getToken();
        if (!token) return alert('トークンを入力してください');
        tokenInput.value = token;
        loadAll(token, false);
    });
});

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = tokenInput.value.trim();
        if (!token) return alert('トークンを入力してください');
        saveToken(token);
        btn.textContent = '保存しました';
        setTimeout(() => { btn.textContent = '保存'; }, 1200);
    });
});

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

// ===== 起動 =====
{
    const saved = loadToken();
    if (saved) tokenInput.value = saved;
    loadFromCache();
    switchView(myName() ? 'diary' : 'settings');
    if (saved) loadAll(saved, true);
}
