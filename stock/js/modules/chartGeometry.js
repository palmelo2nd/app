// (1) インポート — なし（Web標準APIのみ使用）

// 2026-08-29追加：スコアページの五角形レーダーチャート用の座標計算。2026-09-08、履歴の時系列表示を
// 2軸折れ線グラフから5指標積み上げ棒グラフ（buildStackedBarGeometry）に置き換えた。
// 本アプリは外部グラフライブラリを使わず自前実装する方針（CLAUDE.md参照）で、既存の横棒グラフはdiv実装だが、
// 形状上SVGが自然なレーダー・積み上げ棒はこのモジュールで座標だけを計算し、DOM生成（<svg>要素の組み立て）は
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
 * 積み上げ棒グラフ用に、日付（棒）ごとの内訳配列を棒の矩形座標（ピクセル）へ変換する。
 * X軸は棒の本数で等間隔に区画を割り、各区画内でbarGapRatio分の余白を空けて棒幅を決める。
 * Y軸は0〜maxYをheight〜0（上が大きい値）にマッピングし、内訳を下から順に積み上げる。
 *
 * (2) インプット: bars — number[][]（日付ごとの内訳配列。例: [実質利回り,達成率,業種集中,銘柄集中,DEF]）、
 *                options — { width, height, paddingLeft, paddingRight, paddingTop, paddingBottom,
 *                            maxY, barGapRatio=0.3 }
 * (3) メイン: 棒の本数から棒1本あたりの区画幅・棒幅を決め、各棒について内訳を下から積み上げたときの
 *            各セグメントのy（上端）・heightを計算する
 * (4) アウトプット: [{ x, width, segments: [{ y, height }] }]（barsと同じ長さ・並び順）
 */
export function buildStackedBarGeometry(bars, options) {
    const {
        width, height,
        paddingLeft = 0, paddingRight = 0, paddingTop = 0, paddingBottom = 0,
        maxY, barGapRatio = 0.3,
    } = options;

    const innerWidth = Math.max(0, width - paddingLeft - paddingRight);
    const innerHeight = Math.max(0, height - paddingTop - paddingBottom);
    const n = bars.length;
    if (n === 0) return [];

    const slot = innerWidth / n;
    const barWidth = slot * (1 - barGapRatio);
    const scale = maxY > 0 ? innerHeight / maxY : 0;

    return bars.map((values, i) => {
        const x = paddingLeft + slot * i + (slot - barWidth) / 2;
        let cumulative = 0;
        const segments = values.map(value => {
            const v = Number.isFinite(value) ? Math.max(0, value) : 0;
            const yTop = paddingTop + innerHeight - (cumulative + v) * scale;
            const segHeight = v * scale;
            cumulative += v;
            return { y: yTop, height: segHeight };
        });
        return { x, width: barWidth, segments };
    });
}
