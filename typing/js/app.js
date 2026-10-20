// 現在のバージョン: 10
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import {
    loadToken, saveToken, loadRecords, addRecord,
    loadPlayerName, savePlayerName, loadPending, savePending, loadSharedCache, saveSharedCache
} from './modules/storage.js?v=10';
import { fetchFile, saveFile } from './modules/github.js?v=10';
import { parseFrontMatter, stringifyRecords, computeRanking, getLatestPlays } from './modules/dataModel.js?v=10';
import { LEVELS, QUESTION_COUNT, pickQuestions, rankFor, nextRankTarget, RANK_TIMES } from './modules/problems.js?v=10';

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
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

// ===== 画面1：レベル選択（プレイ名・ベスト・ランキング） =====

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

// レベルの解放：最初のレベルは常に開いている。以降は直前のレベルを1回でもクリアしたら開く。
function isLevelUnlocked(level, records) {
    return level === LEVELS[0].level || !!records[level - 1]?.best;
}

let rankViewLevel = LEVELS[0].level; // ランキング表示で選択中のレベル

function renderStart() {
    const records = loadRecords();
    // 初回表示は、開いている中で一番上のレベルのランキングを見せる
    if (!records[rankViewLevel] && rankViewLevel === LEVELS[0].level) {
        const open = LEVELS.filter(l => isLevelUnlocked(l.level, records));
        rankViewLevel = open[open.length - 1].level;
    }
    const pending = loadPending().length;
    const latest = getLatestPlays(sharedPlays, 5);
    game.innerHTML = `
        <h2 class="game-title">タイムアタック</h2>
        <p class="game-lead">${QUESTION_COUNT}問をできるだけ速く打ち切ろう。フリック入力で、表示どおりに入力して確定します。</p>
        <div class="name-row">
            <label class="name-label" for="player-name">プレイ名</label>
            <input type="text" id="player-name" class="name-input" maxlength="20" autocomplete="off" placeholder="名前を入力" value="${escapeHtml(loadPlayerName())}">
        </div>
        ${pending > 0 ? `<p class="notice">共有に未送信のプレイが${pending}件あります。「読込」で再送します。</p>` : ''}
        <div class="level-list">
            ${LEVELS.map(l => {
                const best = records[l.level]?.best;
                const t = RANK_TIMES[l.level];
                const unlocked = isLevelUnlocked(l.level, records);
                return `
                <button type="button" class="level-card ${unlocked ? '' : 'locked'}" data-level="${l.level}" ${unlocked ? '' : 'disabled'}>
                    <span class="level-name">${unlocked ? '' : '🔒 '}${l.label}　${escapeHtml(l.desc)}</span>
                    <span class="level-desc">${unlocked
                        ? `使う文字：${escapeHtml(l.addedChars || l.chars)}${l.addedChars && l.addedChars !== l.chars ? '（追加）' : ''} ／ 目安 S ${t.S}秒・A ${t.A}秒・B ${t.B}秒`
                        : `レベル${l.level - 1}をクリアすると開きます`}</span>
                    <span class="level-best">${best ? `ベスト ${formatTime(best.ms)} ${rankBadge(l.level, best.ms)}` : (unlocked ? '未挑戦' : '')}</span>
                </button>`;
            }).join('')}
        </div>
        <details class="history" open>
            <summary>ランキング（プレイ名ごとのベスト）</summary>
            <select id="rank-level" class="rank-level-select">
                ${LEVELS.map(l => `<option value="${l.level}" ${l.level === rankViewLevel ? 'selected' : ''}>${l.label}　${escapeHtml(l.desc)}</option>`).join('')}
            </select>
            <div id="rank-table">${renderRankingTable(rankViewLevel)}</div>
        </details>
        <details class="history">
            <summary>みんなの最新記録</summary>
            ${latest.length === 0 ? '<p class="placeholder">まだ記録がありません。</p>' : '<table class="history-table"><tbody>' + latest.map(p =>
                '<tr><td>' + escapeHtml(p['日時'].slice(5)) + '</td><td>' + escapeHtml(p['プレイ名']) + '</td><td>Lv' + p['レベル'] + '</td><td>' +
                formatTime(p['ミリ秒']) + '</td><td>' + rankBadge(p['レベル'], p['ミリ秒']) + '</td></tr>').join('') + '</tbody></table>'}
        </details>
        <details class="history">
            <summary>自分の最近の記録（この端末）</summary>
            ${LEVELS.map(l => {
                const hist = records[l.level]?.history || [];
                if (hist.length === 0) return '';
                return '<h4 class="history-level">' + l.label + '（' + l.desc + '）</h4><table class="history-table"><tbody>' +
                    hist.slice(0, 5).map(h => '<tr><td>' + formatDate(h.date) + '</td><td>' + formatTime(h.ms) + '</td><td>' +
                        rankBadge(l.level, h.ms) + '</td><td>ミス' + h.misses + '</td></tr>').join('') + '</tbody></table>';
            }).join('') || '<p class="placeholder">まだ記録がありません。</p>'}
        </details>
    `;
    document.getElementById('rank-level').addEventListener('change', (e) => {
        rankViewLevel = Number(e.target.value);
        document.getElementById('rank-table').innerHTML = renderRankingTable(rankViewLevel);
    });
    game.querySelectorAll('.level-card:not(.locked)').forEach(btn => {
        btn.addEventListener('click', () => {
            const nameEl = document.getElementById('player-name');
            const name = nameEl.value.trim();
            if (!name) { alert('プレイ名を入力してください'); nameEl.focus(); return; }
            savePlayerName(name);
            startGame(Number(btn.dataset.level));
        });
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
            <div class="result-level">${level.label}（${level.desc}）／ プレイ名：${escapeHtml(name)}</div>
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
            <button type="button" class="sub-btn" id="back-btn">レベル選択へ</button>
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
