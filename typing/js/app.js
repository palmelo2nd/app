// 現在のバージョン: 5
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import { loadToken, saveToken, loadRecords, addRecord } from './modules/storage.js?v=5';
import { LEVELS, QUESTION_COUNT, pickQuestions } from './modules/problems.js?v=5';

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

// ===== トークン・キャッシュ更新（記録は端末内のみのため、トークンは他アプリへの引き継ぎ用） =====

const tokenInput = document.querySelector('.js-token-input');

document.querySelectorAll('.js-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const saved = loadToken();
        if (!saved) return alert('保存済みのトークンがありません');
        tokenInput.value = saved;
        document.getElementById('network-status-top').innerHTML = '<span class="status-badge online-badge">読込済み</span>';
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

// ===== 画面1：レベル選択（ベスト・履歴を表示） =====

function renderStart() {
    const records = loadRecords();
    game.innerHTML = `
        <h2 class="game-title">タイムアタック</h2>
        <p class="game-lead">${QUESTION_COUNT}問をできるだけ速く打ち切ろう。フリック入力で、表示どおりに入力します。</p>
        <div class="level-list">
            ${LEVELS.map(l => {
                const rec = records[l.level];
                const best = rec?.best;
                return `
                <button type="button" class="level-card" data-level="${l.level}">
                    <span class="level-name">${l.label}</span>
                    <span class="level-desc">${l.desc}</span>
                    <span class="level-best">${best ? `ベスト ${formatTime(best.ms)}（ミス${best.misses}）` : '未挑戦'}</span>
                </button>`;
            }).join('')}
        </div>
        <details class="history">
            <summary>最近の記録</summary>
            ${LEVELS.map(l => {
                const hist = records[l.level]?.history || [];
                if (hist.length === 0) return '';
                return `<h4 class="history-level">${l.label}（${l.desc}）</h4>
                    <table class="history-table"><tbody>${hist.slice(0, 5).map(h =>
                        `<tr><td>${formatDate(h.date)}</td><td>${formatTime(h.ms)}</td><td>ミス${h.misses}</td></tr>`).join('')}</tbody></table>`;
            }).join('') || '<p class="placeholder">まだ記録がありません。</p>'}
        </details>
    `;
    game.querySelectorAll('.level-card').forEach(btn => {
        btn.addEventListener('click', () => startGame(Number(btn.dataset.level)));
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
        const el = document.getElementById('play-timer');
        if (el && session?.startTime) el.textContent = formatTime(performance.now() - session.startTime);
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

// ===== 画面3：結果 =====

function finishGame() {
    const s = session;
    stopTimer();
    const ms = performance.now() - s.startTime;
    const { isBest, previousBest } = addRecord(s.level, ms, s.misses);
    const level = LEVELS.find(l => l.level === s.level);
    session = null;

    game.innerHTML = `
        <h2 class="game-title">クリア！</h2>
        <div class="result-card">
            <div class="result-level">${level.label}（${level.desc}）</div>
            <div class="result-time">${formatTime(ms)}</div>
            <div class="result-miss">ミス ${s.misses} 回</div>
            ${isBest
                ? `<div class="result-best new">${previousBest ? 'ベスト更新！' : '初記録！'}</div>`
                : `<div class="result-best">ベスト ${formatTime(previousBest.ms)}（ミス${previousBest.misses}）</div>`}
        </div>
        <div class="result-actions">
            <button type="button" class="post-btn" id="retry-btn">もう一度</button>
            <button type="button" class="sub-btn" id="back-btn">レベル選択へ</button>
        </div>
    `;
    document.getElementById('retry-btn').addEventListener('click', () => startGame(s.level));
    document.getElementById('back-btn').addEventListener('click', renderStart);
}

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadToken();
    if (saved) tokenInput.value = saved;
    renderStart();
});
