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

// 漢検の送り仮名問題は「赤字のカタカナを漢字一字と送りがなに直せ」という出題形式のため、
// ひらがなで持っている読みをカタカナ表示に変換する（ひらがな→カタカナはUnicode上0x60の固定オフセット）。
function toKatakana(hiragana) {
    return hiragana.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
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
 * 部首・部首名クイズを1問作る（漢検の実際の出題形式に合わせ、1字について「部首」と「部首名」を
 * それぞれ4択で選ばせる。公式サイトによれば8級〜2級が出題範囲で、6級〜3級は選択式・準2級〜2級は
 * 記述式だが、このアプリは全級で選択式に統一する。準1級・1級は公式の出題内容から外れるため対象外
 * ＝KYU_GENRE_MAPに'bushu'が含まれない）。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列, progressData — 出題重み付け用
 * (3) メイン: 部首・部首名の両方が入っている漢字だけを対象に重み付き抽選し、他の漢字の実際の
 *             部首・部首名から誤答3件ずつを作る（部首・部首名を別々に4択にすることで、公式の
 *             「両方を答えさせる」出題内容を単一漢字1問の中で再現する）
 * (4) アウトプット: { type:'bushu', kanjiRow, questionText, busyuChoices, busyuCorrect,
 *                     busyumeiChoices, busyumeiCorrect } or null（対象の漢字が無い場合）
 */
export function buildBushuQuiz(kanjiList, progressData) {
    const eligible = kanjiList.filter(k => k['部首'] && k['部首名']);
    if (eligible.length < 4) return null;

    const [target] = weightedSample(eligible, progressData, 1);
    if (!target) return null;

    const others = eligible.filter(k => k['ID'] !== target['ID']);

    const busyuCorrect = target['部首'];
    const busyuChoices = buildChoices(busyuCorrect, others.map(k => k['部首']), new Set([busyuCorrect]));
    if (busyuChoices.length < 2) return null;

    const busyumeiCorrect = target['部首名'];
    const busyumeiChoices = buildChoices(busyumeiCorrect, others.map(k => k['部首名']), new Set([busyumeiCorrect]));
    if (busyumeiChoices.length < 2) return null;

    return {
        type: 'bushu',
        kanjiRow: target,
        questionText: `「${target['漢字']}」の部首と部首名はどれ？`,
        busyuChoices,
        busyuCorrect,
        busyumeiChoices,
        busyumeiCorrect
    };
}

/**
 * 送り仮名クイズを1問作る（漢検の実際の出題形式＝「赤字のカタカナを漢字一字と送りがなに直せ」に
 * 合わせ、読みをカタカナで見せて正しい漢字＋送りがな表記を4択で選ばせる）。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列, progressData — 出題重み付け用
 * (3) メイン: kanjiListの各字が持つ`送り仮名例`（{語,読み,確認状態}の配列）を1行1例に展開し、
 *             重み付き抽選（漢字ID単位）で1件選ぶ。誤答は範囲内の他の送り仮名例の`語`から作る
 * (4) アウトプット: { type:'okurigana', kanjiRow, questionText, choices, correctText }
 *                    or null（出題対象の送り仮名例が無い場合）
 */
export function buildOkuriganaQuiz(kanjiList, progressData) {
    const entries = kanjiList.flatMap(k =>
        (k['送り仮名例'] || []).map(example => ({ kanjiRow: k, 語: example['語'], 読み: example['読み'] }))
    );
    if (entries.length < 4) return null;

    const kanjiById = new Map(kanjiList.map(k => [k['ID'], k]));
    const [targetKanji] = weightedSample(kanjiList.filter(k => (k['送り仮名例'] || []).length > 0), progressData, 1);
    if (!targetKanji) return null;
    const target = pickOne(entries.filter(e => e.kanjiRow['ID'] === targetKanji['ID']));

    const correctText = target['語'];
    const distractorPool = entries.filter(e => e['語'] !== correctText).map(e => e['語']);
    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    return {
        type: 'okurigana',
        kanjiRow: kanjiById.get(target.kanjiRow['ID']),
        questionText: `「${toKatakana(target['読み'])}」を漢字と送りがなで書くとどれ？`,
        choices,
        correctText
    };
}

/**
 * 対義語・類義語クイズを1問作る（漢検の実際の出題形式＝「ひらがなの語群から対義語・類義語を選び
 * 漢字に直せ」に合わせ、熟語を見せてその対義語または類義語を4択で選ばせる）。
 * 8級〜7級は対義語のみが出題範囲（`includeSynonym=false`で呼ぶ）、6級以降は対義語・類義語の
 * 両方が範囲になる（`includeSynonym=true`）ため、呼び出し側（js/app.js）が対象級のジャンル
 * （'taigigo'か'taigigoRuigigo'か）に応じてこのフラグを渡し分ける。
 *
 * (2) インプット: jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用,
 *                  includeSynonym — 類義語も出題対象に含めるか
 * (3) メイン: `対義語`（常に）・`類義語`（includeSynonym時のみ）が入っている熟語を1件ずつの
 *             候補にして重み付き抽選し、他候補の対義語・類義語から誤答3件を作る
 * (4) アウトプット: { type:'taigigo', jukugo, kind:'taigi'|'ruigi', questionText, choices, correctText }
 *                    or null（出題対象の熟語が無い場合）
 */
export function buildTaigigoRuigigoQuiz(jukugoList, progressData, includeSynonym) {
    const taigiEntries = jukugoList
        .filter(j => j['対義語'] && j['対義語'].length)
        .map(j => ({ ID: j['ID'], jukugo: j, kind: 'taigi', label: '対義語', target: pickOne(j['対義語']) }));
    const ruigiEntries = includeSynonym
        ? jukugoList
            .filter(j => j['類義語'] && j['類義語'].length)
            .map(j => ({ ID: j['ID'], jukugo: j, kind: 'ruigi', label: '類義語', target: pickOne(j['類義語']) }))
        : [];
    const pool = [...taigiEntries, ...ruigiEntries];
    if (pool.length < 4) return null;

    const [target] = weightedSample(pool, progressData, 1);
    if (!target) return null;

    const correctText = target.target;
    const distractorPool = pool.filter(p => p.target !== correctText).map(p => p.target);
    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    return {
        type: 'taigigo',
        jukugo: target.jukugo,
        kind: target.kind,
        questionText: `「${target.jukugo['語']}」の${target.label}はどれ？`,
        choices,
        correctText
    };
}

/**
 * 同音（同訓）異字クイズを1問作る（漢検の実際の出題形式＝「文中のカタカナ部分に当てはまる、
 * 同じ読みだが異なる漢字を文脈から選ばせる」に合わせる。8級「同じ漢字の読み」・7級「同音異字」・
 * 6級以降「同音・同訓異字」はいずれもこの同じ仕組みの出題内容で、区別は対象漢字の範囲が
 * 広がるだけ（対義語・類義語と同じ考え方）なので、js/app.js側で同じ画面・同じこの関数を使い回す。
 *
 * (2) インプット: jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用
 * (3) メイン: 例文を持つ熟語を「読み」でグループ化し、同じ読みで異なる`語`（漢字表記）が
 *             2件以上あるグループの熟語だけを対象に重み付き抽選する。誤答は同じ読みグループ内の
 *             他の漢字表記（真の同音・同訓異字）を優先し、それだけでは3件に満たない場合のみ
 *             範囲内の他の熟語の漢字表記で埋める
 * (4) アウトプット: { type:'homophone', jukugo, sentence, targetReading, questionText, choices, correctText }
 *                    or null（同じ読みで漢字表記が割れる熟語が対象範囲に無い場合）
 */
export function buildHomophoneQuiz(jukugoList, progressData) {
    const entries = jukugoList.filter(j => j['例文']);
    if (entries.length < 2) return null;

    const byReading = new Map();
    entries.forEach(j => {
        const list = byReading.get(j['読み']) || [];
        list.push(j);
        byReading.set(j['読み'], list);
    });

    const eligible = entries.filter(j => new Set(byReading.get(j['読み']).map(g => g['語'])).size >= 2);
    if (eligible.length === 0) return null;

    const [target] = weightedSample(eligible, progressData, 1);
    if (!target) return null;

    const correctText = target['語'];
    const homophones = shuffle([...new Set(byReading.get(target['読み']).map(g => g['語']))]
        .filter(w => w !== correctText)).slice(0, 3);

    const distractors = homophones.slice();
    if (distractors.length < 3) {
        const usedSet = new Set([correctText, ...distractors]);
        const fallbackPool = [...new Set(entries.map(j => j['語']))].filter(w => !usedSet.has(w));
        distractors.push(...shuffle(fallbackPool).slice(0, 3 - distractors.length));
    }
    if (distractors.length === 0) return null;

    const choices = shuffle([correctText, ...distractors]);
    const sentence = target['例文'].split(target['語']).join(target['読み']);

    return {
        type: 'homophone',
        jukugo: target,
        sentence,
        targetReading: target['読み'],
        questionText: `文中の「${target['読み']}」に当てはまる正しい漢字はどれ？`,
        choices,
        correctText
    };
}

/**
 * 三字熟語・四字熟語クイズを1問作る（漢検の実際の出題形式＝「例文中のカタカナ部分を漢字に直して
 * 三字熟語・四字熟語を完成させる」に合わせ、書取クイズと同じ考え方で例文中の対象語を読みに
 * 置き換えて見せ、正しい表記を4択で選ばせる）。7級・6級は三字熟語、5級以降は四字熟語が公式の
 * 出題範囲（KYU_GENRE_MAPの'sanjiJukugo'/'yonjiJukugo'）なので、js/app.js側が対象級の
 * ジャンルに応じて`jukugoType`（'三字熟語'|'四字熟語'）を渡し分けて同じ画面・関数を使い回す。
 *
 * (2) インプット: jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用,
 *                  jukugoType — '三字熟語' または '四字熟語'（jukugo.jsonの`種別`と一致させる）
 * (3) メイン: `種別`がjukugoTypeと一致し例文を持つ熟語だけを対象に重み付き抽選し、誤答は
 *             同じ種別の他の熟語の漢字表記から作る（三字熟語同士・四字熟語同士でしか紛れさせない）
 * (4) アウトプット: { type:'jukugoType', jukugoType, jukugo, sentence, questionText, choices, correctText }
 *                    or null（対象種別・例文を持つ熟語が範囲内に無い場合）
 */
export function buildJukugoTypeQuiz(jukugoList, progressData, jukugoType) {
    const entries = jukugoList.filter(j => j['種別'] === jukugoType && j['例文']);
    if (entries.length < 4) return null;

    const [target] = weightedSample(entries, progressData, 1);
    if (!target) return null;

    const correctText = target['語'];
    const distractorPool = entries.filter(e => e['語'] !== correctText).map(e => e['語']);
    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    const sentence = target['例文'].split(target['語']).join(target['読み']);

    return {
        type: 'jukugoType',
        jukugoType,
        jukugo: target,
        sentence,
        targetReading: target['読み'],
        questionText: `文中の「${target['読み']}」に当てはまる正しい${jukugoType}はどれ？`,
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
