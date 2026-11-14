// 現在のバージョン: 59
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文、problems.jsのlevels.jsのimportの?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import {
    loadToken, saveToken, loadRecords, addRecord,
    loadPlayerName, savePlayerName, loadPending, savePending, loadSharedCache, saveSharedCache,
    clearLocalRecordsFor, listLocalRecordNames, loadRecordsOf,
    loadGridView, saveGridView, loadPlayerNames, loadGuidesRead, markGuideRead,
    loadInputMethod, saveInputMethod, loadKbSettings, saveKbSettings
} from './modules/storage.js?v=59';
import { fetchFile, saveFile } from './modules/github.js?v=59';
import { parseFrontMatter, stringifyRecords, computeRanking, getLatestPlays } from './modules/dataModel.js?v=59';
import { LEVELS, PLANNED_LEVELS, RANK_TIMES, pickProblems, textOf, rankFor, nextRankTarget, isRankAtLeast, UNLOCK_RANK, normalizeTyped, widthLabelOf, useSoftKeyboardRankTimes } from './modules/problems.js?v=59';
import { GUIDES as GUIDES_DEVICE, cross } from './modules/guides.js?v=59';
import { GUIDES_SOFT, softCross } from './modules/guidesSoft.js?v=59';
import { LEVEL_DEFS } from './modules/levels.js?v=59';
import { buildDict } from './modules/kbCore.js?v=59';
import { createSoftKeyboard } from './modules/softKeyboard.js?v=59';
import { RELEASE_BUILD } from './buildConfig.js?v=59';

// ===== ストア版（2026-11-14） =====
// ストア版（STORE）では、GitHubとトークンを一切使わない（ストア公開タスク一覧 D1・1-1）。
//  ・上部バー（読込・保存・トークン・キャッシュ更新）を出さない。GitHubへの通信をしない
//  ・記録は端末内だけ。「みんなのベスト」「ランキング」「最新記録」は、この端末で遊んだ全員の記録から作る（家族で1台を回す使い方）
//  ・打ち方は専用キーボードだけ（D7）
// Web版で ?store を付けて開くと、同じ見た目を確かめられる（記録は端末内のものをそのまま使う）。
const STORE = RELEASE_BUILD || new URLSearchParams(location.search).has('store');
if (STORE) {
    document.body.classList.add('store-build');
    document.querySelector('.top-bar')?.remove();
    useSoftKeyboardRankTimes(); // 目安タイムを専用キーボードの押す回数で数え直す（problems.js）
}
// OSの文字の倍率（AndroidのWebViewは、OSの文字サイズに合わせて文字だけを大きくする）。
// 100pxと指定した文字の実際の大きさから測り、CSSの --tz に入れる。キーボードの文字はこれで割って、キーからはみ出さないようにする。
// 測れない環境（ふつうのブラウザなど）では 1 のまま。【未確認】実機（Android）で、この測り方で倍率が取れるかは、包装後に確かめる
(function measureTextZoom() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px;line-height:1';
    probe.textContent = 'あ';
    document.body.appendChild(probe);
    const z = parseFloat(getComputedStyle(probe).fontSize) / 100;
    probe.remove();
    if (z > 1.01 && z < 4) document.documentElement.style.setProperty('--tz', String(z));
})();

// 解説：Web版はiPhoneの画面写しと文（guides.js）、ストア版は専用キーボードの図と文（guidesSoft.js）。idは共通
const GUIDES = STORE ? GUIDES_SOFT : GUIDES_DEVICE;

const OWNER = 'palmelo2nd';
// 読むデータリポジトリ。用途別INDEX（index_my／index_fam／index_save）が開いたときに保存した値（my＝app_data／save＝save_data／family＝family_data）。未設定ならapp_data（2026-11-02）
const REPO  = (() => { try { return localStorage.getItem('app_data_repo') || 'app_data'; } catch { return 'app_data'; } })();
const RECORDS_PATH = 'typing/records.md';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const versionBadgeEl = document.getElementById('app-version-badge');
if (versionBadgeEl && CURRENT_VERSION) versionBadgeEl.textContent = `v${CURRENT_VERSION}`;

const game = document.getElementById('game');

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTime(ms) {
    const sec = ms / 1000;
    return sec >= 60 ? `${Math.floor(sec / 60)}分${(sec % 60).toFixed(1).padStart(4, '0')}秒` : `${sec.toFixed(1)}秒`;
}

