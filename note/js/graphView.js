// (1) インポート — グラフのデータ組み立て（modules/graph.js）。描画はforce-graph（js/vendor、index.htmlで読み込み済みの window.ForceGraph）
import { buildGraph, colorScheme } from './modules/graph.js?v=4';

/**
 * グラフ画面（ノートのつながり）。URLの #graph（全体）／#graph:<ノートID>（そのノートの周り）で開く。
 * (2) インプット: ctx = {
 *   container（描画先の要素）, getNotes(), noteKey, noteTitle, allTags, noteLinks, normTitle, matchesSearch,
 *   normalizeForSearch, escapeHtml, categories
 * }
 * (4) アウトプット: { open(centerKey), close(), render() }
 */
export function createGraphView(ctx) {
    const { container, escapeHtml } = ctx;
    // 絞り込みと色分け（この画面を開いている間・閉じても端末のメモリ上は覚えておく）
    const opts = { scope: 'local', depth: 1, category: '', tag: '', keyword: '', hideIsolated: false, linkTags: true, color: 'category' };
    let centerKey = '';
    let graph = null;      // ForceGraphのインスタンス
    let fitPending = false;
    let resizeTimer = null;

    function helpers() {
        return { noteKey: ctx.noteKey, noteTitle: ctx.noteTitle, allTags: ctx.allTags, noteLinks: ctx.noteLinks, normTitle: ctx.normTitle, matchesSearch: ctx.matchesSearch };
    }

    function chip(group, value, label, active) {
        return `<button type="button" class="chip${active ? ' active' : ''}" data-graph="${group}" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    }

    function tagOptions() {
        const counts = new Map();
        ctx.getNotes().forEach(n => ctx.allTags(n).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
            .map(([t, c]) => `<option value="${escapeHtml(t)}"${t === opts.tag ? ' selected' : ''}>${escapeHtml(t)}（${c}）</option>`).join('');
    }

    /** 画面の枠（見出し・操作部品・描画先・凡例）を作る。開いたときだけ（描画先の要素を作り直さないため）。 */
    function renderShell() {
        container.innerHTML = `<div class="panel graph-panel">
            <div class="note-head">
              <button type="button" class="btn btn-sub btn-small back-btn graph-back" data-graph-action="back">← 戻る</button>
              <h2 class="note-title" id="graph-title"></h2>
            </div>
            <div class="graph-controls" id="graph-controls"></div>
            <div class="graph-canvas" id="graph-canvas"></div>
            <div class="graph-legend" id="graph-legend"></div>
            <p class="graph-note">ノートを押すと開きます。タグ（小さな点）を押すと、そのタグで絞り込みます。指でつまんで拡大・ドラッグで移動できます。</p>
          </div>`;
        renderControls();
    }

    /** 見出しと操作部品を、今の絞り込みに合わせて描き直す（「絞り込み・色分け」の開閉はそのまま）。 */
    function renderControls() {
        const center = centerKey ? ctx.getNotes().find(n => ctx.noteKey(n) === centerKey) : null;
        const local = opts.scope === 'local' && center;
        const titleEl = document.getElementById('graph-title');
        const controlsEl = document.getElementById('graph-controls');
        if (!titleEl || !controlsEl) return;
        const wasOpen = controlsEl.querySelector('details')?.open;
        const filtered = !!(opts.category || opts.tag || opts.keyword || opts.hideIsolated);
        titleEl.innerHTML = `グラフ${center ? `<span class="graph-center-name">：${escapeHtml(ctx.noteTitle(center))}</span>` : ''}`;
        controlsEl.innerHTML = `
              <div class="chips">
                ${center ? chip('scope', 'local', 'このノートの周り', !!local) : ''}${chip('scope', 'all', '全体', !local)}
                ${local ? `<span class="graph-sep"></span>${chip('depth', '1', '1段', opts.depth === 1)}${chip('depth', '2', '2段', opts.depth === 2)}` : ''}
              </div>
              <details class="graph-filter"${(wasOpen ?? filtered) ? ' open' : ''}>
                <summary>絞り込み・色分け${filtered ? '（絞り込み中）' : ''}</summary>
                <div class="graph-filter-body">
                  <div class="chips">${chip('category', '', 'すべて', !opts.category)}${ctx.categories.map(c => chip('category', c, c, opts.category === c)).join('')}</div>
                  <div class="graph-row">
                    <select class="form-select" data-graph-input="tag" aria-label="タグで絞り込み"><option value="">すべてのタグ</option>${tagOptions()}</select>
                    <input type="search" class="form-input" data-graph-input="keyword" placeholder="キーワード" value="${escapeHtml(opts.keyword)}">
                  </div>
                  <div class="graph-row">
                    <label class="graph-check"><input type="checkbox" data-graph-input="hideIsolated"${opts.hideIsolated ? ' checked' : ''}> つながりの無いノートを隠す</label>
                    <label class="graph-check"><input type="checkbox" data-graph-input="linkTags"${opts.linkTags ? ' checked' : ''}> 同じタグのノートをつなぐ</label>
                  </div>
                  <div class="chips"><span class="graph-label">色</span>${chip('color', 'category', '分類', opts.color === 'category')}${chip('color', 'tag', 'タグ', opts.color === 'tag')}</div>
                </div>
              </details>`;
    }

    function currentData() {
        return buildGraph(ctx.getNotes(), {
            centerKey, scope: opts.scope, depth: opts.depth, category: opts.category, tag: opts.tag,
            terms: opts.keyword.split(/\s+/).map(ctx.normalizeForSearch).filter(Boolean),
            hideIsolated: opts.hideIsolated, linkTags: opts.linkTags
        }, helpers());
    }

    function canvasSize(el) {
        const width = el.clientWidth || 320;
        const height = Math.round(Math.min(620, Math.max(320, window.innerHeight * 0.6)));
        return { width, height };
    }

    const MAX_FIT_ZOOM = 2;

    /** 点の半径（グラフ上の大きさ）。縮小しても画面上で小さくなりすぎないよう、倍率が1未満なら割り戻す。 */
    function nodeRadius(n, scale = 1) {
        const r = n.kind === 'tag' ? 3 : (n.center ? 7 : 4) + Math.min(n.degree, 8) * 0.4;
        return scale < 1 ? r / scale : r;
    }

    /** グラフを描き直す（データ・色・凡例）。枠はそのまま。 */
    function draw() {
        const el = document.getElementById('graph-canvas');
        const legendEl = document.getElementById('graph-legend');
        if (!el) return;
        if (typeof window.ForceGraph !== 'function') {
            el.innerHTML = '<p class="placeholder">グラフの部品を読み込めませんでした。「キャッシュ更新」を押してから開き直してください。</p>';
            return;
        }
        const data = currentData();
        const { colorOf, legend } = colorScheme(data.nodes, opts.color, ctx.categories);
        const noteCount = data.nodes.filter(n => n.kind === 'note').length;
        const linkCount = data.links.filter(l => l.kind === 'link').length;
        legendEl.innerHTML = legend.map(l => `<span class="graph-legend-item"><span class="graph-dot" style="background:${l.color}"></span>${escapeHtml(l.label)}</span>`).join('')
            + `<span class="graph-count">ノート${noteCount}件・リンク${linkCount}本</span>`;
        if (noteCount === 0) {
            if (graph) { graph._destructor(); graph = null; }
            el.innerHTML = '<p class="placeholder">条件に合うノートがありません。</p>';
            return;
        }

        const showAllLabels = opts.scope === 'local' || data.nodes.length <= 25;
        if (!graph) {
            el.innerHTML = '';
            const { width, height } = canvasSize(el);
            graph = new window.ForceGraph(el)
                .width(width).height(height)
                .backgroundColor('#ffffff')
                .nodeId('id')
                .nodeLabel(n => escapeHtml(n.label))
                .linkColor(l => l.kind === 'tag' ? '#e5e8ee' : '#b8c0cc')
                .linkWidth(l => l.kind === 'tag' ? 1 : 2)
                .cooldownTicks(120)
                .onEngineStop(() => {
                    if (!fitPending) return;
                    fitPending = false;
                    graph.zoomToFit(400, 50);
                    // ノートが少ないと拡大しすぎるので、2倍までに抑える
                    setTimeout(() => { if (graph && graph.zoom() > MAX_FIT_ZOOM) graph.zoom(MAX_FIT_ZOOM, 300); }, 450);
                })
                .onNodeClick(n => {
                    if (n.kind === 'note') location.hash = `#${encodeURIComponent(n.key)}`;
                    else { opts.tag = n.tag; renderControls(); draw(); }
                });
            // 既定より強く押し広げ、線を長めにする（ラベルの重なりを減らすため）
            graph.d3Force('charge').strength(-90);
            graph.d3Force('link').distance(l => l.kind === 'tag' ? 35 : 55);
        }
        graph
            .nodePointerAreaPaint((n, color, c) => { // 押せる範囲は点より大きく
                c.fillStyle = color;
                c.beginPath(); c.arc(n.x, n.y, nodeRadius(n, graph.zoom()) + 5, 0, 2 * Math.PI); c.fill();
            })
            .nodeCanvasObject((n, c, scale) => {
                const r = nodeRadius(n, scale);
                c.beginPath(); c.arc(n.x, n.y, r + 1.5 / scale, 0, 2 * Math.PI); c.fillStyle = '#ffffff'; c.fill(); // 重なりを見分ける白い縁
                c.beginPath(); c.arc(n.x, n.y, r, 0, 2 * Math.PI); c.fillStyle = colorOf(n); c.fill();
                if (n.center) { c.lineWidth = 2 / scale; c.strokeStyle = '#1a2744'; c.stroke(); }
                if (n.kind === 'tag' && !showAllLabels && scale < 2) return;
                if (!showAllLabels && !n.center && scale < 1.4) return;
                const fontSize = (n.center ? 13 : 11) / scale;
                c.font = `${n.center ? '700 ' : ''}${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
                c.textAlign = 'center'; c.textBaseline = 'top';
                const text = n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label;
                c.fillStyle = n.kind === 'tag' ? '#6b7280' : '#333333'; // 文字は文字の色（系列の色にしない）
                c.fillText(text, n.x, n.y + r + 2 / scale);
            })
            .graphData(data);
        fitPending = true;
    }

    function onControl(e) {
        const btn = e.target.closest('[data-graph]');
        if (btn) {
            const { graph: key, value } = btn.dataset;
            if (key === 'depth') opts.depth = Number(value);
            else opts[key] = value;
            renderControls(); draw();
            return;
        }
        if (e.target.closest('[data-graph-action="back"]')) {
            if (history.length > 1) history.back(); else location.hash = '';
        }
    }

    function onInput(e) {
        const input = e.target.closest('[data-graph-input]');
        if (!input) return;
        const key = input.dataset.graphInput;
        opts[key] = input.type === 'checkbox' ? input.checked : input.value;
        if (key === 'keyword') { if (e.type === 'input') draw(); return; } // 入力中に部品を作り直すと文字が消えるため、グラフだけ描き直す
        if (e.type === 'input' && (input.tagName === 'SELECT' || input.type === 'checkbox')) return; // changeだけで処理する（二重に描かない）
        renderControls(); draw();
    }

    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const el = document.getElementById('graph-canvas');
            if (graph && el) { const { width, height } = canvasSize(el); graph.width(width).height(height); }
        }, 150);
    }

    let opened = false;
    function open(key) {
        centerKey = key || '';
        if (!centerKey) opts.scope = 'all';
        else if (!opened || centerKey !== open.lastKey) opts.scope = 'local';
        open.lastKey = centerKey;
        if (!opened) {
            container.addEventListener('click', onControl);
            container.addEventListener('input', onInput);
            container.addEventListener('change', onInput);
            window.addEventListener('resize', onResize);
            opened = true;
        }
        if (graph) { graph._destructor(); graph = null; }
        renderShell();
        draw();
    }

    function close() {
        if (!opened) return;
        container.removeEventListener('click', onControl);
        container.removeEventListener('input', onInput);
        container.removeEventListener('change', onInput);
        window.removeEventListener('resize', onResize);
        if (graph) { graph._destructor(); graph = null; }
        opened = false;
    }

    /** ノートが読み込み直されたときなど、表示中ならデータだけ描き直す。 */
    function render() {
        if (!opened) return;
        renderControls();
        draw();
    }

    return { open, close, render, isOpen: () => opened };
}
