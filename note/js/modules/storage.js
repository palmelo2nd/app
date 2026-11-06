// (1) インポート — なし（Web標準APIのみ使用）
// 端末内の保存（LocalStorage、キーはnote_接頭辞）。圏外でも閲覧・検索・編集できるよう、ノートの本文をすべて持つ。
//   note_index     … { パス: SHA }（前回GitHubから読んだときの一覧。SHAが変わったノートだけ取り直すのに使う）
//   note_file:<パス> … ノートのファイル全文
//   note_pending   … { パス: { text, baseSha } }（まだGitHubへ送れていない保存。baseShaは編集前のSHA、新規はnull）
//   note_drafts    … { パス: { meta, body, isNew } }（編集中で保存していない下書き）

const TOKEN_KEY   = 'note_pat_token';
const INDEX_KEY   = 'note_index';
const FILE_PREFIX = 'note_file:';
const PENDING_KEY = 'note_pending';
const DRAFTS_KEY  = 'note_drafts';

function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { console.warn('端末への保存に失敗しました', key, error); }
}
function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* 何もしない */ }
}
function loadJson(key) {
    try { return JSON.parse(safeGet(key)) || {}; } catch (_) { return {}; }
}
function saveJson(key, obj) {
    if (Object.keys(obj).length === 0) safeRemove(key);
    else safeSet(key, JSON.stringify(obj));
}

// ===== トークン =====
export function loadToken() { return safeGet(TOKEN_KEY); }
export function saveToken(token) { safeSet(TOKEN_KEY, token); }

// ===== ノートの一覧と本文 =====

/** (4) アウトプット: { パス: SHA } */
export function loadIndex() { return loadJson(INDEX_KEY); }
export function saveIndex(index) { safeSet(INDEX_KEY, JSON.stringify(index)); }

export function loadFile(path) { return safeGet(FILE_PREFIX + path); }
export function saveFileCache(path, text) { safeSet(FILE_PREFIX + path, text); }
export function removeFileCache(path) { safeRemove(FILE_PREFIX + path); }

// ===== 未送信の保存 =====
export function loadPending() { return loadJson(PENDING_KEY); }
export function setPending(path, value) {
    const pending = loadPending();
    if (value) pending[path] = value; else delete pending[path];
    saveJson(PENDING_KEY, pending);
}

// ===== 下書き =====
export function loadDrafts() { return loadJson(DRAFTS_KEY); }
export function setDraft(path, value) {
    const drafts = loadDrafts();
    if (value) drafts[path] = value; else delete drafts[path];
    saveJson(DRAFTS_KEY, drafts);
}