function formatDate(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ===== トークン・共有記録の読込 =====
// 共有記録（app_data/typing/records.md）はトークンがあるときだけ読み書きする。
// トークンが無い／通信できない場合は、端末内の記録だけで遊べる（共有はされない）。

const tokenInput = document.querySelector('.js-token-input'); // ストア版では null（上部バーごと消す）
let sharedPlays = STORE ? localPlays() : loadSharedCache(); // 共有記録（全員分のプレイ）。ストア版はこの端末の全員分

// ストア版の「みんな」の記録：この端末に記録がある全員の履歴を、共有記録と同じ形のプレイに直す
function localPlays() {
    const p2 = (v) => String(v).padStart(2, '0');
    const stamp = (iso) => { const d = new Date(iso); return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const plays = [];
    for (const name of listLocalRecordNames()) {
        const records = loadRecordsOf(name);
        for (const [lv, rec] of Object.entries(records)) {
            for (const h of rec.history || []) {
                plays.push({ 'ID': name + '-' + h.date, 'プレイ名': name, 'レベル': Number(lv), 'ミリ秒': h.ms, 'ミス': h.misses, '日時': stamp(h.date) });
            }
        }
    }
    return plays;
}

function setNetworkStatus(html) {
    const el = document.getElementById('network-status-top');
    if (el) el.innerHTML = html;
}

async function loadShared(token, silent = true) {
    if (!token) { if (!silent) alert('トークンを入力してください'); return false; }
    try {
        let text = '';
        try {
            ({ content: text } = await fetchFile(token, OWNER, REPO, RECORDS_PATH));
        } catch (error) {
            if (error.status !== 404) throw error; // 404＝まだ誰もプレイしていない
        }
        sharedPlays = text ? (parseFrontMatter(text).data.playData || []) : [];
        saveSharedCache(sharedPlays);
        setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        return true;
    } catch (error) {
        console.error(error);
        setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
        if (!silent) alert('共有記録を読み込めませんでした（' + error.message + '）。端末内のキャッシュを表示します。');
        return false;
    }
}

// プレイを共有記録へ追記する（競合409は取り直して1回だけ再試行）。失敗時は例外。
async function appendPlays(token, plays) {
    for (let attempt = 0; attempt < 2; attempt++) {
        let playData = [], tail = '\n', sha;
        try {
            const { content: text, sha: sh } = await fetchFile(token, OWNER, REPO, RECORDS_PATH);
            const parsed = parseFrontMatter(text);
            playData = parsed.data.playData || [];
            tail = parsed.tail;
            sha = sh;
        } catch (error) {
            if (error.status !== 404) throw error;
        }
        const known = new Set(playData.map(p => p['ID']));
        playData.push(...plays.filter(p => !known.has(p['ID'])));
        try {
            await saveFile(token, OWNER, REPO, RECORDS_PATH, stringifyRecords(playData, tail), sha);
            sharedPlays = playData;
            saveSharedCache(sharedPlays);
            return;
        } catch (error) {
            if (error.status === 409 && attempt === 0) continue;
            throw error;
        }
    }
}

// 未送信のプレイがあれば送る。送れたらキューを空にする。
async function flushPending(token) {
    const pending = loadPending();
    if (pending.length === 0 || !token) return;
    try {
        await appendPlays(token, pending);
        savePending([]);
    } catch (error) {
        console.error(error);
    }
}

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const token = tokenInput.value.trim() || loadToken() || '';
        if (!token) return alert('トークンを入力してください');
        tokenInput.value = token;
        await flushPending(token);
        await loadShared(token, false);
        if (!session) renderStart();
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
                // 同じドメインの他のアプリ（bookの「端末に保存した本」など）のキャッシュを消さないよう、自分の名前で始まるものだけ消す
                const keys = await caches.keys();
                await Promise.all(keys.filter(k => k.startsWith('typing-')).map(k => caches.delete(k)));
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

// ===== 画面1：レベル選択（プレイ名・レベルのマス・レベルごとのパネル） =====
// マスは5列×20行（全PLANNED_LEVELS）。「自分の記録」は自分の最高記録、「みんなのベスト」は全員の中の最高記録のランクで色分けする。
// マスを押すと下からパネルが出て、挑戦ボタンとそのレベルの記録（自分の履歴／みんなのランキング）を見られる。

function rankBadge(level, ms) {
    const r = rankFor(level, ms);
    return '<span class="rank rank-' + r + '">' + r + '</span>';
}

function renderRankingTable(level) {
    const ranking = computeRanking(sharedPlays, level);
    if (ranking.length === 0) return '<p class="placeholder">まだ記録がありません。</p>';
    const me = loadPlayerName();
    return '<table class="history-table"><tbody>' + ranking.slice(0, 10).map((r, i) =>
        '<tr class="' + (r.name === me ? 'me' : '') + '"><td>' + (i + 1) + '位</td><td>' + escapeHtml(r.name) + '</td>' +
        '<td>' + formatTime(r.ms) + '</td><td>' + rankBadge(level, r.ms) + '</td><td>ミス' + r.misses + '</td></tr>').join('') + '</tbody></table>';
}

// 自分のそのレベルの履歴（新しい順）。この端末の履歴を優先し、無いとき（別の端末で遊んだ等）だけ
// 共有記録の自分のプレイ名の記録で補う（同じプレイを二重に表示しないため）。
function myHistory(level, records) {
    const local = (records[level]?.history || []).map(h => ({ ms: h.ms, misses: h.misses, date: formatDate(h.date) }));
    if (local.length > 0) return local;
    const me = loadPlayerName();
    if (!me) return [];
    return sharedPlays.filter(p => p['レベル'] === level && p['プレイ名'] === me)
        .sort((a, b) => (b['日時'] || '').localeCompare(a['日時'] || ''))
        .map(p => ({ ms: p['ミリ秒'], misses: p['ミス'], date: (p['日時'] || '').slice(5) }));
}

function renderMyHistoryTable(level, records) {
    const hist = myHistory(level, records);
    if (hist.length === 0) return '<p class="placeholder">まだ記録がありません。</p>';
    return '<table class="history-table"><tbody>' + hist.slice(0, 10).map(h =>
        '<tr><td>' + escapeHtml(h.date) + '</td><td>' + formatTime(h.ms) + '</td><td>' + rankBadge(level, h.ms) + '</td><td>ミス' + h.misses + '</td></tr>').join('') +
        '</tbody></table>';
}

// 自分の最高記録（ミリ秒）。この端末の自己ベストと、共有記録の自分のプレイ名の記録のうち速い方。無ければ null。
function myBestMs(level, records) {
    const me = loadPlayerName();
    const candidates = [];
    if (records[level]?.best) candidates.push(records[level].best.ms);
    if (me) sharedPlays.forEach(p => { if (p['レベル'] === level && p['プレイ名'] === me) candidates.push(p['ミリ秒']); });
    return candidates.length ? Math.min(...candidates) : null;
}

// レベルの解放：最初のレベルは常に開いている。以降は、直前のレベルの自分の最高記録が
// 解放ランク（UNLOCK_RANK、現在はA）以上なら開く。
function isLevelUnlocked(level, records) {
    if (level === LEVELS[0].level) return true;
    const prev = myBestMs(level - 1, records);
    return prev !== null && isRankAtLeast(level - 1, prev, UNLOCK_RANK);
}

let gridView = loadGridView(); // 'me'（自分の記録）／ 'all'（みんなのベスト）

// マス1つ分の状態：{ cls, sub }（cls＝色分けのクラス、sub＝レベル表記の下に出す文字）
function cellState(level, records) {
    if (!LEVELS.some(l => l.level === level)) return { cls: 'soon', sub: '準備中' };
    if (gridView === 'all') {
        const top = computeRanking(sharedPlays, level)[0];
        if (!top) return { cls: 'untried', sub: '未挑戦' };
        const r = rankFor(level, top.ms);
        return { cls: 'r-' + r, sub: r };
    }
    if (!isLevelUnlocked(level, records)) return { cls: 'locked', sub: '🔒' };
    const best = myBestMs(level, records);
    if (best === null) return { cls: 'untried', sub: '未挑戦' };
    const r = rankFor(level, best);
    return { cls: 'r-' + r, sub: r };
}

// ===== 上部のタブ（遊ぶ／解説）と、プレイ名の選択 =====

let mainTab = 'play';      // 'play'（遊ぶ）／ 'guide'（解説）
let openGuideId = null;    // 解説タブで開いているページ（null＝一覧）
let addingName = false;    // 「＋新しい人」で名前の入力欄を出している間 true

// 解説が開いているか（openAtLevel のレベルが自分の記録で開いていれば読める）
function isGuideOpen(guide, records) {
    return isLevelUnlocked(guide.openAtLevel, records);
}

function hasUnreadGuide(records) {
    const read = loadGuidesRead();
    return GUIDES.some(g => isGuideOpen(g, records) && !read.includes(g.id));
}

function renderMainTabs(records) {
    return `
        <div class="main-tabs">
            <button type="button" class="main-tab ${mainTab === 'play' ? 'active' : ''}" data-main-tab="play">遊ぶ</button>
            <button type="button" class="main-tab ${mainTab === 'guide' ? 'active' : ''}" data-main-tab="guide">解説${hasUnreadGuide(records) ? '<span class="new-dot">NEW</span>' : ''}</button>
        </div>`;
}

function bindMainTabs() {
    game.querySelectorAll('[data-main-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            mainTab = btn.dataset.mainTab;
            openGuideId = null;
            renderStart();
            window.scrollTo(0, 0);
        });
    });
}

