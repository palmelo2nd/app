// レベル定義（js/modules/levels.js）の検査用スクリプト。実行: node check-levels.mjs
// 確認すること：
//  ・レベル番号が1から連番になっている
//  ・各お題が、そのレベルの chars の文字だけでできている
//  ・お題がちょうど10個で、重複していない
//  ・chars が前のレベルの chars を含んでいる（累積。累積させない設計にしたいときは警告を無視してよい）
import { pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { LEVEL_DEFS } = await import(pathToFileURL(path.join(here, 'js/modules/levels.js')).href);

let errors = 0;
let warnings = 0;
const err = (m) => { console.log('NG  ' + m); errors++; };
const warn = (m) => { console.log('警告 ' + m); warnings++; };

LEVEL_DEFS.forEach((def, i) => {
    const head = 'Lv' + def.level + '（' + def.name + '）';
    if (def.level !== i + 1) err(head + ': レベル番号が連番ではありません（期待 ' + (i + 1) + '）');

    const allowed = new Set([...def.chars]);
    if (def.problems.length !== 10) err(head + ': お題が' + def.problems.length + '個です（ちょうど10個必要）');
    if (new Set(def.problems).size !== def.problems.length) err(head + ': お題に重複があります');

    for (const p of def.problems) {
        const bad = [...p].filter(c => !allowed.has(c));
        if (bad.length > 0) err(head + ': 「' + p + '」に範囲外の文字 ' + [...new Set(bad)].join('') + ' があります');
    }
    if (i > 0) {
        const missing = [...LEVEL_DEFS[i - 1].chars].filter(c => !allowed.has(c));
        if (missing.length > 0) warn(head + ': 前のレベルの文字 ' + missing.join('') + ' が含まれていません');
    }
    const avg = def.problems.reduce((s, p) => s + [...p].length, 0) / def.problems.length;
    console.log('ok  ' + head + ': お題' + def.problems.length + '個 / 平均' + avg.toFixed(1) + '文字');
});

console.log(errors === 0 ? '\n問題なし（警告 ' + warnings + '）' : '\nエラー ' + errors + ' 件');
process.exit(errors === 0 ? 0 : 1);
