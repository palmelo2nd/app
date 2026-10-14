// Androidのアダプティブアイコン（前景・背景）を、各解像度の正しいサイズ（108dp×密度）で生成する。
// Capacitor既定の192px前景＋XMLのinsetだとスプラッシュ等で拡大されてぼやけるため（QA-1）、
// assets/のマスター1024pxから直接書き出し、mipmap-anydpi-v26のinsetは外している。
// `npx capacitor-assets generate`を再実行するとandroid側が上書きされるので、その後はこのスクリプトを再実行する。
// 使い方: node scripts/gen-android-adaptive-icon.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const RES_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const FOREGROUND_SRC = path.join(ROOT, 'assets', 'icon-foreground.png');
const BACKGROUND_SRC = path.join(ROOT, 'assets', 'icon-background.png');

// 108dp × 密度。
const DENSITIES = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
// 丸型マスクの可視領域（直径72dp＝キャンバスの約66.7%）から文字枠の角が欠けないよう、前景を縮小して中央に置く。
const FOREGROUND_SCALE = 0.9;

(async () => {
    for (const [density, size] of Object.entries(DENSITIES)) {
        const dir = path.join(RES_DIR, `mipmap-${density}`);
        if (!fs.existsSync(dir)) continue;

        const inner = Math.round(size * FOREGROUND_SCALE);
        const pad = Math.floor((size - inner) / 2);
        const fg = await sharp(FOREGROUND_SRC)
            .resize(inner, inner, { kernel: 'lanczos3' })
            .extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), fg);

        const bg = await sharp(BACKGROUND_SRC).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
        fs.writeFileSync(path.join(dir, 'ic_launcher_background.png'), bg);

        console.log(`mipmap-${density}: ${size}x${size}`);
    }

    // Android 12+のスプラッシュはアイコンを中央の円（直径＝全体の2/3）で切り抜くため、はみ出さないよう縮小して中央に置く。
    const SPLASH_SIZE = 1024;
    const SPLASH_SCALE = 0.68;
    const splashInner = Math.round(SPLASH_SIZE * SPLASH_SCALE);
    const splashPad = Math.floor((SPLASH_SIZE - splashInner) / 2);
    const splash = await sharp(FOREGROUND_SRC)
        .resize(splashInner, splashInner, { kernel: 'lanczos3' })
        .extend({ top: splashPad, bottom: SPLASH_SIZE - splashInner - splashPad, left: splashPad, right: SPLASH_SIZE - splashInner - splashPad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    fs.writeFileSync(path.join(RES_DIR, 'drawable-nodpi', 'splash_icon.png'), splash);
    console.log('splash_icon.png updated');

    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
        const xmlPath = path.join(RES_DIR, 'mipmap-anydpi-v26', name);
        fs.writeFileSync(xmlPath, `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`);
        console.log(`updated ${name}`);
    }
})();