// 選べる名前：この端末で登録した名前＋共有記録に出てくる名前（重複なし・登録順）
function playerNames() {
    const names = [...loadPlayerNames()];
    for (const p of sharedPlays) if (p['プレイ名'] && !names.includes(p['プレイ名'])) names.push(p['プレイ名']);
    return names;
}

function renderNameRow() {
    const me = loadPlayerName();
    const names = playerNames();
    const showInput = addingName || names.length === 0;
    return `
        <div class="name-row">
            <span class="name-label">プレイ名</span>
            <div class="name-chips">
                ${names.map(n => `<button type="button" class="name-chip ${n === me ? 'active' : ''}" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
                ${showInput ? '' : '<button type="button" class="name-add" id="name-add">＋新しい人</button>'}
            </div>
        </div>
        ${showInput ? `
        <div class="name-new">
            <input type="text" id="player-name" class="name-input" maxlength="20" autocomplete="off" placeholder="名前を入力">
            <button type="button" class="post-btn name-save" id="name-save">登録</button>
            ${names.length ? '<button type="button" class="sub-btn" id="name-cancel">やめる</button>' : ''}
        </div>` : ''}
        ${!me && !showInput ? '<p class="notice">遊ぶ人の名前を選んでください。</p>' : ''}`;
}

function bindNameRow() {
    game.querySelectorAll('[data-name]').forEach(btn => {
        btn.addEventListener('click', () => {
            savePlayerName(btn.dataset.name);
            renderStart(); // 名前が変わると「自分の記録」も変わるため描き直す
        });
    });
    document.getElementById('name-add')?.addEventListener('click', () => {
        addingName = true;
        renderStart();
        document.getElementById('player-name')?.focus();
    });
    document.getElementById('name-cancel')?.addEventListener('click', () => {
        addingName = false;
        renderStart();
    });
    document.getElementById('name-save')?.addEventListener('click', () => {
        const input = document.getElementById('player-name');
        const name = input.value.trim();
        if (!name) { alert('名前を入力してください'); input.focus(); return; }
        savePlayerName(name);
        addingName = false;
        renderStart();
    });
}

function renderStart() {
    const records = loadRecords();
    if (mainTab === 'guide') { renderGuides(records); return; }
    const pending = loadPending().length;
    const latest = getLatestPlays(sharedPlays, 5);
    const current = frontierLevel(records);
    const cells = [];
    for (let lv = 1; lv <= PLANNED_LEVELS; lv++) {
        const st = cellState(lv, records);
        cells.push(`<button type="button" class="cell ${st.cls} ${lv === current && gridView === 'me' ? 'current' : ''}" data-level="${lv}" ${st.cls === 'soon' ? 'disabled' : ''}>` +
            `<span class="cell-lv">Lv${lv}</span><span class="cell-rank">${st.sub}</span></button>`);
    }
    // 次に開くレベルの条件（自分の記録で、まだ開いていない最初のレベル）
    const nextLocked = LEVELS.find(l => !isLevelUnlocked(l.level, records));
    const nextRule = nextLocked
        ? `次の<b>Lv${nextLocked.level}</b>は、Lv${nextLocked.level - 1}で<b class="rank rank-${UNLOCK_RANK}">${UNLOCK_RANK}</b>ランク以上（${RANK_TIMES[nextLocked.level - 1][UNLOCK_RANK]}秒以内）を取ると開きます`
        : `<b class="rank rank-${UNLOCK_RANK}">${UNLOCK_RANK}</b>ランク以上を取ると次のレベルが開きます`;
    const firstTime = loadPlayerNames().length === 0 && !loadPlayerName(); // はじめて開いた（名前をまだ1つも登録していない）
    game.innerHTML = `
        ${renderMainTabs(records)}
        <h2 class="game-title">タイムアタック</h2>
        ${firstTime ? `
        <div class="welcome">
            <p class="welcome-title">はじめての方へ</p>
            <ol class="welcome-steps">
                <li>下の欄に<b>名前</b>を入れて「登録」を押します</li>
                <li>「<b>つづきから Lv1 に挑戦する</b>」を押すと始まります</li>
                <li>打ち方がわからないときは、上の「<b>解説</b>」から「フリック入力のきほん」を読んでみてください</li>
            </ol>
            <button type="button" class="sub-btn" id="welcome-guide">解説「フリック入力のきほん」を読む</button>
        </div>` : ''}
        ${renderNameRow()}
        ${renderInputMethodRow()}
        <button type="button" class="post-btn continue-btn" id="continue-btn">つづきから　Lv${current} に挑戦する</button>
        ${pending > 0 && !STORE ? `<p class="notice">共有に未送信のプレイが${pending}件あります。「読込」で再送します。</p>` : ''}
        <div class="view-toggle">
            <button type="button" class="view-btn ${gridView === 'me' ? 'active' : ''}" data-view="me">自分の記録</button>
            <button type="button" class="view-btn ${gridView === 'all' ? 'active' : ''}" data-view="all">みんなのベスト</button>
        </div>
        <p class="next-rule">${nextRule}</p>
        <div class="level-grid">${cells.join('')}</div>
        <details class="history">
            <summary>みんなの最新記録</summary>
            ${latest.length === 0 ? '<p class="placeholder">まだ記録がありません。</p>' : '<table class="history-table"><tbody>' + latest.map(p =>
                '<tr><td>' + escapeHtml(p['日時'].slice(5)) + '</td><td>' + escapeHtml(p['プレイ名']) + '</td><td>Lv' + p['レベル'] + '</td><td>' +
                formatTime(p['ミリ秒']) + '</td><td>' + rankBadge(p['レベル'], p['ミリ秒']) + '</td></tr>').join('') + '</tbody></table>'}
        </details>
        ${renderClearBox()}
        <div id="level-sheet"></div>
    `;
    bindClearBox();
    document.getElementById('welcome-guide')?.addEventListener('click', () => { openGuide('basic'); });
    document.getElementById('continue-btn').addEventListener('click', () => tryStart(current));
    bindMainTabs();
    bindNameRow();
    bindInputMethodRow();
    game.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            gridView = btn.dataset.view;
            saveGridView(gridView);
            renderStart();
        });
    });
    game.querySelectorAll('.cell:not(.soon)').forEach(btn => {
        btn.addEventListener('click', () => openLevelSheet(Number(btn.dataset.level), gridView));
    });
}

// ===== 打ち方（自分のキーボード／専用キーボード）と専用キーボードの設定 =====
// Web版（家族用）は自分のキーボードが既定。専用キーボード（アプリ内キーボード。ストア版で使う予定）は切り替えて選ぶ（2026-11-11）。

let inputMethod = STORE ? 'soft' : loadInputMethod(); // ストア版は専用キーボードだけ
let kbSettings = loadKbSettings();
const KB_ROW_H = { s: 52, m: 62, l: 76 }; // キーの大きさ（1行の高さ px）

function renderInputMethodRow() {
    const soft = inputMethod === 'soft';
    return `
        ${STORE ? '' : `<div class="method-row">
            <span class="name-label">打ち方</span>
            <div class="view-toggle method-toggle">
                <button type="button" class="view-btn ${soft ? '' : 'active'}" data-method="device">自分のキーボード</button>
                <button type="button" class="view-btn ${soft ? 'active' : ''}" data-method="soft">専用キーボード</button>
            </div>
        </div>`}
        ${soft ? `
        <div class="kb-settings">
            <span class="seg" id="kb-size">キーの大きさ
                ${['s', 'm', 'l'].map(v => `<button type="button" data-size="${v}" class="${kbSettings.size === v ? 'on' : ''}">${{ s: '小', m: '中', l: '大' }[v]}</button>`).join('')}
            </span>
            <label><input type="checkbox" id="kb-vib" ${kbSettings.vibrate ? 'checked' : ''}> 振動</label>
        </div>` : ''}`;
}

function bindInputMethodRow() {
    game.querySelectorAll('[data-method]').forEach(btn => btn.addEventListener('click', () => {
        inputMethod = btn.dataset.method;
        saveInputMethod(inputMethod);
        renderStart();
    }));
    const update = (patch) => { kbSettings = { ...kbSettings, ...patch }; saveKbSettings(kbSettings); };
    game.querySelectorAll('[data-size]').forEach(btn => btn.addEventListener('click', () => {
        update({ size: btn.dataset.size });
        game.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('on', b === btn));
    }));
    document.getElementById('kb-vib')?.addEventListener('change', (e) => update({ vibrate: e.target.checked }));
}

// 変換の辞書（読み → 漢字・カタカナ語）。アプリの全お題から作る。専用キーボードで初めて遊ぶときに1回だけ作る
let kbDict = null;
const getDict = () => (kbDict ||= buildDict(LEVEL_DEFS.flatMap(d => d.problems)));

// ===== その他：この端末の記録を消す（人・レベルを選べる） =====
// 消すのは端末内の自己ベスト・履歴・未送信だけ。共有記録は消えない。
// 「全員」「すべてのレベル」のときは、ランキングのキャッシュも消す（従来の「この端末の記録を消す」と同じ）。

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

// レベルの選択肢：選んだ人（''＝全員）の端末内の記録があるレベル
function clearLevelOptions(name) {
    const levels = new Set();
    for (const n of name ? [name] : listLocalRecordNames()) {
        Object.keys(loadRecordsOf(n)).forEach(lv => levels.add(Number(lv)));
    }
    return '<option value="">すべてのレベル</option>' +
        [...levels].sort((a, b) => a - b).map(lv => `<option value="${lv}">Lv${lv}</option>`).join('');
}

function renderClearBox() {
    const names = listLocalRecordNames();
    const me = loadPlayerName();
    const selected = names.includes(me) ? me : ''; // 既定は今選んでいる人（その人の記録が無ければ全員）
    return `
        <details class="history other-box">
            <summary>その他</summary>
            <p class="clear-lead">${STORE ? 'この端末の記録（自己ベスト・履歴）を消します。消した記録は元に戻せません。' : 'この端末の記録（自己ベスト・履歴・未送信のプレイ）を消します。共有記録は消えません。'}</p>
            <div class="clear-form">
                <label class="clear-field">人
                    <select id="clear-name">
                        <option value="">全員</option>
                        ${names.map(n => `<option value="${escapeAttr(n)}" ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
                    </select>
                </label>
                <label class="clear-field">レベル
                    <select id="clear-level">${clearLevelOptions(selected)}</select>
                </label>
                <button type="button" id="clear-local-btn" class="clear-local-btn">この端末の記録を消す</button>
            </div>
            ${STORE ? renderAbout() : ''}
        </details>`;
}

// ===== このアプリについて（ストア版。その他の中に出す） =====
// 【要確認】ふりっくふろっく用のプライバシーポリシー・問い合わせページは、ou501.com にまだ無い（kanziのページだけ）。
// ストア公開タスク一覧 4章でページを作ったら、URLをここで差し替える。
const ABOUT = {
    privacy: 'https://www.ou501.com/privacy-policy/',
    support: 'https://www.ou501.com/support/',
};
function renderAbout() {
    return `
            <div class="about">
                <p class="about-title">このアプリについて</p>
                <p>ふりっくふろっく ${CURRENT_VERSION ? 'v' + escapeHtml(CURRENT_VERSION) : ''}</p>
                <p>記録はこの端末の中だけに保存します。インターネットには送りません。</p>
                <p><a href="${ABOUT.privacy}" target="_blank" rel="noopener">プライバシーポリシー</a> ／ <a href="${ABOUT.support}" target="_blank" rel="noopener">お問い合わせ</a></p>
            </div>`;
}

function bindClearBox() {
    const nameSel = document.getElementById('clear-name');
    const levelSel = document.getElementById('clear-level');
    nameSel.addEventListener('change', () => { levelSel.innerHTML = clearLevelOptions(nameSel.value); });
    document.getElementById('clear-local-btn').addEventListener('click', () => {
        const name = nameSel.value || null;
        const level = levelSel.value ? Number(levelSel.value) : null;
        const who = name ? `${name}さん` : '全員';
        const what = level ? `Lv${level}` : 'すべてのレベル';
        const extra = STORE ? '' : (!name && !level ? '（ランキングのキャッシュも消します）' : '');
        const note = STORE ? '元に戻せません' : '共有記録は消えません';
        if (!confirm(`この端末の「${who}・${what}」の記録を消します${extra}。${note}。よろしいですか？`)) return;
        clearLocalRecordsFor(name, level);
        if (STORE) sharedPlays = localPlays();
        else if (!name && !level) sharedPlays = [];
        renderStart();
    });
}

// レベルのパネル（画面の下から出る）。tab＝'me'（自分の記録）／'all'（みんなのランキング）
function openLevelSheet(level, tab) {
    const records = loadRecords();
    const unlocked = isLevelUnlocked(level, records);
    const best = myBestMs(level, records);
    const sheet = document.getElementById('level-sheet');
    sheet.innerHTML = `
        <div class="sheet-backdrop" id="sheet-backdrop"></div>
        <div class="sheet" role="dialog" aria-label="Lv${level}">
            <div class="sheet-head">
                <span class="sheet-title">Lv${level}</span>
                <span class="sheet-best">${best !== null ? '自分のベスト ' + formatTime(best) + ' ' + rankBadge(level, best) : '自分のベスト なし'}</span>
                <button type="button" class="sheet-close" id="sheet-close" aria-label="閉じる">×</button>
            </div>
            ${unlocked
                ? '<button type="button" class="post-btn sheet-start" id="sheet-start">挑戦する</button>'
                : '<p class="sheet-lock">Lv' + (level - 1) + 'で' + UNLOCK_RANK + 'ランク以上を取ると開きます</p>'}
            <div class="view-toggle">
                <button type="button" class="view-btn ${tab === 'me' ? 'active' : ''}" data-tab="me">自分の記録</button>
                <button type="button" class="view-btn ${tab === 'all' ? 'active' : ''}" data-tab="all">みんなのランキング</button>
            </div>
            <div class="sheet-body">${tab === 'all' ? renderRankingTable(level) : renderMyHistoryTable(level, records)}</div>
        </div>
    `;
    const close = () => { sheet.innerHTML = ''; };
    document.getElementById('sheet-backdrop').addEventListener('click', close);
    document.getElementById('sheet-close').addEventListener('click', close);
    sheet.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => openLevelSheet(level, btn.dataset.tab)));
    document.getElementById('sheet-start')?.addEventListener('click', () => {
        if (!loadPlayerName()) close();
        tryStart(level);
    });
}

