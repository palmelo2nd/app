// AI確認ビュー（AI秘書が仮登録した行のレビュー。2026-10-27追加、2026-10-30にapp.jsから分離）
// AI原案（登録時の値）を持つ行を一覧し、確認済みにする。移動・修正は行クリックで開く既存の編集フォームで行う。
// 修正の有無は保存せず、modules/aiReview.js の diffAiDraft で都度比較する。
//
// js/views/ は画面（DOM）を扱うファイルの置き場（js/modules/ は計算だけでDOMを触らない）。
// app.js の状態や関数は、引数の ctx（部品）経由でだけ使う。

// (1) インポート
import {
    parseAiDraft, diffAiDraft, isAiReviewed, getAiReviewRows, getAiReviewMark, setAiReviewMark
} from '../modules/aiReview.js?v=63';
import { formatJpDatetime } from '../modules/task.js?v=63';
import { getCalendarStatusClass } from '../modules/calendar.js?v=63';

/**
 * (2) インプット: ctx = {
 *   getMainData()                — 現在のmainData（配列）
 *   persistLocalCache()          — 端末キャッシュへ保存
 *   buildProjectPathFromId(id)   — 親ID → ルートからのID列
 *   isChipSelected(id)           — 編集フォームで単独選択中のタスクか
 *   appendChipLabel(el, row, text) — 優先度ドット＋タイトルを付ける
 *   selectTask(id)               — タスクを単独選択して編集フォームに読み込む
 *   jpDateOnly(dt)               — 日時文字列の日付部分
 * }
 * (4) アウトプット: { render } — AI確認タブ全体を再描画する関数
 */
export function createAiReviewView(ctx) {
    const { getMainData, persistLocalCache, buildProjectPathFromId, isChipSelected, appendChipLabel, selectTask, jpDateOnly } = ctx;

    const selectedIds = new Set(); // 一括確認済用にチェック中の行ID

    /** 親ID → 「親 > 子 > …」の所属パス文字列。親が無ければ「（ルート）」。 */
    function parentPathLabel(parentId) {
        if (!parentId) return '（ルート）';
        const idMap = new Map(getMainData().map(r => [String(r['ID']), r]));
        return buildProjectPathFromId(parentId)
            .map(id => idMap.get(id)?.['タイトル'] || `#${id}`)
            .join(' > ');
    }

    /** 差分1件の表示文字列。親IDは所属パスで見せる。 */
    function diffLabel(d) {
        if (d.field === '親ID') return `所属: ${parentPathLabel(d.before)} → ${parentPathLabel(d.after)}`;
        return `${d.field}: ${d.before || '（空）'} → ${d.after || '（空）'}`;
    }

    /** 行を確認済みにする（今日の日付を記録）。 */
    function markReviewed(rows) {
        const now = formatJpDatetime(new Date());
        rows.forEach(row => { setAiReviewMark(row, `確認済 ${jpDateOnly(now)}`); row['更新日時'] = now; });
        persistLocalCache();
    }

    /** AI確認タブ全体を再描画する。表示中のビューがAI確認の時だけ呼ばれる想定。 */
    function render() {
        const container = document.getElementById('aireview-list');
        if (!container) return;
        container.innerHTML = '';

        const mainData = getMainData();
        const mode = document.getElementById('aireview-mode')?.value || 'unreviewed';
        const rows = getAiReviewRows(mainData, mode);
        const unreviewedCount = getAiReviewRows(mainData, 'unreviewed').length;
        const countEl = document.getElementById('aireview-count');
        if (countEl) countEl.textContent = `表示 ${rows.length} 件（未確認 ${unreviewedCount} 件）`;

        const visibleIds = new Set(rows.map(r => String(r['ID'])));
        [...selectedIds].forEach(id => { if (!visibleIds.has(id)) selectedIds.delete(id); });

        if (rows.length === 0) {
            container.innerHTML = '<p class="empty-cell">該当するAI登録はありません</p>';
            return;
        }

        rows.forEach(row => {
            const id = String(row['ID']);
            const reviewed = isAiReviewed(row);
            const diffs = diffAiDraft(row);

            const line = document.createElement('div');
            line.className = 'aireview-row';
            if (isChipSelected(id)) line.classList.add('selected-row');

            const head = document.createElement('div');
            head.className = 'aireview-row-head';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selectedIds.has(id);
            checkbox.disabled = reviewed;
            checkbox.addEventListener('click', e => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selectedIds.add(id); else selectedIds.delete(id);
            });
            head.appendChild(checkbox);

            const badge = document.createElement('span');
            badge.className = 'aireview-badge ' + (diffs.length > 0 ? 'aireview-badge--fixed' : (reviewed ? 'aireview-badge--ok' : 'aireview-badge--new'));
            badge.textContent = diffs.length > 0 ? '修正あり' : (reviewed ? 'そのまま' : '未確認');
            head.appendChild(badge);

            const label = document.createElement('span');
            label.className = `project-tree-label ${getCalendarStatusClass(row['ステータス'])}`;
            appendChipLabel(label, row, row['タイトル'] || '（無題）');
            head.appendChild(label);

            if (!reviewed) {
                const okBtn = document.createElement('button');
                okBtn.type = 'button';
                okBtn.className = 'recurring-table-btn aireview-ok-btn';
                okBtn.textContent = '確認済';
                okBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    markReviewed([row]);
                    selectedIds.delete(id);
                    render();
                });
                head.appendChild(okBtn);
            } else {
                const doneLabel = document.createElement('span');
                doneLabel.className = 'aireview-done';
                doneLabel.textContent = getAiReviewMark(row);
                head.appendChild(doneLabel);
            }
            line.appendChild(head);

            const meta = document.createElement('div');
            meta.className = 'aireview-row-meta';
            const draft = parseAiDraft(row);
            meta.textContent = `#${id}　${parentPathLabel(row['親ID'])}　｜ AI登録 ${draft['登録日'] || jpDateOnly(row['作成日時'])}`;
            line.appendChild(meta);

            diffs.forEach(d => {
                const diffEl = document.createElement('div');
                diffEl.className = 'aireview-row-diff';
                diffEl.textContent = diffLabel(d);
                line.appendChild(diffEl);
            });

            line.addEventListener('click', () => selectTask(id));
            container.appendChild(line);
        });
    }

    document.getElementById('aireview-mode')?.addEventListener('change', render);
    document.getElementById('aireview-bulk-approve-btn')?.addEventListener('click', () => {
        const mainData = getMainData();
        const rows = [...selectedIds]
            .map(id => mainData.find(r => String(r['ID']) === id))
            .filter(r => r && !isAiReviewed(r));
        if (rows.length === 0) { alert('確認済にする行をチェックしてください'); return; }
        markReviewed(rows);
        selectedIds.clear();
        render();
    });

    return { render };
}
