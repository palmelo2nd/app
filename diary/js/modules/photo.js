// (1) インポート — なし（Canvas APIのみ使用）
// 写真をブラウザ内で縮めてJPEGにする。スマホの写真（3〜5MB）が、だいたい150〜300KBになる。

const MAX_SIDE = 1280; // 長い辺の最大ピクセル数
const QUALITY  = 0.7;  // JPEGの画質（0〜1）

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('写真を読み込めませんでした（対応していない形式の可能性があります）')); };
        img.src = url;
    });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * 写真ファイルを縮めてJPEGにする。
 * (2) インプット: File（input[type=file]で選んだ画像）
 * (4) アウトプット: { blob, base64, width, height }
 */
export async function compressPhoto(file) {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width  = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 透過PNGの透明部分を白にする
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('写真の変換に失敗しました')), 'image/jpeg', QUALITY));
    return { blob, base64: await blobToBase64(blob), width, height };
}
