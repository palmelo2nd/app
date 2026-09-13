// (1) インポート
import { isDue, calcAccuracy, formatDateOnly } from './srs.js';

/**
 * 指定した種別のうち、復習期限が来ているカードを抽出する。
 *
 * (2) インプット: mainData, kubun（'語彙'|'数学記号'|'長文'）, todayStr（省略時は今日）
 * (3) メイン: 種別が一致し、かつ復習期限到来のものを抽出
 * (4) アウトプット: 該当カードの配列
 */
export function getDueItems(mainData, kubun, todayStr = formatDateOnly()) {
    return mainData.filter(item => item['種別'] === kubun && isDue(item, todayStr));
}

/**
 * カード1件の出題重みを計算する。正答率が低い（＝苦手な）カードほど大きくなる。
 * kanziアプリのprogress.js（calcWeight）と同じ考え方。
 *
 * (2) インプット: item
 * (3) メイン: 正答率が低いほど重みを増やす。未回答は中間よりやや高めの重み
 * (4) アウトプット: 重み（正の数値）
 */
export function calcWeight(item) {
    const accuracy = calcAccuracy(item);
    if (accuracy === null) return 1.2;
    return Math.max(0.15, 1 - accuracy) + 0.1;
}

/**
 * 出題重みに応じた非復元抽出で、対象カード全件を並べ替える（苦手なカードほど先頭に出やすい）。
 *
 * (2) インプット: items（カード配列）
 * (3) メイン: 重み付きルーレット選択を全件分繰り返す
 * (4) アウトプット: 並べ替え後のカード配列（件数はitemsと同じ）
 */
export function buildQuizQueue(items) {
    const pool = items.map(item => ({ item, weight: calcWeight(item) }));
    const result = [];

    while (pool.length > 0) {
        const total = pool.reduce((sum, p) => sum + p.weight, 0);
        let r = Math.random() * total;
        let idx = 0;
        for (; idx < pool.length - 1; idx++) {
            r -= pool[idx].weight;
            if (r <= 0) break;
        }
        result.push(pool[idx].item);
        pool.splice(idx, 1);
    }
    return result;
}
