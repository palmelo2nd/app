// (1) インポート — progress.js（出題重み付けのため）
import { weightedSample } from './progress.js';

function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function pickOne(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function buildChoices(correctText, distractorPool, correctExcludeSet) {
    const candidates = shuffle(distractorPool.filter(t => t && !correctExcludeSet.has(t)));
    const uniqueDistractors = [...new Set(candidates)].slice(0, 3);
    return shuffle([correctText, ...uniqueDistractors]);
}

/**
 * 読みクイズを1問作る（熟語が使われた例文を見せて、その熟語の読みを4択で選ばせる）。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列, jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用
 * (3) メイン: kanjiListに含まれる漢字を使用漢字IDに1つでも含み、例文を持つ熟語を重み付き抽選し、
 *             他の熟語の読みから紛らわしくない誤答3件を作る
 * (4) アウトプット: { type:'reading', jukugo, sentence, targetWord, questionText, choices, correctText }
 *                    or null（出題対象の例文が無い場合）
 */
export function buildReadingQuiz(kanjiList, jukugoList, progressData) {
    const scopedIds = new Set(kanjiList.map(k => k['ID']));
    const entries = jukugoList.filter(j =>
        j['例文'] && (j['使用漢字ID'] || []).some(id => scopedIds.has(id))
    );
    if (entries.length < 4) return null;

    const [target] = weightedSample(entries, progressData, 1);
    if (!target) return null;

    const correctText = target['読み'];

    const distractorPool = entries
        .filter(e => e['語'] !== target['語'])
        .map(e => e['読み']);

    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    return {
        type: 'reading',
        jukugo: target,
        sentence: target['例文'],
        targetWord: target['語'],
        questionText: `文中の「${target['語']}」の読みはどれ？`,
        choices,
        correctText
    };
}

/**
 * 書取クイズを1問作る（例文中の対象語を読み＝ひらがなに置き換えて見せ、正しい漢字表記を4択で選ばせる）。
 * 読みクイズ（buildReadingQuiz）の逆で、母集団・重み付け抽選・進捗反映の仕組みは同じものを流用する。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列, jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用
 * (3) メイン: kanjiListに含まれる漢字を使用漢字IDに1つでも含み、例文を持つ熟語を重み付き抽選し、
 *             例文中の対象語（漢字表記）をその読みに置き換えたうえで、他の熟語の漢字表記から誤答3件を作る
 * (4) アウトプット: { type:'writing', jukugo, sentence, targetReading, questionText, choices, correctText }
 *                    or null（出題対象の例文が無い場合）
 */
export function buildWritingQuiz(kanjiList, jukugoList, progressData) {
    const scopedIds = new Set(kanjiList.map(k => k['ID']));
    const entries = jukugoList.filter(j =>
        j['例文'] && (j['使用漢字ID'] || []).some(id => scopedIds.has(id))
    );
    if (entries.length < 4) return null;

    const [target] = weightedSample(entries, progressData, 1);
    if (!target) return null;

    const correctText = target['語'];

    const distractorPool = entries
        .filter(e => e['語'] !== target['語'])
        .map(e => e['語']);

    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    // 例文中の対象語（漢字表記）を読み（ひらがな）に置き換えて「書取」の体裁にする。
    // 対象語は必ず例文中に部分文字列として含まれる前提（既存の読みクイズ・ふりがな処理と同じ）。
    const sentence = target['例文'].split(target['語']).join(target['読み']);

    return {
        type: 'writing',
        jukugo: target,
        sentence,
        targetReading: target['読み'],
        questionText: `文中の「${target['読み']}」に当てはまる正しい漢字はどれ？`,
        choices,
        correctText
    };
}

/**
 * 筆順クイズを1問作る（漢字の1画だけを太字（強調表示）にして見せ、それが何画目かを4択で選ばせる）。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列, strokeData — data/strokeOrder.jsonの内容（漢字ID→{strokes,medians}）, progressData — 出題重み付け用
 * (3) メイン: strokeDataに実データがあり2画以上の漢字だけを対象に重み付き抽選し、ランダムに1画を選んで
 *             正解（画数の位置、1始まり）とし、他の画数の位置番号から誤答3件を作る
 * (4) アウトプット: { type:'kakusuu', kanjiRow, strokeIndex, strokeCount, questionText, choices, correctText }
 *                    or null（strokeDataが未読み込み、または出題対象の漢字が無い場合）
 */
export function buildKakusuuQuiz(kanjiList, strokeData, progressData) {
    if (!strokeData) return null;
    const eligible = kanjiList.filter(k => (strokeData[k['ID']]?.strokes?.length ?? 0) >= 2);
    if (eligible.length === 0) return null;

    const [target] = weightedSample(eligible, progressData, 1);
    if (!target) return null;

    const strokeCount = strokeData[target['ID']].strokes.length;
    const strokeIndex = Math.floor(Math.random() * strokeCount);
    const correctText = String(strokeIndex + 1);

    const distractorPool = Array.from({ length: strokeCount }, (_, i) => String(i + 1))
        .filter(n => n !== correctText);

    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    return {
        type: 'kakusuu',
        kanjiRow: target,
        strokeIndex,
        strokeCount,
        questionText: '太字の画は何画目に書きますか？',
        choices,
        correctText
    };
}

/**
 * 意味・熟語クイズを1問作る（漢字の意味、または熟語の空欄に合う漢字を4択で選ばせる）。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列, jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用
 * (3) メイン: 意味データが入っている漢字だけを対象に、「意味を当てる」「熟語の空欄に合う漢字を当てる」の
 *             いずれかをランダムに選んで出題する。熟語の空欄補充は、使用漢字IDのうちkanjiListに含まれる
 *             ものの中から1字をランダムに選んで空欄にする
 * (4) アウトプット: { type:'meaning', kanjiRow, questionText, choices, correctText }
 *               or { type:'jukugo', jukugo, kanjiRow, questionText, choices, correctText }
 *               or null（意味データが無い場合）
 */
export function buildMeaningQuiz(kanjiList, jukugoList, progressData) {
    const eligible = kanjiList.filter(k => k['意味']);
    if (eligible.length < 4) return null;

    const kanjiById = new Map(kanjiList.map(k => [k['ID'], k]));
    const jukugoEligible = jukugoList.filter(j =>
        [...(j['語'] || '')].length === (j['使用漢字ID'] || []).length &&
        (j['使用漢字ID'] || []).some(id => kanjiById.has(id))
    );
    const useJukugo = jukugoEligible.length >= 4 && Math.random() < 0.5;

    if (useJukugo) {
        const [jukugo] = weightedSample(jukugoEligible, progressData, 1);
        if (!jukugo) return null;

        const chars = [...jukugo['語']];
        const blankCandidates = jukugo['使用漢字ID']
            .map((id, index) => ({ id, index, char: chars[index], kanjiRow: kanjiById.get(id) }))
            .filter(c => c.kanjiRow);
        const chosen = pickOne(blankCandidates);
        const blankedText = chars.map((c, i) => (i === chosen.index ? '＿' : c)).join('');

        const distractorPool = eligible
            .filter(k => k['ID'] !== chosen.id)
            .map(k => k['漢字']);
        const choices = buildChoices(chosen.char, distractorPool, new Set([chosen.char]));
        if (choices.length < 2) return null;

        return {
            type: 'jukugo',
            jukugo,
            kanjiRow: chosen.kanjiRow,
            questionText: `「${blankedText}（${jukugo['読み']}）」の＿に入る漢字はどれ？`,
            choices,
            correctText: chosen.char
        };
    }

    const [target] = weightedSample(eligible, progressData, 1);
    if (!target) return null;

    const distractorPool = eligible
        .filter(k => k['ID'] !== target['ID'])
        .map(k => k['意味']);
    const choices = buildChoices(target['意味'], distractorPool, new Set([target['意味']]));
    if (choices.length < 2) return null;

    return {
        type: 'meaning',
        kanjiRow: target,
        questionText: `「${target['漢字']}」の意味はどれ？`,
        choices,
        correctText: target['意味']
    };
}

/**
 * フラッシュカード用のカード束を作る（苦手・未学習な漢字を優先しつつシャッフル）。
 *
 * (2) インプット: kanjiList, progressData, count
 * (3) メイン: 重み付き抽選でcount件を選ぶ
 * (4) アウトプット: 漢字行の配列
 */
export function buildFlashcardDeck(kanjiList, progressData, count) {
    return weightedSample(kanjiList, progressData, Math.min(count, kanjiList.length));
}

/**
 * クイズの選択肢が正解かどうかを判定する。
 *
 * (2) インプット: quiz, chosenText
 * (3) メイン: quiz.correctTextとの一致判定
 * (4) アウトプット: 真偽値
 */
export function checkAnswer(quiz, chosenText) {
    return chosenText === quiz.correctText;
}
