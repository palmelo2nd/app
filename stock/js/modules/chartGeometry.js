// (1) インポート — なし（Web標準APIのみ使用）

// 2026-08-29追加：スコアページの五角形レーダーチャート・2軸時系列折れ線グラフ用の座標計算。
// 本アプリは外部グラフライブラリを使わず自前実装する方針（CLAUDE.md参照）で、既存の横棒グラフはdiv実装だが、
// 形状上SVGが自然なレーダー・折れ線はこのモジュールで座標だけを計算し、DOM生成（<svg>要素の組み立て）は
// js/app.js側で行う（modules内でのDOM操作禁止の規約を維持するため）。

/**
 * 五角形レーダーチャートの各軸の頂点座標を計算する（値0で中心、値100で半径いっぱい）。
 * 真上（12時の位置）を1軸目の起点にし、時計回りに等間隔で配置する。
 *
 * (2) インプット: values — 0〜100の数値配列（軸の数だけ）、options — { cx, cy, radius }（中心座標・半径）
 * (3) メイン: 軸ごとの角度を求め、値の割合に応じた半径で極座標→直交座標に変換する
 * (4) アウトプット: [{ x, y }]（valuesと同じ長さ）
 */
export function buildRadarPoints(values, { cx, cy, radius }) {
    const n = values.length;
    return values.map((value, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2; // 12時方向を起点に時計回り
        const r = radius * Math.max(0, Math.min(100, value)) / 100;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
}

/**
 * レーダーチャートの軸線（中心から外周へ）と外周（満点=100%）の頂点座標を計算する。
 *
 * (2) インプット: count — 軸の数、options — { cx, cy, radius }
 * (3) メイン: buildRadarPointsと同じ角度配置で、満点（value=100固定）の座標を求める
 * (4) アウトプット: [{ x, y }]（軸線の外側の端点。中心cx,cyと結べば1本の軸線になる）
 */
export function buildRadarAxisPoints(count, { cx, cy, radius }) {
    return buildRadarPoints(Array(count).fill(100), { cx, cy, radius });
}

/**
 * 座標配列をSVG polygon/polyline用の"x1,y1 x2,y2 ..."文字列に変換する。
 *
 * (2) インプット: points — [{ x, y }]
 * (3) メイン: 各点をカンマ区切りにし、スペースで連結する
 * (4) アウトプット: 文字列（pointsが空なら''）
 */
export function pointsToSvgAttr(points) {
    return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

/**
 * 折れ線グラフ用に、値の配列をSVG座標（ピクセル）へ線形マッピングする。
 * X軸はインデックス順に等間隔、Y軸はminY〜maxYをheight〜0（上が大きい値）にマッピングする。
 *
 * (2) インプット: values — 数値配列（null/undefinedは欠損として扱いスキップしない。呼び出し側で除外する想定）、
 *                options — { width, height, paddingLeft, paddingRight, paddingTop, paddingBottom, minY, maxY }
 * (3) メイン: インデックスをX座標に、値をY座標に線形変換する（minY==maxYの場合はheightの中央に固定）
 * (4) アウトプット: [{ x, y }]（valuesと同じ長さ）
 */
export function buildLineChartPoints(values, options) {
    const {
        width, height,
        paddingLeft = 0, paddingRight = 0, paddingTop = 0, paddingBottom = 0,
        minY, maxY,
    } = options;

    const innerWidth = Math.max(0, width - paddingLeft - paddingRight);
    const innerHeight = Math.max(0, height - paddingTop - paddingBottom);
    const n = values.length;
    const stepX = n > 1 ? innerWidth / (n - 1) : 0;
    const range = maxY - minY;

    return values.map((value, i) => {
        const x = paddingLeft + stepX * i;
        const ratio = range > 0 ? (value - minY) / range : 0.5;
        const y = paddingTop + innerHeight * (1 - Math.max(0, Math.min(1, ratio)));
        return { x, y };
    });
}
