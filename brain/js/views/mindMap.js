// MM（マインドマップ）タブ（2026-11-24、brain #-37。計画書：app_data/docs/brain/261124_MMタブ.md）
// 親IDの階層をMermaidのmindmapで描く。中心はプルダウンで上の階層から掘り下げて選ぶ。ノードを押すと「中心にする」「編集」のメニュー。
// 描くノードの計算は js/modules/mindMap.js、全画面・拡大は js/views/diagramZoom.js。
//
// (2) インプット: ctx = {
//   getMainData()          — 現在のmainData
//   buildPathFromId(id)    — 行IDから、最上位→その行までのIDの配列（app.jsのbuildProject2PathFromId）
//   selectTask(id)         — タスクを単独選択して編集フォームに読み込む（app.jsのselectTaskorg2TaskFromView）
//   getCategory()          — 上のカテゴリの選択（'すべて'・仕事・家庭・自分。2026-11-24追加）
// }
// 中心・深さ・完了の切替は、このビューの中だけで持つ（保存しない）。

// (1) インポート
import {
    buildMindMapSource, buildMindMapChildren, getMindMapBranchOptions,
    MIND_MAP_DEPTH_OPTIONS, MIND_MAP_DEFAULT_DEPTH
} from '../modules/mindMap.js?v=87';
import { openDiagramViewer } from './diagramZoom.js?v=87';

// mermaidは重いので、MMタブを開いたときだけCDNから読む（readingと同じ版）
let mermaidPromise = null;
function loadMermaid() {
    if (!mermaidPromise) {
        mermaidPromise = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
            .then(m => {
                m.default.initialize({ startOnLoad: false, securityLevel: 'strict', mindmap: { maxNodeWidth: 160 } });
                return m.default;
            })
            .catch(error => { mermaidPromise = null; throw error; });
    }
    return mermaidPromise;
}

