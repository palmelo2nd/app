import { fetchFile, saveFile } from './modules/github.js';
import {
    loadToken, saveToken, loadCache, saveCache,
    loadDevReviewEdits, saveDevReviewEdits, clearDevReviewEdits,
    loadKanjiReviewEdits, saveKanjiReviewEdits, clearKanjiReviewEdits,
    loadOkuriganaReviewEdits, saveOkuriganaReviewEdits, clearOkuriganaReviewEdits
} from './modules/storage.js';
import { parseMarkdown, stringifyMarkdown, QUIZ_GENRES, KYU_GENRE_MAP } from './modules/dataModel.js';
import { buildReadingQuiz, buildWritingQuiz, buildKakusuuQuiz, buildBushuQuiz, buildOkuriganaQuiz, buildTaigigoRuigigoQuiz, buildHomophoneQuiz, buildJukugoTypeQuiz, buildJukugoKouseiQuiz, buildGojiTeiseiQuiz, buildMeaningQuiz, buildFlashcardDeck, checkAnswer } from './modules/quiz.js';
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
    currentView: 'quiz',
    currentKyu: '10級',
    // 「その他」タブ（ホーム／意味熟語クイズ／フラッシュカード／成績／設定）内で最後に開いていたview。
    // 対象級プルダウンで改めて「その他」を選んだときにここへ戻る。
    otherView: 'home',
    quizGenre: 'reading',
    reading: { quiz: null, answered: false, inputBuffer: '' },
    writing: { quiz: null, answered: false },
    kakusuu: { quiz: null, answered: false },
    bushu: { quiz: null, busyuAnswered: false, busyumeiAnswered: false },
    okurigana: { quiz: null, answered: false },
    taigigo: { quiz: null, answered: false },
    homophone: { quiz: null, answered: false },
    jukugotype: { quiz: null, answered: false },
    jukugokousei: { quiz: null, answered: false },
    gojiteisei: { quiz: null, answered: false },
    meaning: { quiz: null, answered: false },
    flashcard: { deck: [], index: 0, flipped: false },
    dev: {
        mode: 'example', // 'example' | 'kyu' | 'kousei' | 'okurigana' | 'reading' | 'writing' | 'stroke'
        filters: { status: 'all', kyu: 'all', type: 'all', keyword: '', confidence: 'all' },
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
    return merged.filter(k => k['級'] === state.currentKyu);
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

// 「開発」「その他」は級プルダウンの選択肢の1つとして扱うため、対応するnav-btnが
// #other-tabs側にある（クイズ以外の5画面のみ）。それ以外のviewにはnav-btnが無いため、
// ボタン取得はoptional chainingで安全に行う。
const OTHER_VIEWS = ['home', 'meaning', 'flashcard', 'stats', 'settings'];
const OTHER_SELECT_VALUE = 'other';

function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('view--active'));
    el(`view-${viewName}`).classList.add('view--active');

    const isOtherView = OTHER_VIEWS.includes(viewName);
    el('other-tabs').style.display = isOtherView ? '' : 'none';
    document.querySelectorAll('#other-tabs .nav-btn').forEach(b => b.classList.remove('nav-btn--active'));
    if (isOtherView) {
        document.querySelector(`#other-tabs .nav-btn[data-view="${viewName}"]`)?.classList.add('nav-btn--active');
        state.otherView = viewName;
        el('kyu-select').value = OTHER_SELECT_VALUE;
    } else if (viewName === 'dev') {
        el('kyu-select').value = 'dev';
    } else {
        // 「クイズ」画面：プルダウンの表示を現在の対象級に戻す
        // （「開発」「その他」が選ばれたままにならないように）。
        el('kyu-select').value = state.currentKyu;
    }

    if (viewName === 'home') renderHome();
    if (viewName === 'quiz') renderQuizView();
    if (viewName === 'meaning') startMeaningQuiz();
    if (viewName === 'flashcard') startFlashcardSession();
    if (viewName === 'stats') renderStats();
    if (viewName === 'dev') renderDevTab();
}

// ---------- ホーム ----------

function renderHome() {
    const scoped  = getScopedKanjiList();
    const summary = summarizeProgress(scoped, state.progressData);

    el('home-summary').innerHTML = `
        <p class="summary-line"><strong>${state.currentKyu}</strong>：全${summary.total}字</p>
        <p class="summary-line">学習済み：${summary.attempted}字</p>
        <p class="summary-line">平均正答率：${summary.averageAccuracy !== null ? Math.round(summary.averageAccuracy * 100) + '%' : '－'}</p>
    `;
}

// ---------- クイズ（級ごとの出題形式タブ） ----------

// 対象級に応じた出題形式タブを描画する。「漢字の読み」以外は現状クイズ未実装のため、
// 選択時はプレースホルダーを表示する（js/modules/dataModel.jsのKYU_GENRE_MAP参照）。
function renderQuizGenreTabs() {
    const genres = KYU_GENRE_MAP[state.currentKyu] || ['reading'];
    if (!genres.includes(state.quizGenre)) state.quizGenre = 'reading';

    const nav = el('quiz-genre-tabs');
    nav.innerHTML = '';
    genres.forEach(key => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz-genre-btn' + (key === state.quizGenre ? ' quiz-genre-btn--active' : '');
        btn.textContent = QUIZ_GENRES[key].label;
        btn.addEventListener('click', () => {
            state.quizGenre = key;
            renderQuizView();
        });
        nav.appendChild(btn);
    });
}

