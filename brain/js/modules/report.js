// (1) インポート — なし(純粋なパース・計算のみ。DOM操作はapp.js側で行う)

// 報告データは通常のmainData行を流用し、データ区分='報告'・PARA区分の値で「構造行」「エントリ行」「タイミング行」を区別する
// (1日タスクがデータ区分='ナレッジ'・PARA区分='1日タスク'で特殊行を表すのと同じ考え方)。
// 2026-09-25、完了済みタスクの自動プール方式から、自由記述の「エントリ」方式へ再設計した。
export const REPORT_KUBUN = '報告';
export const REPORT_PARA_STRUCTURE = '構造'; // 種別・テーマの見出しツリーを1行にまとめて持つ器行（通常1件のみ）
export const REPORT_PARA_ENTRY     = 'エントリ'; // 作業の区切りごとに自由記述で追記するログ1件（1つ以上のテーマにタグ付け）
export const REPORT_PARA_OCCASION  = 'タイミング'; // 個別の報告タイミング（テーマに紐づく、日付ごとに増えていく行）

/** row が報告構造行（見出しツリーの器）かどうかを判定する。 */
export function isReportStructureRow(row) {
    return row['データ区分'] === REPORT_KUBUN && row['PARA区分'] === REPORT_PARA_STRUCTURE;
}

/** row が報告エントリ行（自由記述のログ1件）かどうかを判定する。 */
export function isReportEntryRow(row) {
    return row['データ区分'] === REPORT_KUBUN && row['PARA区分'] === REPORT_PARA_ENTRY;
}

/** row が報告タイミング行かどうかを判定する。 */
export function isReportOccasionRow(row) {
    return row['データ区分'] === REPORT_KUBUN && row['PARA区分'] === REPORT_PARA_OCCASION;
}

/** 報告エントリ行のInput欄（カンマ区切りのテーマノードID）を配列にして返す。 */
export function getReportEntryTagIds(row) {
    return String(row['Input'] || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** テーマノードIDの配列を、報告エントリ行のInput欄用のカンマ区切り文字列に戻す。 */
export function stringifyReportEntryTagIds(ids) {
    return ids.filter(Boolean).join(',');
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

/** 指定の構造ノードIDに属する報告タイミング行を、開始予定（日付）の新しい順で返す。 */
export function getReportOccasionsForNode(mainData, nodeId) {
    return mainData
        .filter(r => isReportOccasionRow(r) && r['Input'] === nodeId)
        .sort((a, b) => (b['開始予定'] || '').localeCompare(a['開始予定'] || ''));
}

/**
 * 報告タイミング行の備考欄DSLをパースする。1行1件、`#ID 報告|見送り`形式（理由メモは持たない）。
 *
 * (2) インプット: text — タイミング行の備考欄テキスト
 * (3) メイン: 正規表現で1行ずつ #ID・アクションを取り出す
 * (4) アウトプット: { refId, action }[]
 */
export function parseReportResolutions(text) {
    const resolutions = [];
    const lines = (text || '').split(/\r?\n/);
    const re = /^#(\d+)\s+(報告|見送り)\s*$/;
    for (const rawLine of lines) {
        const m = re.exec(rawLine.trim());
        if (m) resolutions.push({ refId: m[1], action: m[2] });
    }
    return resolutions;
}

/** 報告タイミング行の仕分け結果配列を備考欄DSLテキストに戻す。 */
export function stringifyReportResolutions(resolutions) {
    return resolutions.map(r => `#${r.refId} ${r.action}`).join('\n');
}

/**
 * 指定の構造ノードの「未報告プール」を返す＝そのノードにタグ付けされた報告エントリのうち、
 * そのノードの報告タイミングでまだ「報告」と確定していないもの。
 * 「見送り」と記録された回は解決扱いにせずプールに残し続け、見送った回の日付を履歴として持たせる
 * （過去に何を見送ったか、資料を見返さずにこのプールの表示だけで分かるようにするため）。
 *
 * (2) インプット: mainData, nodeId
 * (3) メイン: そのノードのタイミング行全件から仕分け結果を集計し（古い順に見送り履歴を積み上げ、
 *     一度でも「報告」があれば解決済みとする）、未解決の該当エントリを作成日時の新しい順で返す
 * (4) アウトプット: { row, skipHistory }[]（skipHistoryは見送られた回の日付文字列の配列）
 */
export function getReportEntryPool(mainData, nodeId) {
    const occasions = mainData
        .filter(r => isReportOccasionRow(r) && r['Input'] === nodeId)
        .sort((a, b) => (a['開始予定'] || '').localeCompare(b['開始予定'] || ''));

    const reportedIds = new Set();
    const skipHistory = new Map();
    for (const occ of occasions) {
        for (const res of parseReportResolutions(occ['備考'])) {
            if (res.action === '報告') {
                reportedIds.add(res.refId);
            } else if (res.action === '見送り') {
                if (!skipHistory.has(res.refId)) skipHistory.set(res.refId, []);
                skipHistory.get(res.refId).push(occ['開始予定'] || occ['タイトル'] || '');
            }
        }
    }

    return mainData
        .filter(isReportEntryRow)
        .filter(r => getReportEntryTagIds(r).includes(nodeId))
        .filter(r => !reportedIds.has(String(r['ID'])))
        .map(row => ({ row, skipHistory: skipHistory.get(String(row['ID'])) || [] }))
        .sort((a, b) => (b.row['作成日時'] || '').localeCompare(a.row['作成日時'] || ''));
}
