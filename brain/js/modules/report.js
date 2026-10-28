// (1) インポート（純粋なパース・計算のみ。DOM操作はapp.js側で行う）
// キャッシュバスティング用の「?v=N」はjs/app.js冒頭のコメント参照。値を変更する際はそちらと揃えること。
import { getSystemInfo, KIND_REPORT } from './task.js?v=34';

// 報告データは通常のmainData行を流用し、システム列 { 種別: '報告', 報告区分: … } で行の種類を区別する
// (1日タスクが { 種別: '1日タスク' } で特殊行を表すのと同じ考え方。2026-10-28まではデータ区分='報告'・PARA区分で区別していた)。
// 2026-10-14、「テーマ × 報告先」のマトリクス方式へ再設計した（旧: エントリを報告先ノードにタグ付けし、
// 報告タイミング行の備考欄で報告/見送りを仕分ける方式）。
//   構造行   : 報告先（会議・月報など）の一覧。内容欄にDSL `[sN] ラベル`。通常1件のみ。
//   テーマ行 : 成果をまとめる単位（DSSなど）。タイトル=テーマ名、Input=既定の報告先ID（カンマ区切り）。
//   エントリ行: 成果1件。内容=本文、Input=テーマ行のID、Output=報告先ごとの状態DSL。
//   タイミング行: 報告先ごとの個別の日付。Input=報告先ID、開始予定=日付、内容=報告用下書き。
export const REPORT_PARA_STRUCTURE = '構造';
export const REPORT_PARA_THEME     = 'テーマ';
export const REPORT_PARA_ENTRY     = 'エントリ';
export const REPORT_PARA_OCCASION  = 'タイミング';

export const REPORT_STATE_PLANNED = '予定';
export const REPORT_STATE_DONE    = '済';
export const REPORT_STATE_SKIPPED = '見送り';

/** row が指定の報告区分の報告行かどうかを判定する。 */
function isReportKind(row, reportKind) {
    const sys = getSystemInfo(row);
    return sys['種別'] === KIND_REPORT && sys['報告区分'] === reportKind;
}

export function isReportStructureRow(row) {
    return isReportKind(row, REPORT_PARA_STRUCTURE);
}

export function isReportThemeRow(row) {
    return isReportKind(row, REPORT_PARA_THEME);
}

export function isReportEntryRow(row) {
    return isReportKind(row, REPORT_PARA_ENTRY);
}

export function isReportOccasionRow(row) {
    return isReportKind(row, REPORT_PARA_OCCASION);
}

/** カンマ区切りのID文字列を配列にして返す。 */
export function splitReportIds(text) {
    return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 報告行を1件組み立てて返す（mainDataへの追加は呼び出し側で行う）。IDは既存の最大ID+1。
 *
 * (2) インプット: mainData（最大ID算出用）, columns（MAIN_DATA_COLUMNS）, nowStr（作成・更新日時）,
 *                 reportKind（報告区分：REPORT_PARA_*）, fields（上書きする列値）
 * (4) アウトプット: 新しい行オブジェクト
 */
export function createReportRow(mainData, columns, nowStr, reportKind, fields) {
    const maxId = mainData.reduce((max, r) => Math.max(max, parseInt(r['ID'], 10) || 0), 0);
    const row = Object.fromEntries(columns.map(col => [col, '']));
    row['ID']        = String(maxId + 1);
    row['システム']   = { '種別': KIND_REPORT, '報告区分': reportKind };
    row['作成日時']   = nowStr;
    row['更新日時']   = nowStr;
    return Object.assign(row, fields);
}

// ===== 報告先の構造（見出しDSL） =====

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

/** 木構造を { id, label, depth, hasChildren } のフラット配列にする（マトリクスの列順に使う）。 */
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

// ===== テーマ・エントリ・状態 =====

/** テーマ行をID（数値）の昇順で返す。 */
export function getReportThemes(mainData) {
    return mainData
        .filter(isReportThemeRow)
        .sort((a, b) => (parseInt(a['ID'], 10) || 0) - (parseInt(b['ID'], 10) || 0));
}

/** エントリ行の所属テーマID（テーマ行のID）を返す。 */
export function getReportEntryThemeId(row) {
    return String(row['Input'] || '').trim();
}

/**
 * エントリ行のOutput欄DSLをパースする。1行1件、`sN 予定` / `sN 見送り` / `sN 済 yyyy/mm/dd`形式。
 * 行が無い報告先は「対象外（空）」を表す。
 *
 * (4) アウトプット: Map<報告先ID, { state, date }>
 */
export function parseReportStates(text) {
    const map = new Map();
    const re = /^(s\d+)\s+(予定|済|見送り)(?:\s+(\S+))?$/;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const m = re.exec(rawLine.trim());
        if (m) map.set(m[1], { state: m[2], date: m[3] || '' });
    }
    return map;
}

/** parseReportStatesの結果をOutput欄DSLテキストに戻す。 */
export function stringifyReportStates(map) {
    const lines = [];
    for (const [venueId, { state, date }] of map) {
        lines.push(state === REPORT_STATE_DONE && date ? `${venueId} ${state} ${date}` : `${venueId} ${state}`);
    }
    return lines.join('\n');
}

/** セルタップ時の状態の送り順（空 → 予定 → 済 → 見送り → 空）。 */
export function nextReportState(current) {
    switch (current) {
        case '':                    return REPORT_STATE_PLANNED;
        case REPORT_STATE_PLANNED:  return REPORT_STATE_DONE;
        case REPORT_STATE_DONE:     return REPORT_STATE_SKIPPED;
        default:                    return '';
    }
}

