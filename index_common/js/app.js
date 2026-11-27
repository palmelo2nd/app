// キャッシュバスティング：全import文・index.htmlの「?v=N」は同じ値に揃えて更新する（brain等と同じ方式）。
// 現在のバージョン: 16
import { loadToken, saveToken, activate } from './modules/storage.js?v=16';

// 用途別INDEX（2026-11-02）：index_my／index_fam／index_saveの各index.htmlが window.INDEX_CONFIG で
// 用途（読むデータリポジトリ）を渡し、このファイルを共通で読み込む。メニューは各データリポジトリの
// index/apps.json（{"apps": ["stock", "cook", ...]}）で決める（コードを変えずに用途ごとの表示を切り替えるため）。
// shell: true の入口（今はindex_myだけ）は、自分のフォルダのsw.jsで画面を端末に残し、圏外でも開けるようにする（2026-11-27、brain #-105）
const CONFIG = Object.assign({ dataRepo: 'app_data', label: '', shell: false }, window.INDEX_CONFIG || {});
const OWNER = 'palmelo2nd';
const MENU_PATH = 'index/apps.json';
const MENU_CACHE_KEY = `index_menu_${CONFIG.dataRepo}`;  // 前回のアプリ一覧（圏外のときに出す）

// 「キャッシュ更新」ボタンの右に表示するバージョン（自身のimport.meta.urlの?v=Nから取得）
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

// ===== アプリ一覧（名前・説明の辞書。表示するかどうかはデータ側のapps.jsonで決める） =====
// offline: true は、圏外でも開けるアプリ（自分のsw.jsを持つもの）。それ以外は圏外のとき薄く表示して「圏外では開けません」と添える
const APPS = [
    { id: 'brain',  name: 'Brain',  desc: 'タスク管理' },
    { id: 'stock',  name: 'Stock',  desc: '投資・ポートフォリオ' },
    { id: 'cook',   name: 'Cook',   desc: '料理データベース' },
    { id: 'reading', name: 'Reading', desc: '読む・目指す・決まり・記録（旧book・dream）', offline: true },
    { id: 'memory', name: 'Memory', desc: '記憶カード' },
    { id: 'kanzi',  name: 'Kanzi',  desc: '漢字学習' },
    { id: 'diary',  name: 'Diary',  desc: '日記の閲覧・入力' },
    { id: 'note',   name: 'Note',   desc: 'ナレッジ（手順・ルール・メモ）' },
    { id: 'typing', name: '文字入力', desc: 'スマホの文字入力練習アプリ' },
    { id: 'flickflock', name: 'ふりっくふろっく', desc: '文字入力の商用版（開発中）' },
    { id: 'skillmap', name: 'スキルマップ', desc: '仲良くなるためにできることを、枝を広げて書く' },
    { id: 'opnote', name: '操作ノート', desc: 'スマホ・パソコンで教わった操作のまとめ' },
    { id: 'chat',   name: 'Chat',   desc: 'チャット' },
    { id: 'world',  name: 'World',  desc: '世界地図' },
    { id: 'japan',  name: 'Japan',  desc: '日本地図' },
];

// (2) インプット: token  (3) メイン — GitHub Contents APIでapps.jsonを取得  (4) アウトプット — 表示するアプリIDの配列
// 電波が届かないとき（fetchそのものが失敗したとき）は、error.offline = true を付けて投げる
async function fetchMenu(token) {
    let res;
    try {
        res = await fetch(`https://api.github.com/repos/${OWNER}/${CONFIG.dataRepo}/contents/${MENU_PATH}`, {
            headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.raw+json' },
            cache: 'no-store',
        });
    } catch (error) {
        error.offline = true;
        throw error;
    }
    if (!res.ok) throw new Error(`メニューを読み込めませんでした（${res.status}）`);
    const json = await res.json();
    return Array.isArray(json.apps) ? json.apps : [];
}

function loadMenuCache() {
    try {
        const ids = JSON.parse(localStorage.getItem(MENU_CACHE_KEY));
        return Array.isArray(ids) ? ids : null;
    } catch { return null; }
}
function saveMenuCache(ids) {
    try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(ids)); } catch { /* 保存できない環境では何もしない */ }
}

function renderMessage(text) {
    const box = document.getElementById('app-links');
    box.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'app-links-message';
    p.textContent = text;
    box.appendChild(p);
}

let shownIds = null;  // 今表示している一覧（電波が切れた・戻ったときに描き直すため）

async function renderMenu(token) {
    if (!token) return renderMessage('トークンを入力して「保存」を押すと、アプリの一覧が表示されます。');
    try {
        if (!navigator.onLine) throw Object.assign(new Error('圏外'), { offline: true });
        const ids = await fetchMenu(token);
        saveMenuCache(ids);
        showMenu(ids, false);
    } catch (error) {
        const cached = error.offline ? loadMenuCache() : null;
        if (cached) return showMenu(cached, true);
        console.error(error);
        if (error.offline) return renderMessage('圏外のため、アプリの一覧を読み込めませんでした（前回の一覧もありません）。');
        renderMessage(`${error.message}。トークンが正しいか確認してください。`);
    }
}