function renderQuizView() {
    renderQuizGenreTabs();
    const genre = state.quizGenre;
    const isReading = genre === 'reading';
    const isWriting = genre === 'writing';
    const isKakusuu = genre === 'kakusuu';
    const isBushu = genre === 'bushu';
    const isOkurigana = genre === 'okurigana';
    // 対義語（8級〜7級）と対義語・類義語（6級以降）は同じ画面を共用し、類義語も対象に含めるかだけを
    // buildTaigigoRuigigoQuizへのフラグで切り替える（quiz.js参照）。
    const isTaigigo = genre === 'taigigo' || genre === 'taigigoRuigigo';
    // 8級「同じ漢字の読み」・7級「同音異字」・6級以降「同音・同訓異字」は同じ画面・同じロジック
    // （buildHomophoneQuiz）を共用する（対義語・類義語と同じ考え方、quiz.js参照）。
    const isHomophone = genre === 'onji' || genre === 'doonIji' || genre === 'doonDokunIji';
    // 7級・6級「三字熟語」／5級以降「四字熟語」／準1級・1級「故事・諺」も同じ画面・同じロジック
    // （buildJukugoTypeQuiz）を種別だけ変えて共用する（対義語・類義語と同じ考え方、quiz.js参照）。
    const isJukugoType = genre === 'sanjiJukugo' || genre === 'yonjiJukugo' || genre === 'kojiKotowaza';
    const isJukugoKousei = genre === 'jukugoKousei';
    const isGojiTeisei = genre === 'gojiTeisei';
    el('quiz-genre-reading').style.display = isReading ? '' : 'none';
    el('quiz-genre-writing').style.display = isWriting ? '' : 'none';
    el('quiz-genre-kakusuu').style.display = isKakusuu ? '' : 'none';
    el('quiz-genre-bushu').style.display = isBushu ? '' : 'none';
    el('quiz-genre-okurigana').style.display = isOkurigana ? '' : 'none';
    el('quiz-genre-taigigo').style.display = isTaigigo ? '' : 'none';
    el('quiz-genre-homophone').style.display = isHomophone ? '' : 'none';
    el('quiz-genre-jukugotype').style.display = isJukugoType ? '' : 'none';
    el('quiz-genre-jukugokousei').style.display = isJukugoKousei ? '' : 'none';
    el('quiz-genre-gojiteisei').style.display = isGojiTeisei ? '' : 'none';
    el('quiz-genre-placeholder').style.display =
        (isReading || isWriting || isKakusuu || isBushu || isOkurigana || isTaigigo || isHomophone || isJukugoType || isJukugoKousei || isGojiTeisei) ? 'none' : '';

    if (isReading) {
        startReadingQuiz();
    } else if (isWriting) {
        startWritingQuiz();
    } else if (isKakusuu) {
        // strokeOrder.json（約15MB）は開発タブと共用の遅延読み込み。未取得ならここで取得を始め、
        // 完了時のコールバック（ensureStrokeDataLoaded）が改めてこの画面を描き直す。
        if (!state.strokeData) {
            ensureStrokeDataLoaded();
            el('kakusuu-question').innerHTML = '<p>筆順データを読み込み中…（約15MBあります）</p>';
            el('kakusuu-choices').innerHTML = '';
            el('kakusuu-feedback').textContent = '';
            el('kakusuu-next-btn').style.display = 'none';
        } else {
            startKakusuuQuiz();
        }
    } else if (isBushu) {
        startBushuQuiz();
    } else if (isOkurigana) {
        startOkuriganaQuiz();
    } else if (isTaigigo) {
        startTaigigoQuiz(genre === 'taigigoRuigigo');
    } else if (isHomophone) {
        startHomophoneQuiz();
    } else if (isJukugoType) {
        startJukugoTypeQuiz(jukugoTypeForGenre(genre));
    } else if (isJukugoKousei) {
        startJukugoKouseiQuiz();
    } else if (isGojiTeisei) {
        startGojiTeiseiQuiz();
    } else {
        el('quiz-genre-placeholder').innerHTML =
            `<p>「${QUIZ_GENRES[genre].label}」の問題は準備中です。今後、実装が追加され次第ここに表示されます。</p>`;
    }
}

// ---------- 読みクイズ（「クイズ」タブの「漢字の読み」ジャンルの中身） ----------
// 2026-09-02より4択ではなく、ひらがなキーボード（50音＋濁点・半濁点・小文字トグル）で
// 読みを直接入力させる方式に変更（実際の漢検が記述式のため）。

// 50音表（同じ列に文字が無いマスは空文字＝キーボード上は空きマスにする）。
const GOJUON_ROWS = [
    ['あ', 'い', 'う', 'え', 'お'],
    ['か', 'き', 'く', 'け', 'こ'],
    ['さ', 'し', 'す', 'せ', 'そ'],
    ['た', 'ち', 'つ', 'て', 'と'],
    ['な', 'に', 'ぬ', 'ね', 'の'],
    ['は', 'ひ', 'ふ', 'へ', 'ほ'],
    ['ま', 'み', 'む', 'め', 'も'],
    ['や', '', 'ゆ', '', 'よ'],
    ['ら', 'り', 'る', 'れ', 'ろ'],
    ['わ', '', 'を', '', 'ん']
];

