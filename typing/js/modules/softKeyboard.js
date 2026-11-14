// (1) インポート — キーボードの中身（配列・変換・判定）
import { LAYOUTS, DIRS, MODE_LABEL, segmentize, newState, pressKey, candidatesOf, pickCandidate, judge } from './kbCore.js?v=61';

// ふりっくふろっく：専用キーボード（アプリ内キーボード）の画面部分。tools/kb-proto.html の試作をアプリ本体用に部品にしたもの（2026-11-11）。
// キーボード・変換の候補・入力中の文字を描き、キーを押すたびに判定して onChange で知らせる。
// 2026-11-14 ユーザー決定：お手本（次に押すキーなどを光らせる機能）と、キーの上下左右の小さい文字は外した。キーには「あ」だけを出す。
// タイム・ミスの数・次の問題へ進む処理は、呼び出し側（app.js のプレイ画面）が持つ。
//
// 使い方：
//   const kb = createSoftKeyboard({ kbEl, typedEl, dict, settings, onChange });
//   kb.setProblem(problem, norm);  // 問題が変わるたび（入力は空に戻す。かな／ABC／☆123の画面は前の問題のまま。iPhoneと同じ）
//   onChange({ result, committedLength })  // result は 'done'|'prefix'|'ng'
//   kb.destroy();                  // プレイをやめる・終わるとき

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * (2) インプット: kbEl（キーボードを描く要素）, typedEl（入力中の文字）, dict（変換の辞書）,
 *     settings { vibrate: boolean }, onChange
 * (4) アウトプット: { setProblem, destroy }
 */
