// (1) インポート — progress.js（出題重み付けのため）、devReview.js（KYU_ORDER、級の上下比較のため）
import { weightedSample } from './progress.js';
import { KYU_ORDER } from './devReview.js';

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
 * 読みクイズを1問作る（例文を見せて、対象語の読みを4択で選ばせる）。
 *
 * 母集団は2種類を混ぜる：
 *   ①単漢字プール — kanjiMaster.jsonの`読み例`（対象級の漢字自身が持つ、その字だけの読み例文。現状10級・9級に投入済み）
 *   ②熟語プール — jukugoList（複数の漢字にまたがる語の例文）
 * ①のデータがある級では、②を「使用漢字が全て対象級以下（下位級を含む）」に絞り込む
 * （対象級ちょうどの漢字1字だけを含み、もう一方が上位級という熟語を除外する。CLAUDE.md 2章参照。
 * 実際の漢検10級・9級の「漢字の読み」は熟語まるごとではなく単漢字の読みを問う出題が中心なため。
 * 「対象級以下」であって「対象級ちょうど」ではない点に注意：例えば9級の漢字1字と10級の漢字1字で
 * できた熟語は、9級の生徒が習っている範囲内なので正当に出題してよい（最下位の10級では両者が
 * 一致するため区別が表面化しなかったが、9級以降を正しく扱うには`allKanjiList`で全字の級を
 * 引けるようにし、KYU_ORDERでのインデックス比較が必須）。単漢字プールが無い級では従来どおり
 * 「使用漢字を1つでも含む」熟語プールのみを使う）。
 *
 * 4択ではなく、ユーザーがひらがなキーボードで読みを直接入力して回答する形式（2026-09-02変更、
 * 実際の漢検も記述式のため。選択肢を用意する必要が無くなったぶん、母集団は1件あれば出題できる）。
 *
 * (2) インプット: kanjiList — 出題範囲（対象級ちょうど）の漢字配列, jukugoList — 出題範囲の熟語配列,
 *                 progressData — 出題重み付け用, allKanjiList — 級を問わない全漢字配列（熟語の使用漢字が
 *                 対象級以下かどうかを判定するため、kanjiListだけでは他級の漢字の級が引けない）
 * (3) メイン: 上記2種のプールを合わせて重み付き抽選する
 *             （進捗は単漢字エントリなら漢字自身のID、熟語エントリなら熟語自身のIDに紐付ける）
 * (4) アウトプット: { type:'reading', poolType:'kanji'|'jukugo', kanjiRow?, jukugo?, sentence, targetWord,
 *                     questionText, correctText } or null（出題対象の例文が無い場合）
 */