/** エントリに「予定」または「見送り」の報告先が残っている（＝まだ報告が完了していない）か。 */
export function hasUnfinishedReportState(row) {
    for (const { state } of parseReportStates(row['Output']).values()) {
        if (state === REPORT_STATE_PLANNED || state === REPORT_STATE_SKIPPED) return true;
    }
    return false;
}

/** 指定報告先の報告タイミング行を、開始予定（日付）の新しい順で返す。 */
export function getReportOccasionsForVenue(mainData, venueId) {
    return mainData
        .filter(r => isReportOccasionRow(r) && r['Input'] === venueId)
        .sort((a, b) => (b['開始予定'] || '').localeCompare(a['開始予定'] || ''));
}

/** 今日（yyyy/mm/dd）以降で最も近い報告タイミング行を返す（無ければnull）。 */
export function getNextReportOccasion(mainData, venueId, todayJP) {
    const upcoming = getReportOccasionsForVenue(mainData, venueId)
        .filter(r => (r['開始予定'] || '') >= todayJP);
    return upcoming.length > 0 ? upcoming[upcoming.length - 1] : null;
}

/** 本文を箇条書き1項目にする（2行目以降は2スペースでインデント）。 */
function formatReportBullet(text) {
    const lines = String(text || '').split(/\r?\n/);
    return ['- ' + lines[0], ...lines.slice(1).map(l => '  ' + l)].join('\n');
}

/**
 * 指定報告先で「予定」になっているエントリを、テーマごとの見出し付き箇条書きにして返す（報告用下書きの元）。
 *
 * (2) インプット: mainData, venueId
 * (3) メイン: テーマ順に、作成日時の古い順でエントリを並べる
 * (4) アウトプット: 下書きテキスト（該当なしなら空文字）
 */
export function buildReportDraft(mainData, venueId) {
    const entries = mainData.filter(isReportEntryRow)
        .filter(r => parseReportStates(r['Output']).get(venueId)?.state === REPORT_STATE_PLANNED)
        .sort((a, b) => (a['作成日時'] || '').localeCompare(b['作成日時'] || ''));
    const themes = getReportThemes(mainData);
    const blocks = [];
    const themeIds = themes.map(t => String(t['ID']));
    const groups = [
        ...themes.map(t => ({ id: String(t['ID']), name: t['タイトル'] || '（無題）' })),
        { id: null, name: '（テーマ未設定）' },
    ];
    for (const g of groups) {
        const items = entries.filter(r => {
            const tid = getReportEntryThemeId(r);
            return g.id === null ? !themeIds.includes(tid) : tid === g.id;
        });
        if (items.length === 0) continue;
        blocks.push(`■${g.name}\n` + items.map(r => formatReportBullet(r['内容'] || r['タイトル'])).join('\n'));
    }
    return blocks.join('\n\n');
}

// ===== 旧形式データの変換 =====

/**
 * 旧形式のエントリ（Input欄が報告先IDのカンマ区切り）を新形式（Input=テーマ行のID、Output=報告先ごとの状態）へ変換する。
 * テーマは「未分類」を1件作ってそこへ入れる。旧タイミング行の備考欄の報告/見送りの仕分けは、
 * 報告→済（そのタイミングの日付）、見送りのみ→見送り、未仕分け→予定へ引き継ぐ。
 * mainDataを直接書き換え、変換が発生したらtrueを返す。
 *
 * (2) インプット: mainData, columns（MAIN_DATA_COLUMNS）, nowStr（更新日時）
 */
export function migrateLegacyReportEntries(mainData, columns, nowStr) {
    const isVenueId = s => /^s\d+$/.test(s);
    const legacy = mainData.filter(r => isReportEntryRow(r) && splitReportIds(r['Input']).some(isVenueId));
    if (legacy.length === 0) return false;

    let theme = mainData.find(r => isReportThemeRow(r) && r['タイトル'] === '未分類');
    if (!theme) {
        theme = createReportRow(mainData, columns, nowStr, REPORT_PARA_THEME, { 'タイトル': '未分類' });
        mainData.push(theme);
    }

    const occasions = mainData.filter(isReportOccasionRow)
        .sort((a, b) => (a['開始予定'] || '').localeCompare(b['開始予定'] || ''));
    for (const entry of legacy) {
        const entryId = String(entry['ID']);
        const states = new Map();
        for (const venueId of splitReportIds(entry['Input']).filter(isVenueId)) {
            let current = { state: REPORT_STATE_PLANNED, date: '' };
            for (const occ of occasions.filter(o => o['Input'] === venueId)) {
                for (const line of String(occ['備考'] || '').split(/\r?\n/)) {
                    const m = /^#(\d+)\s+(報告|見送り)\s*$/.exec(line.trim());
                    if (!m || m[1] !== entryId) continue;
                    if (m[2] === '報告') current = { state: REPORT_STATE_DONE, date: occ['開始予定'] || '' };
                    else if (current.state !== REPORT_STATE_DONE) current = { state: REPORT_STATE_SKIPPED, date: '' };
                }
            }
            states.set(venueId, current);
        }
        entry['Input']    = String(theme['ID']);
        entry['Output']   = stringifyReportStates(states);
        entry['更新日時'] = nowStr;
    }
    return true;
}
