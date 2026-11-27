// readingの「dream」「rules」「log」を、機能ごとにまとめて端末に保存する（2026-11-27、brain #-107。設計部のwork「readingのdream等の端末保存」）。
// 置き場はbookの本と同じCache Storage「reading-offline」（modules/offline.js）。キーはGitHub上のパス（app_data）。
// 目録は reading_offline_index に「shelf:<機能>」のキーで持つ（kind: 'shelf'。bookの本は「<リポジトリ名>:<書籍ID>」なので混ざらない）。
// 3つとも読むだけなので、bookのような未送信・同期のしくみは無い。電波のある所で開いたら、変わったファイル（SHA比較）だけ差し替える。
// 本文の図はmermaid（本文の文字）なので、保存した本文から描ける。描くための部品（CDN）は、保存のときに一度描いてreading-shellに残す。
import * as offline from './offline.js?v=6';
import { fetchFile, listDir } from './github.js?v=6';
import { parseFrontMatter } from './dataModel.js?v=6';
import { registerShellWorker } from './shell.js?v=6';

const OWNER = 'palmelo2nd';
const REPO = 'app_data';
const INDEX_GROUP = 'shelf';

// 機能ごとのデータの置き場所（dream.js・rules.js・log.jsと、bookの「端末に保存した本」の一覧が使う）
export const SHELF_CONFIGS = {
    dream: { mode: 'dream', dir: 'reading/02_dream', listFile: 'dreams.md', listKey: 'dreamData', title: 'dream（目指す）' },
    rules: { mode: 'rules', dir: 'reading/03_rules', listFile: 'shelf.md',  listKey: 'shelfData', title: 'rules（決まり）' },
    log:   { mode: 'log',   dir: 'reading/04_log',   listFile: 'shelf.md',  listKey: 'shelfData', title: 'log（記録）' },
};

const listPathOf = (cfg) => `${cfg.dir}/${cfg.listFile}`;
const baseName = (path) => path.split('/').pop();

// 一覧ファイルの中身から、保存するファイル（一覧＋各項目の本体）のパスを出す
function targetPaths(cfg, listText) {
    const items = parseFrontMatter(listText).data[cfg.listKey] || [];
    return [listPathOf(cfg), ...items.map(item => `${cfg.dir}/${item['ID']}.md`)];
}

// ===== 目録 =====

// (4) アウトプット — { kind, title, savedAt, syncedAt, files: { <パス>: { sha, bytes } } } or null
export function getShelfEntry(mode) {
    return offline.getEntry(INDEX_GROUP, mode);
}

// (4) アウトプット — [{ mode, ...entry }]
export function listShelfEntries() {
    return offline.listEntries(INDEX_GROUP)
        .map(e => ({ ...e, mode: e.bookId }))
        .filter(e => SHELF_CONFIGS[e.mode]);
}

export function shelfEntrySize(entry) {
    return Object.values(entry?.files || {}).reduce((sum, f) => sum + (f.bytes || 0), 0);
}

export function shelfFileCount(entry) {
    return Object.keys(entry?.files || {}).length;
}

// (2) インプット: mode, path  (4) アウトプット — 端末に保存した本文 or null
export async function getSavedText(mode, path) {
    if (!getShelfEntry(mode)?.files?.[path]) return null;
    return offline.getText(REPO, path);
}

// ===== 保存・更新・削除 =====

// 保存前の容量の目安（フォルダ一覧1回）
export async function estimateShelfSize(token, mode) {
    const files = await listDir(token, OWNER, REPO, SHELF_CONFIGS[mode].dir);
    return files.filter(f => f.type === 'file' && f.name.endsWith('.md')).reduce((sum, f) => sum + f.size, 0);
}

async function fetchOrSkip(token, path) {
    try {
        return await fetchFile(token, OWNER, REPO, path);
    } catch (error) {
        if (error.status === 404) return null; // 一覧にあるのにファイルが無い：飛ばす
        throw error;
    }
}

// (2) インプット: token, mode, onProgress(done, total)
// (3) メイン — 一覧と各項目の本体を取り、Cache Storageへ。目録を書く。図の部品を残す
// (4) アウトプット — 目録の項目
export async function saveShelf(token, mode, onProgress) {
    const cfg = SHELF_CONFIGS[mode];
    offline.requestPersist();
    const list = await fetchFile(token, OWNER, REPO, listPathOf(cfg));
    const paths = targetPaths(cfg, list.content);
    const files = {};
    const texts = [];
    for (const [i, path] of paths.entries()) {
        onProgress?.(i, paths.length);
        const got = i === 0 ? list : await fetchOrSkip(token, path);
        if (!got) continue;
        files[path] = { sha: got.sha, bytes: await offline.putText(REPO, path, got.content) };
        texts.push(got.content);
    }
    onProgress?.(paths.length, paths.length);
    const prev = getShelfEntry(mode);
    const stale = Object.keys(prev?.files || {}).filter(p => !files[p]);
    if (stale.length) await offline.removePaths(REPO, stale);
    const now = new Date().toISOString();
    const entry = { kind: 'shelf', title: cfg.title, savedAt: prev?.savedAt || now, syncedAt: now, files };
    offline.setEntry(INDEX_GROUP, mode, entry);
    await warmDiagrams(texts);
    return entry;
}

