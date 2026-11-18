// スキルマップ（2026-11-18、brain #1700）。仲良くなるために必要なことを、まん中から枝を広げて書き、進み具合を色で見る。
// 2人で共有して、どちらも書き足せる。データは用途のデータリポジトリ（save向けはsave_data）の skillmap/map.md。
// JS/CSSを変更した際は、index.html・このファイルのimportの?v=Nを全部同じ新しい値に揃えること（brain等と同じ方式）。
import { fetchFile, saveFile } from './modules/github.js?v=2';
import { loadToken, saveToken, loadMyName, saveMyName, loadCache, saveCache } from './modules/storage.js?v=2';
import { STATES, ROOT_ID, defaultMap, parseFrontMatter, stringify, childrenOf, subtree, countStates, applyOp, layout } from './modules/mapModel.js?v=2';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const OWNER = 'palmelo2nd';
// 読むデータリポジトリ。Index（index_save など）が用途に合わせて書き込む。未設定ならapp_data
const REPO = (() => { try { return localStorage.getItem('app_data_repo') || 'app_data'; } catch { return 'app_data'; } })();
const MAP_PATH = 'skillmap/map.md';

let mapData = null;       // { mapData: [...] }
let tail = '\n';
let selectedId = ROOT_ID;
let busy = false;

const mapView = document.getElementById('map-view');

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getToken() {
    return document.querySelector('.js-token-input')?.value.trim() || '';
}

function setNetworkStatus(html) {
    const el = document.getElementById('network-status-top');
    if (el) el.innerHTML = html;
}

function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ===== 読込 =====

async function loadMap(token, silent = false) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return; }
    try {
        const { content, sha } = await fetchFile(token, OWNER, REPO, MAP_PATH);
        ({ data: mapData, tail } = parseFrontMatter(content));
        saveCache(content, sha);
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
    } catch (error) {
        if (error.status === 404) {
            // まだ一度も保存していない：最初の形を出す（最初に書き換えたときにファイルを作る）
            mapData = defaultMap();
            setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        } else {
            console.error(error);
            const cached = loadCache();
            if (cached) {
                ({ data: mapData, tail } = parseFrontMatter(cached.content));
                setNetworkStatus('<span class="status-badge offline-badge">オフライン（見るだけ）</span>');
                if (!silent) alert('通信できませんでした。この端末に残っている前回の内容を出します（書き換えは電波のある所で）。');
            } else {
                setNetworkStatus('<span class="status-badge error-badge">読み込み失敗</span>');
                if (!silent) alert(`読み込みに失敗しました（${error.message}）。トークンが「${OWNER}/${REPO}」を読めるか確認してください。`);
                return;
            }
        }
    }
    if (!mapData.mapData.some(n => n.ID === selectedId)) selectedId = ROOT_ID;
    render();
}

// ===== 書き換え：毎回ファイルを取り直してから1つの操作を当て、保存する（2人が同時に書いても消し合わないため） =====

async function commit(op, message) {
    const token = getToken();
    if (!token) { alert('トークンを入力してください'); return null; }
    if (busy) return null;
    busy = true;
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            let latest, sha, latestTail;
            try {
                const file = await fetchFile(token, OWNER, REPO, MAP_PATH);
                ({ data: latest, tail: latestTail } = parseFrontMatter(file.content));
                sha = file.sha;
            } catch (error) {
                if (error.status !== 404) throw error;
                latest = defaultMap(); sha = undefined; latestTail = '\n';
            }
            const result = applyOp(latest, op, loadMyName());
            const text = stringify(result.data, latestTail);
            try {
                const { newSha } = await saveFile(token, OWNER, REPO, MAP_PATH, text, sha, `docs: スキルマップ ${message}`);
                mapData = result.data; tail = latestTail;
                saveCache(text, newSha);
                setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
                return result;
            } catch (error) {
                if (error.status === 409 && attempt === 0) continue; // 他の人が同時に保存した：取り直してもう一度
                throw error;
            }
        }
    } catch (error) {
        console.error(error);
        alert(`保存できませんでした（${error.message}）。電波のある所でもう一度お試しください。`);
        return null;
    } finally {
        busy = false;
    }
    return null;
}

// ===== 表示 =====

const STATE_CLASS = { '未着手': 'todo', '取り組み中': 'doing', '身についた': 'done' };

// 枝の名前を、1行あたりの文字数で折り返す（日本語は単語の区切りが無いので文字数で切る）
function wrapLabel(name, width) {
    const chars = [...name];
    const lines = [];
    for (let i = 0; i < chars.length; i += width) lines.push(chars.slice(i, i + width).join(''));
    return lines.slice(0, 3);
}