// 解説のページを開く（はじめての案内・結果画面のお知らせ・戻るボタンから使う）
function openGuide(id) {
    mainTab = 'guide';
    openGuideId = id;
    renderStart();
    window.scrollTo(0, 0);
}

// 名前が選ばれていれば、そのレベルを始める
function tryStart(level) {
    if (!loadPlayerName()) { alert('先に、遊ぶ人の名前を選ぶか登録してください'); return; }
    startGame(level);
}

// 「つづきから」のレベル：自分の記録で開いているレベルのうち、いちばん先のもの
function frontierLevel(records) {
    let lv = LEVELS[0].level;
    for (const l of LEVELS) if (isLevelUnlocked(l.level, records)) lv = l.level;
    return lv;
}

// ===== 解説タブ（一覧と各ページ） =====
// 解説は読まなくてもプレイには影響しない。openAtLevel のレベルが開くと読めるようになる。

function renderGuides(records) {
    const read = loadGuidesRead();
    const guide = GUIDES.find(g => g.id === openGuideId && isGuideOpen(g, records));
    if (guide) {
        markGuideRead(guide.id);
        game.innerHTML = `
            ${renderMainTabs(loadRecords())}
            <button type="button" class="sub-btn guide-back" id="guide-back">← 解説の一覧へ</button>
            <article class="guide-page">
                <p class="guide-for">${escapeHtml(guide.forLevels)}</p>
                <h2 class="guide-title">${escapeHtml(guide.title)}</h2>
                ${guide.body}
            </article>
            <button type="button" class="post-btn guide-play" id="guide-play">遊ぶ画面へ</button>
        `;
        bindMainTabs();
        document.getElementById('guide-back').addEventListener('click', () => { openGuideId = null; renderStart(); window.scrollTo(0, 0); });
        document.getElementById('guide-play').addEventListener('click', () => { mainTab = 'play'; openGuideId = null; renderStart(); window.scrollTo(0, 0); });
        bindFlickDemo();
        return;
    }
    openGuideId = null;
    game.innerHTML = `
        ${renderMainTabs(records)}
        <h2 class="game-title">解説</h2>
        <p class="game-lead">文字の打ち方を、やさしく説明しています。読まなくても遊べますが、はじめての方はぜひ一度どうぞ。<br>
        新しい文字が出てくるレベルが開くと、そのための解説も読めるようになります。</p>
        <div class="guide-list">
            ${GUIDES.map(g => {
                const open = isGuideOpen(g, records);
                const isNew = open && !read.includes(g.id);
                return `<button type="button" class="guide-card ${open ? '' : 'locked'}" data-guide="${g.id}" ${open ? '' : 'disabled'}>
                    <span class="guide-card-for">${escapeHtml(g.forLevels)}${isNew ? '<span class="new-dot">NEW</span>' : ''}</span>
                    <span class="guide-card-title">${open ? '' : '🔒 '}${escapeHtml(g.title)}</span>
                    ${open ? '' : `<span class="guide-card-lock">Lv${g.openAtLevel}が開くと読めます</span>`}
                </button>`;
            }).join('')}
        </div>
    `;
    bindMainTabs();
    game.querySelectorAll('.guide-card:not(.locked)').forEach(btn => btn.addEventListener('click', () => {
        openGuideId = btn.dataset.guide;
        renderStart();
        window.scrollTo(0, 0);
    }));
}

