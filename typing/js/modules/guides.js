// (1) インポート — なし
// 解説ページの定義。新しい文字や操作が出てくるレベルの前に、1ページずつ追加する。
//
//  id          : 既読管理に使う識別子（公開後は変えないこと）
//  title       : 一覧・ページの見出し
//  forLevels   : どのレベル向けの解説か（一覧に出す文字）
//  openAtLevel : このレベルが開いたら解説も開く（1＝最初から読める）
//  body        : ページの中身（HTML）。キーボードの図は kb() で作る
//
// 解説は読まなくてもプレイには影響しない。開いたときは結果画面でお知らせし、一覧に「NEW」を付ける。

// iPhoneのかなキーボード（フリック）の、文字キー1つ分の並び：[タップ, 左, 上, 右, 下]（空文字＝この解説では使わない）
export const FLICK = {
    'あ': ['あ', 'い', 'う', 'え', 'お'],
    'か': ['か', 'き', 'く', 'け', 'こ'],
    'さ': ['さ', 'し', 'す', 'せ', 'そ'],
    'た': ['た', 'ち', 'つ', 'て', 'と'],
    'な': ['な', 'に', 'ぬ', 'ね', 'の'],
    'は': ['は', 'ひ', 'ふ', 'へ', 'ほ'],
    'ま': ['ま', 'み', 'む', 'め', 'も'],
    'や': ['や', '', 'ゆ', '', 'よ'],
    'ら': ['ら', 'り', 'る', 'れ', 'ろ'],
    'わ': ['わ', 'を', 'ん', '', ''],
    '、。?!': ['、', '。', '？', '！', ''],
};

const KANA_ROWS = [['あ', 'か', 'さ'], ['た', 'な', 'は'], ['ま', 'や', 'ら'], ['^_^', 'わ', '、。?!']];
const SIDE_LEFT = ['→', '↺', 'ABC', '😀'];  // 実機（iPhone、img/kb_kana.jpg）の左端の列

/**
 * キーボードの図（iPhoneのかな入力を模したもの）。
 * (2) インプット: highlight（目立たせる文字キーの配列）  (4) アウトプット: HTML文字列
 * 文字キーは押すと、すべらせた先の文字が図の下に出る（app.js 側で動きを付ける）。
 */
export function kb(highlight = []) {
    const rows = KANA_ROWS.map((row, r) => {
        const keys = row.map(k => {
            const isKana = !!FLICK[k];
            const cls = 'kb-key' + (isKana ? ' kana' : ' fn') + (k.length > 1 ? ' small' : '') + (highlight.includes(k) ? ' hi' : '');
            return isKana
                ? `<button type="button" class="${cls}" data-flick="${k}">${k}</button>`
                : `<span class="${cls}">${k}</span>`;
        }).join('');
        const right = r === 0 ? '<span class="kb-key fn">⌫</span>' : r === 1 ? '<span class="kb-key fn">空白</span>' : r === 2 ? '<span class="kb-key fn enter">↵</span>' : '';
        return `<span class="kb-key fn side">${SIDE_LEFT[r]}</span>${keys}${right}`;
    }).join('');
    return `<div class="kb-wrap"><div class="kb">${rows}</div>` +
        '<div class="flick-demo" aria-live="polite"><p class="flick-hint">上の図の文字キーを押すと、指をすべらせた先の文字がここに出ます</p></div></div>';
}

/** 1つのキーの「十字」の図（まん中＝タップ、左・上・右・下＝すべらせた先）。 */
export function cross(key) {
    const [c, l, u, r, d] = FLICK[key];
    const cell = (ch, pos) => `<span class="cr ${pos}${ch ? '' : ' none'}">${ch || ''}</span>`;
    return `<div class="cross">${cell('', 'blank')}${cell(u, 'up')}${cell('', 'blank')}` +
        `${cell(l, 'left')}${cell(c, 'center')}${cell(r, 'right')}` +
        `${cell('', 'blank')}${cell(d, 'down')}${cell('', 'blank')}</div>`;
}

