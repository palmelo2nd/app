// readingの入口（2026-11-17、brain #1695。旧book・dreamを統合）。
// 画面は index.html 1つで、URLの ?m=book / dream / rules / log で機能を切り替える（Service Workerが画面を1件として持つため）。
// ?m が無いときは表紙（4機能のメニュー）を出す。
// JS/CSSを変更した際は、index.html・このファイル・各mode・modulesの?v=Nを全部同じ新しい値に揃えること（brain等と同じ方式）。

import { registerShellWorker } from './modules/shell.js?v=6';

export const MODES = [
    { id: 'book',  name: 'book',  label: '読む',   desc: '書籍・新聞・講義ノート。雑学と学びの記録、学びの途中経過も' },
    { id: 'dream', name: 'dream', label: '目指す', desc: '人生の目標・お金・習慣チャレンジ・やりたいこと・教養マップ' },
    { id: 'rules', name: 'rules', label: '決まり', desc: '各スレッドのルールとスキル、作業役、生活の決まり（毎朝の写し）' },
    { id: 'log',   name: 'log',   label: '記録',   desc: '作業ログ、取り組みの現在地、出張と宿泊（毎朝の写し）' },
];

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const mode = new URLSearchParams(location.search).get('m');
const current = MODES.find(m => m.id === mode);

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 上の機能切り替え（表紙・book・dream・rules・log）
function renderModeNav() {
    const nav = document.getElementById('mode-nav');
    if (!nav) return;
    nav.innerHTML = [
        `<a href="./" class="mode-link${current ? '' : ' active'}">表紙</a>`,
        ...MODES.map(m => `<a href="./?m=${m.id}" class="mode-link${m.id === mode ? ' active' : ''}">${escapeHtml(m.name)}</a>`),
    ].join('');
}

// 表紙：4機能のメニュー。トークンの保存だけはここでもできる
function renderMenu() {
    document.querySelector('.layout')?.classList.add('shelf-mode');
    document.getElementById('sidebar').innerHTML = '';
    document.getElementById('content').innerHTML = `
        <h2 class="shelf-title">reading</h2>
        <div class="menu-grid">
            ${MODES.map(m => `
                <a class="menu-card" href="./?m=${m.id}">
                    <div class="menu-card-title">${escapeHtml(m.name)}<span class="menu-card-label">${escapeHtml(m.label)}</span></div>
                    <div class="menu-card-desc">${escapeHtml(m.desc)}</div>
                </a>`).join('')}
        </div>
    `;
    const tokenInput = document.querySelector('.js-token-input');
    const saved = localStorage.getItem('book_pat_token') || localStorage.getItem('dream_pat_token');
    if (tokenInput && saved) tokenInput.value = saved;
    document.querySelectorAll('.js-load-btn').forEach(btn => btn.addEventListener('click', () => alert('読む機能を選んでください。')));
    document.querySelectorAll('.js-save-btn').forEach(btn => btn.addEventListener('click', () => {
        const token = tokenInput?.value.trim();
        if (!token) { alert('トークンを入力してください'); return; }
        localStorage.setItem('book_pat_token', token);
        btn.textContent = '保存しました';
        setTimeout(() => { btn.textContent = '保存'; }, 1200);
    }));
    document.querySelectorAll('.js-cache-reset-btn').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
        try {
            if ('caches' in window) await caches.delete('reading-shell');
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.filter(r => r.scope.startsWith(new URL('./', location.href).href)).map(r => r.unregister()));
            }
        } catch (error) {
            console.error(error);
        }
        location.href = location.pathname + '?nocache=' + Date.now();
    }));
}

async function main() {
    renderModeNav();
    if (!current) { renderMenu(); registerShellWorker(); return; }
    document.title = `reading - ${current.name}`;
    const mod = await import(`./modes/${current.id}.js?v=${CURRENT_VERSION}`);
    mod.start();
    registerShellWorker(); // 機能のJSを読み終えてから（読んだファイルの一覧に入れるため）
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
