// 現在のバージョン: 2
// JS/CSSを変更した際は、index.htmlの参照とこのファイルのimport文の?v=Nを同じ値に揃えること（brain/book等と同じ方式）。
import { loadToken, saveToken, loadRecords, addRecord } from './modules/storage.js?v=2';
import { LEVELS, QUESTION_COUNT, pickQuestions } from './modules/problems.js?v=2';

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
//  ・入力欄の文字列が答えと完全一致したら、変換の確定前でも正解として次の問題へ進む
//    （フリックのかな入力は確定するまで「入力中」扱いのため、確定を待つと終われない）。
//  ・ミス判定は「入力中の文字列が答えの先頭部分でなくなった瞬間」に1回数える（打ち直すまで次へ進めない）。
//    漢字交じりのレベル3は、変換中の候補が一時的に答えと食い違うため、変換の確定後にだけ判定する。

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
    renderQuestion();
}

function renderQuestion() {
    const s = session;
    const answer = s.questions[s.index];
    s.wrong = false;
    game.innerHTML = `
        <div class="play-head">
            <span class="play-progress">${s.index + 1} / ${s.questions.length}</span>
            <span class="play-timer" id="play-timer">${s.startTime ? formatTime(performance.now() - s.startTime) : '0.0秒'}</span>
            <span class="play-miss" id="play-miss">ミス ${s.misses}</span>
        </div>
        <div class="prompt" id="prompt">${[...answer].map(c => `<span class="ch">${escapeHtml(c)}</span>`).join('')}</div>
        <input type="text" id="typing-input" class="typing-input" autocomplete="off" autocorrect="off"
               autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${s.startTime ? '' : '入力するとタイム開始'}">
        <div class="play-actions"><button type="button" id="abort-btn" class="sub-btn">やめる</button></div>
    `;

    const input = document.getElementById('typing-input');
    input.addEventListener('compositionstart', () => { s.composing = true; });
    input.addEventListener('compositionend', () => { s.composing = false; evaluate(input, answer); });
    input.addEventListener('input', () => evaluate(input, answer));
    document.getElementById('abort-btn').addEventListener('click', () => {
        stopTimer();
        session = null;
        renderStart();
    });
    input.value = '';
    input.focus();
    if (s.startTime) startTimer();
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

function evaluate(input, answer) {
    const s = session;
    if (!s) return;
    const value = input.value;
    if (value && !s.startTime) { s.startTime = performance.now(); startTimer(); }

    // 完全一致 → 正解（変換確定前でも進む）
    if (value === answer) {
        // 次の問題へ進む前に、入力中の変換状態ごと確実に破棄する（スマホのIMEは入力欄を作り直しても
        // 変換中の文字が残ることがあるため、blurで確定扱いにしてから空にする）
        input.blur();
        input.value = '';
        s.composing = false;
        s.index++;
        if (s.index >= s.questions.length) { finishGame(); } else { renderQuestion(); }
        return;
    }

    // 判定対象にするか：レベル3は変換中の途中状態を無視する
    const judge = !(s.level === 3 && s.composing);
    const isPrefix = answer.startsWith(value);
    const chars = [...answer];
    const typed = [...value];

    if (judge) {
        if (!isPrefix && !s.wrong) {
            s.misses++;
            document.getElementById('play-miss').textContent = `ミス ${s.misses}`;
        }
        s.wrong = !isPrefix;
    }

    // 文字ごとの色分け（一致した先頭部分=緑、食い違い以降=赤、変換中は中立）
    const spans = document.querySelectorAll('#prompt .ch');
    spans.forEach((span, i) => {
        let cls = 'ch';
        if (judge && i < typed.length) cls += typed[i] === chars[i] ? ' ok' : ' ng';
        if (judge && i >= typed.length) cls += '';
        span.className = cls;
    });
    document.getElementById('typing-input').classList.toggle('wrong', judge && s.wrong);
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
