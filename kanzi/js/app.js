import { fetchFile, saveFile } from './modules/github.js';
import {
    loadToken, saveToken, loadCache, saveCache,
    loadDevReviewEdits, saveDevReviewEdits, clearDevReviewEdits,
    loadKanjiReviewEdits, saveKanjiReviewEdits, clearKanjiReviewEdits,
    loadOkuriganaReviewEdits, saveOkuriganaReviewEdits, clearOkuriganaReviewEdits
} from './modules/storage.js';
import { parseMarkdown, stringifyMarkdown } from './modules/dataModel.js';
import { buildReadingQuiz, buildMeaningQuiz, buildFlashcardDeck, checkAnswer } from './modules/quiz.js';
import { getProgressRow, calcAccuracy, applyAnswer, getWeakKanji, summarizeProgress } from './modules/progress.js';
import {
    REVIEW_STATUSES, KYU_ORDER, reviewFieldNames, mergeReviewEdits, filterForReview,
    kanjiReviewFieldName, mergeKanjiReviewEdits, filterKanjiForReview,
    flattenOkuriganaEntries, filterOkuriganaForReview, mergeOkuriganaReviewEdits
} from './modules/devReview.js';

// data/kanjiMaster.json（漢字の読み・意味）、data/jukugo.json（熟語。複数の漢字にまたがるため別ファイル）は
// ユーザーごとに変わらない固定参照データなので、コードリポジトリに同梱し、通常のfetchで読み込む（GitHub API・PATは不要）。
// GitHubデータリポジトリには学習進捗（progressData）のみを保存する。
// 例外：開発タブ（後述）は開発者専用機能として、熟語マスタ自体をコードリポジトリへGitHub API経由で書き戻す。
const KANJI_MASTER_PATH  = 'data/kanjiMaster.json';
const JUKUGO_MASTER_PATH = 'data/jukugo.json';
// 筆順データ（HanziWriter形式、KanjiVG由来・約15MB）。全ユーザーの初回読込を重くしないため、
// 開発タブの筆順レビューを開いた時だけ遅延読み込みする（ensureStrokeDataLoaded参照）。
const STROKE_ORDER_PATH = 'data/strokeOrder.json';

const OWNER = 'palmelo2nd';
const REPO  = 'app_data';
const PATH  = 'kanzi/data.md';

// 開発タブ（jukugo.jsonの例文・対象級レビュー）が書き戻す先＝コードリポジトリ本体。
// 進捗（app_data）とは別のリポジトリ・パスなので定数を分けて持つ（値はここだけで管理し、モジュール側にはハードコードしない）。
const CODE_OWNER = 'palmelo2nd';
const CODE_REPO  = 'app';
const JUKUGO_REMOTE_PATH = 'kanzi/data/jukugo.json';
const KANJI_MASTER_REMOTE_PATH = 'kanzi/data/kanjiMaster.json';

const state = {
    token: '',
    sha: null,
    kanjiData: [],
    jukugoData: [],
    strokeData: null,      // 漢字ID -> { strokes, medians }。開発タブの筆順レビューを開くまでnullのまま
    strokeDataLoading: false,
    progressData: [],
    currentGrade: 'all',
    reading: { quiz: null, answered: false },
    meaning: { quiz: null, answered: false },
    flashcard: { deck: [], index: 0, flipped: false },
    dev: {
        mode: 'example', // 'example' | 'kyu' | 'okurigana' | 'reading' | 'writing' | 'stroke'
        filters: { status: 'all', kyu: 'all', type: 'all', keyword: '' },
        page: 1,
        pageSize: 20,
        jukugoEdits: {},    // 熟語ID -> 変更フィールド（jukugo.json、storage.jsのloadDevReviewEdits系で永続化）
        kanjiEdits: {},     // 漢字ID -> 変更フィールド（kanjiMaster.json、loadKanjiReviewEdits系で永続化）
        okuriganaEdits: {}  // "漢字ID:配列index" -> 変更フィールド（送り仮名例、loadOkuriganaReviewEdits系で永続化）
    }
};

// ---------- ユーティリティ ----------

function getScopedKanjiList() {
    const merged = getMergedKanjiData();
    if (state.currentGrade === 'all') return merged;
    return merged.filter(k => String(k['学年']) === String(state.currentGrade));
}

// 熟語は使用漢字IDを1つでもスコープ内の漢字と共有していれば対象に含める
// （元々「1字にぶら下がる熟語」だった頃と同じ挙動を、複数漢字にまたがる形へ拡張したもの）
function getScopedJukugoList() {
    const scopedIds = new Set(getScopedKanjiList().map(k => k['ID']));
    return getMergedJukugoData().filter(j => (j['使用漢字ID'] || []).some(id => scopedIds.has(id)));
}

// 開発タブでの未保存の編集（state.dev.jukugoEdits）を元データに重ねた実効データ。
// 保存前でもクイズ等ですぐ動作を確認できるよう、クイズ出題も含めてこちらを正とする。
function getMergedJukugoData() {
    return mergeReviewEdits(state.jukugoData, state.dev.jukugoEdits);
}