// 濁点・半濁点・小文字トグルは「直前に入力した1文字」を変換する方式。
// 対応表に無い文字（例：「ん」に濁点）を押しても何もしない。同じキーをもう一度押すと元に戻る（双方向）。
const DAKUTEN_MAP = { 'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご', 'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ', 'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど', 'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ' };
const HANDAKUTEN_MAP = { 'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ' };
const SMALL_MAP = { 'あ': 'ぁ', 'い': 'ぃ', 'う': 'ぅ', 'え': 'ぇ', 'お': 'ぉ', 'つ': 'っ', 'や': 'ゃ', 'ゆ': 'ゅ', 'よ': 'ょ' };

function reverseMap(map) {
    return Object.fromEntries(Object.entries(map).map(([base, modified]) => [modified, base]));
}
const DAKUTEN_REVERSE = reverseMap(DAKUTEN_MAP);
const HANDAKUTEN_REVERSE = reverseMap(HANDAKUTEN_MAP);
const SMALL_REVERSE = reverseMap(SMALL_MAP);

// ヘッダーの級プルダウン初期化と同じタイミングで一度だけ50音キーボードのボタンを組み立てる
// （問題が変わってもキー配置自体は変わらないため、renderReadingQuizのたびに作り直す必要はない）。
function initReadingKeyboard() {
    const keyboard = el('reading-keyboard');
    GOJUON_ROWS.forEach(row => {
        row.forEach(kana => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kana-key';
            if (!kana) {
                btn.classList.add('kana-key--blank');
                btn.disabled = true;
            } else {
                btn.textContent = kana;
                btn.addEventListener('click', () => appendReadingKana(kana));
            }
            keyboard.appendChild(btn);
        });
    });
}

function appendReadingKana(kana) {
    if (state.reading.answered) return;
    state.reading.inputBuffer += kana;
    renderReadingAnswerDisplay();
}

function applyReadingModifier(map, reverse) {
    if (state.reading.answered) return;
    const buf = state.reading.inputBuffer;
    if (!buf) return;
    const last = buf[buf.length - 1];
    const converted = map[last] || reverse[last];
    if (!converted) return;
    state.reading.inputBuffer = buf.slice(0, -1) + converted;
    renderReadingAnswerDisplay();
}

function backspaceReadingInput() {
    if (state.reading.answered) return;
    state.reading.inputBuffer = state.reading.inputBuffer.slice(0, -1);
    renderReadingAnswerDisplay();
}

function clearReadingInput() {
    if (state.reading.answered) return;
    state.reading.inputBuffer = '';
    renderReadingAnswerDisplay();
}

function renderReadingAnswerDisplay() {
    el('reading-answer-display').textContent = state.reading.inputBuffer || '　';
}

function startReadingQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildReadingQuiz(scoped, getScopedJukugoList(), state.progressData);
    state.reading = { quiz, answered: false, inputBuffer: '' };
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

function setReadingKeyboardDisabled(disabled) {
    document.querySelectorAll('#reading-keyboard .kana-key:not(.kana-key--blank), .kana-modifier-btn, #reading-submit-btn')
        .forEach(btn => { btn.disabled = disabled; });
}

function renderReadingQuiz() {
    const { quiz } = state.reading;
    el('reading-next-btn').style.display = 'none';
    el('reading-feedback').textContent = '';
    renderReadingAnswerDisplay();
    setReadingKeyboardDisabled(false);

    if (!quiz) {
        el('reading-question').innerHTML = '<p>この級には出題できる例文がありません。対象級を切り替えてください。</p>';
        setReadingKeyboardDisabled(true);
        return;
    }

    const furiganaList = quiz.poolType === 'jukugo' ? quiz.jukugo['ふりがな'] : undefined;
    el('reading-question').innerHTML = `
        <p class="quiz-sentence">${renderQuizSentence(quiz.sentence, quiz.targetWord, furiganaList)}</p>
        <p>${quiz.questionText}</p>
    `;
}

function submitReadingAnswer() {
    if (state.reading.answered) return;
    const { quiz } = state.reading;
    if (!quiz) return;
    state.reading.answered = true;

    const isCorrect = checkAnswer(quiz, state.reading.inputBuffer);

    // 単漢字エントリは漢字自身の進捗のみ、熟語エントリは熟語自体と使われている各漢字の進捗の両方に反映する
    const targetIds = quiz.poolType === 'kanji'
        ? [quiz.kanjiRow['ID']]
        : [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    setReadingKeyboardDisabled(true);
    el('reading-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('reading-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('reading-next-btn').style.display = 'inline-block';
}

// ---------- 書取クイズ（「クイズ」タブの「漢字の書取」ジャンルの中身） ----------

// 読みクイズの逆：例文中の対象語を読み（ひらがな）に置き換えて見せ、正しい漢字表記を4択で選ばせる。
// レンダリング・ふりがな処理はrenderQuizSentenceをそのまま流用する（targetWordに読みを渡す点だけが異なる）。
function startWritingQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildWritingQuiz(scoped, getScopedJukugoList(), state.progressData);
    state.writing = { quiz, answered: false };
    renderWritingQuiz();
}

function renderWritingQuiz() {
    const { quiz } = state.writing;
    el('writing-next-btn').style.display = 'none';
    el('writing-feedback').textContent = '';

    if (!quiz) {
        el('writing-question').innerHTML = '<p>この級には出題できる例文がありません。対象級を切り替えてください。</p>';
        el('writing-choices').innerHTML = '';
        return;
    }

    el('writing-question').innerHTML = `
        <p class="quiz-sentence">${renderQuizSentence(quiz.sentence, quiz.targetReading, quiz.jukugo['ふりがな'])}</p>
        <p>${quiz.questionText}</p>
    `;
    el('writing-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerWritingQuiz(choiceText));
        el('writing-choices').appendChild(btn);
    });
}