// 電波のある所で開いたとき・「すべて同期」：変わったファイルだけ差し替える（フォルダ一覧1回＋変わった分）
// (4) アウトプット — 差し替えたファイルがあれば true
export async function refreshShelf(token, mode) {
    const entry = getShelfEntry(mode);
    if (!entry) return false;
    const cfg = SHELF_CONFIGS[mode];
    const dir = await listDir(token, OWNER, REPO, cfg.dir);
    if (dir.length === 0) return false; // フォルダが見えない（権限・一時的な不具合）：保存した分は消さない
    const shaOf = (path) => dir.find(f => f.name === baseName(path))?.sha;
    const listPath = listPathOf(cfg);
    const files = { ...entry.files };
    const texts = [];
    let changed = false;

    let paths = Object.keys(files);
    if (shaOf(listPath) && shaOf(listPath) !== files[listPath]?.sha) {
        const list = await fetchFile(token, OWNER, REPO, listPath);
        files[listPath] = { sha: list.sha, bytes: await offline.putText(REPO, listPath, list.content) };
        paths = targetPaths(cfg, list.content);
        changed = true;
    }
    for (const path of paths.filter(p => p !== listPath)) {
        const remote = shaOf(path);
        if (!remote || files[path]?.sha === remote) continue;
        const got = await fetchOrSkip(token, path);
        if (!got) continue;
        files[path] = { sha: got.sha, bytes: await offline.putText(REPO, path, got.content) };
        texts.push(got.content);
        changed = true;
    }
    const keep = new Set([listPath, ...paths]);
    const stale = Object.keys(files).filter(p => !keep.has(p) || !shaOf(p));
    if (stale.length) {
        await offline.removePaths(REPO, stale);
        stale.forEach(p => delete files[p]);
        changed = true;
    }
    if (!getShelfEntry(mode)) return false; // 更新中に「端末から削除」された：書き戻さない
    offline.setEntry(INDEX_GROUP, mode, { ...entry, files, syncedAt: new Date().toISOString() });
    if (texts.length) await warmDiagrams(texts);
    return changed;
}

// 「端末に保存した本」の一覧で「更新あり」を出すため：GitHubの方が新しいファイルがあるか（フォルダ一覧1回）
export async function isShelfStale(token, mode) {
    const entry = getShelfEntry(mode);
    if (!entry) return false;
    const dir = await listDir(token, OWNER, REPO, SHELF_CONFIGS[mode].dir);
    return Object.entries(entry.files).some(([path, f]) => {
        const remote = dir.find(d => d.name === baseName(path))?.sha;
        return remote && remote !== f.sha;
    });
}

export async function removeShelf(mode) {
    const entry = getShelfEntry(mode);
    if (entry) await offline.removePaths(REPO, Object.keys(entry.files || {}));
    offline.removeEntry(INDEX_GROUP, mode);
}

// ===== 図（mermaid） =====
// mermaidは重いため、図のあるページを開いた時だけCDNから遅延読み込みする（shelf.jsのページ表示もこれを使う）
let mermaidPromise = null;
export function loadMermaid() {
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

// 保存した本文にある図の種類（mindmap・flowchartなど）ごとに1つを見えない所で描き、
// mermaidが種類ごとに後から読む部品をService Workerに残してもらう（圏外で初めて開くページの図も描けるように）
async function warmDiagrams(texts) {
    const samples = new Map();
    for (const text of texts) {
        let pages;
        try { pages = parseFrontMatter(text).data.pageData || []; } catch (error) { continue; }
        for (const page of pages) {
            for (const m of (page['本文'] || '').matchAll(/```mermaid[^\n]*\n([\s\S]*?)```/g)) {
                const head = m[1].split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%'));
                const type = head?.split(/[\s;]/)[0];
                if (type && !samples.has(type)) samples.set(type, m[1]);
            }
        }
    }
    if (samples.size === 0) return;
    try {
        const mermaid = await loadMermaid();
        let i = 0;
        for (const code of samples.values()) {
            try { await mermaid.render(`reading-warm-${Date.now()}-${i++}`, code); } catch (error) { console.warn(error); }
        }
    } catch (error) {
        console.warn('図の部品を読み込めませんでした', error);
        return;
    }
    await registerShellWorker(); // Service Workerがまだ働いていなかった端末でも、読んだ部品を残してもらう
}
