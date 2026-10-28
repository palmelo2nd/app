// (1) インポート
// （このモジュールは外部ライブラリに依存しない）

// (2) インプット関数定義

/** yyyy/mm/dd hh:mm:ss 形式の日時文字列を Date に変換する */
export function parseJpDatetime(str) {
    if (!str || !str.trim()) return null;
    const m = str.trim().match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Date を yyyy/mm/dd hh:mm:ss 形式にフォーマットする */
export function formatJpDatetime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 旧形式のタイムスタンプログ文字列（"開始-終了, 開始-, …"）を区間の配列 [{ 開始, 終了, 補正: 0 }] にする（終了が無い区間は計測中）。
 * 2026-10-28まで使っていた「タイムスタンプログ」列の変換用（moveTimerFieldsToSystemColumn）。
 */
export function parseLegacyTimestampLog(log) {
    if (!log || !String(log).trim()) return [];
    return String(log).split(',').map(s => s.trim()).filter(Boolean).map(seg => {
        const dashIdx = seg.indexOf('-', 10);
        if (dashIdx === -1) return null;
        const start = seg.slice(0, dashIdx).trim();
        if (!parseJpDatetime(start)) return null;
        const end = seg.slice(dashIdx + 1).trim();
        return { '開始': start, '終了': parseJpDatetime(end) ? end : '', '補正': 0 };
    }).filter(Boolean);
}

/** タイムスタンプログ文字列を解析して累計ミリ秒を返す（末尾が計測中の場合は現在時刻まで加算）。旧形式の値の検証用に残している。 */
export function parseTimestampLog(log) {
    if (!log || !log.trim()) return 0;
    const segments = log.split(',').map(s => s.trim()).filter(Boolean);
    let total = 0;
    const now = Date.now();
    segments.forEach(seg => {
        const dashIdx = seg.indexOf('-', 10);
        if (dashIdx === -1) return;
        const start = parseJpDatetime(seg.slice(0, dashIdx));
        if (!start) return;
        const endStr = seg.slice(dashIdx + 1).trim();
        const end = endStr ? parseJpDatetime(endStr) : null;
        total += (end ? end.getTime() : now) - start.getTime();
    });
    return total;
}

/** ミリ秒を hh:mm:ss にフォーマットする */
export function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ===== タイマー（作業時間の計測） =====
// システム列の「タイマー」に、区間（開始〜終了）の配列 [{ 開始: 'yyyy/mm/dd hh:mm:ss', 終了: 同形式（空＝計測中）, 補正: 分（±） }] を持つ。
// 区間の時間は「終了（計測中なら現在時刻）−開始＋補正」、累計はその合計。
// 2026-10-28までは「タイムスタンプログ」列（文字列）と「補正時間」列（タスク全体で1つの分数）に持っていた。
export const TIMER_KEY = 'タイマー';

/** row のタイマーの区間配列を返す（無ければ空配列）。返した配列は書き換えず、変更は setTimerSegments で行うこと。 */
export function getTimerSegments(row) {
    const v = getSystemInfo(row)[TIMER_KEY];
    return Array.isArray(v) ? v : [];
}

/** row のタイマーの区間配列を書き換える（キーの順をそろえた複製を保存する。空配列なら項目ごと削除）。 */
export function setTimerSegments(row, segments) {
    const list = (segments || []).map(s => ({
        '開始': String(s['開始'] || ''),
        '終了': String(s['終了'] || ''),
        '補正': Number(s['補正']) || 0,
    }));
    setSystemField(row, TIMER_KEY, list.length > 0 ? list : '');
}

/** 計測中（終了の無い区間がある）かどうか。 */
export function isTimerRunning(row) {
    return getTimerSegments(row).some(s => !s['終了']);
}

/** タイマー開始：計測中でなければ、開始=ts の区間を末尾に追加する。追加したらtrue。 */
export function startTimer(row, ts) {
    if (isTimerRunning(row)) return false;
    setTimerSegments(row, [...getTimerSegments(row), { '開始': ts, '終了': '', '補正': 0 }]);
    return true;
}

/** タイマー停止：計測中の区間に終了=ts を入れる。止めたらtrue。 */
export function stopTimer(row, ts) {
    if (!isTimerRunning(row)) return false;
    setTimerSegments(row, getTimerSegments(row).map(s => s['終了'] ? s : { ...s, '終了': ts }));
    return true;
}

/** 区間1つの時間（ms、補正込み）。開始が読めない区間は補正だけを数える。 */
export function computeTimerSegmentMs(seg, nowMs = Date.now()) {
    const start = parseJpDatetime(seg['開始'] || '');
    const end = seg['終了'] ? parseJpDatetime(seg['終了']) : null;
    const base = start ? (end ? end.getTime() : nowMs) - start.getTime() : 0;
    return base + (Number(seg['補正']) || 0) * 60000;
}

/** row のタイマーの累計時間（ms、補正込み）。 */
export function computeTimerTotalMs(row, nowMs = Date.now()) {
    return getTimerSegments(row).reduce((sum, s) => sum + computeTimerSegmentMs(s, nowMs), 0);
}

/** 指定タスクIDの補正込み累計時間（ms）を、メインデータから算出して返す */
export function computeTotalDuration(mainData, taskId) {
    const row = mainData.find(r => String(r['ID']) === String(taskId));
    return row ? computeTimerTotalMs(row) : 0;
}

/**
 * 行の実績時間（h）を返す。「実績時間」列に手入力値があればそれを優先し、無ければ
 * タイマーの累計（区間ごとの補正込み）から算出する（小数第1位まで、例: 2.5）。
 */
export function computeActualHours(row) {
    const manual = parseFloat(row['実績時間'] || '');
    if (!isNaN(manual) && manual > 0) return manual;
    const ms = computeTimerTotalMs(row);
    return ms > 0 ? Math.round(ms / 360000) / 10 : 0;
}

/**
 * 旧形式の「タイムスタンプログ」「補正時間」列を、システム列の「タイマー」へ移して列を消す（2026-10-28移行。読み込みのたびに行う）。
 * 補正時間（タスク全体で1つ）は最後の区間の補正にする（区間が無ければ、更新日時（無ければ作成日時）の長さ0の区間を作って付ける）。
 * システム列にタイマーがすでにある場合は、そちらを正として旧列の値は捨てる。変換が発生したらtrueを返す。
 */
export function moveTimerFieldsToSystemColumn(mainData) {
    let changed = false;
    for (const row of mainData) {
        if (!('タイムスタンプログ' in row) && !('補正時間' in row)) continue;
        if (getTimerSegments(row).length === 0) {
            const segs = parseLegacyTimestampLog(row['タイムスタンプログ']);
            const adj = parseFloat(row['補正時間'] || '');
            if (!isNaN(adj) && adj !== 0) {
                if (segs.length === 0) {
                    const ts = row['更新日時'] || row['作成日時'] || '';
                    if (parseJpDatetime(ts)) segs.push({ '開始': ts, '終了': ts, '補正': 0 });
                }
                if (segs.length > 0) segs[segs.length - 1]['補正'] = adj;
            }
            if (segs.length > 0) setTimerSegments(row, segs);
        }
        delete row['タイムスタンプログ'];
        delete row['補正時間'];
        changed = true;
    }
    return changed;
}

/** 選択中カテゴリでフィルタされたメインデータを返す。「すべて」選択時は全件返す（複製配列）。 */
export function filterMainDataByCategory(mainData, category) {
    if (category === 'すべて') return [...mainData];
    return mainData.filter(r => r['カテゴリ'] === category);
}

/** 指定IDを親IDに持つ行（子）一覧を返す。 */
export function getChildren(mainData, parentId) {
    if (!parentId) return [];
    return mainData.filter(r => String(r['親ID'] || '') === String(parentId));
}

/** 指定IDが、他のいずれかの行から親IDとして参照されているか（＝実質プロジェクトかどうか）を判定する。 */
export function isParentRow(mainData, id) {
    if (!id) return false;
    return mainData.some(r => String(r['親ID'] || '') === String(id));
}

/** 行の親ID（row['親ID']）から親行本体を引く。親IDが空欄、または参照先が存在しない場合は null。 */
export function getParentRow(mainData, row) {
    const parentId = row && row['親ID'];
    if (!parentId) return null;
    return mainData.find(r => String(r['ID']) === String(parentId)) || null;
}

/**
 * newParentId を childId の親として設定した場合に循環参照が発生するかを判定する。
 * newParentId から親を辿っていき、途中で childId に戻り着けば循環とみなす。
 * 自分自身を親にしようとする場合（newParentId === childId）も循環として扱う。
 */
export function wouldCreateCycle(mainData, childId, newParentId) {
    if (!newParentId) return false;
    if (String(newParentId) === String(childId)) return true;

    const idMap = new Map(mainData.map(r => [String(r['ID']), r]));
    let current = idMap.get(String(newParentId));
    const visited = new Set();
    while (current && current['親ID']) {
        const pid = String(current['親ID']);
        if (pid === String(childId)) return true;
        if (visited.has(pid)) return false; // 既存データ側に別の循環がある場合の無限ループ防止
        visited.add(pid);
        current = idMap.get(pid);
    }
    return false;
}

/**
 * id から親IDを辿り、最も高い階層の祖先（親IDが空、または参照先が存在しない行）のIDを返す。
 * 循環がある場合は検出した時点で辿るのを止め、その時点のIDを返す（無限ループ防止）。
 * 親IDが無い行（自分自身がルート）の場合は id 自身を文字列で返す。
 */
export function getRootParentId(mainData, id) {
    const idMap = new Map(mainData.map(r => [String(r['ID']), r]));
    let currentId = String(id);
    const visited = new Set([currentId]);
    let current = idMap.get(currentId);
    while (current && current['親ID']) {
        const pid = String(current['親ID']);
        if (visited.has(pid) || !idMap.has(pid)) break;
        visited.add(pid);
        currentId = pid;
        current = idMap.get(pid);
    }
    return currentId;
}

// 繰返しテンプレート（親タスク）のシステム列で、頻度（{ 月: [], 日: [], 曜日: [] }）を持つ項目名。
// この項目がある行を繰返しテンプレートとみなす（2026-10-28までは「繰返し識別子」列が'1'の行。頻度は「繰返し頻度_月/日/曜日」列）。
export const RECURRING_FREQ_KEY = '繰返し頻度';

/** row が繰返しタスクの親（テンプレート）かどうかを判定する（システム列に「繰返し頻度」があるか）。 */
export function isRecurringParentRow(row) {
    return !!row && !!getSystemInfo(row)[RECURRING_FREQ_KEY];
}

/** row が繰返しタスクの子（生成済みインスタンス）かどうかを判定する。親ID（row['親ID']）が繰返しテンプレート行を指しているかで判定する。 */
export function isRecurringChildRow(mainData, row) {
    const parentId = row && row['親ID'];
    if (!parentId) return false;
    const parent = mainData.find(r => String(r['ID']) === String(parentId));
    return !!parent && isRecurringParentRow(parent);
}

// 行の種別は「システム」列（アプリ管理用のオブジェクト）の「種別」で表す。種別が無い行が通常のタスク。
// 2026-10-28に「データ区分」「PARA区分」の2列を廃止してここへ統合した（旧データは読み込み時にapp.jsのsanitizeMainDataLegacyFieldsで変換）。
//   1日タスク     : { 種別: '1日タスク' }（その日のタイムスケジュールを文法で記述する特殊行）
//   報告          : { 種別: '報告', 報告区分: '構造'|'テーマ'|'エントリ'|'タイミング' }（report.js参照）
//   勤務カレンダー : { 種別: '勤務カレンダー' }（年ごとの休日の例外）
export const KIND_DAYPLAN       = '1日タスク';
export const KIND_REPORT        = '報告';
export const KIND_WORK_CALENDAR = '勤務カレンダー';

/** row のシステム列（アプリ管理用のオブジェクト）を返す。未設定・不正な値の場合は空オブジェクト。 */
export function getSystemInfo(row) {
    const v = row && row['システム'];
    return (v && typeof v === 'object') ? v : {};
}

// システム列のキーの並び順。オブジェクトのキー順が端末ごとに変わると、保存時の比較（merge.jsのrowsEqual）で
// 中身が同じでも「変更あり」と判定されてしまうため、書き込み時は必ずこの順に並べ直す（一覧に無いキーは末尾）。
const SYSTEM_KEY_ORDER = ['種別', '報告区分', '報告先', 'テーマID', '報告状態', 'AI原案', 'AI確認', '繰返し頻度', '繰返しテンプレート', '繰返し基準日', 'タイマー', '旧備考'];

/**
 * row のシステム列の1項目を書き換える（value が空なら項目ごと削除）。row['システム'] は新しいオブジェクトに置き換える。
 *
 * (2) インプット: row, key（項目名）, value（文字列）
 */
export function setSystemField(row, key, value) {
    const merged = { ...getSystemInfo(row) };
    if (value === '' || value === null || value === undefined) delete merged[key];
    else merged[key] = value;
    const keys = Object.keys(merged).sort((a, b) => {
        const ia = SYSTEM_KEY_ORDER.indexOf(a), ib = SYSTEM_KEY_ORDER.indexOf(b);
        return (ia < 0 ? SYSTEM_KEY_ORDER.length : ia) - (ib < 0 ? SYSTEM_KEY_ORDER.length : ib);
    });
    row['システム'] = Object.fromEntries(keys.map(k => [k, merged[k]]));
}

/** row の種別を返す（通常のタスクは空文字）。 */
export function getRowKind(row) {
    return getSystemInfo(row)['種別'] || '';
}

/** row が1日タスク（DAYPLAN）の器行かどうかを判定する。 */
export function isDayPlanRow(row) {
    return getRowKind(row) === KIND_DAYPLAN;
}

/** row が通常のタスク（種別の無い行。1日タスク・報告・勤務カレンダーではない）かどうかを判定する。一覧・件数・カレンダー等の母集団はこれで絞り込む。 */
export function isNormalTaskRow(row) {
    return !!row && getRowKind(row) === '';
}

/**
 * 行が親（プロジェクト）になれるかどうかを判定する。進捗管理の必要上、親になれるのは通常のタスクのみ。
 * 繰返しタスクの親（テンプレート）は、生成済みの子タスクの親ID経由でのみ紐づく特殊な行のため、
 * 通常の親（プロジェクト）選択候補としては提示しない（誤って選ばれることを防ぐ）。
 */
export function isEligibleParentRow(row) {
    return isNormalTaskRow(row) && !isRecurringParentRow(row);
}

/**
 * 親ID選択UI（datalist）用の候補一覧を返す。excludeId を指定すると、その行自身と
 * その子孫（excludeId を親として辿れる全行）を候補から除外する（自分自身や自分の子孫を親にできないようにする）。
 * existingParentsOnly を true にすると、既に他の行から親IDとして参照されている行（＝既存プロジェクト）のみに絞り込む。
 * 候補は親になれる行（通常のタスク）のみを対象にする。
 */
export function getAllParentCandidates(mainData, excludeId, existingParentsOnly = false) {
    let excludedIds = new Set();
    if (excludeId) {
        excludedIds.add(String(excludeId));
        let frontier = [String(excludeId)];
        while (frontier.length > 0) {
            const next = mainData
                .filter(r => frontier.includes(String(r['親ID'] || '')))
                .map(r => String(r['ID']))
                .filter(id => !excludedIds.has(id));
            next.forEach(id => excludedIds.add(id));
            frontier = next;
        }
    }
    return mainData
        .filter(r => !excludedIds.has(String(r['ID'])))
        .filter(isEligibleParentRow)
        .filter(r => !existingParentsOnly || isParentRow(mainData, r['ID']))
        .map(r => ({ id: r['ID'], title: r['タイトル'] || '' }));
}

// (3)〜(4) メイン機能・アウトプット
// このモジュールの各関数は純粋計算のみを行い、引数として受け取った値から
// 計算結果を return する（DOM操作・グローバル状態への直接アクセスは行わない）。