function answerWritingQuiz(choiceText) {
    if (state.writing.answered) return;
    state.writing.answered = true;

    const { quiz } = state.writing;
    const isCorrect = checkAnswer(quiz, choiceText);

    // 熟語自体の進捗と、使われている各漢字の進捗の両方に反映する（読みクイズと同じ考え方）
    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#writing-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('writing-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('writing-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('writing-next-btn').style.display = 'inline-block';
}

// ---------- 筆順クイズ（「クイズ」タブの「筆順・画数」ジャンルの中身） ----------

// data/strokeOrder.jsonのstrokesは、HanziWriterのclip-pathではなく単独の塗りつぶし輪郭として
// 直接fillできる形状で確定している（CLAUDE.md参照）。HanziWriterのアニメーション機構は使わず、
// 対象の1画だけ色を変えた静止画SVGを自前で組み立てる方が「1画だけ強調表示する」用途にはシンプル。
// 変換式はHanziWriter本体の描画結果（translate/scale）を実測して合わせたもの
// （scale=(size-2*padding)/1024、縦方向はy軸反転のうえ文字の基準高さ900を基準に配置）。
function buildKakusuuSvg(charData, highlightIndex, size, padding) {
    const scale = (size - 2 * padding) / 1024;
    const ty = padding + 900 * scale;
    const paths = charData.strokes.map((d, i) => {
        const fill = i === highlightIndex ? '#2f6fed' : '#c9d3e0';
        return `<path d="${escapeHtml(d)}" fill="${fill}"></path>`;
    }).join('');
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
        `<g transform="translate(${padding}, ${ty}) scale(${scale}, ${-scale})">${paths}</g></svg>`;
}

function startKakusuuQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildKakusuuQuiz(scoped, state.strokeData, state.progressData);
    state.kakusuu = { quiz, answered: false };
    renderKakusuuQuiz();
}

function renderKakusuuQuiz() {
    const { quiz } = state.kakusuu;
    el('kakusuu-next-btn').style.display = 'none';
    el('kakusuu-feedback').textContent = '';

    if (!quiz) {
        el('kakusuu-question').innerHTML = '<p>この級には出題できる筆順データがありません。対象級を切り替えてください。</p>';
        el('kakusuu-choices').innerHTML = '';
        return;
    }

    const charData = state.strokeData[quiz.kanjiRow['ID']];
    const svg = buildKakusuuSvg(charData, quiz.strokeIndex, 200, 12);
    el('kakusuu-question').innerHTML = `
        <div class="kakusuu-svg-wrap">${svg}</div>
        <p>${quiz.questionText}</p>
    `;
    el('kakusuu-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = `${choiceText}画目`;
        btn.addEventListener('click', () => answerKakusuuQuiz(choiceText));
        el('kakusuu-choices').appendChild(btn);
    });
}

