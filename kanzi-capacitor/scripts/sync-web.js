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

fs.rmSync(WWW_DIR, { recursive: true, force: true });
fs.mkdirSync(WWW_DIR, { recursive: true });

for (const name of TARGETS) {
    const src = path.join(KANZI_DIR, name);
    const dest = path.join(WWW_DIR, name);
    if (!fs.existsSync(src)) {
        console.warn(`[sync-web] スキップ（存在しない）: ${src}`);
        continue;
    }
    fs.cpSync(src, dest, { recursive: true });
    console.log(`[sync-web] コピー完了: ${name}`);
}

console.log(`[sync-web] ${KANZI_DIR} -> ${WWW_DIR} の同期が完了しました。`);