// キーボードの図：文字キーを押すと、そのキーの十字（すべらせた先の文字）を図の下に出す
function bindFlickDemo() {
    game.querySelectorAll('.kb-wrap').forEach(wrap => {
        const demo = wrap.querySelector('.flick-demo');
        wrap.querySelectorAll('[data-flick]').forEach(key => key.addEventListener('click', () => {
            wrap.querySelectorAll('[data-flick]').forEach(k => k.classList.toggle('pressed', k === key));
            const k = key.dataset.flick;
            // 専用キーボードの図（data-mode あり）は kbCore の配列から、iPhoneの図は guides.js の FLICK から十字を作る
            const mode = wrap.dataset.mode;
            demo.innerHTML = (mode ? softCross(mode, k) : cross(k)) + `<p class="flick-hint">「${escapeHtml(key.textContent)}」のキーで打てる文字です</p>`;
        }));
    });
}

// ===== 画面2：プレイ =====
// 判定の考え方：
//  ・判定は「確定したとき」だけ行う。変換中（入力中の下線付き状態）は一切判定しない
//    （フリックの濁点・小書きの途中状態や、変換候補の食い違いを間違い扱いしないため）。
//  ・確定した文字列が答えと完全一致したら次の問題へ。答えの先頭部分なら入力を続け、
//    そうでなければミスを1回数える（打ち直すまで次へ進めない）。