const DAKUTEN = String.fromCharCode(0x3099);    // 「゛」（文字を分解したときの濁点）
const HANDAKUTEN = String.fromCharCode(0x309A); // 「゜」
const SMALL = 'っゃゅょ';  // 小さい文字と、もとの文字（同じ順）
const LARGE = 'つやゆよ';

// 1文字の打ち方（例：「す」＝「さ」を上へ、「ご」＝「か」を押して下へ →「^_^」を1回、「っ」＝「た」を押して上へ →「^_^」を1回）
function how(ch) {
    const dirs = ['押すだけ', '左へ', '上へ', '右へ', '下へ'];
    const smallIdx = SMALL.indexOf(ch);
    const [plain, mark] = smallIdx >= 0 ? [LARGE[smallIdx], ''] : [...ch.normalize('NFD')];
    const extra = mark === DAKUTEN || smallIdx >= 0 ? ' →「^_^」を1回' : mark === HANDAKUTEN ? ' →「^_^」を2回' : '';
    for (const [key, list] of Object.entries(FLICK)) {
        const i = list.indexOf(plain);
        if (i >= 0) return `<span class="how"><b>${ch}</b>＝「${key}」${i === 0 ? (extra ? 'を押す' : 'を押すだけ') : 'を押して' + dirs[i]}${extra}</span>`;
    }
    return `<span class="how"><b>${ch}</b></span>`;
}

function example(word) {
    return `<div class="example"><div class="example-word">${word}</div>${[...word].map(how).join('')}</div>`;
}

