// kanzi/（Webアプリ本体）のうち、実際にアプリとして配布すべきファイルだけを
// kanzi-capacitor/www/ へコピーする。CapacitorのCLIにはwebDir配下を除外する仕組み
// （.capacitorignore等）が無く単純に丸ごとコピーするため、企画ドキュメント
// （00_市場調査 等の部門フォルダ、CLAUDE.md／README.md／ToDo*.md）を混入させないよう、
// 対象を明示的に絞り込む。`npx cap sync`の前に実行する（package.jsonの"sync"スクリプト参照）。
const fs = require('fs');
const path = require('path');

const KANZI_DIR = path.resolve(__dirname, '..', '..', 'kanzi');
const WWW_DIR = path.resolve(__dirname, '..', 'www');

// コピー対象：実行時にfetch/読み込まれる実ファイルのみ。ドキュメント・企画フォルダは含めない。
const TARGETS = ['index.html', 'css', 'js', 'data'];

// js/app.jsのRELEASE_BUILDがtrueのときだけ、10級・9級の軽量版で足りるため不要な全級版データを除外する
// （RELEASE_BUILD=falseの開発用ビルドは全級を使うので除外しない）。バックアップファイルは常に除外。
const appJs = fs.readFileSync(path.join(KANZI_DIR, 'js', 'app.js'), 'utf8');
const isReleaseBuild = /^const RELEASE_BUILD\s*=\s*true\s*;/m.test(appJs);
const RELEASE_EXCLUDED_DATA = ['kanjiMaster.json', 'jukugo.json', 'strokeOrder.json'];
const dataDir = path.join(KANZI_DIR, 'data');

function shouldCopy(srcPath) {
    if (path.dirname(srcPath) !== dataDir) return true;
    const base = path.basename(srcPath);
    if (base.includes('.backup_')) return false;
    if (isReleaseBuild && RELEASE_EXCLUDED_DATA.includes(base)) return false;
    return true;
}

console.log(`[sync-web] RELEASE_BUILD=${isReleaseBuild}${isReleaseBuild ? '（全級版データを除外）' : '（全データをコピー）'}`);

fs.rmSync(WWW_DIR, { recursive: true, force: true });
fs.mkdirSync(WWW_DIR, { recursive: true });

for (const name of TARGETS) {
    const src = path.join(KANZI_DIR, name);
    const dest = path.join(WWW_DIR, name);
    if (!fs.existsSync(src)) {
        console.warn(`[sync-web] スキップ（存在しない）: ${src}`);
        continue;
    }
    fs.cpSync(src, dest, { recursive: true, filter: shouldCopy });
    console.log(`[sync-web] コピー完了: ${name}`);
}

// 配布ビルドでは、開発タブ専用のhanzi-writer（jsDelivr CDN）を読み込むscriptタグを除去する。
// 残すと起動のたびに外部へ接続しIPアドレスが第三者に渡るため、データセーフティ申告
// 「データを収集・共有しない」と矛盾する。app.js側は`!window.HanziWriter`で安全にスキップする。
if (isReleaseBuild) {
    const htmlPath = path.join(WWW_DIR, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const stripped = html.replace(/[ \t]*<script src="https:\/\/cdn\.jsdelivr\.net\/[^"]*"><\/script>\r?\n?/g, '');
    if (stripped === html) throw new Error('[sync-web] CDNのscriptタグが見つからず除去できませんでした（index.htmlの構造が変わった可能性）');
    fs.writeFileSync(htmlPath, stripped);
    if (/https?:\/\/[^"' ]*(cdn|jsdelivr|unpkg|googleapis)/i.test(stripped.replace(/<a [^>]*href="[^"]*"[^>]*>/g, ''))) {
        throw new Error('[sync-web] www/index.htmlに外部読み込みが残っています');
    }
    console.log('[sync-web] 配布ビルド：外部CDNのscriptタグを除去しました');
}

console.log(`[sync-web] ${KANZI_DIR} -> ${WWW_DIR} の同期が完了しました。`);