function renderMap(nodes) {
    const { pos, bounds } = layout(nodes);
    const pad = 80;
    const minX = bounds.minX - pad, minY = bounds.minY - pad;
    const w = bounds.maxX - bounds.minX + pad * 2, h = bounds.maxY - bounds.minY + pad * 2;
    const lines = nodes.filter(n => n.ID !== ROOT_ID && pos[n.ID] && pos[n['親ID']]).map(n => {
        const a = pos[n['親ID']], b = pos[n.ID];
        return `<line class="map-edge depth-${Math.min(b.depth, 3)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    }).join('');
    const boxes = nodes.filter(n => pos[n.ID]).map(n => {
        const p = pos[n.ID];
        const isRoot = n.ID === ROOT_ID;
        const label = wrapLabel(n['名前'], isRoot ? 6 : 7);
        const fs = isRoot ? 20 : p.depth === 1 ? 16 : 14;
        const bw = Math.max(...label.map(l => [...l].length)) * fs + 24;
        const bh = label.length * (fs + 4) + 16;
        const cls = isRoot ? 'root' : STATE_CLASS[n['状態']] || 'todo';
        const text = label.map((l, i) => `<tspan x="${p.x}" y="${p.y - (label.length - 1) * (fs + 4) / 2 + i * (fs + 4)}">${escapeHtml(l)}</tspan>`).join('');
        return `<g class="map-node ${cls}${n.ID === selectedId ? ' selected' : ''}" data-id="${n.ID}" tabindex="0" role="button" aria-label="${escapeHtml(n['名前'])}（${escapeHtml(n['状態'] || 'まん中')}）">
            <rect x="${p.x - bw / 2}" y="${p.y - bh / 2}" width="${bw}" height="${bh}" rx="${isRoot ? bh / 2 : 10}"/>
            <text font-size="${fs}" dominant-baseline="middle" text-anchor="middle">${text}</text>
        </g>`;
    }).join('');
    return `<svg class="map-svg" viewBox="${minX} ${minY} ${w} ${h}" style="min-width:${Math.round(w * 0.8)}px">${lines}${boxes}</svg>`;
}

function renderSummary(nodes) {
    const rows = childrenOf(nodes, ROOT_ID).map(branch => {
        const counts = countStates(subtree(nodes, branch.ID));
        const total = STATES.reduce((s, k) => s + counts[k], 0) || 1;
        const bar = STATES.map(k => `<span class="bar-${STATE_CLASS[k]}" style="width:${counts[k] * 100 / total}%"></span>`).join('');
        return `<button type="button" class="summary-row" data-id="${branch.ID}">
            <span class="summary-name">${escapeHtml(branch['名前'])}</span>
            <span class="summary-bar">${bar}</span>
            <span class="summary-count">身についた ${counts['身についた']} ／ ${total}</span>
        </button>`;
    }).join('');
    return `<div class="panel">
        <div class="panel-title">進み具合</div>
        <div class="legend">${STATES.map(k => `<span class="legend-item ${STATE_CLASS[k]}">${k}</span>`).join('')}</div>
        ${rows}
    </div>`;
}

function renderEditor(nodes) {
    const node = nodes.find(n => n.ID === selectedId) || nodes.find(n => n.ID === ROOT_ID);
    const isRoot = node.ID === ROOT_ID;
    const parent = nodes.find(n => n.ID === node['親ID']);
    const kids = childrenOf(nodes, node.ID);
    const stamp = node['更新日時'] ? `${node['更新日時']}${node['更新者'] ? `（${node['更新者']}）` : ''}` : '';
    return `<div class="panel editor">
        <div class="panel-title">${isRoot ? 'まん中' : '選んでいる枝'}：${escapeHtml(node['名前'])}</div>
        ${parent ? `<div class="sub">つながり：${escapeHtml(parent['名前'])} → ${escapeHtml(node['名前'])}</div>` : ''}
        ${node['リンク']?.URL ? `<a class="app-link" href="${escapeHtml(node['リンク'].URL)}">${escapeHtml(node['リンク']['名前'] || '開く')} →</a>` : ''}
        ${isRoot ? '' : `
        <div class="field-label">進み具合</div>
        <div class="state-buttons">
            ${STATES.map(k => `<button type="button" class="state-btn ${STATE_CLASS[k]}${node['状態'] === k ? ' active' : ''}" data-state="${k}">${k}</button>`).join('')}
        </div>`}
        <div class="field-label">この枝の先に足す</div>
        <div class="row">
            <input type="text" id="add-input" placeholder="例：毎朝ストレッチ" maxlength="20">
            <button type="button" class="primary-btn" id="add-btn">追加</button>
        </div>
        <div class="field-label">ひとことメモ（できたこと・次にやること）</div>
        <textarea id="memo-input" rows="3" maxlength="300">${escapeHtml(node['メモ'] || '')}</textarea>
        <div class="field-label">名前</div>
        <div class="row">
            <input type="text" id="name-input" value="${escapeHtml(node['名前'])}" maxlength="20">
        </div>
        <div class="row actions">
            <button type="button" class="primary-btn" id="update-btn">保存</button>
            ${isRoot ? '' : `<button type="button" class="danger-btn" id="delete-btn" ${kids.length ? 'disabled title="先の枝から消してください"' : ''}>削除</button>`}
        </div>
        ${stamp ? `<div class="sub">最後に書いた日：${escapeHtml(stamp)}</div>` : ''}
    </div>`;
}

function renderSettings() {
    return `<details class="panel settings">
        <summary>設定・使い方</summary>
        <div class="field-label">自分の名前（書いた人として残ります）</div>
        <div class="row">
            <input type="text" id="my-name-input" value="${escapeHtml(loadMyName())}" maxlength="20">
            <button type="button" class="sub-btn" id="my-name-btn">保存</button>
        </div>
        <ul class="help">
            <li>図の枝を押すと、下の欄でその枝を書き換えられます</li>
            <li>色：灰＝未着手、青＝取り組み中、緑＝身についた</li>
            <li>「この枝の先に足す」で、新しい枝を足せます。2人とも書き足せます</li>
            <li>前向きな言葉で書きましょう（例：「〜できるようになる」）</li>
        </ul>
    </details>`;
}

function render() {
    if (!mapData) return;
    const nodes = mapData.mapData;
    mapView.innerHTML = `
        <div class="panel map-panel"><div class="map-scroll">${renderMap(nodes)}</div></div>
        ${renderEditor(nodes)}
        ${renderSummary(nodes)}
        ${renderSettings()}
    `;
    // 図が画面より広いときは横にずらして見る。最初はまん中が見えるようにする
    const scroller = mapView.querySelector('.map-scroll');
    if (scroller) scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    bindEvents();
}

function select(id) {
    selectedId = id;
    render();
    document.querySelector('.editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function bindEvents() {
    mapView.querySelectorAll('.map-node').forEach(g => {
        g.addEventListener('click', () => select(g.dataset.id));
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(g.dataset.id); });
    });
    mapView.querySelectorAll('.summary-row').forEach(b => b.addEventListener('click', () => select(b.dataset.id)));

    mapView.querySelectorAll('.state-btn').forEach(b => b.addEventListener('click', async () => {
        if (await commit({ type: 'update', id: selectedId, fields: { 状態: b.dataset.state } }, `「${b.dataset.state}」に変更`)) {
            render(); toast(`「${b.dataset.state}」にしました`);
        }
    }));

    document.getElementById('add-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('add-input').value.trim();
        if (!name) { alert('足す枝の名前を書いてください'); return; }
        const result = await commit({ type: 'add', parentId: selectedId, name }, `「${name}」を追加`);
        if (result) { selectedId = result.id; render(); toast(`「${name}」を足しました`); }
    });

    document.getElementById('update-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('name-input').value.trim();
        const memo = document.getElementById('memo-input').value.trim();
        if (!name) { alert('名前を書いてください'); return; }
        if (await commit({ type: 'update', id: selectedId, fields: { 名前: name, メモ: memo } }, `「${name}」を保存`)) {
            render(); toast('保存しました');
        }
    });

    document.getElementById('delete-btn')?.addEventListener('click', async () => {
        const node = mapData.mapData.find(n => n.ID === selectedId);
        if (!node || !confirm(`「${node['名前']}」を消します。よろしいですか？`)) return;
        const result = await commit({ type: 'delete', id: selectedId }, `「${node['名前']}」を削除`);
        if (result) { selectedId = result.id || ROOT_ID; render(); toast('消しました'); }
    });

    document.getElementById('my-name-btn')?.addEventListener('click', () => {
        saveMyName(document.getElementById('my-name-input').value.trim());
        toast('名前を保存しました');
    });
}

// ===== 上のバー =====

document.querySelectorAll('.js-load-btn').forEach(btn => btn.addEventListener('click', () => loadMap(getToken())));

document.querySelectorAll('.js-save-btn').forEach(btn => btn.addEventListener('click', () => {
    const token = getToken();
    if (!token) { alert('トークンを入力してください'); return; }
    saveToken(token);
    btn.textContent = '保存しました';
    setTimeout(() => { btn.textContent = '保存'; }, 1200);
}));

document.querySelectorAll('.js-cache-reset-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
    try {
        // 自分の名前で始まるキャッシュとService Workerだけを消す（ルートCLAUDE.mdの決まり。今は使っていない）
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter(k => k.startsWith('skillmap-')).map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.filter(r => r.scope.startsWith(new URL('./', location.href).href)).map(r => r.unregister()));
        }
    } catch (error) {
        console.error(error);
    }
    location.href = location.pathname + '?nocache=' + Date.now();
}));

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) {
        document.querySelector('.js-token-input').value = saved;
        loadMap(saved, true);
    } else {
        mapView.innerHTML = '<div class="panel"><p class="sub">トークンを入れて「読込」を押してください。</p></div>';
    }
});