export const GUIDES = [
    {
        id: 'basic',
        title: 'フリック入力のきほん',
        forLevels: 'Lv1〜3',
        openAtLevel: 1,
        body: `
<p class="lead">スマホで文字を打つときは「フリック入力」という打ち方を使います。<br>
キーを押して、そのまま指を少しすべらせるだけで、いろいろな文字が打てます。<br>
ゆっくりで大丈夫です。順番に見ていきましょう。</p>

<h3>1. キーのならび</h3>
<p>文字を打つときに出てくるキーボードです（iPhoneの画面）。</p>
<figure class="kb-photo"><img src="img/kb_kana.jpg" alt="iPhoneのかな入力のキーボード" loading="lazy"><figcaption>実際の画面</figcaption></figure>
<p>まん中の12個のキーに、「あ・か・さ・た・な…」が<b>左上から右へ、50音の順</b>にならんでいます（下の図の黄色のキー）。</p>
${kb(['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'])}
<ul class="rows">
  <li><b>いちばん上の段</b>：あ・か・さ</li>
  <li><b>2段目</b>：た・な・は</li>
  <li><b>3段目</b>：ま・や・ら</li>
  <li><b>いちばん下のまん中</b>：わ</li>
</ul>

<h3>2. 指のすべらせかた</h3>
<p>たとえば「あ」のキーです。</p>
${cross('あ')}
<ul class="rows">
  <li>押して、そのままはなす → <b>あ</b></li>
  <li>押したまま <b>左</b>へすべらせる → <b>い</b></li>
  <li>押したまま <b>上</b>へすべらせる → <b>う</b></li>
  <li>押したまま <b>右</b>へすべらせる → <b>え</b></li>
  <li>押したまま <b>下</b>へすべらせる → <b>お</b></li>
</ul>
<p class="tip">「<b>左から時計まわりに い・う・え・お</b>」とおぼえると便利です。<br>
「か」のキーなら か・き・く・け・こ、「さ」のキーなら さ・し・す・せ・そ。どのキーも同じ向きです。</p>
<p class="tip">すべらせるのは、ほんの少し（指1本分くらい）で大丈夫です。</p>

<h3>3. ためしてみましょう</h3>
<p>下の図のキーを押すと、そのキーで打てる文字が十字の形で出ます。</p>
${kb()}

<h3>4. レベル1：あ・か・さ行</h3>
<p>いちばん上の段の3つのキーだけを使います。</p>
${example('すし')}
${example('かお')}

<h3>5. レベル2：た・な・は行</h3>
<p>2段目の3つのキーを使います。</p>
${example('ひと')}
${example('ふね')}

<h3>6. レベル3：ま・や・ら・わ行</h3>
<p>3段目のキーと、いちばん下のまん中の「わ」のキーを使います。</p>
<p>「や」のキーは、<b>や・ゆ・よ</b>の3つだけです（上へ＝ゆ、下へ＝よ）。</p>
${cross('や')}
<p>「わ」のキーは、<b>左へ＝を</b>、<b>上へ＝ん</b>です。</p>
${cross('わ')}
${example('れもん')}
<p class="tip">「もも」のように同じ文字が続くときも、2回すべらせるだけで打てます。</p>

<h3>7. 打ち終わったら「確定」</h3>
<p>打った文字の下に線が出ている間は、まだ「入力中」です。<br>
右下の<b>大きなキー（↵）</b>を押すと、文字が決まります（これを「確定」といいます）。このアプリは、確定したときに答え合わせをします。</p>

<h3>8. まちがえたとき</h3>
<p>右上の<b>「⌫」</b>のキーで、1文字ずつ消せます。消してから打ち直しましょう。</p>
<p class="tip">キーを何回か続けて押して「あ→い→う」と変える打ち方もありますが、このアプリでは、すべらせる打ち方がおすすめです。</p>
`,
    },
    {
        id: 'dakuon',
        title: '「゛」のつく文字（濁音）',
        forLevels: 'Lv11〜13',
        openAtLevel: 11,
        body: `
<p class="lead">「が・ざ・だ・ば」のように、右上に「゛」（てんてん）がつく文字の打ち方です。<br>
先に「゛」のない文字を打ってから、てんてんを付けます。</p>

<h3>1. てんてんを付けるキー</h3>
<p>左下の<b>「^_^」</b>のキーを使います（下の図の黄色のキー）。<br>
文字を打った直後は、このキーが<b>「゛゜小」</b>という表示に変わり、てんてんを付けるキーになります。</p>
${kb(['^_^'])}

<h3>2. 打ち方</h3>
<p>たとえば「が」を打つときは、</p>
<ul class="rows">
  <li>① 「か」のキーを押して、<b>か</b>を打つ</li>
  <li>② すぐに左下の<b>「^_^」</b>のキーを1回押す → <b>が</b>に変わる</li>
</ul>
<p class="tip">「ご」なら「か」を下へすべらせて<b>こ</b>を打ち、「^_^」を1回。どの文字も同じです。</p>

<h3>3. てんてんがつく行</h3>
<ul class="rows">
  <li><b>か行</b> → が・ぎ・ぐ・げ・ご</li>
  <li><b>さ行</b> → ざ・じ・ず・ぜ・ぞ</li>
  <li><b>た行</b> → だ・ぢ・づ・で・ど</li>
  <li><b>は行</b> → ば・び・ぶ・べ・ぼ</li>
</ul>

<h3>4. 例</h3>
${example('かぎ')}
${example('ぶどう')}
${example('だいこん')}

<h3>5. まちがえたとき</h3>
<p>「^_^」のキーは、押すたびに形が変わります。押しすぎて別の形になったら、<b>もう何回か押すと元にもどります</b>。</p>
<p class="tip">「は行」は、押すたびに は → ば → ぱ → は と変わります。「ぱ」（まる）は、レベル14から出てきます。</p>
`,
    },
    {
        id: 'handakuon',
        title: '「゜」のつく文字（半濁音）',
        forLevels: 'Lv14〜16',
        openAtLevel: 14,
        body: `
<p class="lead">「ぱ・ぴ・ぷ・ぺ・ぽ」のように、右上に「゜」（まる）がつく文字の打ち方です。<br>
まるがつくのは<b>「は行」だけ</b>です。</p>

<h3>1. 打ち方</h3>
<p>てんてん（゛）と同じ、左下の<b>「^_^」</b>のキーを使います。押す回数がちがいます。</p>
${kb(['は', '^_^'])}
<ul class="rows">
  <li>① 「は」のキーを押して、<b>は</b>を打つ</li>
  <li>② 「^_^」を1回押す → <b>ば</b></li>
  <li>③ もう1回押す → <b>ぱ</b></li>
</ul>
<p class="tip">「は → ば → ぱ」の順に変わります。<b>まるは2回</b>とおぼえましょう。<br>
押しすぎて「は」にもどったら、もう一度押せば「ば」「ぱ」と進みます。</p>

<h3>2. まるがつく文字</h3>
<ul class="rows">
  <li><b>は行</b> → ぱ・ぴ・ぷ・ぺ・ぽ</li>
</ul>

<h3>3. 例</h3>
${example('さんぽ')}
${example('えんぴつ')}
${example('てんぷら')}
`,
    },
    {
        id: 'sokuon',
        title: '小さい「っ」',
        forLevels: 'Lv17〜19',
        openAtLevel: 17,
        body: `
<p class="lead">「きって」「がっこう」の、小さい「っ」の打ち方です。<br>
先にふつうの大きさの「つ」を打ってから、小さくします。</p>

<h3>1. 打ち方</h3>
<p>てんてんと同じ、左下の<b>「^_^」</b>のキーを使います。</p>
${kb(['た', '^_^'])}
<ul class="rows">
  <li>① 「た」のキーを上へすべらせて、<b>つ</b>を打つ</li>
  <li>② すぐに「^_^」を1回押す → 小さい<b>っ</b>に変わる</li>
</ul>
<p class="tip">もう1回押すと「づ」に変わります。押しすぎたときは、何回か押すと「つ」にもどります。</p>

<h3>2. 例</h3>
${example('きって')}
${example('しっぽ')}
${example('みっつ')}
<p class="tip">「みっつ」は、小さい「っ」のあとに大きい「つ」が続きます。2つ目の「つ」は小さくしません。</p>
`,
    },
    {
        id: 'youon',
        title: '小さい「ゃ・ゅ・ょ」',
        forLevels: 'Lv20〜22',
        openAtLevel: 20,
        body: `
<p class="lead">「でんしゃ」「きゅうり」「きょう」の、小さい「ゃ・ゅ・ょ」の打ち方です。<br>
小さい「っ」と同じく、先に大きい字を打ってから小さくします。</p>

<h3>1. 打ち方</h3>
${kb(['や', '^_^'])}
<ul class="rows">
  <li>① 「や」のキーで <b>や・ゆ・よ</b> のどれかを打つ（ゆ＝上へ、よ＝下へ）</li>
  <li>② すぐに「^_^」を1回押す → 小さい<b>ゃ・ゅ・ょ</b>に変わる</li>
</ul>
${cross('や')}

<h3>2. 例</h3>
<p>「しゃ」なら、<b>し</b>を打って、<b>や</b>を打って、小さくします。</p>
${example('おちゃ')}
${example('きゅうり')}
${example('じしょ')}
`,
    },
    {
        id: 'kutouten',
        title: '「、」と「。」（句読点）',
        forLevels: 'Lv29〜31',
        openAtLevel: 29,
        body: `
<p class="lead">文の区切りの「、」と、文の終わりの「。」の打ち方です。<br>
「わ」の右どなりの<b>「、。?!」</b>のキーを使います。</p>

<h3>1. 打ち方</h3>
${kb(['、。?!'])}
<ul class="rows">
  <li>「、」＝「、。?!」のキーを<b>押すだけ</b></li>
  <li>「。」＝「、。?!」のキーを押して<b>左へ</b>すべらせる</li>
</ul>
${cross('、。?!')}
<p class="tip">上へすべらせると「？」、右へすべらせると「！」になります（この先のレベルで使います）。</p>

<h3>2. 例</h3>
${example('はい、わかりました。')}
<p class="tip">文は最後の「。」まで打ってから、確定（↵）を押します。</p>
`,
    },
];
