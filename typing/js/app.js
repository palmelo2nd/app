// 現在のバージョン: 21
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import {
    loadToken, saveToken, loadRecords, addRecord,
    loadPlayerName, savePlayerName, loadPending, savePending, loadSharedCache, saveSharedCache, clearLocalRecords,
    loadGridView, saveGridView
} from './modules/storage.js?v=21';
import { fetchFile, saveFile } from './modules/github.js?v=21';
import { parseFrontMatter, stringifyRecords, computeRanking, getLatestPlays } from './modules/dataModel.js?v=21';
import { LEVELS, PLANNED_LEVELS, pickQuestions, rankFor, nextRankTarget, isRankAtLeast, UNLOCK_RANK } from './modules/problems.js?v=21';

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

const tokenInput = document.querySelector('.js-token-input');
let sharedPlays = loadSharedCache(); // 共有記録（全員分のプレイ）

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

function renderStart() {
    const records = loadRecords();
    const pending = loadPending().length;
    const latest = getLatestPlays(sharedPlays, 5);
    const cells = [];
    for (let lv = 1; lv <= PLANNED_LEVELS; lv++) {
        const st = cellState(lv, records);
        cells.push(`<button type="button" class="cell ${st.cls}" data-level="${lv}" ${st.cls === 'soon' ? 'disabled' : ''}>` +
            `<span class="cell-lv">Lv${lv}</span><span class="cell-rank">${st.sub}</span></button>`);
    }
    game.innerHTML = `
        <h2 class="game-title">タイムアタック</h2>
        <div class="name-row">
            <label class="name-label" for="player-name">プレイ名</label>
            <input type="text" id="player-name" class="name-input" maxlength="20" autocomplete="off" placeholder="名前を入力" value="${escapeHtml(loadPlayerName())}">
        </div>
        ${pending > 0 ? `<p class="notice">共有に未送信のプレイが${pending}件あります。「読込」で再送します。</p>` : ''}
        <div class="view-toggle">
            <button type="button" class="view-btn ${gridView === 'me' ? 'active' : ''}" data-view="me">自分の記録</button>
            <button type="button" class="view-btn ${gridView === 'all' ? 'active' : ''}" data-view="all">みんなのベスト</button>
        </div>
        <div class="level-grid">${cells.join('')}</div>
        <details class="history">
            <summary>みんなの最新記録</summary>
            ${latest.length === 0 ? '<p class="placeholder">まだ記録がありません。</p>' : '<table class="history-table"><tbody>' + latest.map(p =>
                '<tr><td>' + escapeHtml(p['日時'].slice(5)) + '</td><td>' + escapeHtml(p['プレイ名']) + '</td><td>Lv' + p['レベル'] + '</td><td>' +
                formatTime(p['ミリ秒']) + '</td><td>' + rankBadge(p['レベル'], p['ミリ秒']) + '</td></tr>').join('') + '</tbody></table>'}
        </details>
        <button type="button" id="clear-local-btn" class="clear-local-btn">この端末の記録を消す</button>
        <div id="level-sheet"></div>
    `;
    document.getElementById('clear-local-btn').addEventListener('click', () => {
        if (!confirm('この端末内の記録（自己ベスト・履歴・未送信・ランキングのキャッシュ）を消します。共有記録は消えません。よろしいですか？')) return;
        clearLocalRecords();
        sharedPlays = [];
        renderStart();
    });
    document.getElementById('player-name').addEventListener('change', (e) => {
        savePlayerName(e.target.value.trim());
        renderStart(); // プレイ名が変わると「自分の記録」も変わるため描き直す
    });
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
        const nameEl = document.getElementById('player-name');
        const name = nameEl.value.trim();
        if (!name) { close(); alert('プレイ名を入力してください'); nameEl.focus(); return; }
        savePlayerName(name);
        startGame(level);
    });
}

// ===== 画面2：プレイ =====
// 判定の考え方：
//  ・判定は「確定したとき」だけ行う。変換中（入力中の下線付き状態）は一切判定しない
//    （フリックの濁点・小書きの途中状態や、変換候補の食い違いを間違い扱いしないため）。
//  ・確定した文字列が答えと完全一致したら次の問題へ。答えの先頭部分なら入力を続け、
//    そうでなければミスを1回数える（打ち直すまで次へ進めない）。