// 専用キーボードのとき（method: 'soft'）は入力欄を作らず、画面の下に専用キーボードを出す。
// 判定はキーを押すたびに kbCore の judge で行う（確定した所はお題の表記と、打ちかけの所は読みと比べる）。

let session = null; // { level, problems, questions, index, misses, startTime, timerId, wrong, composing, method, kb }

function startGame(level) {
    endSoftKeyboard();
    const problems = pickProblems(level);
    session = {
        level,
        problems,
        questions: problems.map(textOf),
        index: 0,
        misses: 0,
        startTime: null, // 最初の入力でタイム開始
        timerId: null,
        wrong: false,
        composing: false,
        method: inputMethod,
        kb: null,
    };
    if (session.method === 'soft') { startSoftGame(); return; }
    renderPlayShell();
    showQuestion();
    const input = document.getElementById('typing-input');
    input.value = '';
    input.focus();
}

// ----- 専用キーボードのプレイ -----
function startSoftGame() {
    const s = session;
    document.body.classList.add('softkb-play');
    document.documentElement.style.setProperty('--skb-row-h', (KB_ROW_H[kbSettings.size] || KB_ROW_H.m) + 'px');
    game.innerHTML = `
        <div class="play-head">
            <span class="play-progress" id="play-progress"></span>
            <span class="play-timer" id="play-timer">0.0秒</span>
            <span class="play-miss" id="play-miss">ミス 0</span>
        </div>
        <div class="play-target" id="play-target"></div>
        <div class="prompt" id="prompt"></div>
        <div class="skb-typed" id="skb-typed"></div>
        <div class="play-actions"><button type="button" id="abort-btn" class="sub-btn">やめる</button></div>
        <div class="skb" id="skb"></div>
    `;
    s.kb = createSoftKeyboard({
        kbEl: document.getElementById('skb'),
        typedEl: document.getElementById('skb-typed'),
        dict: getDict(),
        settings: { vibrate: kbSettings.vibrate },
        onChange: ({ result, committedLength }) => onSoftChange(s, result, committedLength),
    });
    document.getElementById('abort-btn').addEventListener('click', () => abortPlay());
    showSoftQuestion();
    window.scrollTo(0, 0);
}

function showSoftQuestion() {
    const s = session;
    const answer = s.questions[s.index];
    s.wrong = false;
    document.getElementById('play-progress').textContent = `${s.index + 1} / ${s.questions.length}`;
    document.getElementById('play-miss').textContent = `ミス ${s.misses}`;
    const width = widthLabelOf(s.level, answer);
    document.getElementById('prompt').innerHTML = [...answer].map(c => `<span class="ch">${escapeHtml(c)}</span>`).join('')
        + (width ? `<div class="width-label">${width}で打つ</div>` : '');
    if (!s.startTime) document.getElementById('play-target').textContent = 'キーを押すとタイム開始';
    s.kb.setProblem(s.problems[s.index], (v) => normalizeTyped(s.level, v));
}

function onSoftChange(s, result, committedLength) {
    if (session !== s) return;
    if (!s.startTime) { s.startTime = performance.now(); startTimer(); }
    if (result === 'done') {
        s.index++;
        if (s.index >= s.questions.length) { finishGame(); return; }
        showSoftQuestion();
        return;
    }
    const isWrong = result === 'ng';
    if (isWrong && !s.wrong) {
        s.misses++;
        document.getElementById('play-miss').textContent = `ミス ${s.misses}`;
    }
    s.wrong = isWrong;
    // 確定した所まで緑（まちがえている間は色を付けない）
    document.querySelectorAll('#prompt .ch').forEach((span, i) => { span.className = i < committedLength ? 'ch ok' : 'ch'; });
}

// プレイをやめる（「やめる」ボタン・Androidの戻るボタン）。打ち始めたあとは確認する。やめたら true
function abortPlay() {
    const s = session;
    if (!s) return true;
    if (s.startTime && !confirm('やめますか？今回のプレイは記録されません。')) {
        document.getElementById('typing-input')?.focus();
        return false;
    }
    stopTimer();
    endSoftKeyboard();
    session = null;
    renderStart();
    return true;
}

// 専用キーボードを片付ける（やめる・終わる・別のレベルを始めるとき）
function endSoftKeyboard() {
    session?.kb?.destroy();
    if (session) session.kb = null;
    document.body.classList.remove('softkb-play');
}