export function createSoftKeyboard({ kbEl, typedEl, dict, settings, onChange }) {
    kbEl.innerHTML = '<div class="skb-cands"></div><div class="skb-grid"></div>';
    const candsEl = kbEl.querySelector('.skb-cands');
    const gridEl = kbEl.querySelector('.skb-grid');

    let st = newState('kana');
    let segs = [];
    let norm = (s) => s;
    let cands = [];
    let wrong = false;
    let alive = true;
    const active = new Map(); // pointerId → { key, el, x0, y0, dir, pop }（押した指ごとに追う）

    const findKey = (id) => LAYOUTS[st.mode].find(k => k.id === id) || { id };
    const buzz = () => { if (settings.vibrate && navigator.vibrate) navigator.vibrate(8); };

    // ===== キーボード（5列×4行。左＝画面切り替え、まん中＝文字、右＝消す・空白・確定） =====
    function buildKeyboard() {
        const cell = (k) => {
            if (k.fn) return `<div class="skb-key fn" data-id="${k.id}">${k.label}</div>`;
            return `<div class="skb-key" data-id="${k.id}">${esc(k.f[0])}</div>`; // キーには真ん中の文字だけ（はらう先は押している間の十字で見せる）
        };
        const keys = LAYOUTS[st.mode];
        const blank = '<div class="skb-key blank"></div>';
        const rows = [0, 1, 2, 3].map(i => keys.slice(i * 3, i * 3 + 3).map(cell).join(''));
        gridEl.innerHTML =
            blank + rows[0] + '<div class="skb-key fn" data-id="del">⌫</div>' +
            blank + rows[1] + '<div class="skb-key fn" data-id="space">空白</div>' +
            `<div class="skb-key fn mode" data-id="mode">${MODE_LABEL[st.mode]}</div>` + rows[2] + '<div class="skb-key fn enter" data-id="enter">確定</div>' +
            blank + rows[3];
    }

    function renderCands() {
        cands = candidatesOf(st.pending, dict);
        candsEl.innerHTML = cands.map((c, i) => `<button type="button" data-i="${i}">${esc(c.text)}</button>`).join('');
        candsEl.scrollLeft = 0;
    }

    function renderTyped() {
        typedEl.innerHTML = esc(st.committed) + (st.pending ? `<span class="pend">${esc(st.pending)}</span>` : '') + '<span class="caret"></span>';
        typedEl.classList.toggle('wrong', wrong);
    }

    // ===== はらう先の文字を大きく出す十字 =====
    function dirOf(dx, dy, el) {
        const th = Math.max(16, el.offsetWidth * 0.22); // この距離より動いたら「はらった」とみなす
        if (Math.hypot(dx, dy) < th) return 'c';
        return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'l' : 'r') : (dy < 0 ? 'u' : 'd');
    }
    function showPop(s) {
        const rect = s.el.getBoundingClientRect();
        const cell = Math.round(Math.min(rect.height * 1.05, 80));
        const pop = document.createElement('div');
        pop.className = 'skb-pop';
        pop.style.setProperty('--cell', cell + 'px');
        // 十字の中心を、押したキーの少し上に置く（指で隠れないように）
        pop.style.left = Math.round(rect.left + rect.width / 2 - cell * 1.5) + 'px';
        pop.style.top = Math.round(rect.top - cell * 1.6) + 'px';
        const [c, l, u, r, d] = s.key.f.map(esc);
        const cells = ['', u, '', l, c, r, '', d, ''];
        const dirs = ['', 'u', '', 'l', 'c', 'r', '', 'd', ''];
        pop.innerHTML = cells.map((ch, i) => `<span data-d="${dirs[i]}" class="${ch ? 'c' : 'empty'}">${ch}</span>`).join('');
        document.body.appendChild(pop);
        s.pop = pop;
        updatePop(s);
    }
    const updatePop = (s) => s.pop?.querySelectorAll('span').forEach(x => x.classList.toggle('on', x.dataset.d === s.dir));

    function onDown(e) {
        const el = e.target.closest('.skb-key');
        if (!el || !el.dataset.id) return;
        e.preventDefault();
        const key = findKey(el.dataset.id);
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* 取れなくても押せる */ }
        el.classList.add('pressed');
        const s = { key, el, x0: e.clientX, y0: e.clientY, dir: 'c', pop: null };
        active.set(e.pointerId, s);
        if (key.f) showPop(s);
        buzz();
    }
    function onMove(e) {
        const s = active.get(e.pointerId);
        if (!s || !s.key.f) return;
        const dir = dirOf(e.clientX - s.x0, e.clientY - s.y0, s.el);
        if (dir !== s.dir) { s.dir = dir; updatePop(s); }
    }
    function release(e, commit) {
        const s = active.get(e.pointerId);
        if (!s) return;
        active.delete(e.pointerId);
        s.el.classList.remove('pressed');
        s.pop?.remove();
        if (!commit || !alive) return;
        if (s.key.id === 'space') { act({ ...st, pending: st.pending + (st.mode === 'kana' ? '　' : ' ') }); return; }
        if (s.key.f && !s.key.f[DIRS.indexOf(s.dir)]) return; // その向きに文字が無いときは何もしない
        const before = st.mode;
        act(pressKey(st, s.key.id, s.dir));
        if (st.mode !== before) buildKeyboard();
    }
    const onUp = (e) => release(e, true);
    const onCancel = (e) => release(e, false);
    const onCand = (e) => {
        const b = e.target.closest('button');
        if (!b || !alive) return;
        buzz();
        act(pickCandidate(st, cands[+b.dataset.i]));
    };
    const noMenu = (e) => e.preventDefault();

    gridEl.addEventListener('pointerdown', onDown);
    gridEl.addEventListener('pointermove', onMove);
    gridEl.addEventListener('pointerup', onUp);
    gridEl.addEventListener('pointercancel', onCancel);
    candsEl.addEventListener('click', onCand);
    kbEl.addEventListener('contextmenu', noMenu); // 長押しのメニューを出さない

    // ===== 入力と判定 =====
    function act(next) {
        st = next;
        const j = judge(segs, st, norm);
        wrong = j.result === 'ng';
        renderCands();
        renderTyped();
        onChange({ result: j.result, committedLength: wrong ? 0 : [...st.committed].length });
    }

    buildKeyboard();

    return {
        setProblem(problem, normFn) {
            segs = segmentize(problem);
            norm = normFn;
            st = { ...st, committed: '', pending: '' };
            wrong = false;
            renderCands();
            renderTyped();
        },
        destroy() {
            alive = false;
            active.forEach(s => s.pop?.remove());
            active.clear();
            document.querySelectorAll('.skb-pop').forEach(p => p.remove());
            gridEl.removeEventListener('pointerdown', onDown);
            gridEl.removeEventListener('pointermove', onMove);
            gridEl.removeEventListener('pointerup', onUp);
            gridEl.removeEventListener('pointercancel', onCancel);
            candsEl.removeEventListener('click', onCand);
            kbEl.removeEventListener('contextmenu', noMenu);
            kbEl.innerHTML = '';
        },
    };
}
