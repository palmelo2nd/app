// (1) インポート — なし
// スキルマップのデータ（Front Matter JSONの mapData）と、マインドマップの配置計算。画面には触らない。
// 1つの枝＝1レコード：{ ID, 親ID, 名前, 状態, メモ, 並び順, 更新者, 更新日時, リンク? }。中心はID 'root'（親IDは空、状態なし）。
// リンク（任意）：{ 名前, URL }。その枝に関係する補助アプリ（例：操作ノート）への入口。アプリからは変えず、データに直接書く

export const STATES = ['未着手', '取り組み中', '身についた'];
export const ROOT_ID = 'root';

// 最初の形（lab #1570で決定、2026-11-18）。2段目以降は後から足す
export function defaultMap() {
    const branches = ['健康なからだ', 'コミュニケーション', 'できることを増やす', '楽しみ・経験'];
    return {
        mapData: [
            { ID: ROOT_ID, 親ID: '', 名前: '仲良くなる', 状態: '', メモ: '', 並び順: 0, 更新者: '', 更新日時: '' },
            ...branches.map((name, i) => ({ ID: `n${i + 1}`, 親ID: ROOT_ID, 名前: name, 状態: '未着手', メモ: '', 並び順: i + 1, 更新者: '', 更新日時: '' })),
        ],
    };
}

/**
 * Front Matter（JSON）をパースする。
 * (2) インプット: markdown  (4) アウトプット: { data, tail }
 */
export function parseFrontMatter(markdown) {
    const match = (markdown || '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { data: defaultMap(), tail: '\n' };
    return { data: JSON.parse(match[1]), tail: markdown.replace(/\r\n/g, '\n').slice(match[0].length) || '\n' };
}

export function stringify(data, tail) {
    return `---\n${JSON.stringify(data, null, 2)}\n---${tail || '\n'}`;
}

export function childrenOf(nodes, id) {
    return nodes.filter(n => n['親ID'] === id).sort((a, b) => (a['並び順'] || 0) - (b['並び順'] || 0));
}

// 子孫（自分を含む）
export function subtree(nodes, id) {
    const out = [];
    const walk = (nid) => {
        const node = nodes.find(n => n.ID === nid);
        if (!node) return;
        out.push(node);
        childrenOf(nodes, nid).forEach(c => walk(c.ID));
    };
    walk(id);
    return out;
}

// 状態ごとの数（中心は数えない）
export function countStates(nodes) {
    const counts = Object.fromEntries(STATES.map(s => [s, 0]));
    nodes.forEach(n => { if (n.ID !== ROOT_ID && counts[n['状態']] !== undefined) counts[n['状態']]++; });
    return counts;
}

function nowStamp() {
    const d = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function newId(nodes) {
    const max = nodes.reduce((m, n) => Math.max(m, Number((n.ID.match(/^n(\d+)$/) || [])[1] || 0)), 0);
    return `n${max + 1}`;
}

/**
 * 1回の操作をデータに当てる（保存の直前に、取り直した最新のデータへ当て直すため純粋な関数にしている）。
 * (2) インプット: data, op（{type:'add'|'update'|'delete', ...}）, who
 * (4) アウトプット: { data, id }（追加した枝のIDなど）。当てられないときは error を投げる
 */
export function applyOp(data, op, who) {
    const nodes = data.mapData.map(n => ({ ...n }));
    const stamp = nowStamp();
    if (op.type === 'add') {
        if (!nodes.some(n => n.ID === op.parentId)) throw new Error('もとの枝が見つかりません（他の人が消した可能性があります）');
        const id = newId(nodes);
        const siblings = childrenOf(nodes, op.parentId);
        nodes.push({ ID: id, 親ID: op.parentId, 名前: op.name, 状態: '未着手', メモ: '', 並び順: siblings.length + 1, 更新者: who, 更新日時: stamp });
        return { data: { ...data, mapData: nodes }, id };
    }
    const node = nodes.find(n => n.ID === op.id);
    if (!node) throw new Error('この枝が見つかりません（他の人が消した可能性があります）');
    if (op.type === 'update') {
        Object.assign(node, op.fields, { 更新者: who, 更新日時: stamp });
        return { data: { ...data, mapData: nodes }, id: node.ID };
    }
    if (op.type === 'delete') {
        if (node.ID === ROOT_ID) throw new Error('まん中は消せません');
        if (childrenOf(nodes, node.ID).length) throw new Error('先の枝があるので消せません。先の枝から消してください');
        return { data: { ...data, mapData: nodes.filter(n => n.ID !== node.ID) }, id: node['親ID'] };
    }
    throw new Error(`知らない操作です: ${op.type}`);
}

/**
 * マインドマップの配置（放射状）。葉の数に合わせて角度を割り当て、深さごとに外へ広げる。
 * (2) インプット: nodes  (4) アウトプット: { pos: {ID: {x, y, depth, angle}}, bounds: {minX, minY, maxX, maxY} }
 */
export function layout(nodes, ring = 150) {
    const leaves = {};
    const countLeaves = (id) => {
        const kids = childrenOf(nodes, id);
        leaves[id] = kids.length ? kids.reduce((s, k) => s + countLeaves(k.ID), 0) : 1;
        return leaves[id];
    };
    countLeaves(ROOT_ID);
    const pos = { [ROOT_ID]: { x: 0, y: 0, depth: 0, angle: 0 } };
    const place = (id, from, to, depth) => {
        const kids = childrenOf(nodes, id);
        const total = kids.reduce((s, k) => s + leaves[k.ID], 0) || 1;
        let a = from;
        kids.forEach(k => {
            const span = (to - from) * leaves[k.ID] / total;
            const mid = a + span / 2;
            // 1段目は少し離し、その先は段ごとに少しずつ詰める
            const r = depth === 1 ? ring : ring + (depth - 1) * ring * 0.85;
            pos[k.ID] = { x: Math.cos(mid) * r, y: Math.sin(mid) * r, depth, angle: mid };
            place(k.ID, a, a + span, depth + 1);
            a += span;
        });
    };
    // 上から時計回り（1つ目の枝が右上に来るよう、少しずらして始める）
    place(ROOT_ID, -Math.PI / 2 - Math.PI / 4, Math.PI * 3 / 2 - Math.PI / 4, 1);
    const xs = Object.values(pos).map(p => p.x);
    const ys = Object.values(pos).map(p => p.y);
    return { pos, bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } };
}
