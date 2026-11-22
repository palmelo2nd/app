// Mermaid図（マインドマップ・フローチャート）を大きく見るための部品（2026-11-22、brain #-19）。
// (1) 本文中の図は画面の幅に合わせて縮めて描く（全体が見えるように。原寸より大きくはしない）
// (2) 図を押すと全画面で開き、指で拡大・移動できる（2本指でつまむ・1本指でずらす。パソコンはホイールとドラッグ）
// book.js・shelf.js の renderMermaidBlocks から呼ぶ。

/**
 * 描き終えたMermaid図を、幅に合わせて縮め、押すと全画面で開けるようにする。
 *
 * (2) インプット: nodes — mermaid.run で描いた div.mermaid の配列
 * (3) メイン: svgの幅を枠いっぱい（上限は原寸）にし、押したら openDiagramViewer を呼ぶ
 * (4) アウトプット: なし（DOMを書き換える）
 */
export function makeDiagramsZoomable(nodes) {
    for (const node of nodes) {
        const svg = node.querySelector('svg');
        if (!svg) continue;
        // mermaidは style.maxWidth に原寸の幅を入れる。幅は枠に合わせ、原寸より大きくはしない
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.minWidth = '';
        node.classList.add('mermaid-zoomable');
        node.title = '押すと全画面で開きます';
        node.addEventListener('click', () => openDiagramViewer(svg));
    }
}

/** svgの原寸（viewBoxの幅・高さ）。無ければ描いた大きさ。 */
function naturalSize(svg) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
    const r = svg.getBoundingClientRect();
    return { w: r.width || 800, h: r.height || 600 };
}

/**
 * 図を全画面で開く。閉じるボタン・Escで閉じる。
 *
 * (2) インプット: svg — 本文中の図
 * (3) メイン: 図の写しを重ね表示の上に置き、transform（移動・倍率）で拡大・移動する
 * (4) アウトプット: なし
 */
export function openDiagramViewer(svg) {
    const { w, h } = naturalSize(svg);

    const overlay = document.createElement('div');
    overlay.className = 'diagram-viewer';
    overlay.innerHTML = `
        <div class="diagram-viewer-bar">
            <button type="button" data-act="out" aria-label="縮小">－</button>
            <button type="button" data-act="in" aria-label="拡大">＋</button>
            <button type="button" data-act="fit">全体</button>
            <button type="button" data-act="close">閉じる</button>
        </div>
        <div class="diagram-viewer-stage"><div class="diagram-viewer-canvas mermaid"></div></div>`;
    const stage = overlay.querySelector('.diagram-viewer-stage');
    const canvas = overlay.querySelector('.diagram-viewer-canvas');

    // 写しは原寸で置き、倍率はtransformで変える（mermaidの<style>は図のidで当たるので、idはそのまま）
    const copy = svg.cloneNode(true);
    copy.removeAttribute('style');
    copy.setAttribute('width', w);
    copy.setAttribute('height', h);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.appendChild(copy);

    document.body.appendChild(overlay);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let scale = 1, x = 0, y = 0;
    const apply = () => { canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
    const fit = () => {
        const sw = stage.clientWidth, sh = stage.clientHeight;
        scale = Math.min(sw / w, sh / h) * 0.95;
        x = (sw - w * scale) / 2;
        y = (sh - h * scale) / 2;
        apply();
    };
    // 画面上の点(px,py)を動かさずに倍率をfactor倍にする
    const zoomAt = (factor, px, py) => {
        const next = Math.min(Math.max(scale * factor, 0.05), 20);
        factor = next / scale;
        x = px - (px - x) * factor;
        y = py - (py - y) * factor;
        scale = next;
        apply();
    };
    const center = () => ({ px: stage.clientWidth / 2, py: stage.clientHeight / 2 });

    // 指・マウスの操作：1本でずらす、2本でつまんで拡大縮小
    const pointers = new Map();
    let last = null; // { x, y, dist }
    const stagePoint = (e) => {
        const r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const gesture = () => {
        const ps = [...pointers.values()];
        if (ps.length === 1) return { x: ps[0].x, y: ps[0].y, dist: 0 };
        const [a, b] = ps;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    stage.addEventListener('pointerdown', (e) => {
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, stagePoint(e));
        last = gesture();
    });
    stage.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, stagePoint(e));
        const g = gesture();
        if (last) {
            x += g.x - last.x;
            y += g.y - last.y;
            apply();
            if (pointers.size >= 2 && last.dist > 0 && g.dist > 0) zoomAt(g.dist / last.dist, g.x, g.y);
        }
        last = g;
    });
    const release = (e) => {
        pointers.delete(e.pointerId);
        last = pointers.size ? gesture() : null;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = stagePoint(e);
        zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
    // ダブルタップ（ダブルクリック）でその場所を2倍に
    stage.addEventListener('dblclick', (e) => {
        const p = stagePoint(e);
        zoomAt(2, p.x, p.y);
    });

    const close = () => {
        overlay.remove();
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', fit);
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        // 開いている間は、本のページ送り（左右の矢印）を効かせない
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', fit);

    overlay.querySelector('.diagram-viewer-bar').addEventListener('click', (e) => {
        const act = e.target.closest('button')?.dataset.act;
        if (act === 'close') close();
        else if (act === 'fit') fit();
        else if (act === 'in') { const c = center(); zoomAt(1.4, c.px, c.py); }
        else if (act === 'out') { const c = center(); zoomAt(1 / 1.4, c.px, c.py); }
    });

    fit();
}
