// キャッシュバスティング：全import文・index.htmlの「?v=N」は同じ値に揃えて更新する（brain等と同じ方式）。
// 現在のバージョン: 2
import { loadToken, saveToken } from './modules/storage.js?v=2';

// 「キャッシュ更新」ボタンの右に表示するバージョン（自身のimport.meta.urlの?v=Nから取得）
const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

// ===== アプリ一覧（リンク先はindexと同階層の各アプリ） =====
const APPS = [
    { id: 'brain',  name: 'Brain',  desc: 'タスク・ナレッジ管理' },
    { id: 'stock',  name: 'Stock',  desc: '投資・ポートフォリオ' },
    { id: 'cook',   name: 'Cook',   desc: '料理データベース' },
    { id: 'book',   name: 'Book',   desc: '読書ビューア' },
    { id: 'dream',  name: 'Dream',  desc: '教養マップ・考えたこと' },
    { id: 'memory', name: 'Memory', desc: '記憶カード' },
    { id: 'kanzi',  name: 'Kanzi',  desc: '漢字学習' },
    { id: 'diary',  name: 'Diary',  desc: '日記の閲覧・入力' },
    { id: 'chat',   name: 'Chat',   desc: 'チャット' },
];

function renderLinks() {
    const box = document.getElementById('app-links');
    box.innerHTML = '';
    APPS.forEach(app => {
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
    renderLinks();
    const saved = loadToken();
    if (saved) setTokenInputs(saved);
});

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const saved = loadToken();
        if (!saved) return alert('保存済みのトークンがありません');
        setTokenInputs(saved);
        setNetworkStatus('<span class="status-badge online-badge">読込済み</span>');
    });
});

document.querySelectorAll('.js-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const token = getTokenValue();
        if (!token) return alert('トークンを入力してください');
        saveToken(token);
        setNetworkStatus('<span class="status-badge online-badge">保存済み（各アプリに引き継ぎ）</span>');
        alert('トークンを保存し、各アプリに引き継ぎました。');
    });
});

// ===== キャッシュ更新（brainと同じ） =====
document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？（入力中の内容は失われます）')) return;
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
