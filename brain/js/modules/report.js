// (1) インポート — なし（純粋なパース・計算のみ。DOM操作はapp.js側で行う）

// 報告データは通常のmainData行を流用し、データ区分='報告'・PARA区分の値で「構造行」「タイミング行」を区別する
// （1日タスクがデータ区分='ナレッジ'・PARA区分='1日タスク'で特殊行を表すのと同じ考え方）。
export const REPORT_KUBUN = '報告';
export const REPORT_PARA_STRUCTURE = '構造'; // 種別・テーマの見出しツリーを1行にまとめて持つ器行（通常1件のみ）
export const REPORT_PARA_OCCASION  = 'タイミング'; // 個別の報告タイミング（種別ノードの下にぶら下がる、日付ごとに増えていく行）

/** row が報告構造行（見出しツリーの器）かどうかを判定する。 */
export function isReportStructureRow(row) {
    return row['データ区分'] === REPORT_KUBUN && row['PARA区分'] === REPORT_PARA_STRUCTURE;
}

/** row が報告タイミング行かどうかを判定する。 */
export function isReportOccasionRow(row) {
    return row['データ区分'] === REPORT_KUBUN && row['PARA区分'] === REPORT_PARA_OCCASION;
}

/**
 * 報告構造行の内容欄DSLを木構造にパースする。
 * 1行1ノード、全角スペースN個のインデントで深さNを表す。`[sN] ラベル`形式（[sN]は省略可）。
 *
 * (2) インプット: text — 構造行の内容欄テキスト
 * (3) メイン: 行ごとにインデント数・ID・ラベルを取り出し、インデントの浅深でスタックを使って親子付けする
 * (4) アウトプット: { id, label, children }[] のツリー配列（ルート直下のノード配列）
 */
export function parseReportStructure(text) {
    const root = [];
    const stack = [{ depth: -1, children: root }];
    const lines = (text || '').split(/\r?\n/);
    for (const rawLine of lines) {
        if (!rawLine.trim()) continue;
        const indentMatch = rawLine.match(/^(　*)/);
        const depth = indentMatch ? indentMatch[1].length : 0;
        let rest = rawLine.slice(depth);
        let id = null;
        const idMatch = rest.match(/^\[(s\d+)\]\s*/);
        if (idMatch) { id = idMatch[1]; rest = rest.slice(idMatch[0].length); }
        const label = rest.trim();
        if (!label) continue;
        const node = { id, label, children: [] };
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push({ depth, children: node.children });
    }
    return root;
}

/**
 * 木構造のうちID未採番のノードに新しいID（s1, s2, ...）を採番する（既存の最大番号の続きから）。
 * 引数のtreeを直接書き換えて返す。
 */
export function assignReportNodeIds(tree) {
    let maxN = 0;
    const scan = (nodes) => {
        for (const n of nodes) {
            const m = n.id && /^s(\d+)$/.exec(n.id);
            if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
            scan(n.children);
        }
    };
    scan(tree);
    const assign = (nodes) => {
        for (const n of nodes) {
            if (!n.id) n.id = `s${++maxN}`;
            assign(n.children);
        }
    };
    assign(tree);
    return tree;
}

/** 木構造を構造行の内容欄DSLテキストに戻す。 */
export function stringifyReportStructure(tree) {
    const lines = [];
    const walk = (nodes, depth) => {
        for (const n of nodes) {
            lines.push('　'.repeat(depth) + `[${n.id}] ${n.label}`);
            walk(n.children, depth + 1);
        }
    };
    walk(tree, 0);
    return lines.join('\n');
}

/** 木構造を { id, label, depth, hasChildren } のフラット配列にする（ツリー表示用）。 */
export function flattenReportTree(tree) {
    const out = [];
    const walk = (nodes, depth) => {
        for (const n of nodes) {
            out.push({ id: n.id, label: n.label, depth, hasChildren: n.children.length > 0 });
            walk(n.children, depth + 1);
        }
    };
    walk(tree, 0);
    return out;
}