export function buildReadingQuiz(kanjiList, jukugoList, progressData, allKanjiList) {
    const scopedIds = new Set(kanjiList.map(k => k['ID']));

    const kanjiPool = [];
    kanjiList.forEach(k => {
        (k['読み例'] || []).forEach(ex => {
            if (ex['確認状態'] === '却下') return;
            kanjiPool.push({ ID: k['ID'], poolType: 'kanji', kanjiRow: k, word: ex['語'], reading: ex['読み'], sentence: ex['例文'] });
        });
    });
    const hasKanjiPool = kanjiPool.length > 0;

    const currentKyuIndex = KYU_ORDER.indexOf(kanjiList[0]?.['級']);
    const kyuIndexById = new Map((allKanjiList || kanjiList).map(k => [k['ID'], KYU_ORDER.indexOf(k['級'])]));

    const jukugoEntries = jukugoList.filter(j => {
        if (!j['例文']) return false;
        const usedIds = j['使用漢字ID'] || [];
        if (!usedIds.some(id => scopedIds.has(id))) return false;
        if (hasKanjiPool) {
            const allWithinOrBelow = usedIds.every(id => {
                const idx = kyuIndexById.get(id);
                return idx !== undefined && idx <= currentKyuIndex;
            });
            if (!allWithinOrBelow) return false;
        }
        return true;
    });
    const jukugoPool = jukugoEntries.map(j => ({ ID: j['ID'], poolType: 'jukugo', jukugo: j }));

    const pool = [...kanjiPool, ...jukugoPool];
    if (pool.length < 1) return null;

    const [target] = weightedSample(pool, progressData, 1);
    if (!target) return null;

    if (target.poolType === 'kanji') {
        return {
            type: 'reading',
            poolType: 'kanji',
            kanjiRow: target.kanjiRow,
            sentence: target.sentence,
            targetWord: target.word,
            questionText: `文中の「${target.word}」の読みをひらがなで入力してね。`,
            correctText: target.reading
        };
    }

    const jukugo = target.jukugo;
    return {
        type: 'reading',
        poolType: 'jukugo',
        jukugo,
        sentence: jukugo['例文'],
        targetWord: jukugo['語'],
        questionText: `文中の「${jukugo['語']}」の読みをひらがなで入力してね。`,
        correctText: jukugo['読み']
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
 * 三字熟語・四字熟語・故事諺クイズを1問作る（漢検の実際の出題形式＝「例文中のカタカナ部分を漢字に直す」
 * に合わせ、書取クイズと同じ考え方で例文中の対象語を読みに置き換えて見せ、正しい表記を4択で選ばせる）。
 * 7級・6級は三字熟語、5級以降は四字熟語、準1級・1級は故事・諺が公式の出題範囲
 * （KYU_GENRE_MAPの'sanjiJukugo'/'yonjiJukugo'/'kojiKotowaza'）なので、js/app.js側が
 * 対象級のジャンルに応じて`jukugoType`（'三字熟語'|'四字熟語'|'故事・諺'）を渡し分けて同じ画面・関数を使い回す。
 * 故事・諺は他の2つと`語`の意味付けが異なる（`語`＝諺・成語全体ではなく、その中の空欄部分の部分文字列。
 * `例文`＝諺・成語の全文がそのまま該当する）が、「`語`は`例文`の部分文字列」という前提は共通のため、
 * 出題ロジック自体に変更は不要（01_技術調査/故事諺データ調査.md 6章参照）。
 *
 * (2) インプット: jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用,
 *                  jukugoType — '三字熟語'・'四字熟語'・'故事・諺'のいずれか（jukugo.jsonの`種別`と一致させる）
 * (3) メイン: `種別`がjukugoTypeと一致し例文を持つ熟語だけを対象に重み付き抽選し、誤答は
 *             同じ種別の他の熟語の漢字表記から作る（三字熟語同士・四字熟語同士・故事諺同士でしか紛れさせない）
 * (4) アウトプット: { type:'jukugoType', jukugoType, jukugo, sentence, questionText, choices, correctText }
 *                    or null（対象種別・例文を持つ熟語が範囲内に無い場合）
 */
export function buildJukugoTypeQuiz(jukugoList, progressData, jukugoType) {
    const entries = jukugoList.filter(j => j['種別'] === jukugoType && j['例文']);
    if (entries.length < 4) return null;

    const [target] = weightedSample(entries, progressData, 1);
    if (!target) return null;

    const correctText = target['語'];
    // 故事・諺は`語`（空欄部分）の文字数が1〜4字以上とバラつく（他の三字熟語・四字熟語は種別自体が
    // 文字数を固定しているため元々この問題が無かった）。文字数が違う選択肢が混ざると、読まずに文字数
    // だけで正解が分かってしまうため、故事・諺に限り同じ文字数の熟語だけを誤答候補にする。
    const lengthMatchedPool = jukugoType === '故事・諺'
        ? entries.filter(e => [...e['語']].length === [...correctText].length)
        : entries;
    const distractorPool = lengthMatchedPool.filter(e => e['語'] !== correctText).map(e => e['語']);
    const choices = buildChoices(correctText, distractorPool, new Set([correctText]));
    if (choices.length < 2) return null;

    const sentence = target['例文'].split(target['語']).join(target['読み']);

    // 故事・諺は`語`が諺・成語全体ではなく空欄部分の断片（例：「塞翁」）なので、「正しい故事・諺はどれ？」
    // という問いは意味が通らない。書取クイズと同じ「正しい漢字はどれ？」という問い方にする。
    const questionText = jukugoType === '故事・諺'
        ? `文中の「${target['読み']}」に当てはまる正しい漢字はどれ？`
        : `文中の「${target['読み']}」に当てはまる正しい${jukugoType}はどれ？`;

    return {
        type: 'jukugoType',
        jukugoType,
        jukugo: target,
        sentence,
        targetReading: target['読み'],
        questionText,
        choices,
        correctText
    };
}

// 漢検「熟語の構成」の5分類。問題ごとにシャッフルせず、選択肢は常にこの順（ア→オ）で提示する
// （漢検対策サイト・教材が共通してこの並びで凡例表を出す慣習に合わせた。quiz.js冒頭のimport無し純粋関数群と同じ層）。
const KOUSEI_CHOICES = [
    { key: 'ア', label: 'ア　同じような意味の字を重ねたもの（例：岩石）' },
    { key: 'イ', label: 'イ　反対または対応の意味を表す字を重ねたもの（例：高低）' },
    { key: 'ウ', label: 'ウ　上の字が下の字を修飾しているもの（例：洋画）' },
    { key: 'エ', label: 'エ　下の字が上の字の目的語・補語になっているもの（例：着席）' },
    { key: 'オ', label: 'オ　上の字が下の字の意味を打ち消しているもの（例：非常）' }
];

/**
 * 熟語の構成クイズを1問作る（二字熟語を1つ見せ、漢検公式の5分類ア〜オのどれに当てはまるかを選ばせる）。
 *
 * (2) インプット: jukugoList — 出題範囲の熟語配列, progressData — 出題重み付け用
 * (3) メイン: 種別が二字熟語かつ`構成`が設定済みの熟語（データ投入プロジェクトで確信度「低」も含め
 *             全件に付与済み）を対象に重み付き抽選する。選択肢は常に固定のア〜オ5つ
 *             （実際の漢検対策教材が凡例表を毎回同じ並びで示す慣習に合わせ、シャッフルしない）
 * (4) アウトプット: { type:'jukugoKousei', jukugo, questionText, choices, correctText }
 *                    or null（この級には`構成`済みの二字熟語が無い場合）
 */
export function buildJukugoKouseiQuiz(jukugoList, progressData) {
    const entries = jukugoList.filter(j => j['種別'] === '二字熟語' && j['構成']);
    if (entries.length === 0) return null;

    const [target] = weightedSample(entries, progressData, 1);
    if (!target) return null;

    const correctChoice = KOUSEI_CHOICES.find(c => c.key === target['構成']);
    if (!correctChoice) return null;

    return {
        type: 'jukugoKousei',
        jukugo: target,
        questionText: `「${target['語']}（${target['読み']}）」の熟語の構成として正しいものはどれ？`,
        choices: KOUSEI_CHOICES.map(c => c.label),
        correctText: correctChoice.label
    };
}

/**
 * 誤字訂正クイズを1問作る（漢検の実際の出題形式＝「文中の誤って使われている同じ読みの漢字を正しい漢字に
 * 直す」に合わせ、二字熟語の一方の文字を同じ読みの別の漢字に差し替えた文を見せ、正しい漢字を4択で選ばせる）。
 * 差し替え候補（`誤字候補_*`）はkanjiMaster.jsonの音読みと部品構成データ（IDS）から事前に機械生成済み
 * （01_技術調査/誤字訂正データ調査.md参照。`構成`/`構成_確信度`等と同じフラットなフィールド構成）。
 * 誤答は、正解と同じ読みを持つ範囲内の他の漢字と、生成時に選定した`誤字候補_文字`自身
 * （文中に実際に表示されている字）を組み合わせて作る。
 *
 * (2) インプット: kanjiList — 出題範囲の漢字配列（誤答候補の抽出元）, jukugoList — 出題範囲の熟語配列,
 *                  progressData — 出題重み付け用
 * (3) メイン: `誤字候補_文字`と`例文`を持ち、対象級の漢字を使用漢字IDに1つでも含む熟語を重み付き抽選し、
 *             例文中の対象語を「誤字を埋め込んだ語」に置き換えたうえで、正しい漢字を答えさせる
 * (4) アウトプット: { type:'gojiTeisei', jukugo, sentence, wrongWord, questionText, choices, correctText }
 *                    or null（出題対象の熟語が範囲内に無い場合）
 */
export function buildGojiTeiseiQuiz(kanjiList, jukugoList, progressData) {
    const scopedIds = new Set(kanjiList.map(k => k['ID']));
    const entries = jukugoList.filter(j =>
        j['誤字候補_文字'] && j['例文'] && (j['使用漢字ID'] || []).some(id => scopedIds.has(id))
    );
    if (entries.length === 0) return null;

    const [target] = weightedSample(entries, progressData, 1);
    if (!target) return null;

    const position = target['誤字候補_位置'];
    const chars = [...target['語']];
    const correctChar = chars[position];
    chars[position] = target['誤字候補_文字'];
    const wrongWord = chars.join('');

    const sentence = target['例文'].split(target['語']).join(wrongWord);

    const distractorPool = kanjiList
        .filter(k => k['漢字'] !== correctChar && (k['音読み'] || []).includes(target['誤字候補_読み']))
        .map(k => k['漢字']);
    const choices = buildChoices(correctChar, [target['誤字候補_文字'], ...distractorPool], new Set([correctChar]));
    if (choices.length < 2) return null;

    return {
        type: 'gojiTeisei',
        jukugo: target,
        sentence,
        wrongWord,
        questionText: `下線部の「${wrongWord}」には誤って使われている漢字が1字あります。正しい漢字はどれ？`,
        choices,
        correctText: correctChar
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