// (2) インプット: ids（表示するアプリID）, fromCache（前回の一覧を出しているか）
function showMenu(ids, fromCache) {
    shownIds = ids;
    const apps = ids.map(id => APPS.find(a => a.id === id) || { id, name: id, desc: '' });
    if (apps.length === 0) return renderMessage('表示するアプリはまだありません。');
    renderLinks(apps, fromCache);
}

function renderLinks(apps, fromCache) {
    const offline = !navigator.onLine || fromCache;
    const box = document.getElementById('app-links');
    box.innerHTML = '';
    if (fromCache) {
        const note = document.createElement('p');
        note.className = 'app-links-message app-links-note';
        note.textContent = '圏外のため、前回の一覧を表示しています。';
        box.appendChild(note);
    }
    apps.forEach(app => {
        const a = document.createElement('a');
        a.className = 'app-link';
        a.href = `../${app.id}/`;
        a.innerHTML = '<div class="app-link-name"></div><div class="app-link-desc"></div>';
        a.querySelector('.app-link-name').textContent = app.name;
        a.querySelector('.app-link-desc').textContent = app.desc;
        if (offline && !app.offline) {
            // 押しても開けないので、薄く表示して押せないようにする
            a.classList.add('app-link-disabled');
            a.removeAttribute('href');
            a.setAttribute('aria-disabled', 'true');
            const tip = document.createElement('div');
            tip.className = 'app-link-offline';
            tip.textContent = '圏外では開けません';
            a.appendChild(tip);
        }
        box.appendChild(a);
    });
}

// 電波が切れた・戻ったら描き直す（戻ったときは最新の一覧を取り直す）
window.addEventListener('offline', () => { if (shownIds) showMenu(shownIds, true); });
window.addEventListener('online', () => renderMenu(loadToken(CONFIG.dataRepo)));

// ===== 画面を圏外でも開けるようにする（入口のフォルダのsw.js。readingと同じ方式） =====
// 最初に開いたときはService Workerが動き出す前にJS・CSSを読み終えているので、読んだファイルの一覧を渡して端末に残してもらう
async function registerShellWorker() {
    if (!CONFIG.shell || !('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('./sw.js');
        const reg = await navigator.serviceWorker.ready;
        const urls = [...new Set([
            ...performance.getEntriesByType('resource').map(e => e.name),
            ...[...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')].map(el => el.src || el.href),
            new URL(import.meta.url).href,
        ])].filter(u => !u.startsWith('https://api.github.com/'));
        reg.active?.postMessage({ type: 'cache-shell', urls });
    } catch (error) {
        console.warn('Service Workerを登録できませんでした（圏外でこの画面を開けません）', error);
    }
}

// ===== トークン入力・読込・保存 =====
function setTokenInputs(value) {
    document.querySelectorAll('.js-token-input').forEach(el => { el.value = value; });
}
function getTokenValue() {
    return document.querySelector('.js-token-input')?.value.trim() || '';
}
function setNetworkStatus(html) {
    document.querySelectorAll('.js-network-status').forEach(el => { el.innerHTML = html; });
}

window.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.label) {
        document.title = `Index（${CONFIG.label}）`;
        const h = document.querySelector('h2');
        if (h) h.textContent = `Index（${CONFIG.label}）`;
    }
    const saved = loadToken(CONFIG.dataRepo);
    activate(CONFIG.dataRepo, saved);
    if (saved) setTokenInputs(saved);
    renderMenu(saved);
    registerShellWorker();
});

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const saved = loadToken(CONFIG.dataRepo);
        if (!saved) return alert('保存済みのトークンがありません');
        setTokenInputs(saved);
        activate(CONFIG.dataRepo, saved);
        setNetworkStatus('<span class="status-badge online-badge">読込済み</span>');
        renderMenu(saved);
    });
});

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getTokenValue();
        if (!token) return alert('トークンを入力してください');
        saveToken(CONFIG.dataRepo, token);
        setNetworkStatus('<span class="status-badge online-badge">保存済み（各アプリに引き継ぎ）</span>');
        renderMenu(token);
    });
});

// ===== キャッシュ更新（brainと同じ） =====
document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？（入力中の内容は失われます）')) return;
        try {
            if ('caches' in window) {
                // 同じドメインの他のアプリ（bookの「端末に保存した本」など）のキャッシュを消さないよう、自分の名前で始まるものだけ消す
                const keys = await caches.keys();
                await Promise.all(keys.filter(k => k.startsWith('index-')).map(k => caches.delete(k)));
            }
            if ('serviceWorker' in navigator) {
                // 他のアプリのService Worker（bookなど）は解除しない
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.filter(r => r.scope.startsWith(new URL('./', location.href).href)).map(r => r.unregister()));
            }
        } catch (error) {
            console.error(error);
        }
        location.href = location.pathname + '?nocache=' + Date.now();
    });
});