// 開発タブでの未保存の編集（読み・書きレビューのkanjiEdits、送り仮名レビューのokuriganaEdits）を
// 元データに重ねた実効データ。getMergedJukugoDataと同じ考え方。
function getMergedKanjiData() {
    const withKanjiEdits = mergeKanjiReviewEdits(state.kanjiData, state.dev.kanjiEdits);
    return mergeOkuriganaReviewEdits(withKanjiEdits, state.dev.okuriganaEdits);
}

function persistLocal() {
    const md = stringifyMarkdown(state.progressData);
    saveCache(md, state.sha || '');
}

function el(id) {
    return document.getElementById(id);
}

// data/*.jsonはGitHub Pages・ブラウザ双方でキャッシュされうるため、取得のたびにキャッシュを
// バイパスするクエリパラメータを付ける。データはこのアプリ自体の開発で頻繁に更新されるため、
// 帯域よりも「常に最新を見られること」を優先する。
function cacheBustedUrl(path) {
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}_cb=${Date.now()}`;
}

// ---------- 画面切り替え ----------

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('view--active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('nav-btn--active'));
    el(`view-${viewName}`).classList.add('view--active');
    document.querySelector(`.nav-btn[data-view="${viewName}"]`).classList.add('nav-btn--active');

    if (viewName === 'home') renderHome();
    if (viewName === 'reading') startReadingQuiz();
    if (viewName === 'meaning') startMeaningQuiz();
    if (viewName === 'flashcard') startFlashcardSession();
    if (viewName === 'stats') renderStats();
    if (viewName === 'dev') renderDevTab();
}

// ---------- ホーム ----------

function renderHome() {
    const scoped  = getScopedKanjiList();
    const summary = summarizeProgress(scoped, state.progressData);
    const gradeLabel = state.currentGrade === 'all' ? 'すべての学年' : `小学${state.currentGrade}年`;

    el('home-summary').innerHTML = `
        <p class="summary-line"><strong>${gradeLabel}</strong>：全${summary.total}字</p>
        <p class="summary-line">学習済み：${summary.attempted}字</p>
        <p class="summary-line">平均正答率：${summary.averageAccuracy !== null ? Math.round(summary.averageAccuracy * 100) + '%' : '－'}</p>
    `;
}

// ---------- 読みクイズ ----------

function startReadingQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildReadingQuiz(scoped, getScopedJukugoList(), state.progressData);
    state.reading = { quiz, answered: false };
    renderReadingQuiz();
}

// 例文を「対象語のハイライト」と「対象語以外の高度な漢字へのふりがな」を両方適用したHTMLに変換する。
// ふりがな一覧（jukugo.jsonの`ふりがな`：[[文字, 読み], ...]、文中での出現順）は対象語の文字を含まない前提のため、
// 対象語区間はふりがな走査から素通りさせるだけでよい（詳細はCLAUDE.md参照）。
function renderQuizSentence(sentence, targetWord, furiganaList) {
    const targetIdx = sentence.indexOf(targetWord);
    const queue = (furiganaList || []).map(([char, reading]) => ({ char, reading, used: false }));

    let html = '';
    let i = 0;
    while (i < sentence.length) {
        if (targetIdx !== -1 && i === targetIdx) {
            html += `<span class="quiz-target">${targetWord}</span>`;
            i += targetWord.length;
            continue;
        }
        const ch = sentence[i];
        const match = queue.find(f => !f.used && f.char === ch);
        if (match) {
            match.used = true;
            html += `<ruby>${ch}<rt>${match.reading}</rt></ruby>`;
        } else {
            html += ch;
        }
        i += 1;
    }
    return html;
}

function renderReadingQuiz() {
    const { quiz } = state.reading;
    el('reading-next-btn').style.display = 'none';
    el('reading-feedback').textContent = '';

    if (!quiz) {
        el('reading-question').innerHTML = '<p>この範囲には出題できる例文がありません（現在は小学1年の熟語のみ対応）。学年を「小学1年」または「すべて」に切り替えてください。</p>';
        el('reading-choices').innerHTML = '';
        return;
    }

    el('reading-question').innerHTML = `
        <p class="quiz-sentence">${renderQuizSentence(quiz.sentence, quiz.targetWord, quiz.jukugo['ふりがな'])}</p>
        <p>${quiz.questionText}</p>
    `;
    el('reading-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerReadingQuiz(choiceText));
        el('reading-choices').appendChild(btn);
    });
}

function answerReadingQuiz(choiceText) {
    if (state.reading.answered) return;
    state.reading.answered = true;

    const { quiz } = state.reading;
    const isCorrect = checkAnswer(quiz, choiceText);

    // 熟語自体の進捗と、使われている各漢字の進捗の両方に反映する
    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#reading-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('reading-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('reading-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('reading-next-btn').style.display = 'inline-block';
}

// ---------- 意味・熟語クイズ ----------

function startMeaningQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildMeaningQuiz(scoped, getScopedJukugoList(), state.progressData);
    state.meaning = { quiz, answered: false };
    renderMeaningQuiz();
}

function renderMeaningQuiz() {
    const { quiz } = state.meaning;
    el('meaning-next-btn').style.display = 'none';
    el('meaning-feedback').textContent = '';

    if (!quiz) {
        el('meaning-question').innerHTML = '<p>この学年にはまだ意味・熟語データがありません。小学1年、またはすべての学年でお試しください。</p>';
        el('meaning-choices').innerHTML = '';
        return;
    }

    el('meaning-question').innerHTML = `
        <div class="quiz-kanji">${quiz.type === 'jukugo' ? '' : quiz.kanjiRow['漢字']}</div>
        <p>${quiz.questionText}</p>
    `;
    el('meaning-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerMeaningQuiz(choiceText));
        el('meaning-choices').appendChild(btn);
    });
}

function answerMeaningQuiz(choiceText) {
    if (state.meaning.answered) return;
    state.meaning.answered = true;

    const { quiz } = state.meaning;
    const isCorrect = checkAnswer(quiz, choiceText);

    // 熟語の空欄補充問題は、熟語自体と使われている各漢字の進捗の両方に反映する
    const targetIds = quiz.type === 'jukugo'
        ? [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])]
        : [quiz.kanjiRow['ID']];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#meaning-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('meaning-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('meaning-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('meaning-next-btn').style.display = 'inline-block';
}

// ---------- フラッシュカード ----------

function startFlashcardSession() {
    const scoped = getScopedKanjiList();
    const deck = buildFlashcardDeck(scoped, state.progressData, 20);
    state.flashcard = { deck, index: 0, flipped: false };
    renderFlashcard();
}

function renderFlashcard() {
    const { deck, index, flipped } = state.flashcard;
    el('flashcard-restart-btn').style.display = 'none';
    el('flashcard-rate-buttons').style.display = 'none';
    el('flashcard-back').style.display = 'none';

    if (deck.length === 0) {
        el('flashcard-progress').textContent = '';
        el('flashcard-front').innerHTML = '<p>この範囲には出題できる漢字がありません。</p>';
        return;
    }

    if (index >= deck.length) {
        el('flashcard-progress').textContent = `${deck.length} / ${deck.length}`;
        el('flashcard-front').innerHTML = '<p>おつかれさま！このセットは終わりです。</p>';
        el('flashcard-back').style.display = 'none';
        el('flashcard-restart-btn').style.display = 'inline-block';
        return;
    }

    const card = deck[index];
    el('flashcard-progress').textContent = `${index + 1} / ${deck.length}`;
    el('flashcard-front').innerHTML = `<div class="quiz-kanji">${card['漢字']}</div>`;

    if (flipped) {
        const onyomi = card['音読み']?.length ? `音：${card['音読み'].join('、')}` : '';
        const kunyomi = card['訓読み']?.length ? `訓：${card['訓読み'].join('、')}` : '';
        const imi = card['意味'] ? `<p class="flashcard-imi">${card['意味']}</p>` : '';
        el('flashcard-back').innerHTML = `<p>${onyomi}</p><p>${kunyomi}</p>${imi}`;
        el('flashcard-back').style.display = 'block';
        el('flashcard-rate-buttons').style.display = 'flex';
    }
}

function flipFlashcard() {
    if (state.flashcard.index >= state.flashcard.deck.length) return;
    state.flashcard.flipped = true;
    renderFlashcard();
}

function rateFlashcard(known) {
    const { deck, index } = state.flashcard;
    const card = deck[index];
    state.progressData = applyAnswer(state.progressData, card['ID'], known);
    persistLocal();

    state.flashcard.index += 1;
    state.flashcard.flipped = false;
    renderFlashcard();
}

// ---------- 成績 ----------

function renderStats() {
    const scoped  = getScopedKanjiList();
    const summary = summarizeProgress(scoped, state.progressData);
    const weak    = getWeakKanji(scoped, state.progressData).slice(0, 20);

    el('stats-summary').innerHTML = `
        <p class="summary-line">対象：${summary.total}字／学習済み：${summary.attempted}字</p>
        <p class="summary-line">平均正答率：${summary.averageAccuracy !== null ? Math.round(summary.averageAccuracy * 100) + '%' : '－'}</p>
    `;

    el('stats-weak-list').innerHTML = '';
    if (weak.length === 0) {
        el('stats-weak-list').innerHTML = '<li>まだ苦手な漢字はありません（出題数が少ないか、正答率が良好です）。</li>';
        return;
    }
    weak.forEach(({ kanjiRow, accuracy, attempts }) => {
        const li = document.createElement('li');
        li.textContent = `${kanjiRow['漢字']}（${Math.round(accuracy * 100)}% ・ ${attempts}回出題）`;
        el('stats-weak-list').appendChild(li);
    });
}

// ---------- 開発（開発者専用：例文・対象級レビュー） ----------

const JUKUGO_MODES = ['example', 'kyu'];

// 現在のモードに応じて「絞り込み後の一覧・全体件数・行の組み立て関数」をまとめて返す。
// example/kyu は熟語（jukugo.json）、okurigana/reading/writing/strokeは漢字（kanjiMaster.json、
// strokeはさらにstrokeOrder.jsonとの突き合わせ）が対象。
function getDevListForMode() {
    const mode = state.dev.mode;
    if (JUKUGO_MODES.includes(mode)) {
        const merged = getMergedJukugoData();
        return { filtered: filterForReview(merged, mode, state.dev.filters), totalCount: merged.length, buildRow: buildJukugoDevRow };
    }
    if (mode === 'okurigana') {
        const rows = flattenOkuriganaEntries(getMergedKanjiData());
        return { filtered: filterOkuriganaForReview(rows, state.dev.filters), totalCount: rows.length, buildRow: buildOkuriganaDevRow };
    }
    if (mode === 'stroke') {
        const merged = getMergedKanjiData();
        const withStroke = state.strokeData ? merged.filter(k => state.strokeData[k.ID]) : [];
        return { filtered: filterKanjiForReview(withStroke, mode, state.dev.filters), totalCount: withStroke.length, buildRow: buildStrokeDevRow };
    }
    const merged = getMergedKanjiData();
    return { filtered: filterKanjiForReview(merged, mode, state.dev.filters), totalCount: merged.length, buildRow: buildKanjiDevRow };
}

// strokeOrder.json（約15MB）は開発タブの筆順レビューを開いた時だけ取得する。
// 取得完了後、その時点でまだ筆順モードを見ていれば再描画する。
function ensureStrokeDataLoaded() {
    if (state.strokeData || state.strokeDataLoading) return;
    state.strokeDataLoading = true;
    fetch(cacheBustedUrl(STROKE_ORDER_PATH))
        .then(res => {
            if (!res.ok) throw new Error(`strokeOrder.json 読込失敗 (${res.status})`);
            return res.json();
        })
        .then(data => {
            state.strokeData = data;
            state.strokeDataLoading = false;
            if (state.dev.mode === 'stroke') renderDevTab();
        })
        .catch(err => {
            state.strokeDataLoading = false;
            el('dev-list').innerHTML = `<p class="dev-row">筆順データの読み込みに失敗しました：${escapeHtml(err.message)}</p>`;
        });
}

function renderDevTab() {
    updateDevSaveButton();
    updateDevFilterVisibility();

    if (state.dev.mode === 'stroke' && !state.strokeData) {
        ensureStrokeDataLoaded();
        el('dev-filter-summary').textContent = '';
        el('dev-page-info').textContent = '';
        el('dev-page-prev-btn').disabled = true;
        el('dev-page-next-btn').disabled = true;
        el('dev-list').innerHTML = '<p class="dev-row">筆順データを読み込み中…（約15MBあります）</p>';
        return;
    }

    const { filtered, totalCount, buildRow } = getDevListForMode();
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.dev.pageSize));
    if (state.dev.page > totalPages) state.dev.page = totalPages;

    el('dev-filter-summary').textContent = `${filtered.length}件（全${totalCount}件中）`;
    el('dev-page-info').textContent = `${state.dev.page} / ${totalPages}ページ`;
    el('dev-page-prev-btn').disabled = state.dev.page <= 1;
    el('dev-page-next-btn').disabled = state.dev.page >= totalPages;

    const pageItems = filtered.slice((state.dev.page - 1) * state.dev.pageSize, state.dev.page * state.dev.pageSize);

    el('dev-list').innerHTML = '';
    if (pageItems.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'dev-row';
        empty.textContent = '条件に一致する項目はありません。';
        el('dev-list').appendChild(empty);
        return;
    }
    pageItems.forEach(entry => el('dev-list').appendChild(buildRow(entry)));

    // HanziWriterはDOMに実際に挿入された要素が必要なため、行の追加が終わってから初期化する
    if (state.dev.mode === 'stroke') {
        pageItems.forEach(entry => initStrokeWriter(entry));
    }
}

// 種別フィルタは熟語（jukugo.json）のみに存在する概念なので、漢字系モードでは隠す。
function updateDevFilterVisibility() {
    el('dev-filter-type-field').style.display = JUKUGO_MODES.includes(state.dev.mode) ? '' : 'none';
}

function buildDevStatusActions(status, onClickKey) {
    const actions = document.createElement('div');
    actions.className = 'dev-row-actions';

    const statusButtons = document.createElement('div');
    statusButtons.className = 'dev-status-buttons';
    ['承認', '保留', '却下'].forEach(key => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `dev-status-btn dev-status-btn--${key}` + (status === key ? ' dev-status-btn--active' : '');
        btn.textContent = key;
        btn.addEventListener('click', () => onClickKey(status === key ? '未確認' : key)); // 同じボタンをもう一度押すと未確認に戻す
        statusButtons.appendChild(btn);
    });
    actions.appendChild(statusButtons);

    const badge = document.createElement('span');
    badge.className = `dev-status-badge dev-status-badge--${status}`;
    badge.textContent = status;
    actions.appendChild(badge);

    return actions;
}

function buildJukugoDevRow(entry) {
    const { reviewField, contentField } = reviewFieldNames(state.dev.mode);
    const status = entry[reviewField] || '未確認';
    const isDirty = !!state.dev.jukugoEdits[entry.ID];

    const row = document.createElement('div');
    row.className = 'dev-row' + (isDirty ? ' dev-row--dirty' : '');

    const head = document.createElement('div');
    head.className = 'dev-row-head';
    head.innerHTML = `
        <span><span class="dev-row-word">${escapeHtml(entry['語'] || '')}</span> <span class="dev-row-reading">${escapeHtml(entry['読み'] || '')}</span></span>
        <span class="dev-row-tag">${escapeHtml(entry['対象級'] || '')}・${escapeHtml(entry['ID'] || '')}</span>
    `;
    row.appendChild(head);

    const meaning = document.createElement('div');
    meaning.className = 'dev-row-meaning';
    meaning.textContent = entry['意味'] || '（意味未設定）';
    row.appendChild(meaning);

    let contentInput;
    if (state.dev.mode === 'example') {
        contentInput = document.createElement('input');
        contentInput.type = 'text';
        contentInput.value = entry['例文'] || '';
        contentInput.placeholder = '（例文なし）';
    } else {
        contentInput = document.createElement('select');
        KYU_ORDER.forEach(kyu => {
            const opt = document.createElement('option');
            opt.value = kyu;
            opt.textContent = kyu;
            if (kyu === entry['対象級']) opt.selected = true;
            contentInput.appendChild(opt);
        });
    }
    contentInput.className = 'dev-row-content-input';
    contentInput.addEventListener('change', () => {
        applyJukugoEdit(entry.ID, { [contentField]: contentInput.value });
    });
    row.appendChild(contentInput);

    row.appendChild(buildDevStatusActions(status, (next) => applyJukugoEdit(entry.ID, { [reviewField]: next })));
    return row;
}

// 読み・書きレビュー（kanjiMaster.json、漢字1字単位）の行。
// 「書き」モードは読みタブの逆＝読みを主役に表示し、対応する漢字が正しいかを確認する形式。
function buildKanjiDevRow(entry) {
    const mode = state.dev.mode; // 'reading' | 'writing'
    const reviewField = kanjiReviewFieldName(mode);
    const status = entry[reviewField] || '未確認';
    const isDirty = !!state.dev.kanjiEdits[entry.ID];

    const row = document.createElement('div');
    row.className = 'dev-row' + (isDirty ? ' dev-row--dirty' : '');

    const head = document.createElement('div');
    head.className = 'dev-row-head';
    if (mode === 'writing') {
        const readings = [...(entry['音読み'] || []), ...(entry['訓読み'] || [])].filter(r => r && r !== 'ー');
        head.innerHTML = `
            <span><span class="dev-row-word">${escapeHtml(readings.join('／') || '（読みなし）')}</span> <span class="dev-row-reading">→ ${escapeHtml(entry['漢字'] || '')}</span></span>
            <span class="dev-row-tag">${escapeHtml(entry['級'] || '')}・${escapeHtml(entry['ID'] || '')}</span>
        `;
    } else {
        head.innerHTML = `
            <span><span class="dev-row-word">${escapeHtml(entry['漢字'] || '')}</span></span>
            <span class="dev-row-tag">${escapeHtml(entry['級'] || '')}・${escapeHtml(entry['ID'] || '')}</span>
        `;
    }
    row.appendChild(head);

    if (mode === 'reading') {
        const meaning = document.createElement('div');
        meaning.className = 'dev-row-meaning';
        meaning.textContent = entry['意味'] || '（意味未設定）';
        row.appendChild(meaning);

        const onyomiInput = document.createElement('input');
        onyomiInput.type = 'text';
        onyomiInput.className = 'dev-row-content-input';
        onyomiInput.value = (entry['音読み'] || []).join('、');
        onyomiInput.placeholder = '音読み（読点区切り）';
        onyomiInput.addEventListener('change', () => {
            applyKanjiEdit(entry.ID, { '音読み': onyomiInput.value.split('、').map(s => s.trim()).filter(Boolean) });
        });
        row.appendChild(onyomiInput);

        const kunyomiInput = document.createElement('input');
        kunyomiInput.type = 'text';
        kunyomiInput.className = 'dev-row-content-input';
        kunyomiInput.value = (entry['訓読み'] || []).join('、');
        kunyomiInput.placeholder = '訓読み（読点区切り）';
        kunyomiInput.addEventListener('change', () => {
            applyKanjiEdit(entry.ID, { '訓読み': kunyomiInput.value.split('、').map(s => s.trim()).filter(Boolean) });
        });
        row.appendChild(kunyomiInput);
    }

    row.appendChild(buildDevStatusActions(status, (next) => applyKanjiEdit(entry.ID, { [reviewField]: next })));
    return row;
}

// 送り仮名レビュー（kanjiMaster.json、送り仮名例1件単位。1字に複数件ありうるためflattenOkuriganaEntriesで展開済み）の行。
function buildOkuriganaDevRow(entry) {
    const editKey = `${entry.kanjiId}:${entry.exampleIndex}`;
    const status = entry['確認状態'] || '未確認';
    const isDirty = !!state.dev.okuriganaEdits[editKey];

    const row = document.createElement('div');
    row.className = 'dev-row' + (isDirty ? ' dev-row--dirty' : '');

    const head = document.createElement('div');
    head.className = 'dev-row-head';
    head.innerHTML = `
        <span><span class="dev-row-word">${escapeHtml(entry['漢字'] || '')}</span></span>
        <span class="dev-row-tag">${escapeHtml(entry['級'] || '')}・${escapeHtml(entry.kanjiId || '')}</span>
    `;
    row.appendChild(head);

    const wordInput = document.createElement('input');
    wordInput.type = 'text';
    wordInput.className = 'dev-row-content-input';
    wordInput.value = entry['語'] || '';
    wordInput.placeholder = '語（例：明るい）';
    wordInput.addEventListener('change', () => {
        applyOkuriganaEdit(editKey, { '語': wordInput.value });
    });
    row.appendChild(wordInput);

    const readingInput = document.createElement('input');
    readingInput.type = 'text';
    readingInput.className = 'dev-row-content-input';
    readingInput.value = entry['読み'] || '';
    readingInput.placeholder = '読み（例：あかるい）';
    readingInput.addEventListener('change', () => {
        applyOkuriganaEdit(editKey, { '読み': readingInput.value });
    });
    row.appendChild(readingInput);

    row.appendChild(buildDevStatusActions(status, (next) => applyOkuriganaEdit(editKey, { '確認状態': next })));
    return row;
}

// 筆順レビュー（kanjiMaster.json、漢字1字単位。実データはstrokeOrder.jsonから）の行。
// HanziWriter本体の初期化はDOM挿入後に行うため、ここでは空のcanvas要素を用意するだけ。
function buildStrokeDevRow(entry) {
    const reviewField = '筆順_確認状態';
    const status = entry[reviewField] || '未確認';
    const isDirty = !!state.dev.kanjiEdits[entry.ID];
    const strokeCount = state.strokeData?.[entry.ID]?.strokes?.length ?? '?';

    const row = document.createElement('div');
    row.className = 'dev-row' + (isDirty ? ' dev-row--dirty' : '');

    const head = document.createElement('div');
    head.className = 'dev-row-head';
    head.innerHTML = `
        <span><span class="dev-row-word">${escapeHtml(entry['漢字'] || '')}</span> <span class="dev-row-reading">${strokeCount}画</span></span>
        <span class="dev-row-tag">${escapeHtml(entry['級'] || '')}・${escapeHtml(entry['ID'] || '')}</span>
    `;
    row.appendChild(head);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'dev-stroke-canvas-wrap';

    const canvas = document.createElement('div');
    canvas.className = 'dev-stroke-canvas';
    canvas.id = `dev-stroke-canvas-${entry.ID}`;
    canvasWrap.appendChild(canvas);

    const replayBtn = document.createElement('button');
    replayBtn.type = 'button';
    replayBtn.className = 'secondary-btn dev-stroke-replay-btn';
    replayBtn.textContent = '▶ 筆順を再生';
    canvasWrap.appendChild(replayBtn);

    row.appendChild(canvasWrap);
    row.appendChild(buildDevStatusActions(status, (next) => applyKanjiEdit(entry.ID, { [reviewField]: next })));
    return row;
}

// buildStrokeDevRowで作った空のcanvas要素がDOMに挿入された後に呼ぶ。HanziWriterは
// 要素が実際に存在しないと初期化できないため、renderDevTabの行追加ループとは別パスにしている。
function initStrokeWriter(entry) {
    const canvas = el(`dev-stroke-canvas-${entry.ID}`);
    const charData = state.strokeData?.[entry.ID];
    if (!canvas || !charData || !window.HanziWriter) return;

    const writer = window.HanziWriter.create(canvas, entry['漢字'], {
        width: 110,
        height: 110,
        padding: 5,
        showCharacter: true,
        showOutline: true,
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 300,
        charDataLoader: (_char, onComplete) => onComplete(charData)
    });

    const replayBtn = canvas.parentElement.querySelector('.dev-stroke-replay-btn');
    if (replayBtn) replayBtn.addEventListener('click', () => writer.animateCharacter());
}

function applyJukugoEdit(id, changes) {
    state.dev.jukugoEdits[id] = { ...(state.dev.jukugoEdits[id] || {}), ...changes };
    saveDevReviewEdits(state.dev.jukugoEdits);
    updateDevSaveButton();
    renderDevTab();
}

function applyKanjiEdit(id, changes) {
    state.dev.kanjiEdits[id] = { ...(state.dev.kanjiEdits[id] || {}), ...changes };
    saveKanjiReviewEdits(state.dev.kanjiEdits);
    updateDevSaveButton();
    renderDevTab();
}

function applyOkuriganaEdit(editKey, changes) {
    state.dev.okuriganaEdits[editKey] = { ...(state.dev.okuriganaEdits[editKey] || {}), ...changes };
    saveOkuriganaReviewEdits(state.dev.okuriganaEdits);
    updateDevSaveButton();
    renderDevTab();
}

function updateDevSaveButton() {
    const count = Object.keys(state.dev.jukugoEdits).length
        + Object.keys(state.dev.kanjiEdits).length
        + Object.keys(state.dev.okuriganaEdits).length;
    el('dev-save-btn').disabled = count === 0 || !state.token;
    el('dev-save-btn').textContent = count > 0 ? `変更をGitHubに保存（${count}件）` : '変更をGitHubに保存';
}

// jukugo.json・kanjiMaster.jsonそれぞれに未保存の編集があれば、両方を独立して保存する。
// 一方が失敗してももう一方の結果には影響しない（失敗した方の編集はローカルに残る）。
async function handleDevSaveClick() {
    if (!state.token) {
        el('dev-status').textContent = '保存には設定タブでGitHub Personal Access Tokenを登録してください。';
        return;
    }
    const jukugoEditCount = Object.keys(state.dev.jukugoEdits).length;
    const kanjiEditCount = Object.keys(state.dev.kanjiEdits).length + Object.keys(state.dev.okuriganaEdits).length;
    if (jukugoEditCount === 0 && kanjiEditCount === 0) return;

    el('dev-status').textContent = '保存中…';
    const savedParts = [];
    const errorParts = [];

    if (jukugoEditCount > 0) {
        try {
            const { content, sha } = await fetchFile(state.token, CODE_OWNER, CODE_REPO, JUKUGO_REMOTE_PATH);
            const remoteData = JSON.parse(content);
            const merged = mergeReviewEdits(remoteData, state.dev.jukugoEdits);
            const message = `chore(kanzi): 開発タブから熟語データを更新（${jukugoEditCount}件）`;
            await saveFile(state.token, CODE_OWNER, CODE_REPO, JUKUGO_REMOTE_PATH, JSON.stringify(merged, null, 2), sha, message);

            state.jukugoData = merged;
            state.dev.jukugoEdits = {};
            clearDevReviewEdits();
            savedParts.push(`熟語データ${jukugoEditCount}件`);
        } catch (err) {
            errorParts.push(err.status === 409
                ? '熟語データ：他の場所で更新されています。「最新のデータを再取得」してから保存し直してください。'
                : `熟語データの保存に失敗：${err.message}`);
        }
    }

    if (kanjiEditCount > 0) {
        try {
            const { content, sha } = await fetchFile(state.token, CODE_OWNER, CODE_REPO, KANJI_MASTER_REMOTE_PATH);
            const remoteData = JSON.parse(content);
            const merged = mergeOkuriganaReviewEdits(mergeKanjiReviewEdits(remoteData, state.dev.kanjiEdits), state.dev.okuriganaEdits);
            const message = `chore(kanzi): 開発タブから漢字マスタを更新（${kanjiEditCount}件）`;
            await saveFile(state.token, CODE_OWNER, CODE_REPO, KANJI_MASTER_REMOTE_PATH, JSON.stringify(merged, null, 2), sha, message);

            state.kanjiData = merged;
            state.dev.kanjiEdits = {};
            state.dev.okuriganaEdits = {};
            clearKanjiReviewEdits();
            clearOkuriganaReviewEdits();
            savedParts.push(`漢字マスタ${kanjiEditCount}件`);
        } catch (err) {
            errorParts.push(err.status === 409
                ? '漢字マスタ：他の場所で更新されています。「最新のデータを再取得」してから保存し直してください。'
                : `漢字マスタの保存に失敗：${err.message}`);
        }
    }

    const messageParts = [];
    if (savedParts.length > 0) messageParts.push(`GitHubへ保存しました（${savedParts.join('、')}、${new Date().toLocaleString('ja-JP')}）。`);
    if (errorParts.length > 0) messageParts.push(errorParts.join(' '));
    el('dev-status').textContent = messageParts.join(' ');

    updateDevSaveButton();
    renderDevTab();
}

async function handleDevReloadClick() {
    el('dev-status').textContent = '取得中…';
    try {
        await loadKanjiMaster();
        await loadJukugoMaster();
        // 筆順データ（state.strokeData）は一度読み込むとメモリ上にキャッシュされたままなので、
        // ここで明示的に破棄し、筆順モードを見ていれば即座に取り直す。
        state.strokeData = null;
        if (state.dev.mode === 'stroke') ensureStrokeDataLoaded();
        el('dev-status').textContent = '最新のデータを取得しました（未保存の編集は保持されています）。';
        renderDevTab();
    } catch (err) {
        el('dev-status').textContent = `取得に失敗しました：${err.message}`;
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------- 設定・データ読込／保存 ----------

async function loadKanjiMaster() {
    const res = await fetch(cacheBustedUrl(KANJI_MASTER_PATH));
    if (!res.ok) throw new Error(`kanjiMaster.json 読込失敗 (${res.status})`);
    const data = await res.json();
    // 想定外の確認状態の値（データ破損等）は安全側で「未確認」に正規化する（loadJukugoMasterと同じ考え方）
    data.forEach(entry => {
        if (!REVIEW_STATUSES.includes(entry['読み_確認状態'])) entry['読み_確認状態'] = '未確認';
        if (!REVIEW_STATUSES.includes(entry['書き_確認状態'])) entry['書き_確認状態'] = '未確認';
        (entry['送り仮名例'] || []).forEach(ex => {
            if (!REVIEW_STATUSES.includes(ex['確認状態'])) ex['確認状態'] = '未確認';
        });
    });
    state.kanjiData = data;
}

async function loadJukugoMaster() {
    const res = await fetch(cacheBustedUrl(JUKUGO_MASTER_PATH));
    if (!res.ok) throw new Error(`jukugo.json 読込失敗 (${res.status})`);
    const data = await res.json();
    // 想定外の確認状態の値（データ破損等）は安全側で「未確認」に正規化する
    data.forEach(entry => {
        if (!REVIEW_STATUSES.includes(entry['例文_確認状態'])) entry['例文_確認状態'] = '未確認';
        if (!REVIEW_STATUSES.includes(entry['対象級_確認状態'])) entry['対象級_確認状態'] = '未確認';
    });
    state.jukugoData = data;
}

async function loadProgressData() {
    const cache = loadCache();
    if (cache) {
        const parsed = parseMarkdown(cache.content);
        state.progressData = parsed.progressData;
        state.sha = cache.sha || null;
    }

    if (!state.token) return;

    try {
        const { content, sha } = await fetchFile(state.token, OWNER, REPO, PATH);
        const parsed = parseMarkdown(content);
        state.progressData = parsed.progressData;
        state.sha = sha;
        saveCache(content, sha);
        setStatus('GitHubから進捗を読み込みました。');
    } catch (err) {
        setStatus(`GitHubからの読込に失敗しました（オフラインのキャッシュを表示中）：${err.message}`);
    }
}

async function handleLoadClick() {
    state.token = el('settings-token-input').value.trim();
    if (state.token) saveToken(state.token);
    setStatus('読み込み中…');
    await loadProgressData();
    switchView('home');
}

async function handleSaveClick() {
    state.token = el('settings-token-input').value.trim();
    if (!state.token) {
        setStatus('保存にはGitHub Personal Access Tokenが必要です。');
        return;
    }
    saveToken(state.token);

    const md = stringifyMarkdown(state.progressData);
    saveCache(md, state.sha || '');

    try {
        setStatus('保存中…');
        const { newSha } = await saveFile(state.token, OWNER, REPO, PATH, md, state.sha);
        state.sha = newSha;
        saveCache(md, newSha);
        setStatus('GitHubへ保存しました。');
    } catch (err) {
        if (err.status === 409) {
            setStatus('他の端末で更新されています。設定タブの「読み込み」で最新化してから、もう一度保存してください。');
        } else {
            setStatus(`保存に失敗しました（進捗はこの端末には保存済みです）：${err.message}`);
        }
    }
}

function setStatus(text) {
    el('settings-status').textContent = text;
}

// Cache Storage API（Service Workerが使っている場合のみ実在する）を消去し、
// キャッシュを無視した状態でページを再読み込みする。「更新したのに反映されない」を
// ブラウザの設定を触らずアプリ内から解消できるようにするためのボタン用ハンドラ。
async function handleClearCacheClick() {
    try {
        if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }
    } catch (err) {
        // ベストエフォート。失敗しても再読み込みは続行する
    }
    const url = new URL(location.href);
    url.searchParams.set('_cb', Date.now().toString());
    location.href = url.toString();
}

// ---------- 初期化 ----------

function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    el('grade-select').addEventListener('change', (e) => {
        state.currentGrade = e.target.value;
        const activeView = document.querySelector('.nav-btn--active').dataset.view;
        switchView(activeView);
    });

    el('reading-next-btn').addEventListener('click', startReadingQuiz);
    el('meaning-next-btn').addEventListener('click', startMeaningQuiz);

    el('flashcard-card').addEventListener('click', flipFlashcard);
    el('flashcard-again-btn').addEventListener('click', () => rateFlashcard(false));
    el('flashcard-known-btn').addEventListener('click', () => rateFlashcard(true));
    el('flashcard-restart-btn').addEventListener('click', startFlashcardSession);

    el('settings-load-btn').addEventListener('click', handleLoadClick);
    el('settings-save-btn').addEventListener('click', handleSaveClick);
    el('settings-clear-cache-btn').addEventListener('click', handleClearCacheClick);

    document.querySelectorAll('.dev-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.dev.mode = btn.dataset.mode;
            state.dev.page = 1;
            document.querySelectorAll('.dev-mode-btn').forEach(b => b.classList.toggle('dev-mode-btn--active', b === btn));
            renderDevTab();
        });
    });

    [el('dev-filter-status'), el('dev-filter-kyu'), el('dev-filter-type')].forEach(sel => {
        sel.addEventListener('change', () => {
            state.dev.filters.status = el('dev-filter-status').value;
            state.dev.filters.kyu = el('dev-filter-kyu').value;
            state.dev.filters.type = el('dev-filter-type').value;
            state.dev.page = 1;
            renderDevTab();
        });
    });

    let devKeywordTimer = null;
    el('dev-filter-keyword').addEventListener('input', () => {
        clearTimeout(devKeywordTimer);
        devKeywordTimer = setTimeout(() => {
            state.dev.filters.keyword = el('dev-filter-keyword').value.trim();
            state.dev.page = 1;
            renderDevTab();
        }, 200);
    });

    el('dev-page-prev-btn').addEventListener('click', () => {
        if (state.dev.page > 1) { state.dev.page--; renderDevTab(); }
    });
    el('dev-page-next-btn').addEventListener('click', () => {
        const { filtered } = getDevListForMode();
        const totalPages = Math.max(1, Math.ceil(filtered.length / state.dev.pageSize));
        if (state.dev.page < totalPages) { state.dev.page++; renderDevTab(); }
    });

    el('dev-save-btn').addEventListener('click', handleDevSaveClick);
    el('dev-reload-btn').addEventListener('click', handleDevReloadClick);
}

function initDevFilters() {
    KYU_ORDER.forEach(kyu => {
        const opt = document.createElement('option');
        opt.value = kyu;
        opt.textContent = kyu;
        el('dev-filter-kyu').appendChild(opt);
    });
}

async function init() {
    bindEvents();
    initDevFilters();

    state.token = loadToken() || '';
    if (state.token) el('settings-token-input').value = state.token;

    try {
        await loadKanjiMaster();
        await loadJukugoMaster();
    } catch (err) {
        setStatus(`漢字データの読込に失敗しました：${err.message}`);
        return;
    }

    state.dev.jukugoEdits = loadDevReviewEdits();
    state.dev.kanjiEdits = loadKanjiReviewEdits();
    state.dev.okuriganaEdits = loadOkuriganaReviewEdits();
    updateDevSaveButton();

    await loadProgressData();
    renderHome();
}

init();
