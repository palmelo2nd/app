// (1) インポート — なし
// readingのService Worker（sw.js）を登録し、アプリ本体（画面・JS・CSS・CDN）を端末に残してもらう。
// 2026-11-27までbook.jsだけが呼んでいたため、dream・rules・logだけを開く端末ではアプリ本体が圏外で開けなかった。
// 今はjs/app.jsが全機能で呼ぶ。端末に保存した後にも呼び直す（あとから読んだmermaidの部品も残すため）。

const VERSION = new URL(import.meta.url).searchParams.get('v');
const MODE_IDS = ['book', 'dream', 'rules', 'log'];

// 4機能の入口のJSと、そこからimportしているJSを全部たどる（まだ開いていない機能も圏外で開けるように）
async function collectModuleUrls() {
    const seen = new Set();
    const queue = MODE_IDS.map(m => new URL(`../modes/${m}.js?v=${VERSION}`, import.meta.url).href);
    while (queue.length) {
        const url = queue.shift();
        if (seen.has(url)) continue;
        seen.add(url);
        try {
            const text = await (await fetch(url)).text();
            for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
                queue.push(new URL(m[1], url).href);
            }
        } catch (error) { /* 圏外など：取れた分だけ */ }
    }
    return [...seen];
}

// (2) インプット — なし  (3) メイン — SW登録＋残すファイルの一覧を渡す  (4) アウトプット — なし
export async function registerShellWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url).href);
        const reg = await navigator.serviceWorker.ready;
        const urls = [...new Set([
            ...performance.getEntriesByType('resource').map(e => e.name),
            ...[...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')].map(el => el.src || el.href),
            ...(navigator.onLine ? await collectModuleUrls() : []),
        ])].filter(u => /^https?:/.test(u) && !u.startsWith('https://api.github.com/'));
        reg.active?.postMessage({ type: 'cache-shell', urls, version: VERSION });
    } catch (error) {
        console.warn('Service Workerを登録できませんでした（圏外でアプリを開けません）', error);
    }
}
