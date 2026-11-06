// (1) インポート — なし（Web標準のCache Storage・LocalStorageのみ使用）
// 「端末に保存した本」の置き場。本文・state・図版を、GitHubから取ったままの形（暗号化版は暗号文のまま）でCache Storageに入れる。
// LocalStorage（全アプリで約5MBを共有）には入りきらないため。noteの画像キャッシュ（note-attachments）と同じ方式。
// どの本を保存したかの目録だけはLocalStorageに持つ（本棚を同期的に描くため）。
// 自動では消さない。消すのはユーザーが「端末から削除」を押したときだけ（各アプリの「キャッシュ更新」も book-offline は消さない）。

const CACHE_NAME = 'book-offline';
const INDEX_KEY = 'book_offline_index';

// キャッシュのキー。GitHub上のパスをそのまま使い、従来版（app_data）と暗号化版（book_data）はリポジトリ名で分ける
function keyOf(repo, path) {
    return new URL(`./__offline/${repo}/${path.split('/').map(encodeURIComponent).join('/')}`, location.href).href;
}

// (2) インプット: repo, path, text  (3) メイン — Cache Storageへ書き込み  (4) アウトプット — 書き込んだバイト数
export async function putText(repo, path, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const cache = await caches.open(CACHE_NAME);
    await cache.put(keyOf(repo, path), new Response(blob));
    return blob.size;
}

// (2) インプット: repo, path  (3) メイン — Cache Storage読み取り  (4) アウトプット — 文字列 or null
export async function getText(repo, path) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(keyOf(repo, path));
        return hit ? await hit.text() : null;
    } catch (error) {
        return null;
    }
}

// (2) インプット: repo, path, blob  (3) メイン — Cache Storageへ書き込み  (4) アウトプット — 書き込んだバイト数
export async function putBlob(repo, path, blob) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(keyOf(repo, path), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
    return blob.size;
}

// (2) インプット: repo, path  (3) メイン — Cache Storage読み取り  (4) アウトプット — Blob or null
export async function getBlob(repo, path) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(keyOf(repo, path));
        return hit ? await hit.blob() : null;
    } catch (error) {
        return null;
    }
}

// (2) インプット: repo, paths  (3) メイン — Cache Storageから削除  (4) アウトプット — なし
export async function removePaths(repo, paths) {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(paths.map(p => cache.delete(keyOf(repo, p))));
}

// ===== 目録（LocalStorage） =====
// { "<repo>:<書籍ID>": { title, savedAt, sha, stateSha, withImages, textBytes, imageBytes, images:[{name, path, bytes}] } }

export function loadIndex() {
    try {
        return JSON.parse(localStorage.getItem(INDEX_KEY)) || {};
    } catch (error) {
        return {};
    }
}

function saveIndex(index) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

// (2) インプット: repo, 書籍ID  (3) メイン — 目録の読み取り  (4) アウトプット — 保存した本の情報 or null
export function getEntry(repo, bookId) {
    return loadIndex()[`${repo}:${bookId}`] || null;
}

// (2) インプット: repo, 書籍ID, entry  (3) メイン — 目録へ書き込み  (4) アウトプット — なし
export function setEntry(repo, bookId, entry) {
    const index = loadIndex();
    index[`${repo}:${bookId}`] = entry;
    saveIndex(index);
}

// (2) インプット: repo, 書籍ID  (3) メイン — 目録から削除  (4) アウトプット — なし
export function removeEntry(repo, bookId) {
    const index = loadIndex();
    delete index[`${repo}:${bookId}`];
    saveIndex(index);
}

// (2) インプット: repo  (3) メイン — 目録の読み取り  (4) アウトプット — [{ bookId, ...entry }]（このリポジトリの分だけ）
export function listEntries(repo) {
    return Object.entries(loadIndex())
        .filter(([key]) => key.startsWith(`${repo}:`))
        .map(([key, entry]) => ({ bookId: key.slice(repo.length + 1), ...entry }));
}

// ===== 容量 =====

// ブラウザに「容量が足りなくなっても勝手に消さないで」と頼む（iPhoneはホーム画面に追加したときだけ確実に効く）
export async function requestPersist() {
    try {
        if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (error) { /* 頼めない環境では何もしない */ }
}

// (4) アウトプット — { usage, quota }（バイト）or null
export async function storageEstimate() {
    try {
        return navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    } catch (error) {
        return null;
    }
}

// (2) インプット: バイト数  (4) アウトプット — 「約1.2MB」のような文字列
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes >= 1024 ** 3) return `約${(bytes / 1024 ** 3).toFixed(1)}GB`;
    if (bytes >= 1024 ** 2) return `約${(bytes / 1024 ** 2).toFixed(1)}MB`;
    return `約${Math.max(1, Math.round(bytes / 1024))}KB`;
}