function answerKakusuuQuiz(choiceText) {
    if (state.kakusuu.answered) return;
    state.kakusuu.answered = true;

    const { quiz } = state.kakusuu;
    const isCorrect = checkAnswer(quiz, choiceText);

    state.progressData = applyAnswer(state.progressData, quiz.kanjiRow['ID'], isCorrect);
    persistLocal();

    document.querySelectorAll('#kakusuu-choices .choice-btn').forEach(btn => {
        const value = btn.textContent.replace('画目', '');
        btn.disabled = true;
        if (value === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (value === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('kakusuu-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}画目」`;
    el('kakusuu-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('kakusuu-next-btn').style.display = 'inline-block';
}

// ---------- 部首・部首名クイズ（「クイズ」タブの「部首・部首名」ジャンルの中身） ----------

// 漢検の実際の出題内容（1字について部首・部首名の両方を答えさせる）を、部首・部首名それぞれの
// 4択という2つの選択グループとして1画面にまとめる（quiz.jsのbuildBushuQuiz参照）。
// 両方に解答するまで「次の問題」ボタンは出さず、進捗は両方正解して初めて正解として記録する。
function startBushuQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildBushuQuiz(scoped, state.progressData);
    state.bushu = { quiz, busyuAnswered: false, busyumeiAnswered: false };
    renderBushuQuiz();
}

function renderBushuChoiceGroup(containerId, choices, onSelect) {
    const container = el(containerId);
    container.innerHTML = '';
    choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => onSelect(choiceText));
        container.appendChild(btn);
    });
}

function renderBushuQuiz() {
    const { quiz } = state.bushu;
    el('bushu-next-btn').style.display = 'none';
    el('bushu-busyu-feedback').textContent = '';
    el('bushu-busyumei-feedback').textContent = '';

    if (!quiz) {
        el('bushu-question').innerHTML = '<p>この級には出題できる部首データがありません。対象級を切り替えてください。</p>';
        el('bushu-busyu-choices').innerHTML = '';
        el('bushu-busyumei-choices').innerHTML = '';
        return;
    }

    el('bushu-question').innerHTML = `
        <div class="quiz-kanji">${quiz.kanjiRow['漢字']}</div>
        <p>${quiz.questionText}</p>
    `;
    renderBushuChoiceGroup('bushu-busyu-choices', quiz.busyuChoices, choiceText => answerBushuPart('busyu', choiceText));
    renderBushuChoiceGroup('bushu-busyumei-choices', quiz.busyumeiChoices, choiceText => answerBushuPart('busyumei', choiceText));
}

function answerBushuPart(part, choiceText) {
    const b = state.bushu;
    const answeredKey = part === 'busyu' ? 'busyuAnswered' : 'busyumeiAnswered';
    if (b[answeredKey]) return;
    b[answeredKey] = true;

    const correctText = part === 'busyu' ? b.quiz.busyuCorrect : b.quiz.busyumeiCorrect;
    const isCorrect = choiceText === correctText;
    const choicesId = part === 'busyu' ? 'bushu-busyu-choices' : 'bushu-busyumei-choices';
    const feedbackId = part === 'busyu' ? 'bushu-busyu-feedback' : 'bushu-busyumei-feedback';

    document.querySelectorAll(`#${choicesId} .choice-btn`).forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el(feedbackId).textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${correctText}」`;
    el(feedbackId).className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');

    if (b.busyuAnswered && b.busyumeiAnswered) {
        const bothCorrect = document.querySelectorAll('#bushu-busyu-choices .choice-btn--wrong').length === 0 &&
            document.querySelectorAll('#bushu-busyumei-choices .choice-btn--wrong').length === 0;
        state.progressData = applyAnswer(state.progressData, b.quiz.kanjiRow['ID'], bothCorrect);
        persistLocal();
        el('bushu-next-btn').style.display = 'inline-block';
    }
}

// ---------- 送り仮名クイズ（「クイズ」タブの「送り仮名」ジャンルの中身） ----------

// 漢検の実際の出題形式（赤字のカタカナを漢字＋送りがなに直す）に合わせ、読みをカタカナで見せて
// 正しい表記を4択で選ばせる（quiz.jsのbuildOkuriganaQuiz参照）。
function startOkuriganaQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildOkuriganaQuiz(scoped, state.progressData);
    state.okurigana = { quiz, answered: false };
    renderOkuriganaQuiz();
}

function renderOkuriganaQuiz() {
    const { quiz } = state.okurigana;
    el('okurigana-next-btn').style.display = 'none';
    el('okurigana-feedback').textContent = '';

    if (!quiz) {
        el('okurigana-question').innerHTML = '<p>この級には出題できる送り仮名データがありません。対象級を切り替えてください。</p>';
        el('okurigana-choices').innerHTML = '';
        return;
    }

    el('okurigana-question').innerHTML = `<p>${quiz.questionText}</p>`;
    el('okurigana-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerOkuriganaQuiz(choiceText));
        el('okurigana-choices').appendChild(btn);
    });
}

function answerOkuriganaQuiz(choiceText) {
    if (state.okurigana.answered) return;
    state.okurigana.answered = true;

    const { quiz } = state.okurigana;
    const isCorrect = checkAnswer(quiz, choiceText);

    state.progressData = applyAnswer(state.progressData, quiz.kanjiRow['ID'], isCorrect);
    persistLocal();

    document.querySelectorAll('#okurigana-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('okurigana-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('okurigana-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('okurigana-next-btn').style.display = 'inline-block';
}

// ---------- 対義語・類義語クイズ（「クイズ」タブの「対義語」「対義語・類義語」ジャンルの中身） ----------

// 8級〜7級は対義語のみ、6級以降は対義語・類義語の両方が公式の出題範囲（KYU_GENRE_MAPの
// 'taigigo'/'taigigoRuigigo'）。includeSynonymで対象を切り替えるだけで画面・ロジックは共用する。
function startTaigigoQuiz(includeSynonym) {
    const quiz = buildTaigigoRuigigoQuiz(getScopedJukugoList(), state.progressData, includeSynonym);
    state.taigigo = { quiz, answered: false };
    renderTaigigoQuiz();
}

function renderTaigigoQuiz() {
    const { quiz } = state.taigigo;
    el('taigigo-next-btn').style.display = 'none';
    el('taigigo-feedback').textContent = '';

    if (!quiz) {
        el('taigigo-question').innerHTML = '<p>この級には出題できる対義語・類義語データがありません。対象級を切り替えてください。</p>';
        el('taigigo-choices').innerHTML = '';
        return;
    }

    el('taigigo-question').innerHTML = `<p>${quiz.questionText}</p>`;
    el('taigigo-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerTaigigoQuiz(choiceText));
        el('taigigo-choices').appendChild(btn);
    });
}

function answerTaigigoQuiz(choiceText) {
    if (state.taigigo.answered) return;
    state.taigigo.answered = true;

    const { quiz } = state.taigigo;
    const isCorrect = checkAnswer(quiz, choiceText);

    // 熟語自体の進捗と、使われている各漢字の進捗の両方に反映する（意味・熟語クイズと同じ考え方）
    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#taigigo-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('taigigo-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('taigigo-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('taigigo-next-btn').style.display = 'inline-block';
}

// ---------- 同音・同訓異字クイズ（「クイズ」タブの「同じ漢字の読み」「同音異字」「同音・同訓異字」ジャンルの中身） ----------

// 例文中のカタカナ化した読みに対し、同じ読みを持つ複数の漢字表記から文脈に合う正しいものを選ばせる
// （quiz.jsのbuildHomophoneQuiz参照）。表示は書取クイズと同じrenderQuizSentenceを流用する。
function startHomophoneQuiz() {
    const quiz = buildHomophoneQuiz(getScopedJukugoList(), state.progressData);
    state.homophone = { quiz, answered: false };
    renderHomophoneQuiz();
}

function renderHomophoneQuiz() {
    const { quiz } = state.homophone;
    el('homophone-next-btn').style.display = 'none';
    el('homophone-feedback').textContent = '';

    if (!quiz) {
        el('homophone-question').innerHTML = '<p>この級には出題できる同じ読みの熟語がありません。対象級を切り替えてください。</p>';
        el('homophone-choices').innerHTML = '';
        return;
    }

    el('homophone-question').innerHTML = `
        <p class="quiz-sentence">${renderQuizSentence(quiz.sentence, quiz.targetReading, quiz.jukugo['ふりがな'])}</p>
        <p>${quiz.questionText}</p>
    `;
    el('homophone-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerHomophoneQuiz(choiceText));
        el('homophone-choices').appendChild(btn);
    });
}

function answerHomophoneQuiz(choiceText) {
    if (state.homophone.answered) return;
    state.homophone.answered = true;

    const { quiz } = state.homophone;
    const isCorrect = checkAnswer(quiz, choiceText);

    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#homophone-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('homophone-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('homophone-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('homophone-next-btn').style.display = 'inline-block';
}

// ---------- 三字熟語・四字熟語クイズ（「クイズ」タブの「三字熟語」「四字熟語」ジャンルの中身） ----------

// 例文中の対象語（三字熟語または四字熟語）を読みに置き換えて見せ、正しい表記を4択で選ばせる
// ジャンルkey→jukugo.jsonの`種別`値への対応（`quiz-genre-tabs`のジャンル切り替え・次の問題ボタンの両方から使う）。
function jukugoTypeForGenre(genre) {
    if (genre === 'yonjiJukugo') return '四字熟語';
    if (genre === 'kojiKotowaza') return '故事・諺';
    return '三字熟語';
}

// （書取クイズと同じ考え方、quiz.jsのbuildJukugoTypeQuiz参照）。
function startJukugoTypeQuiz(jukugoType) {
    const quiz = buildJukugoTypeQuiz(getScopedJukugoList(), state.progressData, jukugoType);
    state.jukugotype = { quiz, answered: false };
    renderJukugoTypeQuiz();
}

function renderJukugoTypeQuiz() {
    const { quiz } = state.jukugotype;
    el('jukugotype-next-btn').style.display = 'none';
    el('jukugotype-feedback').textContent = '';

    if (!quiz) {
        el('jukugotype-question').innerHTML = '<p>この級には出題できる熟語がありません。対象級を切り替えてください。</p>';
        el('jukugotype-choices').innerHTML = '';
        return;
    }

    el('jukugotype-question').innerHTML = `
        <p class="quiz-sentence">${renderQuizSentence(quiz.sentence, quiz.targetReading, quiz.jukugo['ふりがな'])}</p>
        <p>${quiz.questionText}</p>
    `;
    el('jukugotype-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerJukugoTypeQuiz(choiceText));
        el('jukugotype-choices').appendChild(btn);
    });
}

function answerJukugoTypeQuiz(choiceText) {
    if (state.jukugotype.answered) return;
    state.jukugotype.answered = true;

    const { quiz } = state.jukugotype;
    const isCorrect = checkAnswer(quiz, choiceText);

    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#jukugotype-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('jukugotype-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('jukugotype-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('jukugotype-next-btn').style.display = 'inline-block';
}

// ---------- 熟語の構成クイズ（「クイズ」タブの「熟語の構成」ジャンルの中身） ----------

// 二字熟語を1つ見せ、漢検公式の5分類ア〜オのどれに当てはまるかを選ばせる（quiz.jsのbuildJukugoKouseiQuiz参照）。
// 確信度「低」のエントリも出題対象に含める（開発タブの「熟語の構成レビュー」で別途レビュー・修正できる）。
function startJukugoKouseiQuiz() {
    const quiz = buildJukugoKouseiQuiz(getScopedJukugoList(), state.progressData);
    state.jukugokousei = { quiz, answered: false };
    renderJukugoKouseiQuiz();
}

function renderJukugoKouseiQuiz() {
    const { quiz } = state.jukugokousei;
    el('jukugokousei-next-btn').style.display = 'none';
    el('jukugokousei-feedback').textContent = '';

    if (!quiz) {
        el('jukugokousei-question').innerHTML = '<p>この級には出題できる熟語がありません。対象級を切り替えてください。</p>';
        el('jukugokousei-choices').innerHTML = '';
        return;
    }

    el('jukugokousei-question').innerHTML = `<p>${quiz.questionText}</p>`;
    el('jukugokousei-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn choice-btn--kousei';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerJukugoKouseiQuiz(choiceText));
        el('jukugokousei-choices').appendChild(btn);
    });
}

function answerJukugoKouseiQuiz(choiceText) {
    if (state.jukugokousei.answered) return;
    state.jukugokousei.answered = true;

    const { quiz } = state.jukugokousei;
    const isCorrect = checkAnswer(quiz, choiceText);

    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#jukugokousei-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('jukugokousei-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('jukugokousei-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('jukugokousei-next-btn').style.display = 'inline-block';
}

// ---------- 誤字訂正クイズ（「クイズ」タブの「誤字訂正」ジャンルの中身） ----------

function startGojiTeiseiQuiz() {
    const scoped = getScopedKanjiList();
    const quiz = buildGojiTeiseiQuiz(scoped, getScopedJukugoList(), state.progressData);
    state.gojiteisei = { quiz, answered: false };
    renderGojiTeiseiQuiz();
}

function renderGojiTeiseiQuiz() {
    const { quiz } = state.gojiteisei;
    el('gojiteisei-next-btn').style.display = 'none';
    el('gojiteisei-feedback').textContent = '';

    if (!quiz) {
        el('gojiteisei-question').innerHTML = '<p>この級には出題できる熟語がありません。対象級を切り替えてください。</p>';
        el('gojiteisei-choices').innerHTML = '';
        return;
    }

    el('gojiteisei-question').innerHTML = `
        <p class="quiz-sentence">${renderQuizSentence(quiz.sentence, quiz.wrongWord, quiz.jukugo['ふりがな'])}</p>
        <p>${quiz.questionText}</p>
    `;
    el('gojiteisei-choices').innerHTML = '';
    quiz.choices.forEach(choiceText => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.textContent = choiceText;
        btn.addEventListener('click', () => answerGojiTeiseiQuiz(choiceText));
        el('gojiteisei-choices').appendChild(btn);
    });
}

function answerGojiTeiseiQuiz(choiceText) {
    if (state.gojiteisei.answered) return;
    state.gojiteisei.answered = true;

    const { quiz } = state.gojiteisei;
    const isCorrect = checkAnswer(quiz, choiceText);

    const targetIds = [quiz.jukugo['ID'], ...(quiz.jukugo['使用漢字ID'] || [])];
    targetIds.forEach(id => {
        state.progressData = applyAnswer(state.progressData, id, isCorrect);
    });
    persistLocal();

    document.querySelectorAll('#gojiteisei-choices .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === quiz.correctText) btn.classList.add('choice-btn--correct');
        else if (btn.textContent === choiceText) btn.classList.add('choice-btn--wrong');
    });

    el('gojiteisei-feedback').textContent = isCorrect ? '正解！' : `ちがうよ。正解は「${quiz.correctText}」`;
    el('gojiteisei-feedback').className = 'quiz-feedback ' + (isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong');
    el('gojiteisei-next-btn').style.display = 'inline-block';
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
        el('meaning-question').innerHTML = '<p>この級にはまだ意味・熟語データがありません。対象級を切り替えてください。</p>';
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

const JUKUGO_MODES = ['example', 'kyu', 'kousei', 'goji'];

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
            if (state.currentView === 'quiz' && state.quizGenre === 'kakusuu') renderQuizView();
        })
        .catch(err => {
            state.strokeDataLoading = false;
            const message = `筆順データの読み込みに失敗しました：${escapeHtml(err.message)}`;
            if (state.dev.mode === 'stroke') el('dev-list').innerHTML = `<p class="dev-row">${message}</p>`;
            if (state.currentView === 'quiz' && state.quizGenre === 'kakusuu') el('kakusuu-question').innerHTML = `<p>${message}</p>`;
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
// kousei（熟語の構成レビュー）・goji（誤字訂正レビュー）は対象が二字熟語のみに固定されるため
// 種別フィルタは不要な代わりに、確信度／視覚類似度フィルタ（構成_確信度／誤字候補_視覚類似度）を表示する。
function updateDevFilterVisibility() {
    el('dev-filter-type-field').style.display = (JUKUGO_MODES.includes(state.dev.mode) && state.dev.mode !== 'kousei' && state.dev.mode !== 'goji') ? '' : 'none';
    el('dev-filter-confidence-field').style.display = (state.dev.mode === 'kousei' || state.dev.mode === 'goji') ? '' : 'none';
    el('dev-filter-confidence-label').textContent = state.dev.mode === 'goji' ? '視覚類似度' : '確信度';
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
    let confidenceBadge = '';
    if (state.dev.mode === 'kousei' && entry['構成_確信度']) {
        confidenceBadge = `<span class="dev-confidence-badge dev-confidence-badge--${escapeHtml(entry['構成_確信度'])}">確信度：${escapeHtml(entry['構成_確信度'])}</span>`;
    } else if (state.dev.mode === 'goji' && entry['誤字候補_視覚類似度']) {
        confidenceBadge = `<span class="dev-confidence-badge dev-confidence-badge--${escapeHtml(entry['誤字候補_視覚類似度'])}">視覚類似度：${escapeHtml(entry['誤字候補_視覚類似度'])}</span>`;
    }
    head.innerHTML = `
        <span><span class="dev-row-word">${escapeHtml(entry['語'] || '')}</span> <span class="dev-row-reading">${escapeHtml(entry['読み'] || '')}</span> ${confidenceBadge}</span>
        <span class="dev-row-tag">${escapeHtml(entry['対象級'] || '')}・${escapeHtml(entry['ID'] || '')}</span>
    `;
    row.appendChild(head);

    const meaning = document.createElement('div');
    meaning.className = 'dev-row-meaning';
    meaning.textContent = entry['意味'] || '（意味未設定）';
    row.appendChild(meaning);

    if (state.dev.mode === 'goji') {
        const chars = [...(entry['語'] || '')];
        const position = entry['誤字候補_位置'];
        const correctChar = chars[position];
        chars[position] = entry['誤字候補_文字'] || '？';
        const wrongPreview = document.createElement('div');
        wrongPreview.className = 'dev-row-meaning';
        wrongPreview.textContent = `${position + 1}文字目「${correctChar}」を「${entry['誤字候補_文字'] || ''}」に差し替え → 誤字表記「${chars.join('')}」（読み：${entry['誤字候補_読み'] || ''}）`;
        row.appendChild(wrongPreview);
    }

    let contentInput;
    if (state.dev.mode === 'example' || state.dev.mode === 'goji') {
        contentInput = document.createElement('input');
        contentInput.type = 'text';
        contentInput.value = (state.dev.mode === 'goji' ? entry['誤字候補_文字'] : entry['例文']) || '';
        contentInput.placeholder = state.dev.mode === 'goji' ? '（誤字の漢字1字）' : '（例文なし）';
    } else if (state.dev.mode === 'kousei') {
        contentInput = document.createElement('select');
        [['ア', 'ア（同じような意味を重ねる）'], ['イ', 'イ（反対・対応の意味）'], ['ウ', 'ウ（上が下を修飾）'], ['エ', 'エ（下が上の目的語・補語）'], ['オ', 'オ（上が下を打ち消す）']].forEach(([key, label]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            if (key === entry['構成']) opt.selected = true;
            contentInput.appendChild(opt);
        });
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
    // 「その他」タブ内（ホーム／意味熟語クイズ／フラッシュカード／成績／設定）のサブナビ切り替え。
    document.querySelectorAll('#other-tabs .nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // 級プルダウンには「開発」「その他」も選択肢として含める。10級〜1級を選ぶと常に
    // クイズ画面（対象級に応じたジャンルサブタブ）へ直接遷移し、「その他」を選ぶと
    // 最後に開いていたその他系画面（初回はホーム）へ、「開発」を選ぶと開発タブへ遷移する。
    el('kyu-select').addEventListener('change', (e) => {
        const value = e.target.value;
        if (value === 'dev') {
            switchView('dev');
            return;
        }
        if (value === OTHER_SELECT_VALUE) {
            switchView(state.otherView || 'home');
            return;
        }
        state.currentKyu = value;
        switchView('quiz');
    });

    el('reading-next-btn').addEventListener('click', startReadingQuiz);
    el('reading-submit-btn').addEventListener('click', submitReadingAnswer);
    el('reading-dakuten-btn').addEventListener('click', () => applyReadingModifier(DAKUTEN_MAP, DAKUTEN_REVERSE));
    el('reading-handakuten-btn').addEventListener('click', () => applyReadingModifier(HANDAKUTEN_MAP, HANDAKUTEN_REVERSE));
    el('reading-small-btn').addEventListener('click', () => applyReadingModifier(SMALL_MAP, SMALL_REVERSE));
    el('reading-backspace-btn').addEventListener('click', backspaceReadingInput);
    el('reading-clear-btn').addEventListener('click', clearReadingInput);
    el('writing-next-btn').addEventListener('click', startWritingQuiz);
    el('kakusuu-next-btn').addEventListener('click', startKakusuuQuiz);
    el('bushu-next-btn').addEventListener('click', startBushuQuiz);
    el('okurigana-next-btn').addEventListener('click', startOkuriganaQuiz);
    el('taigigo-next-btn').addEventListener('click', () => startTaigigoQuiz(state.quizGenre === 'taigigoRuigigo'));
    el('homophone-next-btn').addEventListener('click', startHomophoneQuiz);
    el('jukugotype-next-btn').addEventListener('click', () => startJukugoTypeQuiz(jukugoTypeForGenre(state.quizGenre)));
    el('jukugokousei-next-btn').addEventListener('click', startJukugoKouseiQuiz);
    el('gojiteisei-next-btn').addEventListener('click', startGojiTeiseiQuiz);
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

    [el('dev-filter-status'), el('dev-filter-kyu'), el('dev-filter-type'), el('dev-filter-confidence')].forEach(sel => {
        sel.addEventListener('change', () => {
            state.dev.filters.status = el('dev-filter-status').value;
            state.dev.filters.kyu = el('dev-filter-kyu').value;
            state.dev.filters.type = el('dev-filter-type').value;
            state.dev.filters.confidence = el('dev-filter-confidence').value;
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

// ヘッダーの級プルダウン（#kyu-select）に10級〜1級の選択肢を並べ、末尾に「開発」「その他」を追加する
// （開発タブ・その他タブ群はいずれも独立したnavボタンではなく、この級プルダウンの選択肢として統合している）。
function initKyuSelect() {
    const select = el('kyu-select');
    KYU_ORDER.forEach(kyu => {
        const opt = document.createElement('option');
        opt.value = kyu;
        opt.textContent = kyu;
        select.appendChild(opt);
    });
    const devOpt = document.createElement('option');
    devOpt.value = 'dev';
    devOpt.textContent = '開発';
    select.appendChild(devOpt);
    const otherOpt = document.createElement('option');
    otherOpt.value = OTHER_SELECT_VALUE;
    otherOpt.textContent = 'その他';
    select.appendChild(otherOpt);
    select.value = state.currentKyu;
}

async function init() {
    bindEvents();
    initDevFilters();
    initKyuSelect();
    initReadingKeyboard();

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
    switchView('quiz');
}

init();