export function createMindMapView(ctx) {
    let centerPath = [];          // 中心の行まで、最上位からのIDの配列（空＝全体）
    let depth = MIND_MAP_DEFAULT_DEPTH;
    let showDone = false;
    let lastSource = null;        // 前回描いたMermaidの文（同じなら描き直さない）
    let lastIds = [];
    let renderSeq = 0;            // 描画の追い越し防止

    const panelEl  = () => document.getElementById('mindmap-map');
    const statusEl = () => document.getElementById('mindmap-status');

    // ---- 上の操作（中心のプルダウン・深さ・完了・全画面） ----

    function renderControls(children) {
        const container = document.getElementById('mindmap-center-dropdowns');
        if (!container) return;
        container.innerHTML = '';
        const byId = new Map(ctx.getMainData().map(r => [String(r['ID']), r]));
        let parentId = '';
        for (let level = 0; ; level++) {
            const current = centerPath[level] || '';
            let options = getMindMapBranchOptions(children, parentId, current);
            // 完了を隠していても、選んだ中心（完了の行）はプルダウンに残す
            if (current && !options.some(r => String(r['ID']) === current) && byId.get(current)) options = [...options, byId.get(current)];
            if (options.length === 0 && !current) break;

            const row = document.createElement('div');
            row.className = 'calendar-edit-row';
            const label = document.createElement('label');
            label.textContent = level === 0 ? '中心' : `${level + 1}層`;
            const select = document.createElement('select');
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = level === 0 ? '（全体）' : '（ここまで）';
            select.appendChild(blank);
            options.forEach(r => {
                const opt = document.createElement('option');
                opt.value = String(r['ID']);
                opt.textContent = r['タイトル'] || '（無題）';
                select.appendChild(opt);
            });
            select.value = current;
            const lv = level;
            select.addEventListener('change', () => {
                centerPath = select.value ? [...centerPath.slice(0, lv), select.value] : centerPath.slice(0, lv);
                render();
            });
            row.append(label, select);
            container.appendChild(row);
            if (!current) break;
            parentId = current;
        }

        const depthSel = document.getElementById('mindmap-depth');
        if (depthSel && depthSel.options.length === 0) {
            MIND_MAP_DEPTH_OPTIONS.forEach(n => {
                const opt = document.createElement('option');
                opt.value = String(n);
                opt.textContent = n === 0 ? '全部' : `${n}段`;
                depthSel.appendChild(opt);
            });
            depthSel.addEventListener('change', () => { depth = Number(depthSel.value); render(); });
        }
        if (depthSel) depthSel.value = String(depth);
        const doneChk = document.getElementById('mindmap-show-done');
        if (doneChk && !doneChk.dataset.wired) {
            doneChk.dataset.wired = '1';
            doneChk.addEventListener('change', () => { showDone = doneChk.checked; render(); });
        }
        if (doneChk) doneChk.checked = showDone;
        const fullBtn = document.getElementById('mindmap-fullscreen-btn');
        if (fullBtn && !fullBtn.dataset.wired) {
            fullBtn.dataset.wired = '1';
            fullBtn.addEventListener('click', () => {
                const svg = panelEl()?.querySelector('svg');
                if (svg) openDiagramViewer(svg, 'mm-map');
            });
        }
    }

    // ---- ノードのメニュー ----

    function closeMenu() {
        document.getElementById('mindmap-node-menu')?.remove();
    }

    function openMenu(taskId, x, y) {
        closeMenu();
        const panel = panelEl();
        if (!panel) return;
        const row = ctx.getMainData().find(r => String(r['ID']) === taskId);
        const menu = document.createElement('div');
        menu.id = 'mindmap-node-menu';
        menu.className = 'mm-node-menu';
        const title = document.createElement('div');
        title.className = 'mm-node-menu-title';
        title.textContent = `#${taskId} ${row ? row['タイトル'] || '' : ''}`;
        const centerBtn = document.createElement('button');
        centerBtn.type = 'button';
        centerBtn.textContent = '中心にする';
        centerBtn.addEventListener('click', () => {
            closeMenu();
            centerPath = ctx.buildPathFromId(taskId);
            render();
        });
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = '編集';
        editBtn.addEventListener('click', () => {
            closeMenu();
            ctx.selectTask(taskId);
            document.getElementById('dayedit2-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', '閉じる');
        closeBtn.addEventListener('click', closeMenu);
        menu.append(title, centerBtn, editBtn, closeBtn);
        panel.appendChild(menu);
        // 押した場所の近くに出す（枠からはみ出さないように寄せる）
        const pr = panel.getBoundingClientRect();
        const left = Math.min(Math.max(x - pr.left, 4), Math.max(pr.width - menu.offsetWidth - 4, 4));
        const top = Math.min(y - pr.top + 8, Math.max(pr.height - menu.offsetHeight - 4, 4));
        menu.style.left = `${left}px`;
        menu.style.top = `${Math.max(top, 4)}px`;
    }

    function wireNodes(svg, ids, prefix) {
        ids.forEach((taskId, i) => {
            if (!taskId) return; // 「全体」の中心は押しても何もしない
            const g = svg.querySelector(`#${CSS.escape(`${prefix}-node_${i}`)}`);
            if (!g) return;
            g.classList.add('mm-node-clickable');
            g.addEventListener('click', (e) => {
                e.stopPropagation();
                openMenu(taskId, e.clientX, e.clientY);
            });
        });
    }

    // ---- 描画 ----

    async function render() {
        const panel = panelEl();
        if (!panel) return;
        const mainData = ctx.getMainData();
        const category = ctx.getCategory();
        const children = buildMindMapChildren(mainData, showDone, category);
        renderControls(children);

        const centerId = centerPath[centerPath.length - 1] || '';
        const { text, ids, count } = buildMindMapSource(mainData, centerId, depth, showDone, category);
        if (statusEl()) statusEl().textContent = count ? `${count}件` : '';
        if (text === lastSource && panel.querySelector('svg')) return; // 中身が同じなら描き直さない
        if (!text || count === 0) {
            closeMenu();
            panel.innerHTML = '<p class="calendar-dayplan-hint">描く行がありません。</p>';
            lastSource = text;
            return;
        }

        const seq = ++renderSeq;
        let mermaid;
        try {
            mermaid = await loadMermaid();
        } catch (error) {
            console.error(error);
            panel.innerHTML = '<p class="calendar-dayplan-hint">マップの部品（Mermaid）を読み込めませんでした。電波のある所で開き直してください。</p>';
            return;
        }
        if (seq !== renderSeq) return;
        const prefix = `mm${seq}`;
        try {
            const { svg } = await mermaid.render(prefix, text);
            if (seq !== renderSeq) return;
            closeMenu();
            panel.innerHTML = svg;
        } catch (error) {
            console.error(error, text);
            panel.innerHTML = '<p class="calendar-dayplan-hint">マップを描けませんでした。</p>';
            return;
        }
        lastSource = text;
        lastIds = ids;
        const svgEl = panel.querySelector('svg');
        if (svgEl) {
            // 画面の幅に合わせて縮めて全体を見せる（原寸より大きくはしない。mermaidがmax-widthに原寸を入れる）
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
            wireNodes(svgEl, lastIds, prefix);
        }
    }

    // マップの外を押したらメニューを閉じる
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('mindmap-node-menu');
        if (menu && !menu.contains(e.target) && !e.target.closest?.('.mm-node-clickable')) closeMenu();
    });

    return { render };
}
