// キャッシュバスティング：index.html・このファイルのimport文の「?v=N」は同じ値に揃えて更新する（brain等と同じ方式）。
// 現在のバージョン: 7
import { loadToken, saveToken, activate, DATA_REPO_KEY } from '../../index_common/js/modules/storage.js?v=14';

// Master（2026-11-02）：管理者（my）の動線用。3つの用途のトークンをここで保存しておき、リンクで各INDEXへ移る。
// トークンは用途別INDEXと同じキー（index_pat_token_<データリポジトリ名>）に保存するだけで、移動先のINDEXが
// 自分の用途のトークンを読み込んで各アプリへ引き継ぐ。URLにはトークンを載せない（閲覧履歴等に残さないため）。
// 公開ページなので開くこと自体は防げない。myのトークンでapp_dataに届くことを確かめたときだけ、リンクを出す。
const OWNER = 'palmelo2nd';
const SPACES = [
    { label: 'my',     dataRepo: 'app_data',    href: '../index_my/' },
    { label: 'save',   dataRepo: 'save_data',   href: '../index_save/' },
    { label: 'family', dataRepo: 'family_data', href: '../index_fam/' },
];
const GATE_REPO = 'app_data';
// 前回「確認OK」だった用途（{ dataRepo: true }）。圏外ではGitHubに届かないので、これでリンクを出す（2026-11-27、brain #-105）
const LAST_OK_KEY = 'master_last_ok';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

// (2) インプット: dataRepo, token  (4) アウトプット — 'ok'（届く）／'ng'（届かない）／'offline'（電波が届かず確かめられない）
async function canReach(dataRepo, token) {
    if (!token) return 'ng';
    if (!navigator.onLine) return 'offline';
    try {
        const res = await fetch(`https://api.github.com/repos/${OWNER}/${dataRepo}`, {
            headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
            cache: 'no-store',
        });
        return res.ok ? 'ok' : 'ng';
    } catch (error) {
        console.error(error);
        return 'offline';
    }
}

function loadLastOk() {
    try { return JSON.parse(localStorage.getItem(LAST_OK_KEY)) || {}; } catch { return {}; }
}
function saveLastOk(map) {
    try { localStorage.setItem(LAST_OK_KEY, JSON.stringify(map)); } catch { /* 保存できない環境では何もしない */ }
}

function badge(kind, text) {
    return `<span class="status-badge ${kind}">${text}</span>`;
}

function renderRows() {
    const box = document.getElementById('space-list');
    box.innerHTML = '';
    SPACES.forEach(space => {
        const row = document.createElement('div');
        row.className = 'space-row';
        row.innerHTML = `
            <div class="space-head"><span class="space-name"></span><span class="space-repo"></span></div>
            <div class="space-token">
                <input type="password" autocomplete="off" placeholder="トークン">
                <button type="button">保存</button>
            </div>
            <div class="space-foot">
                <span class="space-status"></span>
                <a class="space-open" hidden>開く</a>
            </div>`;
        row.querySelector('.space-name').textContent = space.label;
        row.querySelector('.space-repo').textContent = space.dataRepo;
        row.querySelector('input').value = loadToken(space.dataRepo) || '';
        row.querySelector('.space-open').href = space.href;
        row.querySelector('button').addEventListener('click', () => onSave(space, row));
        space.row = row;
        box.appendChild(row);
    });
}

// (3) メイン — 各用途のトークンを確かめ、状態を表示する。myが通ったときだけ「開く」を出す
// 圏外で確かめられなかった用途は、前回「確認OK」だったかどうかで代わりに判断する
async function refresh() {
    const checked = await Promise.all(SPACES.map(s => canReach(s.dataRepo, loadToken(s.dataRepo))));
    const lastOk = loadLastOk();
    SPACES.forEach((s, i) => { if (checked[i] !== 'offline') lastOk[s.dataRepo] = checked[i] === 'ok'; });
    saveLastOk(lastOk);
    const usedLast = checked.some(r => r === 'offline');
    const results = SPACES.map((s, i) => checked[i] === 'offline' ? !!lastOk[s.dataRepo] : checked[i] === 'ok');
    const gateOk = results[SPACES.findIndex(s => s.dataRepo === GATE_REPO)];
    SPACES.forEach((space, i) => {
        const saved = loadToken(space.dataRepo);
        const status = !saved ? badge('offline-badge', '未保存')
            : checked[i] === 'offline' ? (results[i] ? badge('online-badge', '前回確認OK') : badge('offline-badge', '圏外'))
            : results[i] ? badge('online-badge', '確認OK') : badge('error-badge', '届きません');
        space.row.querySelector('.space-status').innerHTML = status;
        space.row.querySelector('.space-open').hidden = !(gateOk && results[i]);
    });
    document.getElementById('gate-message').textContent = !gateOk
        ? 'myのトークンを保存して確認できると、各INDEXへのリンクが表示されます。'
        : usedLast ? '圏外のため、前回の確認結果でリンクを表示しています（圏外で開けるのはmyだけです）。' : '';
}

// ===== 画面を圏外でも開けるようにする（このフォルダのsw.js。readingと同じ方式） =====
// 最初に開いたときはService Workerが動き出す前にJS・CSSを読み終えているので、読んだファイルの一覧を渡して端末に残してもらう
async function registerShellWorker() {
    if (!('serviceWorker' in navigator)) return;
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

// 電波が切れた・戻ったら確かめ直す
window.addEventListener('offline', () => refresh());
window.addEventListener('online', () => refresh());

async function onSave(space, row) {
    const token = row.querySelector('input').value.trim();
    if (!token) return alert('トークンを入力してください');
    // saveTokenは「現在の用途」も切り替えるため、保存の前の用途に戻しておく（用途の切り替えは移動先のINDEXで行う）
    let prevRepo = null;
    try { prevRepo = localStorage.getItem(DATA_REPO_KEY); } catch { /* 読めない環境では戻さない */ }
    saveToken(space.dataRepo, token);
    if (prevRepo && prevRepo !== space.dataRepo) activate(prevRepo, loadToken(prevRepo));
    await refresh();
}

window.addEventListener('DOMContentLoaded', () => {
    renderRows();
    refresh();
    registerShellWorker();
});

// ===== キャッシュ更新（INDEXと同じ） =====
document.querySelectorAll('.js-cache-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
        try {
            if ('caches' in window) {
                // 同じドメインの他のアプリ（bookの「端末に保存した本」など）のキャッシュを消さないよう、自分の名前で始まるものだけ消す
                const keys = await caches.keys();
                await Promise.all(keys.filter(k => k.startsWith('master-')).map(k => caches.delete(k)));
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
