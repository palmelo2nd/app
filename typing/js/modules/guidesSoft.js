// (1) インポート — 専用キーボードの配列（kbCore.js）
import { LAYOUTS, MODE_LABEL } from './kbCore.js?v=58';

// ストア版（専用キーボード）の解説ページ（2026-11-14）。
// Web版の解説（guides.js）はiPhoneの画面写しと文で説明しているが、ストア版は専用キーボードだけで遊ぶので、
// 専用キーボードと同じ配列の「動かない図」と文で説明する（キーを光らせて実演する案は、お手本の取りやめに合わせてやめた）。
// id・title・forLevels・openAtLevel は guides.js と同じにする（既読の記録と、結果画面の「新しい解説」のお知らせを共通にするため）。
// 図は kbCore.js の LAYOUTS から作るので、キーボードの配列を変えたら図も自動で変わる。

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const DIR_WORD = ['押すだけ', '左へ', '上へ', '右へ', '下へ'];
const findKey = (mode, id) => LAYOUTS[mode].find(k => k.id === id);

/**
 * 専用キーボードの図（プレイ画面のキーボードと同じ並び。キーには真ん中の文字だけ）。
 * (2) インプット: mode（'kana'|'abc'|'num'）, hi（目立たせるキーのid。'mode'は画面切り替えキー）
 * 文字キーを押すと、はらう先の十字が図の下に出る（app.js の bindFlickDemo）。
 */
export function softKb(mode = 'kana', hi = []) {
    const keys = LAYOUTS[mode];
    const cls = (id, extra = '') => `skb-key${extra}${hi.includes(id) ? ' hi' : ''}`;
    const cell = (k) => k.fn
        ? `<div class="${cls(k.id, ' fn')}">${k.label}</div>`
        : `<div class="${cls(k.id)}" data-flick="${k.id}">${esc(k.f[0])}</div>`;
    const rows = [0, 1, 2, 3].map(i => keys.slice(i * 3, i * 3 + 3).map(cell).join(''));
    const blank = '<div class="skb-key blank"></div>';
    return `<div class="kb-wrap" data-mode="${mode}"><div class="skb-static"><div class="skb-grid">` +
        blank + rows[0] + `<div class="${cls('del', ' fn')}">⌫</div>` +
        blank + rows[1] + `<div class="${cls('space', ' fn')}">空白</div>` +
        `<div class="${cls('mode', ' fn mode')}">${MODE_LABEL[mode]}</div>` + rows[2] + `<div class="${cls('enter', ' fn enter')}">確定</div>` +
        blank + rows[3] +
        '</div></div><div class="flick-demo" aria-live="polite"><p class="flick-hint">上の図の文字キーを押すと、はらう先の文字がここに出ます</p></div></div>';
}

/** 1つのキーの「十字」の図（まん中＝押すだけ、左・上・右・下＝はらった先）。guides.js の cross と同じ形。 */
export function softCross(mode, id) {
    const [c, l, u, r, d] = findKey(mode, id).f.map(esc);
    const cell = (ch, pos) => `<span class="cr ${pos}${ch ? '' : ' none'}">${ch || ''}</span>`;
    return `<div class="cross">${cell('', 'blank')}${cell(u, 'up')}${cell('', 'blank')}` +
        `${cell(l, 'left')}${cell(c, 'center')}${cell(r, 'right')}` +
        `${cell('', 'blank')}${cell(d, 'down')}${cell('', 'blank')}</div>`;
}

// 1文字の打ち方（かなの画面）。例：「す」＝「さ」を上へ、「ご」＝「か」を下へ →「小゛゜」を1回
const SMALL = 'っゃゅょ';
const LARGE = 'つやゆよ';
function how(ch) {
    const smallIdx = SMALL.indexOf(ch);
    const [plain, mark] = smallIdx >= 0 ? [LARGE[smallIdx], ''] : [...ch.normalize('NFD')];
    const extra = mark === '゙' || smallIdx >= 0 ? ' →「小゛゜」を1回' : mark === '゚' ? ' →「小゛゜」を2回' : '';
    for (const k of LAYOUTS.kana) {
        const i = k.f ? k.f.indexOf(plain) : -1;
        if (i >= 0) return `<span class="how"><b>${ch}</b>＝「${k.f[0]}」${i === 0 ? (extra ? 'を押す' : 'を押すだけ') : 'を' + DIR_WORD[i].replace('へ', 'に') + 'はらう'}${extra}</span>`;
    }
    return `<span class="how"><b>${ch}</b></span>`;
}
const example = (word) => `<div class="example"><div class="example-word">${word}</div>${[...word].map(how).join('')}</div>`;
const steps = (word, list) => `<div class="example"><div class="example-word">${word}</div>${list.map((s, i) => `<span class="how"><b>${'①②③④⑤'[i]}</b>${s}</span>`).join('')}</div>`;

