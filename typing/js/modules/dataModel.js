// (1) インポート — なし
// 共有記録（app_data/typing/records.md）の読み書きと集計。1プレイ＝1レコード：
// { ID, プレイ名, レベル, ミリ秒, ミス, 日時 }

export function parseFrontMatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { data: {}, tail: '' };
    return { data: JSON.parse(match[1]), tail: markdown.slice(match[0].length) };
}

export function stringifyRecords(playData, tail) {
    return '---\n' + JSON.stringify({ playData }, null, 2) + '\n---' + (tail || '\n');
}

/**
 * レベルごとのランキング（プレイ名ごとのベスト。同タイムならミスが少ない方が上）。
 * (2) インプット: playData, level  (4) アウトプット: [{ name, ms, misses, plays }]（速い順）
 */
export function computeRanking(playData, level) {
    const best = new Map();
    for (const p of playData || []) {
        if (p['レベル'] !== level) continue;
        const name = p['プレイ名'];
        const cur = best.get(name);
        if (!cur) {
            best.set(name, { name, ms: p['ミリ秒'], misses: p['ミス'], plays: 1 });
            continue;
        }
        cur.plays++;
        if (p['ミリ秒'] < cur.ms || (p['ミリ秒'] === cur.ms && p['ミス'] < cur.misses)) {
            cur.ms = p['ミリ秒']; cur.misses = p['ミス'];
        }
    }
    return [...best.values()].sort((a, b) => a.ms - b.ms || a.misses - b.misses);
}

/** 新しい順の最新プレイ（全レベル）。 */
export function getLatestPlays(playData, count = 5) {
    return [...(playData || [])]
        .sort((a, b) => (b['日時'] || '').localeCompare(a['日時'] || '') || String(b['ID']).localeCompare(String(a['ID'])))
        .slice(0, count);
}
