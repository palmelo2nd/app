// 読書ビューアのService Worker：アプリ本体（画面・JS・CSS・CDNのライブラリ）を端末に残し、圏外でもアプリを開けるようにする。
// 本文・図版（GitHub API）には関与しない。保存した本は app.js 側が Cache Storage「book-offline」に入れる（ここでは触らない）。
// 「キャッシュ更新」ボタンは book-shell だけを消し、このService Workerを解除する（book-offline は消さない）。

const SHELL_CACHE = 'book-shell';
const SCOPE = new URL('./', self.location.href).href;  // 例: https://palmelo2nd.github.io/app/book/
const NAV_TIMEOUT_MS = 4000;                           // 電波が弱いときに画面が出ないままにならないよう、これを過ぎたら端末の版を出す

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// 同じ画面のURL（?nocache= や ?src= 付き）は、すべて SCOPE 1件として持つ
function isShellAsset(url) {
    return (url.href.startsWith(SCOPE) && url.origin === self.location.origin) || url.hostname === 'cdn.jsdelivr.net';
}

async function putShell(key, response) {
    if (!response || !response.ok) return;
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(key, response);
}

// 画面（HTML）：まずネットから（更新を取り込むため）、だめなら端末の版
async function handleNavigate(request) {
    const network = fetch(request).then(async (res) => { await putShell(SCOPE, res.clone()); return res; });
    const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
    try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
    } catch (_) { /* 圏外 */ }
    const cached = await caches.match(SCOPE, { cacheName: SHELL_CACHE });
    return cached || network;
}

// JS・CSS・CDN：?v=N 付きでURLが変わるので、端末にあればそれを使う。無ければネットから取って残す
async function handleAsset(request) {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    const res = await fetch(request);
    await putShell(request, res.clone());
    return res;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (request.mode === 'navigate' && url.href.startsWith(SCOPE)) {
        event.respondWith(handleNavigate(request));
    } else if (isShellAsset(url)) {
        event.respondWith(handleAsset(request));
    }
});

// 最初に開いたときは、Service Workerが動き出す前にJS・CSSを読み終えているので、
// app.js から「今読んだファイルの一覧」を受け取って取り直し、端末に残す。古い ?v=N の版は消す
self.addEventListener('message', (event) => {
    if (event.data?.type !== 'cache-shell') return;
    event.waitUntil((async () => {
        const urls = (event.data.urls || []).filter((u) => isShellAsset(new URL(u)));
        const cache = await caches.open(SHELL_CACHE);
        // 画面（HTML）は ?nocache= などを外した SCOPE 1件として持つ。最初に開いた1回で圏外でも開けるようにするため
        if (!(await cache.match(SCOPE))) {
            try { await putShell(SCOPE, await fetch(SCOPE, { cache: 'no-store' })); } catch (_) { /* 次の機会に */ }
        }
        await Promise.all(urls.map(async (u) => {
            if (await cache.match(u)) return;
            try { await putShell(u, await fetch(u)); } catch (_) { /* 次の機会に */ }
        }));
        const keep = new Set([SCOPE, ...urls]);
        for (const req of await cache.keys()) {
            const u = new URL(req.url);
            if (u.origin === self.location.origin && u.searchParams.has('v') && !keep.has(req.url)) await cache.delete(req);
        }
    })());
});