const AUTO_NEXT = '<p class="tip">お題のとおりに打てたら、<b>自動で次の問題に進みます</b>。「確定」を押す必要はありません。</p>';

export const GUIDES_SOFT = [
    {
        id: 'basic',
        title: 'フリック入力のきほん',
        forLevels: 'Lv1〜3',
        openAtLevel: 1,
        body: `
<p class="lead">スマホで文字を打つときは「フリック入力」という打ち方を使います。<br>
キーを押して、そのまま指を少しすべらせる（はらう）だけで、いろいろな文字が打てます。<br>
ゆっくりで大丈夫です。順番に見ていきましょう。</p>

<h3>1. キーのならび</h3>
<p>遊ぶときに画面の下に出てくるキーボードです。まん中の12個のキーに、「あ・か・さ・た・な…」が<b>左上から右へ、50音の順</b>にならんでいます（黄色のキー）。</p>
${softKb('kana', ['a', 'ka', 'sa', 'ta', 'na', 'ha', 'ma', 'ya', 'ra', 'wa'])}
<ul class="rows">
  <li><b>いちばん上の段</b>：あ・か・さ</li>
  <li><b>2段目</b>：た・な・は</li>
  <li><b>3段目</b>：ま・や・ら</li>
  <li><b>いちばん下のまん中</b>：わ</li>
</ul>

<h3>2. 指のすべらせかた</h3>
<p>たとえば「あ」のキーです。</p>
${softCross('kana', 'a')}
<ul class="rows">
  <li>押して、そのままはなす → <b>あ</b></li>
  <li>押したまま <b>左</b>へすべらせる → <b>い</b></li>
  <li>押したまま <b>上</b>へすべらせる → <b>う</b></li>
  <li>押したまま <b>右</b>へすべらせる → <b>え</b></li>
  <li>押したまま <b>下</b>へすべらせる → <b>お</b></li>
</ul>
<p class="tip">「<b>左から時計まわりに い・う・え・お</b>」とおぼえると便利です。<br>
「か」のキーなら か・き・く・け・こ、「さ」のキーなら さ・し・す・せ・そ。どのキーも同じ向きです。</p>
<p class="tip">キーを押している間は、キーの上に<b>十字が大きく出て</b>、すべらせた先の文字が見えます。すべらせるのは、ほんの少し（指1本分くらい）で大丈夫です。</p>

<h3>3. ためしてみましょう</h3>
<p>下の図のキーを押すと、そのキーで打てる文字が十字の形で出ます。</p>
${softKb('kana')}

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
<p>「や」のキーは、<b>や・ゆ・よ</b>の3つです（上へ＝ゆ、下へ＝よ。左右の「」はずっと先のレベルで使います）。</p>
${softCross('kana', 'ya')}
<p>「わ」のキーは、<b>左へ＝を</b>、<b>上へ＝ん</b>です。</p>
${softCross('kana', 'wa')}
${example('れもん')}
<p class="tip">「もも」のように同じ文字が続くときも、2回押すだけで打てます。</p>

<h3>7. 打ち終わったら</h3>
${AUTO_NEXT}

<h3>8. まちがえたとき</h3>
<p>まちがえると、打った文字のまわりが赤くなります。右上の<b>「⌫」</b>のキーで1文字ずつ消して、打ち直しましょう。</p>
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
<p>左下の<b>「小゛゜」</b>のキーを使います（黄色のキー）。</p>
${softKb('kana', ['dk'])}

<h3>2. 打ち方</h3>
<p>たとえば「が」を打つときは、</p>
<ul class="rows">
  <li>① 「か」のキーを押して、<b>か</b>を打つ</li>
  <li>② すぐに左下の<b>「小゛゜」</b>のキーを1回押す → <b>が</b>に変わる</li>
</ul>
<p class="tip">「ご」なら「か」を下へすべらせて<b>こ</b>を打ち、「小゛゜」を1回。どの文字も同じです。</p>

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
<p>「小゛゜」のキーは、押すたびに形が変わります。押しすぎて別の形になったら、<b>もう何回か押すと元にもどります</b>。</p>
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
<p>てんてん（゛）と同じ、左下の<b>「小゛゜」</b>のキーを使います。押す回数がちがいます。</p>
${softKb('kana', ['ha', 'dk'])}
<ul class="rows">
  <li>① 「は」のキーを押して、<b>は</b>を打つ</li>
  <li>② 「小゛゜」を1回押す → <b>ば</b></li>
  <li>③ もう1回押す → <b>ぱ</b></li>
</ul>
<p class="tip">「は → ば → ぱ」の順に変わります。<b>まるは2回</b>とおぼえましょう。<br>
押しすぎて「は」にもどったら、もう一度押せば「ば」「ぱ」と進みます。</p>

<h3>2. 例</h3>
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
<p>てんてんと同じ、左下の<b>「小゛゜」</b>のキーを使います。</p>
${softKb('kana', ['ta', 'dk'])}
<ul class="rows">
  <li>① 「た」のキーを上へすべらせて、<b>つ</b>を打つ</li>
  <li>② すぐに「小゛゜」を1回押す → 小さい<b>っ</b>に変わる</li>
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
${softKb('kana', ['ya', 'dk'])}
<ul class="rows">
  <li>① 「や」のキーで <b>や・ゆ・よ</b> のどれかを打つ（ゆ＝上へ、よ＝下へ）</li>
  <li>② すぐに「小゛゜」を1回押す → 小さい<b>ゃ・ゅ・ょ</b>に変わる</li>
</ul>
${softCross('kana', 'ya')}

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
「わ」の右どなりの<b>「、」</b>のキーを使います。</p>

<h3>1. 打ち方</h3>
${softKb('kana', ['pu'])}
<ul class="rows">
  <li>「、」＝「、」のキーを<b>押すだけ</b></li>
  <li>「。」＝「、」のキーを<b>左</b>へすべらせる</li>
</ul>
${softCross('kana', 'pu')}
<p class="tip">上へすべらせると「？」、右へすべらせると「！」になります。</p>

<h3>2. 例</h3>
${example('はい、わかりました。')}
${AUTO_NEXT}
`,
    },
    {
        id: 'katakana',
        title: 'カタカナに変える',
        forLevels: 'Lv32〜34',
        openAtLevel: 32,
        body: `
<p class="lead">「カメラ」「テレビ」のようなカタカナは、<b>ひらがなで打ってから変えます</b>。</p>

<h3>1. 打ち方</h3>
<ul class="rows">
  <li>① ひらがなで打つ（例：<b>かめら</b>）</li>
  <li>② キーボードのすぐ上に、変えられる候補が横に並ぶ</li>
  <li>③ その中の <b>カメラ</b> を押す → カタカナになる</li>
</ul>
<p class="tip">候補がたくさんあって見えないときは、候補の列を左へすべらせると続きが出ます。</p>

<h3>2. 例</h3>
${steps('テレビ', ['「てれび」と打つ', '候補の「テレビ」を押す'])}
${steps('シャツ', ['「しゃつ」と打つ（ゃは小さくする）', '候補の「シャツ」を押す'])}

<h3>3. ひらがなとまざった文</h3>
<p>「テレビをみる。」なら、先に「てれび」を打って「テレビ」に変え、続けて「をみる。」を打ちます。</p>
<p class="tip">ひらがなのまま「確定」を押すと、まちがいになります。「⌫」で消して打ち直してください。</p>
`,
    },
    {
        id: 'chouon',
        title: 'のばす音「ー」',
        forLevels: 'Lv35〜37',
        openAtLevel: 35,
        body: `
<p class="lead">「ノート」「コーヒー」の、のばす音「ー」の打ち方です。</p>

<h3>1. 打ち方</h3>
${softKb('kana', ['wa'])}
<ul class="rows">
  <li>「ー」＝「わ」のキーを<b>右へ</b>すべらせる</li>
</ul>
${softCross('kana', 'wa')}

<h3>2. 例</h3>
${steps('ノート', ['「の」「ー」「と」と打つ（ひらがなで「のーと」）', '候補の「ノート」を押す'])}
${steps('コーヒー', ['「こーひー」と打つ（「ー」は2回）', '候補の「コーヒー」を押す'])}
<p class="tip">「ー」は「あ・い・う…」ではなく、横棒の記号です。「こうひい」と打つと、カタカナにしても「コウヒイ」になってしまいます。</p>
`,
    },
    {
        id: 'kanji',
        title: '漢字に変える',
        forLevels: 'Lv38〜40',
        openAtLevel: 38,
        body: `
<p class="lead">漢字も、カタカナと同じように<b>ひらがなで打ってから変えます</b>。</p>

<h3>1. 打ち方</h3>
<ul class="rows">
  <li>① 読みをひらがなで打つ（例：<b>でんしゃ</b>）</li>
  <li>② キーボードのすぐ上に、変えられる候補が横に並ぶ</li>
  <li>③ その中の <b>電車</b> を押す → 漢字になる</li>
</ul>
<p class="tip">ここで出てくる語は、同じ読みの別の漢字がほとんど無い語です。候補の先頭あたりに出てきます。</p>

<h3>2. 例</h3>
${steps('牛乳', ['「ぎゅうにゅう」と打つ', '候補の「牛乳」を押す'])}
${steps('図書館', ['「としょかん」と打つ', '候補の「図書館」を押す'])}

<h3>3. ひらがなとまざった文</h3>
<p>「電車でかえります。」なら、「でんしゃ」を打って「電車」に変え、続けて「でかえります。」を打ちます。</p>
<p class="tip">変える所は、<b>その語を打ち終わったところで</b>候補を押しましょう。先まで打ってしまっても、候補に前の語の漢字が出るので変えられます。</p>
`,
    },
    {
        id: 'douon',
        title: '同じ読みの漢字',
        forLevels: 'Lv41〜43',
        openAtLevel: 41,
        body: `
<p class="lead">「はし」には「橋」と「箸」があるように、<b>読みが同じで漢字がちがう</b>ことばがあります。<br>
打ち方は同じで、<b>候補の中から、お題と同じ漢字を選びます</b>。</p>

<h3>1. 選び方</h3>
<ul class="rows">
  <li>① 読みをひらがなで打つ（例：<b>はし</b>）</li>
  <li>② 候補に「橋」「箸」などが並ぶ</li>
  <li>③ お題と<b>同じ漢字</b>を押す</li>
</ul>

<h3>2. 例</h3>
${steps('雨／飴', ['どちらも「あめ」と打つ', '空から降るのは「雨」、なめるのは「飴」を押す'])}
${steps('暑い／熱い', ['どちらも「あつ」と打つ', '天気なら「暑」、お茶なら「熱」を押して、「い」を打つ'])}
<p class="tip">ちがう漢字を選ぶと、まちがいになります。「⌫」で消して打ち直してください。</p>
`,
    },
    {
        id: 'number',
        title: '数字を打つ',
        forLevels: 'Lv49〜51',
        openAtLevel: 49,
        body: `
<p class="lead">「3時」「100円」のような数字は、<b>数字の画面に切り替えて</b>打ちます。</p>

<h3>1. 数字の画面に切り替える</h3>
<p>左側の<b>画面を切り替えるキー</b>を使います（黄色のキー）。押すたびに、かな → 英字 → 数字 → かな の順に変わります。キーには「次の画面」の名前が書いてあります。</p>
${softKb('kana', ['mode'])}
<ul class="rows">
  <li>① かなの画面で<b>「ABC」</b>を押す → 英字の画面になる</li>
  <li>② 同じ場所の<b>「☆123」</b>を押す → 数字の画面になる</li>
  <li>③ 数字を打つ（キーを押すだけ。0は下の段のまん中）</li>
  <li>④ 同じ場所の<b>「あいう」</b>を押す → かなの画面にもどる</li>
</ul>
<p>数字の画面は、こうなっています。</p>
${softKb('num', ['mode'])}

<h3>2. 例</h3>
${steps('3時', ['数字の画面で「3」を打つ', '「あいう」でかなにもどって「じ」を打つ', '候補の「時」を押す'])}
<p class="tip">このレベルでは、数字は半角（3）でも全角（３）でも正解です。半角と全角の打ち分けは、Lv52から練習します。</p>
`,
    },
    {
        id: 'width',
        title: '半角と全角',
        forLevels: 'Lv52〜54',
        openAtLevel: 52,
        body: `
<p class="lead">数字には、幅のせまい<b>半角（3）</b>と、幅の広い<b>全角（３）</b>があります。<br>
このレベルからは、お題の下に出る「半角で打つ」「全角で打つ」のとおりに打ち分けます。</p>

<h3>1. 半角で打つ</h3>
<ul class="rows">
  <li>数字の画面で数字を打つだけ → <b>半角</b>になる</li>
</ul>

<h3>2. 全角で打つ</h3>
<ul class="rows">
  <li>① 数字の画面で数字を打つ</li>
  <li>② キーボードの上の候補から、幅の広い<b>全角</b>の数字を押す</li>
</ul>

<h3>3. 見分け方</h3>
<div class="example"><div class="example-word">12 ／ １２</div><span class="how"><b>左</b>半角：数字の幅がせまい</span><span class="how"><b>右</b>全角：1字がひらがなと同じ幅</span></div>
<p class="tip">ちがう方で打つと、まちがいになります。「⌫」で消して打ち直してください。</p>
`,
    },
    {
        id: 'symbol1',
        title: '記号を打つ（～ ： ／）',
        forLevels: 'Lv58〜60',
        openAtLevel: 58,
        body: `
<p class="lead">「10:30」「11/3」「3～5」の記号は、<b>数字の画面</b>で打ちます。<br>
記号は数字のキーを<b>はらう（フリック）</b>と出ます。図のキーを押すと、どの向きに何があるかが見られます。</p>

<h3>1. どのキーにあるか</h3>
${softKb('num', ['n7', 'sym', 'n0'])}
<ul class="rows">
  <li><b>：</b>（コロン）… 「7」のキーを<b>右</b>へ</li>
  <li><b>／</b>（スラッシュ）… 右下の「.」のキーを<b>右</b>へ</li>
  <li><b>～</b>（から）… 「0」のキーを<b>左</b>へ</li>
</ul>

<h3>2. 例</h3>
${steps('10:30', ['数字の画面で「1」「0」', '「7」のキーを右へはらって「:」', '「3」「0」を打つ'])}
<p class="tip">数字と記号は同じ画面なので、「10:30」は画面を切り替えずに続けて打てます。記号は半角でも全角でも正解です。</p>
`,
    },
    {
        id: 'symbol2',
        title: '記号を打つ（・ －）',
        forLevels: 'Lv61〜63',
        openAtLevel: 61,
        body: `
<p class="lead">「月・水・金」の<b>・（なかぐろ）</b>と、電話番号の<b>-（ハイフン）</b>も、数字の画面で打ちます。</p>

<h3>1. どのキーにあるか</h3>
${softKb('num', ['n4', 'sym'])}
<ul class="rows">
  <li><b>・</b>（なかぐろ）… 「4」のキーを<b>右</b>へ</li>
  <li><b>-</b>（ハイフン）… 右下の「.」のキーを<b>上</b>へ</li>
</ul>

<h3>2. 例</h3>
${steps('月・水', ['「げつ」を打って「月」を選ぶ', '数字の画面で「4」を右へはらって「・」', 'かなにもどって「すい」→「水」'])}
<p class="tip">かなの画面の「ー」（のばす音）とハイフン「-」は見た目が似ていますが、別の文字です。電話番号や住所は、数字の画面の「-」で打ってください。</p>
`,
    },
    {
        id: 'symbol3',
        title: '記号を打つ（「」（））',
        forLevels: 'Lv64〜66',
        openAtLevel: 64,
        body: `
<p class="lead">会話を囲む<b>「」（かぎかっこ）</b>は、かなの画面のまま打てます。<br>
曜日などを囲む<b>（）（かっこ）</b>は、数字の画面で打ちます。</p>

<h3>1. どのキーにあるか</h3>
<ul class="rows">
  <li><b>「</b> … かなの画面の「や」のキーを<b>左</b>にはらう</li>
  <li><b>」</b> … かなの画面の「や」のキーを<b>右</b>にはらう</li>
</ul>
${softCross('kana', 'ya')}
<ul class="rows">
  <li><b>（</b> … 数字の画面の左下の「(」のキーを<b>押すだけ</b></li>
  <li><b>）</b> … 同じキーを<b>左</b>にはらう</li>
</ul>
${softKb('num', ['par'])}

<h3>2. 例</h3>
${steps('「はい」', ['「や」を左にはらって「', '「はい」と打つ', '「や」を右にはらって」'])}
<p class="tip">かっこは半角でも全角でも正解です。</p>
`,
    },
    {
        id: 'symbol4',
        title: '記号を打つ（％ ※）',
        forLevels: 'Lv67〜69',
        openAtLevel: 67,
        body: `
<p class="lead"><b>％（パーセント）</b>は数字の画面で打ちます。<br>
<b>※（こめじるし）</b>はキーに無いので、<b>「こめ」と打って変えます</b>。</p>

<h3>1. どのキーにあるか</h3>
${softKb('num', ['n3'])}
<ul class="rows">
  <li><b>％</b> … 数字の画面の「3」のキーを<b>左</b>へ</li>
  <li><b>※</b> … かなの画面で「こめ」と打ち、候補の「※」を押す</li>
</ul>

<h3>2. 例</h3>
${steps('※注意', ['「こめ」と打って「※」を選ぶ', '「ちゅうい」と打って「注意」を選ぶ'])}
<p class="tip">％は半角でも全角でも正解です。</p>
`,
    },
    {
        id: 'symbol5',
        title: '記号を打つ（♪ ☆）',
        forLevels: 'Lv70〜72',
        openAtLevel: 70,
        body: `
<p class="lead">メッセージを楽しくする<b>♪（おんぷ）</b>と<b>☆（ほし）</b>は、数字の画面の<b>「1」のキー</b>にあります。</p>

<h3>1. どのキーにあるか</h3>
${softKb('num', ['n1'])}
<ul class="rows">
  <li><b>☆</b> … 「1」のキーを<b>左</b>へ</li>
  <li><b>♪</b> … 「1」のキーを<b>上</b>へ</li>
</ul>

<h3>2. 例</h3>
${steps('ありがとう♪', ['「ありがとう」と打つ', '数字の画面で「1」を上へはらって「♪」'])}
`,
    },
    {
        id: 'alpha-upper',
        title: '英字を打つ（大文字）',
        forLevels: 'Lv76〜78',
        openAtLevel: 76,
        body: `
<p class="lead">「JR」「NHK」のような英字は、<b>英字の画面</b>に切り替えて打ちます。</p>

<h3>1. 英字の画面に切り替える</h3>
<ul class="rows">
  <li>① かなの画面の左側の<b>「ABC」</b>を押す → 英字の画面になる</li>
  <li>② 英字を打つ</li>
  <li>③ 左側の<b>「☆123」</b>→<b>「あいう」</b>と押す → かなの画面にもどる</li>
</ul>
${softKb('abc', ['case'])}

<h3>2. 英字の打ち方</h3>
<ul class="rows">
  <li>かなと同じく、キーを<b>押す・はらう</b>で打つ（「a」のキーなら、押すとa、左へはらうとb、上へはらうとc）</li>
  <li><b>大文字</b>にするときは、文字を打ったあとに左下の<b>「a/A」</b>を押す（「小゛゜」と同じ使い方）</li>
</ul>

<h3>3. 例</h3>
${steps('JR', ['英字の画面で「j」→「a/A」', '「p」のキーを上へはらって「r」→「a/A」'])}
<p class="tip">英字は半角でも全角でも正解です。</p>
`,
    },
    {
        id: 'alpha-lower',
        title: '英字を打つ（小文字）',
        forLevels: 'Lv79〜81',
        openAtLevel: 79,
        body: `
<p class="lead">英字の画面では、打った文字は<b>はじめから小文字</b>です。「a/A」は押さずに、そのまま打ちます。</p>

<h3>1. 打ち方</h3>
<ul class="rows">
  <li>① かなの画面の<b>「ABC」</b>で英字の画面にする</li>
  <li>② 小文字のまま打つ</li>
</ul>
${softKb('abc')}

<h3>2. 例</h3>
${steps('yes', ['「w」のキーを上へはらって「y」', '「d」のキーを左へはらって「e」', '「p」のキーを右へはらって「s」'])}
<p class="tip">大文字と小文字は別の文字として判定します。まちがえて大文字にしたときは、もう一度「a/A」を押すと小文字にもどります。</p>
`,
    },
    {
        id: 'mail-url',
        title: '＠と「.」を打つ（メールアドレス・URL）',
        forLevels: 'Lv91〜93',
        openAtLevel: 91,
        body: `
<p class="lead">メールアドレスの<b>＠（アットマーク）</b>と、URLの<b>.（ドット）</b>は、<b>英字の画面</b>で打ちます。</p>

<h3>1. どのキーにあるか</h3>
${softKb('abc', ['at', 'dot'])}
<ul class="rows">
  <li><b>＠</b> … 英字の画面の左上の「@」のキーを<b>押すだけ</b></li>
  <li><b>.</b> … 英字の画面の右下の「.」のキーを<b>押すだけ</b></li>
</ul>

<h3>2. 例</h3>
${steps('info@abc.jp', ['英字の画面で「info」', '「@」', '「abc」→「.」→「jp」'])}
<p class="tip">英字と同じ画面なので、切り替えずに続けて打てます。半角でも全角でも正解です。</p>
`,
    },
];
