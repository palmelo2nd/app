// typing/（Webアプリ本体）のうち、アプリとして配る実行ファイルだけを typing-capacitor/www/ へコピーし、ストア版に切り替える。
// CapacitorのCLIは webDir を丸ごとコピーするので、企画文書（05_リリース_ストア申請 など）・README・試作（tools/）・
// iPhoneの画面写し（img/。ストア版の解説は専用キーボードの図を使う）を入れないよう、対象を明示的に絞る。
// `npx cap sync` の前に実行する（package.json の "sync" 参照）。
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'typing');
const WWW = path.resolve(__dirname, '..', 'www');
const TARGETS = ['index.html', 'css', 'js'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const name of TARGETS) {
    fs.cpSync(path.join(SRC, name), path.join(WWW, name), { recursive: true });
    console.log(`[sync-web] コピー: ${name}`);
}

// ストア版に切り替える（Web版の typing/js/buildConfig.js は false のまま。こちらのコピーだけ true にする）
const cfg = path.join(WWW, 'js', 'buildConfig.js');
const before = fs.readFileSync(cfg, 'utf8');
const after = before.replace(/export const RELEASE_BUILD = false;/, 'export const RELEASE_BUILD = true;');
if (after === before) throw new Error('[sync-web] buildConfig.js の RELEASE_BUILD を書き換えられませんでした（書き方が変わった可能性）');
fs.writeFileSync(cfg, after);
console.log('[sync-web] RELEASE_BUILD = true（ストア版）');

// 外部から読み込むもの（CDNのscript・css・画像）が無いことを確かめる。リンク（<a href>）とGitHub通信のコード（github.js、ストア版では呼ばれない）は除く
const offenders = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    if (d.name === 'github.js') return;
    const text = fs.readFileSync(p, 'utf8').replace(/<a [^>]*href="https?:[^"]*"[^>]*>/g, '').replace(/^\s*\/\/.*$/gm, '');
    const m = text.match(/(src|href)=["']https?:|@import\s+url\(["']?https?:|fetch\(["']https?:/);
    if (m) offenders.push(`${path.relative(WWW, p)}: ${m[0]}`);
});
walk(WWW);
if (offenders.length) throw new Error('[sync-web] 外部から読み込んでいる所があります:\n' + offenders.join('\n'));
console.log('[sync-web] 外部からの読み込み：なし');
console.log(`[sync-web] ${SRC} -> ${WWW} 完了`);