/** 木構造から指定IDのノードを探す（無ければnull）。 */
export function findReportNode(tree, nodeId) {
    for (const n of tree) {
        if (n.id === nodeId) return n;
        const found = findReportNode(n.children, nodeId);
        if (found) return found;
    }
    return null;
}

/** 指定ノードとその子孫すべてのIDを配列で返す（削除時の対象特定に使う）。 */
export function collectReportNodeIds(node) {
    const ids = [node.id];
    for (const c of node.children) ids.push(...collectReportNodeIds(c));
    return ids;
}

/**
 * 報告タイミング行の備考欄DSLをパースする。1行1件、`#ID 報告|中断 メモ`形式（保留は記録しない）。
 *
 * (2) インプット: text — タイミング行の備考欄テキスト
 * (3) メイン: 正規表現で1行ずつ #ID・アクション・メモを取り出す
 * (4) アウトプット: { refId, action, memo }[]
 */
export function parseReportOccasionEntries(text) {
    const entries = [];
    const lines = (text || '').split(/\r?\n/);
    const re = /^#(\d+)\s+(報告|中断)\s*(.*)$/;
    for (const rawLine of lines) {
        const m = re.exec(rawLine.trim());
        if (m) entries.push({ refId: m[1], action: m[2], memo: m[3] || '' });
    }
    return entries;
}

/** 報告タイミング行のエントリ配列を備考欄DSLテキストに戻す。 */
export function stringifyReportOccasionEntries(entries) {
    return entries.map(e => `#${e.refId} ${e.action}${e.memo ? ' ' + e.memo : ''}`).join('\n');
}

/** 指定の構造ノードIDに属する報告タイミング行を、開始予定（日付）の新しい順で返す。 */
export function getReportOccasionsForNode(mainData, nodeId) {
    return mainData
        .filter(r => isReportOccasionRow(r) && r['Input'] === nodeId)
        .sort((a, b) => (b['開始予定'] || '').localeCompare(a['開始予定'] || ''));
}

/**
 * 指定の構造ノードの「未解決プール」を返す＝完了済みタスクのうち、
 * そのノードに属する全タイミング行の備考欄で「報告」「中断」のどちらにも記録されていないもの。
 * 「保留」は記録しない運用のため、何もしなければ自動的にプールに残り続ける。
 * 完了日の新しい順にソートして返す。options.completedFrom/completedToで完了日の範囲を絞り込める
 * （'YYYY/MM/DD'形式、両端含む。<input type="date">の値はisoToJP等で変換してから渡すこと）。
 * options.candidateRowsを渡すと、そちら（例:タスク管理上部のカテゴリ・タグ等でフィルタ済みの一覧）を
 * 候補の母集団として使う（省略時はmainData全件）。ただし「解決済みID」の判定は常にmainData全件の
 * タイミング行から行う（フィルタ状態にかかわらず、過去に報告・中断済みのタスクを再度出さないため）。
 *
 * (2) インプット: mainData, nodeId, options（completedFrom, completedTo, candidateRows）
 * (3) メイン: 解決済みID集合をmainData全件から求めた上で、候補一覧から完了済み・未解決・期間内の行を抽出し完了日降順に並べる
 * (4) アウトプット: 条件に合う行の配列（完了日の新しい順）
 */
export function getReportPool(mainData, nodeId, options = {}) {
    const { completedFrom = '', completedTo = '', candidateRows = null } = options;
    const resolvedIds = new Set();
    for (const occ of mainData.filter(r => isReportOccasionRow(r) && r['Input'] === nodeId)) {
        for (const e of parseReportOccasionEntries(occ['備考'])) resolvedIds.add(e.refId);
    }
    return (candidateRows || mainData)
        .filter(r => r['データ区分'] === 'タスク' && r['ステータス'] === '完了' && !resolvedIds.has(String(r['ID'])))
        .filter(r => !completedFrom || (r['完了日'] || '') >= completedFrom)
        .filter(r => !completedTo   || (r['完了日'] || '') <= completedTo)
        .sort((a, b) => (b['完了日'] || '').localeCompare(a['完了日'] || ''));
}
