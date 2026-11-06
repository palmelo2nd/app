// キャッシュバスティング：全import文・index.htmlの「?v=N」は同じ値に揃えて更新する（brain等と同じ方式）。
// 現在のバージョン: 6
import { loadToken, saveToken, activate } from './modules/storage.js?v=8';

// 用途別INDEX（2026-11-02）：index_my／index_fam／index_saveの各index.htmlが window.INDEX_CONFIG で
// 用途（読むデータリポジトリ）を渡し、このファイルを共通で読み込む。メニューは各データリポジトリの
// index/apps.json（{"apps": ["stock", "cook", ...]}）で決める（コードを変えずに用途ごとの表示を切り替えるため）。
const CONFIG = Object.assign({ dataRepo: 'app_data', label: '' }, window.INDEX_CONFIG || {});
const OWNER = 'palmelo2nd';
const MENU_PATH = 'index/apps.json';

// 「キャッシュ更新」ボタンの右に表示するバージョン（自身のimport.meta.urlの?v=Nから取得）
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

// ===== アプリ一覧（名前・説明の辞書。表示するかどうかはデータ側のapps.jsonで決める） =====
const APPS = [
    { id: 'brain',  name: 'Brain',  desc: 'タスク管理' },
    { id: 'stock',  name: 'Stock',  desc: '投資・ポートフォリオ' },
    { id: 'cook',   name: 'Cook',   desc: '料理データベース' },
    { id: 'book',   name: 'Book',   desc: '読書ビューア' },
    { id: 'dream',  name: 'Dream',  desc: '教養マップ・考えたこと' },
    { id: 'memory', name: 'Memory', desc: '記憶カード' },
    { id: 'kanzi',  name: 'Kanzi',  desc: '漢字学習' },
    { id: 'diary',  name: 'Diary',  desc: '日記の閲覧・入力' },
    { id: 'note',   name: 'Note',   desc: 'ナレッジ（手順・ルール・メモ）' },
    { id: 'typing', name: 'Typing', desc: 'フリック入力タイムアタック' },
    { id: 'chat',   name: 'Chat',   desc: 'チャット' },
];

// (2) インプット: token  (3) メイン — GitHub Contents APIでapps.jsonを取得  (4) アウトプット — 表示するアプリIDの配列
async function fetchMenu(token) {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${CONFIG.dataRepo}/contents/${MENU_PATH}`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.raw+json' },
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`メニューを読み込めませんでした（${res.status}）`);
    const json = await res.json();
    return Array.isArray(json.apps) ? json.apps : [];
}

function renderMessage(text) {
    const box = document.getElementById('app-links');
    box.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'app-links-message';
    p.textContent = text;
    box.appendChild(p);
}

async function renderMenu(token) {
    if (!token) return renderMessage('トークンを入力して「保存」を押すと、アプリの一覧が表示されます。');
    try {
        const ids = await fetchMenu(token);
        const apps = ids.map(id => APPS.find(a => a.id === id) || { id, name: id, desc: '' });
        if (apps.length === 0) return renderMessage('表示するアプリはまだありません。');
        renderLinks(apps);
    } catch (error) {
        console.error(error);
        renderMessage(`${error.message}。トークンが正しいか確認してください。`);
    }
}

function renderLinks(apps) {
    const box = document.getElementById('app-links');
    box.innerHTML = '';
    apps.forEach(app => {
        const a = document.createElement('a');
        a.className = 'app-link';
        a.href = `../${app.id}/`;
        a.innerHTML = '<div class="app-link-name"></div><div class="app-link-desc"></div>';
        a.querySelector('.app-link-name').textContent = app.name;
        a.querySelector('.app-link-desc').textContent = app.desc;
        box.appendChild(a);
    });
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
