// ふりっくふろっくのアイコンとスプラッシュを、assets/ のSVG（前景・背景、1024px）から作る。
// ・アダプティブアイコン（前景・背景、108dp×密度）と、古いAndroid用の ic_launcher.png・ic_launcher_round.png
// ・スプラッシュ（drawable*/splash.png。今ある画像と同じ大きさで、背景色のまん中にアイコン）
// ・ストアのアイコン 512×512（assets/store-icon-512.png）
// 使い方: npm run icons（npx cap add android のあとに1回。cap sync では上書きされない）
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const FG = fs.readFileSync(path.join(ROOT, 'assets', 'icon-foreground.svg'));
const BG = fs.readFileSync(path.join(ROOT, 'assets', 'icon-background.svg'));
const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const png = (svg, size) => sharp(svg, { density: 72 * size / 1024 * 4 }).resize(size, size).png().toBuffer();
// 前景と背景を重ねた1枚（round＝丸く切り抜く）。前景はアダプティブの安全な範囲（まん中66%）に合わせて少し縮める
async function full(size, round = false) {
    const inner = Math.round(size * 0.86);
    const fg = await sharp(await png(FG, 1024)).resize(inner, inner).toBuffer();
    let img = sharp(await png(BG, size)).composite([{ input: fg, gravity: 'centre' }]);
    if (round) {
        const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
        img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
    }
    return img.png().toBuffer();
}

(async () => {
    for (const [d, size] of Object.entries(ADAPTIVE)) {
        const dir = path.join(RES, `mipmap-${d}`);
        fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), await png(FG, size));
        fs.writeFileSync(path.join(dir, 'ic_launcher_background.png'), await png(BG, size));
        fs.writeFileSync(path.join(dir, 'ic_launcher.png'), await full(LEGACY[d]));
        fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), await full(LEGACY[d], true));
        console.log(`mipmap-${d}`);
    }
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
        fs.writeFileSync(path.join(RES, 'mipmap-anydpi-v26', name), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`);
    }
    // スプラッシュ：今ある splash.png と同じ大きさで作り直す
    for (const dir of fs.readdirSync(RES).filter(n => n.startsWith('drawable'))) {
        const p = path.join(RES, dir, 'splash.png');
        if (!fs.existsSync(p)) continue;
        const { width, height } = await sharp(p).metadata();
        const icon = Math.round(Math.min(width, height) * 0.4);
        const bg = await sharp(BG).resize(width, height, { fit: 'cover' }).png().toBuffer();
        const out = await sharp(bg).composite([{ input: await full(icon, true), gravity: 'centre' }]).png().toBuffer();
        fs.writeFileSync(p, out);
        console.log(`${dir}/splash.png ${width}x${height}`);
    }
    fs.writeFileSync(path.join(ROOT, 'assets', 'store-icon-512.png'), await full(512));
    console.log('assets/store-icon-512.png');
})();