// プレイ画面の枠と入力欄は1回だけ作り、問題が変わっても作り直さず使い回す。
// （入力欄を作り直すと、スマホのIMEが変換中だった文字を新しい入力欄へ持ち越すことがあるため）
function renderPlayShell() {
    const s = session;
    game.innerHTML = `
        <div class="play-head">
            <span class="play-progress" id="play-progress"></span>
            <span class="play-timer" id="play-timer">0.0秒</span>
            <span class="play-miss" id="play-miss">ミス 0</span>
        </div>
        <div class="play-target" id="play-target"></div>
        <div class="prompt" id="prompt"></div>
        <div class="input-wrap">
            <input type="text" id="typing-input" class="typing-input" autocomplete="off" autocorrect="off"
                   autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="入力するとタイム開始">
            <button type="button" id="resume-btn" class="resume-btn" hidden>ここを押して続ける</button>
        </div>
        <div class="play-actions"><button type="button" id="abort-btn" class="sub-btn">やめる</button></div>
    `;

    const input = document.getElementById('typing-input');
    // キーボードが閉じたら（着信・画面の外を触った等）、入力欄を押し直せば続けられることを大きく知らせる
    const resumeBtn = document.getElementById('resume-btn');
    input.addEventListener('blur', () => { if (session === s) resumeBtn.hidden = false; });
    input.addEventListener('focus', () => { resumeBtn.hidden = true; });
    resumeBtn.addEventListener('click', () => input.focus());
    input.addEventListener('compositionstart', () => { s.composing = true; });
    input.addEventListener('compositionend', () => { s.composing = false; evaluate(input); });
    input.addEventListener('input', (e) => {
        if (input.value && !s.startTime) { s.startTime = performance.now(); startTimer(); } // 最初の入力でタイム開始
        if (e.isComposing || s.composing) return; // 変換中は判定しない
        evaluate(input);
    });
    document.getElementById('abort-btn').addEventListener('click', () => {
        // 打ち始めたあとは、押し間違いでプレイが消えないよう確認する
        abortPlay();
    });
}

// 現在の問題（s.index）を画面に反映する。入力欄は触らない。
function showQuestion() {
    const s = session;
    const answer = s.questions[s.index];
    s.wrong = false;
    document.getElementById('play-progress').textContent = `${s.index + 1} / ${s.questions.length}`;
    document.getElementById('play-miss').textContent = `ミス ${s.misses}`;
    const width = widthLabelOf(s.level, answer);
    document.getElementById('prompt').innerHTML = [...answer].map(c => `<span class="ch">${escapeHtml(c)}</span>`).join('')
        + (width ? `<div class="width-label">${width}で打つ</div>` : '');
    const input = document.getElementById('typing-input');
    input.classList.remove('wrong');
    input.placeholder = s.startTime ? '' : '入力するとタイム開始';
}

// 正解後、次の問題へ進む（確定済みなので、前の問題の入力は残らない）。
function advance(input) {
    const s = session;
    input.value = '';
    s.index++;
    if (s.index >= s.questions.length) { finishGame(); return; }
    showQuestion();
}

function startTimer() {
    stopTimer();
    session.timerId = setInterval(() => {
        if (!session?.startTime) return;
        const elapsed = performance.now() - session.startTime;
        const el = document.getElementById('play-timer');
        if (el) el.textContent = formatTime(elapsed);
        const targetEl = document.getElementById('play-target');
        if (targetEl) {
            const t = nextRankTarget(session.level, elapsed);
            targetEl.textContent = t ? t.rank + 'ランクまで あと ' + t.remain.toFixed(1) + '秒' : 'ランクE';
            targetEl.className = 'play-target rank-text-' + (t ? t.rank : 'E');
        }
    }, 100);
}

function stopTimer() {
    if (session?.timerId) { clearInterval(session.timerId); session.timerId = null; }
}

// 確定した入力を判定する（変換中は呼ばれない）。
function evaluate(input) {
    const s = session;
    if (!s) return;
    const answer = s.questions[s.index];
    const value = normalizeTyped(s.level, input.value);
    if (!value) {
        // 全部消したときは、間違いの表示（赤い枠・文字の色分け）を元に戻す
        s.wrong = false;
        document.querySelectorAll('#prompt .ch').forEach(span => { span.className = 'ch'; });
        input.classList.remove('wrong');
        return;
    }

    if (value === answer) {
        advance(input);
        return;
    }

    const chars = [...answer];
    const typed = [...value];
    const isPrefix = typed.length <= chars.length && typed.every((c, i) => c === chars[i]);

    if (!isPrefix && !s.wrong) {
        s.misses++;
        document.getElementById('play-miss').textContent = `ミス ${s.misses}`;
    }
    s.wrong = !isPrefix;

    // 文字ごとの色分け（一致した先頭部分=緑、食い違い=赤）
    document.querySelectorAll('#prompt .ch').forEach((span, i) => {
        span.className = i < typed.length ? (typed[i] === chars[i] ? 'ch ok' : 'ch ng') : 'ch';
    });
    input.classList.toggle('wrong', s.wrong);
}

// ===== 画面3：結果（共有記録への登録とランキング） =====

function nowStamp() {
    const n = new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    return n.getFullYear() + '/' + p2(n.getMonth() + 1) + '/' + p2(n.getDate()) + ' ' + p2(n.getHours()) + ':' + p2(n.getMinutes());
}

