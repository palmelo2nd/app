// (1) インポート — なし（ノートの読み方は呼び出し側から関数で受け取る）
//
// グラフ表示のデータを組み立てる（画面は触らない）。ノード＝ノート（とタグ）、線＝[[リンク]]（とタグの付与）。
// 絞り込み：分類・タグ・キーワード・孤立ノートを隠す。範囲：全体／中心のノートからつながりの深さ（1〜2段）まで。

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a']; // dataviz既定の1〜3番（全ペア判定で3色まで。検証済み）
export const OTHER_COLOR = '#9ca3af';                           // その他・タグのノード

/**
 * グラフのノードと線を作る。
 * (2) インプット:
 *   notes — ノートの配列
 *   opts  — { centerKey, scope:'local'|'all', depth:1|2, category, tag, terms, hideIsolated, linkTags }
 *   h     — { noteKey, noteTitle, allTags, noteLinks, normTitle, matchesSearch }
 * (4) アウトプット: { nodes:[{ id, kind:'note'|'tag', key?, label, category?, tags?, center?, degree }], links:[{ source, target, kind }] }
 */
export function buildGraph(notes, opts, h) {
    const center = opts.centerKey ? notes.find(n => h.noteKey(n) === opts.centerKey) : null;
    const visible = notes.filter(n => n === center || (
        (!opts.category || n.meta.category === opts.category)
        && (!opts.tag || h.allTags(n).includes(opts.tag))
        && h.matchesSearch(n, opts.terms || [])
    ));

    // [[題名]]／[[ID]] → ノート（絞り込みの外のノートへの線は引かない）
    const byTitle = new Map();
    visible.forEach(n => {
        byTitle.set(h.normTitle(h.noteTitle(n)), n);
        if (n.meta.id) byTitle.set(h.normTitle(n.meta.id), n);
    });

    const nodes = new Map();
    const links = [];
    const linkSeen = new Set();
    const nodeIdOf = (n) => `n:${h.noteKey(n)}`;
    visible.forEach(n => nodes.set(nodeIdOf(n), {
        id: nodeIdOf(n), kind: 'note', key: h.noteKey(n), label: h.noteTitle(n),
        category: n.meta.category || '', tags: h.allTags(n), center: n === center, degree: 0
    }));
    const addLink = (a, b, kind) => {
        if (a === b) return;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (linkSeen.has(k)) return;
        linkSeen.add(k);
        links.push({ source: a, target: b, kind });
    };
    visible.forEach(n => {
        h.noteLinks(n).forEach(t => {
            const to = byTitle.get(t);
            if (to) addLink(nodeIdOf(n), nodeIdOf(to), 'link');
        });
        if (opts.linkTags) {
            h.allTags(n).forEach(tag => {
                const id = `t:${tag}`;
                if (!nodes.has(id)) nodes.set(id, { id, kind: 'tag', label: `#${tag}`, tag, degree: 0 });
                addLink(nodeIdOf(n), id, 'tag');
            });
        }
    });

    let keep = new Set(nodes.keys());
    // 中心のノートから深さdepthまで（線を両向きにたどる）
    if (opts.scope === 'local' && center) {
        const adj = new Map([...nodes.keys()].map(id => [id, []]));
        links.forEach(l => { adj.get(l.source).push(l.target); adj.get(l.target).push(l.source); });
        keep = new Set([nodeIdOf(center)]);
        let frontier = [nodeIdOf(center)];
        for (let d = 0; d < (opts.depth || 1); d++) {
            const next = [];
            frontier.forEach(id => adj.get(id).forEach(nb => { if (!keep.has(nb)) { keep.add(nb); next.push(nb); } }));
            frontier = next;
        }
    }
    let outLinks = links.filter(l => keep.has(l.source) && keep.has(l.target));
    outLinks.forEach(l => { nodes.get(l.source).degree++; nodes.get(l.target).degree++; });
    let outNodes = [...keep].map(id => nodes.get(id));
    // タグのノードは、つながるノートが無ければ出さない。孤立ノートを隠すなら、線の無いノートも出さない（中心は残す）
    outNodes = outNodes.filter(n => n.degree > 0 || (n.kind === 'note' && (!opts.hideIsolated || n.center)));
    return { nodes: outNodes, links: outLinks };
}

/**
 * ノードの色の付け方を決める。分類で色分けするなら仕事・自分、タグで色分けするなら件数の多いタグ3つ（それ以外は「その他」）。
 * 色はノートの分類・タグに付く（件数の順位が変わっても、同じ分類には同じ色。タグは表示中の上位3つ）。
 * (2) インプット: nodes, mode:'category'|'tag', categories（分類の並び）
 * (4) アウトプット: { colorOf(node) → 色, legend:[{ label, color }] }
 */
export function colorScheme(nodes, mode, categories) {
    if (mode === 'tag') {
        const counts = new Map();
        nodes.filter(n => n.kind === 'note').forEach(n => n.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, SERIES_COLORS.length).map(([t]) => t);
        const colorOf = (n) => {
            if (n.kind === 'tag') return top.includes(n.tag) ? SERIES_COLORS[top.indexOf(n.tag)] : OTHER_COLOR;
            const hit = top.find(t => n.tags.includes(t));
            return hit ? SERIES_COLORS[top.indexOf(hit)] : OTHER_COLOR;
        };
        return { colorOf, legend: [...top.map((t, i) => ({ label: `#${t}`, color: SERIES_COLORS[i] })), { label: 'その他', color: OTHER_COLOR }] };
    }
    const cats = categories.slice(0, SERIES_COLORS.length);
    const colorOf = (n) => (n.kind === 'note' && cats.includes(n.category)) ? SERIES_COLORS[cats.indexOf(n.category)] : OTHER_COLOR;
    return { colorOf, legend: [...cats.map((c, i) => ({ label: c, color: SERIES_COLORS[i] })), { label: 'タグ・その他', color: OTHER_COLOR }] };
}