let session = null; // { level, questions, index, misses, startTime, timerId, wrong, composing }

function startGame(level) {
    session = {
        level,
        questions: pickQuestions(level),
        index: 0,
        misses: 0,
        startTime: null, // 最初の入力でタイム開始
        timerId: null,
        wrong: false,
        composing: false,
    };
    renderPlayShell();
    showQuestion();
    const input = document.getElementById('typing-input');
    input.value = '';
    input.focus();
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
        <input type="text" id="typing-input" class="typing-input" autocomplete="off" autocorrect="off"
               autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="入力するとタイム開始">
        <div class="play-actions"><button type="button" id="abort-btn" class="sub-btn">やめる</button></div>
    `;

    const input = document.getElementById('typing-input');
    input.addEventListener('compositionstart', () => { s.composing = true; });
    input.addEventListener('compositionend', () => { s.composing = false; evaluate(input); });
    input.addEventListener('input', (e) => {
        if (input.value && !s.startTime) { s.startTime = performance.now(); startTimer(); } // 最初の入力でタイム開始
        if (e.isComposing || s.composing) return; // 変換中は判定しない
        evaluate(input);
    });
    document.getElementById('abort-btn').addEventListener('click', () => {
        stopTimer();
        session = null;
        renderStart();
    });
}

// 現在の問題（s.index）を画面に反映する。入力欄は触らない。
function showQuestion() {
    const s = session;
    const answer = s.questions[s.index];
    s.wrong = false;
    document.getElementById('play-progress').textContent = `${s.index + 1} / ${s.questions.length}`;
    document.getElementById('play-miss').textContent = `ミス ${s.misses}`;
    document.getElementById('prompt').innerHTML = [...answer].map(c => `<span class="ch">${escapeHtml(c)}</span>`).join('');
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
            targetEl.textContent = t ? t.rank + 'ランクまで あと ' + t.remain.toFixed(1) + '秒' : 'ランクC';
            targetEl.className = 'play-target rank-text-' + (t ? t.rank : 'C');
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
    const value = input.value;
    if (!value) return;

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
    const ms = Math.round(performance.now() - s.startTime);
    const { isBest, previousBest } = addRecord(s.level, ms, s.misses);
    const level = LEVELS.find(l => l.level === s.level);
    const name = loadPlayerName();
    const rank = rankFor(s.level, ms);
    session = null;

    const play = {
        'ID': Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        'プレイ名': name, 'レベル': s.level, 'ミリ秒': ms, 'ミス': s.misses, '日時': nowStamp(),
    };

    game.innerHTML = `
        <h2 class="game-title">クリア！</h2>
        <div class="result-card">
            <div class="result-level">${level.label} ／ プレイ名：${escapeHtml(name)}</div>
            <div class="result-rank rank-${rank}">${rank}</div>
            <div class="result-time">${formatTime(ms)}</div>
            <div class="result-miss">ミス ${s.misses} 回</div>
            ${isBest
                ? '<div class="result-best new">' + (previousBest ? '自己ベスト更新！（前回 ' + formatTime(previousBest.ms) + '）' : '初記録！') + '</div>'
                : '<div class="result-best">自己ベスト ' + formatTime(previousBest.ms) + '（今回は +' + ((ms - previousBest.ms) / 1000).toFixed(1) + '秒）</div>'}
            <div class="result-share" id="result-share">共有に登録中…</div>
        </div>
        <div class="result-actions">
            <button type="button" class="post-btn" id="retry-btn">もう一度</button>
            <button type="button" class="sub-btn" id="back-btn">レベル一覧へ</button>
        </div>
        <div id="result-ranking"></div>
    `;
    document.getElementById('retry-btn').addEventListener('click', () => startGame(s.level));
    document.getElementById('back-btn').addEventListener('click', renderStart);

    // 共有記録への登録（トークンが無い／通信できない場合は未送信として端末内に残し、次の「読込」で再送する）
    const shareEl = document.getElementById('result-share');
    const token = tokenInput.value.trim() || loadToken() || '';
    const queue = [...loadPending(), play];
    if (!token) {
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

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', async () => {
    const saved = loadToken();
    if (saved) tokenInput.value = saved;
    renderStart();
    if (saved) {
        await flushPending(saved);
        if (await loadShared(saved, true) && !session) renderStart();
    }
});
