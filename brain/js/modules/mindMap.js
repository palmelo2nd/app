// MM（マインドマップ）タブの計算（2026-11-24、brain #-37。計画書：app_data/docs/brain/261124_MMタブ.md）。
// 親IDの階層から、中心・深さ・完了の切替に応じて描くノードを集め、Mermaidのmindmapの文を作る。DOMは触らない。

// (1) インポート
// キャッシュバスティング用の「?v=N」はjs/app.js冒頭のコメント参照。値を変更する際はそちらと揃えること。
import { getRowKind, isRecurringChildRow } from './task.js?v=86';

// ステータス → Mermaidのノードに付けるクラス（色はcss/style.cssの .mm-map 以下）
const STATUS_CLASS = {
    '未着手': 'mm-todo',
    '進行中': 'mm-doing',
    '完了': 'mm-done',
    '連絡待ち': 'mm-wait',
    '中断': 'mm-stop',
};

// 深さの選択肢（0＝全部）
export const MIND_MAP_DEPTH_OPTIONS = [1, 2, 3, 4, 5, 0];
export const MIND_MAP_DEFAULT_DEPTH = 2;

/**
 * マップに描ける行か。種別のある行（1日タスク・報告・勤務カレンダー）と、繰返しから作られた実行タスクは描かない。
 *
 * (2) インプット: row, mainData
 * (4) アウトプット: boolean
 */
export function isMindMapRow(row, mainData) {
    return getRowKind(row) === '' && !isRecurringChildRow(mainData, row);
}

/**
 * 親ID → 子の配列（描ける行だけ、IDの数字順）を作る。
 *
 * (2) インプット: mainData, showDone（falseなら完了の行を除く。子孫もたどらないので一緒に隠れる）
 * (3) メイン: 描ける行を親IDごとにまとめる
 * (4) アウトプット: Map<string 親ID（''＝最上位）, row[]>
 */
export function buildMindMapChildren(mainData, showDone) {
    const children = new Map();
    for (const row of mainData) {
        if (!isMindMapRow(row, mainData)) continue;
        if (!showDone && row['ステータス'] === '完了') continue;
        const pid = String(row['親ID'] || '');
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid).push(row);
    }
    const num = r => { const n = Number(r['ID']); return Number.isNaN(n) ? Infinity : n; };
    children.forEach(list => list.sort((a, b) => num(a) - num(b)));
    return children;
}

/** Mermaidの記号と重なる文字を置き換え、1行にする（ノードの文字が構文を壊さないように）。 */
function sanitizeLabel(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim()
        .replace(/\(/g, '（').replace(/\)/g, '）')
        .replace(/\[/g, '［').replace(/\]/g, '］')
        .replace(/\{/g, '｛').replace(/\}/g, '｝')
        .replace(/"/g, '”').replace(/`/g, '‘')
        .replace(/:::/g, '：：：');
    return s || '（無題）';
}

/**
 * 描くノードを集め、Mermaidのmindmapの文を作る。
 *
 * (2) インプット: mainData, centerId（''なら「全体」＝最上位の行のうち子を持つものを1段目にする）,
 *                 depth（中心から何段目まで。0＝全部）, showDone
 * (3) メイン: 中心から深さ優先で子をたどり、1ノード1〜2行（ノード＋ステータスのクラス）を書く。
 *             Mermaidは書いた順にSVGのノードへ node_0, node_1, … と番号を付けるので、同じ順でIDを返す
 * (4) アウトプット: { text: Mermaidの文, ids: 書いた順のタスクID（中心が「全体」なら先頭は ''）, count: ノード数 }
 */
export function buildMindMapSource(mainData, centerId, depth, showDone) {
    const children = buildMindMapChildren(mainData, showDone);
    const byId = new Map(mainData.map(r => [String(r['ID']), r]));
    const lines = ['mindmap'];
    const ids = [];
    const maxLevel = depth > 0 ? depth : Infinity;
    const visited = new Set();

    const writeNode = (row, level, isRoot) => {
        const indent = '  '.repeat(level + 1);
        const label = sanitizeLabel(row ? row['タイトル'] : '全体');
        lines.push(`${indent}n${ids.length}${isRoot ? `((${label}))` : `[${label}]`}`);
        const cls = row ? STATUS_CLASS[row['ステータス']] : '';
        if (cls) lines.push(`${indent}:::${cls}`);
        ids.push(row ? String(row['ID']) : '');
    };
    const walk = (parentId, level) => {
        if (level > maxLevel) return;
        for (const child of children.get(parentId) || []) {
            const id = String(child['ID']);
            if (visited.has(id)) continue; // 親IDが循環していても止まるように
            visited.add(id);
            writeNode(child, level, false);
            walk(id, level + 1);
        }
    };

    if (centerId) {
        const center = byId.get(String(centerId));
        if (!center) return { text: '', ids: [], count: 0 };
        visited.add(String(centerId));
        writeNode(center, 0, true);
        walk(String(centerId), 1);
    } else {
        writeNode(null, 0, true);
        // 「全体」の1段目は、最上位の行のうち子を持つもの（プロジェクト）だけ。親の無い単独のタスクまで並べると埋もれるため
        const roots = (children.get('') || []).filter(r => (children.get(String(r['ID'])) || []).length > 0);
        for (const root of roots) {
            const id = String(root['ID']);
            visited.add(id);
            writeNode(root, 1, false);
            walk(id, 2);
        }
    }
    return { text: lines.join('\n'), ids, count: ids.length };
}

/**
 * 中心を選ぶプルダウンの1段分の選択肢：その親の子のうち、さらに子を持つもの（枝）。
 * 選択中の値が葉でも消えないよう、currentId は必ず含める。
 *
 * (2) インプット: children（buildMindMapChildrenの結果）, parentId（''＝最上位）, currentId
 * (4) アウトプット: row[]
 */
export function getMindMapBranchOptions(children, parentId, currentId) {
    return (children.get(parentId) || []).filter(r =>
        (children.get(String(r['ID'])) || []).length > 0 || String(r['ID']) === String(currentId || ''));
}
