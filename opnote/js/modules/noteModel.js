// (1) インポート — なし
// 操作ノートのデータ（Front Matter JSON）。画面には触らない。
// categoryData：分類 { ID, 名前, 並び順 }（例：phone＝スマホ、pc＝パソコン）
// itemData：項目 { ID, 分類, 題, 問い, 答え, 本文, 並び順, 登録日, メモ: [{ ID, 書いた人, 本文, 日時 }] }
//   題・問い・答え・本文はbookスレッドが書く（アプリでは変えない）。メモだけアプリから書き足す。
//   問いと答えは、後で復習アプリで出題するために分けて持つ（例：「文字をコピーするには？」→「Ctrl+C」）

export function emptyNote() {
    return {
        categoryData: [{ ID: 'phone', 名前: 'スマホ', 並び順: 1 }, { ID: 'pc', 名前: 'パソコン', 並び順: 2 }],
        itemData: [],
    };
}

export function parseFrontMatter(markdown) {
    const text = (markdown || '').replace(/\r\n/g, '\n');
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { data: emptyNote(), tail: '\n' };
    const data = JSON.parse(match[1]);
    data.categoryData = data.categoryData || [];
    data.itemData = data.itemData || [];
    return { data, tail: text.slice(match[0].length) || '\n' };
}

export function stringify(data, tail) {
    return `---\n${JSON.stringify(data, null, 2)}\n---${tail || '\n'}`;
}

export function sortedCategories(data) {
    return [...data.categoryData].sort((a, b) => (a['並び順'] || 0) - (b['並び順'] || 0));
}

// 分類の中の項目（並び順→登録日の順）。分類が空なら全部
export function itemsOf(data, categoryId) {
    return data.itemData
        .filter(it => !categoryId || it['分類'] === categoryId)
        .sort((a, b) => (a['並び順'] || 0) - (b['並び順'] || 0) || String(a['登録日']).localeCompare(String(b['登録日'])));
}

function nowStamp() {
    const d = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * メモの追加・削除を、取り直した最新のデータへ当てる。
 * (2) インプット: data, op（{type:'addMemo', itemId, body} | {type:'deleteMemo', itemId, memoId}）, who
 * (4) アウトプット: 新しいdata。当てられないときは error を投げる
 */
export function applyOp(data, op, who) {
    const items = data.itemData.map(it => ({ ...it, メモ: [...(it['メモ'] || [])] }));
    const item = items.find(it => it.ID === op.itemId);
    if (!item) throw new Error('この項目が見つかりません（ノートが書き換えられた可能性があります。「読込」を押してください）');
    if (op.type === 'addMemo') {
        const max = item['メモ'].reduce((m, x) => Math.max(m, Number((String(x.ID).match(/(\d+)$/) || [])[1] || 0)), 0);
        item['メモ'].push({ ID: `m${max + 1}`, 書いた人: who, 本文: op.body, 日時: nowStamp() });
    } else if (op.type === 'deleteMemo') {
        const memo = item['メモ'].find(m => m.ID === op.memoId);
        if (!memo) throw new Error('このメモはもうありません');
        if (memo['書いた人'] !== who) throw new Error('自分が書いたメモだけ消せます');
        item['メモ'] = item['メモ'].filter(m => m.ID !== op.memoId);
    } else {
        throw new Error(`知らない操作です: ${op.type}`);
    }
    return { ...data, itemData: items };
}