async function finishGame() {
    const s = session;
    stopTimer();
    endSoftKeyboard();
    const ms = Math.round(performance.now() - s.startTime);
    const openBefore = new Set(GUIDES.filter(g => isGuideOpen(g, loadRecords())).map(g => g.id));
    const { isBest, previousBest } = addRecord(s.level, ms, s.misses, s.method);
    if (STORE) sharedPlays = localPlays();
    const newGuides = GUIDES.filter(g => !openBefore.has(g.id) && isGuideOpen(g, loadRecords()));
    const level = LEVELS.find(l => l.level === s.level);
    const name = loadPlayerName();
    const rank = rankFor(s.level, ms);
    // 最後のレベルを合格ランク以上でクリアしたら、全コースクリアのメッセージを出す
    const graduated = s.level === PLANNED_LEVELS && isRankAtLeast(s.level, ms, UNLOCK_RANK);
    // 今回で合格ランク以上を取り、次のレベルがあれば「次のレベルへ」をいちばん目立つボタンにする
    const passed = isRankAtLeast(s.level, ms, UNLOCK_RANK);
    const nextLevel = passed && LEVELS.some(l => l.level === s.level + 1) ? s.level + 1 : null;
    // 合格に届かなかったときは、あと何秒でAランクだったかを出す
    const unlockSec = RANK_TIMES[s.level]?.[UNLOCK_RANK];
    const shortBy = !passed && unlockSec ? (ms / 1000 - unlockSec) : null;
    session = null;

    const play = {
        'ID': Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        'プレイ名': name, 'レベル': s.level, 'ミリ秒': ms, 'ミス': s.misses, '日時': nowStamp(),
    };
    if (s.method === 'soft') play['打ち方'] = '専用キーボード'; // 自分のキーボードの記録は今までどおり項目なし

    game.innerHTML = `
        <h2 class="game-title">クリア！</h2>
        ${graduated ? `
        <div class="graduation">
            <p class="graduation-title">全コースクリアおめでとうございます！</p>
            <p>これで${escapeHtml(name)}さんは、スマホの文字入力スキルマスターです！！<br>
            お知り合いとのメールや、調べ物など色々な場面で、役立ててください！</p>
            <p class="graduation-next">このアプリでは、最高でSSSランクまであります。まだまだ遊び足りない方は全コースでSSSを狙ってみてくださいね♪</p>
        </div>` : ''}
        <div class="result-card">
            <div class="result-level">${level.label} ／ プレイ名：${escapeHtml(name)}${s.method === 'soft' ? ' ／ 専用キーボード' : ''}</div>
            <div class="result-rank rank-${rank}">${rank}</div>
            <div class="result-time">${formatTime(ms)}</div>
            <div class="result-miss">ミス ${s.misses} 回</div>
            ${isBest
                ? '<div class="result-best new">' + (previousBest ? '自己ベスト更新！（前回 ' + formatTime(previousBest.ms) + '）' : '初記録！') + '</div>'
                : '<div class="result-best">自己ベスト ' + formatTime(previousBest.ms) + '（今回は +' + ((ms - previousBest.ms) / 1000).toFixed(1) + '秒）</div>'}
            ${shortBy !== null ? `<div class="result-short">${UNLOCK_RANK}ランク（${unlockSec}秒以内）まで あと ${shortBy.toFixed(1)}秒</div>` : ''}
            ${STORE ? '' : '<div class="result-share" id="result-share">共有に登録中…</div>'}
        </div>
        ${newGuides.map(g => `
        <div class="guide-unlock">
            <p>新しい解説が読めるようになりました</p>
            <p class="guide-unlock-title">「${escapeHtml(g.title)}」（${escapeHtml(g.forLevels)}）</p>
            <button type="button" class="sub-btn" data-open-guide="${g.id}">解説を読む</button>
        </div>`).join('')}
        <div class="result-actions">
            ${nextLevel ? `<button type="button" class="post-btn" id="next-btn">次のレベルへ（Lv${nextLevel}）</button>` : ''}
            <button type="button" class="${nextLevel ? 'sub-btn' : 'post-btn'}" id="retry-btn">もう一度</button>
            <button type="button" class="sub-btn" id="back-btn">レベル一覧へ</button>
        </div>
        <div id="result-ranking"></div>
    `;
    document.getElementById('next-btn')?.addEventListener('click', () => startGame(nextLevel));
    document.getElementById('retry-btn').addEventListener('click', () => startGame(s.level));
    document.getElementById('back-btn').addEventListener('click', renderStart);
    game.querySelectorAll('[data-open-guide]').forEach(btn => btn.addEventListener('click', () => openGuide(btn.dataset.openGuide)));

    // 共有記録への登録（トークンが無い／通信できない場合は未送信として端末内に残し、次の「読込」で再送する）
    const shareEl = document.getElementById('result-share');
    const token = STORE ? '' : (tokenInput.value.trim() || loadToken() || '');
    const queue = [...loadPending(), play];
    if (STORE) {
        // ストア版は共有しない（端末内の記録は addRecord で保存済み）
    } else if (!token) {
        savePending(queue);
        shareEl.textContent = 'トークンが無いため共有されていません（端末内に保存しました）';
    } else {
        try {
            await appendPlays(token, queue);
            savePending([]);
            shareEl.textContent = '共有に登録しました';
            setNetworkStatus('<span class="status-badge online-badge">オンライン（最新）</span>');
        } catch (error) {
            console.error(error);
            savePending(queue);
            shareEl.textContent = '共有に登録できませんでした。端末内に保存したので、通信できるときに「読込」を押すと送信されます';
            setNetworkStatus('<span class="status-badge offline-badge">オフライン（未同期）</span>');
        }
    }
    const rankingEl = document.getElementById('result-ranking');
    if (rankingEl) {
        rankingEl.innerHTML = '<details class="history" open><summary>' + level.label + 'のランキング</summary>' + renderRankingTable(s.level) + '</details>';
    }
}

// ===== Androidの戻るボタン（ストア版。Capacitorの @capacitor/app） =====
// パネル→プレイ（やめる確認）→結果・解説→レベル一覧→アプリを閉じる、の順に戻る。
// バンドラを使わないので、プラグインはグローバル（window.Capacitor.Plugins.App）から使う（kanziと同じ）。
const capApp = window.Capacitor?.Plugins?.App;
if (capApp) {
    capApp.addListener('backButton', () => {
        const sheet = document.getElementById('level-sheet');
        if (sheet && sheet.innerHTML.trim()) { sheet.innerHTML = ''; return; }            // レベルのパネルを閉じる
        if (session) { abortPlay(); return; }                                              // プレイ中はやめる（確認あり）
        if (mainTab === 'guide' && openGuideId) { openGuideId = null; renderStart(); window.scrollTo(0, 0); return; } // 解説のページ→一覧
        if (mainTab === 'guide') { mainTab = 'play'; renderStart(); window.scrollTo(0, 0); return; }                  // 解説の一覧→遊ぶ
        if (document.querySelector('.result-card')) { renderStart(); window.scrollTo(0, 0); return; }                 // 結果→レベル一覧
        capApp.exitApp();
    });
}

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', async () => {
    if (STORE) { renderStart(); return; } // ストア版はGitHubへ通信しない
    const saved = loadToken();
    if (saved) tokenInput.value = saved;
    renderStart();
    if (saved) {
        await flushPending(saved);
        if (await loadShared(saved, true) && !session) renderStart();
    }
});
