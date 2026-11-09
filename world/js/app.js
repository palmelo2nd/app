// world：世界地図アプリ。段階0の試作（2026-11-10）
// 背景地図（タイルなし／OpenFreeMap）・日本語の文字の出し方（端末の字／サーバーの字）・地球儀と平面・飛行機の描画の重さを試す。
// 経緯と結果：app_data/docs/world/261110_段階0_試作.md

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.15.0/dist/maplibre-gl.mjs';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const RELAY_KEY = 'world-relay-url';   // 中継URLはこの端末のlocalStorageにだけ置く（公開リポジトリに書かない）

const FONT_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const OFM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';

// タイルなしのときの文字の確かめ用（漢字・かな・ラテン文字を混ぜる）
const SAMPLE_CITIES = [
    ['東京', 139.69, 35.69], ['ソウル', 126.98, 37.57], ['北京', 116.40, 39.90], ['ニューデリー', 77.21, 28.61],
    ['モスクワ', 37.62, 55.76], ['ロンドン', -0.13, 51.51], ['パリ', 2.35, 48.86], ['カイロ', 31.24, 30.04],
    ['ナイロビ', 36.82, -1.29], ['ワシントンD.C.', -77.04, 38.91], ['ブラジリア', -47.88, -15.79], ['キャンベラ', 149.13, -35.28],
];

const state = {
    bg: 'none',          // 'none'（タイルなし）／'ofm'（OpenFreeMap）
    projection: 'globe', // 'globe'／'mercator'
    font: 'local',       // 'local'（端末の字：localIdeographFontFamily）／'glyphs'（サーバーの字）
    planes: null,        // 最後に描いた飛行機（GeoJSON）。地図を作り直しても描き直す
};
let map = null;
let landGeoJSON = null;

const $ = id => document.getElementById(id);

// ===== 上のバー =====
$('app-version-badge').textContent = CURRENT_VERSION ? `v${CURRENT_VERSION}` : '';

function updateNetworkStatus() {
    const el = $('network-status-top');
    el.textContent = navigator.onLine ? 'オンライン' : 'オフライン';
    el.className = 'js-network-status ' + (navigator.onLine ? 'online' : 'offline');
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

$('cache-reset-btn').addEventListener('click', async () => {
    if (!confirm('キャッシュを更新して最新版を読み込み直します。よろしいですか？')) return;
    try {
        if ('caches' in window) {
            // 同じドメインの他のアプリのキャッシュを消さないよう、自分の名前で始まるものだけ消す（app/CLAUDE.md 2章）
            const keys = await caches.keys();
            await Promise.all(keys.filter(k => k.startsWith('world-')).map(k => caches.delete(k)));
        }
    } catch (error) {
        console.error(error);
    }
    location.href = location.pathname + '?nocache=' + Date.now();
});

// ===== 地図 =====

/** 飛行機の印（上向きの三角）。track（真北から時計回りの角度）で回す。 */
function makePlaneImage() {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d');
    c.fillStyle = '#2f6fed';
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(16, 3); c.lineTo(27, 28); c.lineTo(16, 22); c.lineTo(5, 28); c.closePath();
    c.fill(); c.stroke();
    return c.getImageData(0, 0, size, size);
}

async function loadLand() {
    if (landGeoJSON) return landGeoJSON;
    const topo = await (await fetch(LAND_URL)).json();
    landGeoJSON = window.topojson.feature(topo, topo.objects.countries);
    return landGeoJSON;
}

function cityGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: SAMPLE_CITIES.map(([name, lon, lat]) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
    };
}

/** タイルなしの地図：海の色＋国の面と境界（Natural Earth 110m）＋確かめ用の都市名。 */
function noTileStyle(land) {
    return {
        version: 8,
        glyphs: FONT_URL,
        sources: {
            land:   { type: 'geojson', data: land },
            cities: { type: 'geojson', data: cityGeoJSON() },
        },
        layers: [
            { id: 'ocean', type: 'background', paint: { 'background-color': '#dfe8f3' } },
            { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f7f5ef' } },
            { id: 'border', type: 'line', source: 'land', paint: { 'line-color': '#b8bfcc', 'line-width': 0.6 } },
            { id: 'city-dot', type: 'circle', source: 'cities', paint: { 'circle-radius': 3, 'circle-color': '#1a2744' } },
            {
                id: 'city-label', type: 'symbol', source: 'cities',
                layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 0.9], 'text-anchor': 'top' },
                paint: { 'text-color': '#1a2744', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
            },
        ],
    };
}

/** OpenFreeMapの地名を日本語（name:ja）優先にする。無ければ元の名前。 */
function toJapaneseLabels(style) {
    style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
            layer.layout['text-field'] = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
        }
    });
    return style;
}

/** 文字の配信（/fonts/）の件数。どちらの方式でどれだけ落としたかを見るため（別のサイトなので大きさは取れない）。 */
function countFontRequests(since) {
    return performance.getEntriesByType('resource').filter(e => e.startTime >= since && e.name.includes('/fonts/')).length;
}
// 地図のタイルで記録の上限（既定250件）がすぐ埋まるため広げる
performance.setResourceTimingBufferSize?.(5000);

async function buildMap() {
    const statsEl = $('map-stats');
    statsEl.textContent = '地図を読み込み中…';
    const t0 = performance.now();
    if (map) { map.remove(); map = null; }
    performance.clearResourceTimings?.();

    let style;
    try {
        if (state.bg === 'none') {
            style = noTileStyle(await loadLand());
        } else {
            style = toJapaneseLabels(await (await fetch(OFM_STYLE_URL)).json());
        }
    } catch (error) {
        statsEl.innerHTML = `<span class="ng">地図の読み込みに失敗しました：${error.message}</span>`;
        return;
    }

    map = new maplibregl.Map({
        container: 'map',
        style,
        center: [139.7, 35.7],
        zoom: 2,
        // 'local'：漢字・かなは端末の字で描く（サーバーから字を落とさない）。false：全部サーバーの字
        localIdeographFontFamily: state.font === 'local' ? "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif" : false,
        attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('style.load', () => {
        map.setProjection({ type: state.projection });
        map.addImage('plane', makePlaneImage(), { pixelRatio: 2 });
        map.addSource('planes', { type: 'geojson', data: state.planes || emptyFC() });
        map.addLayer({
            id: 'planes', type: 'symbol', source: 'planes',
            layout: {
                'icon-image': 'plane',
                'icon-rotate': ['coalesce', ['get', 'track'], 0],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1],
            },
        });
    });

    map.on('click', 'planes', e => {
        const p = e.features[0].properties;
        const alt = p.alt == null || p.alt === 'null' ? '—' : `${Math.round(p.alt)} ft`;
        new maplibregl.Popup({ closeButton: false })
            .setLngLat(e.lngLat)
            .setText(`${p.callsign || p.id}　高度 ${alt}`)
            .addTo(map);
    });

    map.once('idle', () => {
        const ms = Math.round(performance.now() - t0);
        const fonts = countFontRequests(t0);
        statsEl.textContent =
            `表示まで ${ms} ms（${state.bg === 'none' ? 'タイルなし' : 'OpenFreeMap'}・${state.projection === 'globe' ? '地球儀' : '平面'}・${state.font === 'local' ? '端末の字' : 'サーバーの字'}）\n` +
            `文字の配信 ${fonts} 件（1件 70〜200 KB）`;
    });
}

function setupSeg(id, key, onChange) {
    $(id).addEventListener('click', e => {
        const btn = e.target.closest('button[data-v]');
        if (!btn || state[key] === btn.dataset.v) return;
        state[key] = btn.dataset.v;
        $(id).querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        onChange();
    });
}
setupSeg('bg-seg', 'bg', buildMap);
setupSeg('font-seg', 'font', buildMap);   // localIdeographFontFamilyは作るときにしか渡せないので作り直す
setupSeg('proj-seg', 'projection', () => map && map.setProjection({ type: state.projection }));

// ===== 飛行機 =====

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function planeFeature(id, callsign, lon, lat, track, alt) {
    return { type: 'Feature', properties: { id, callsign: (callsign || '').trim(), track, alt }, geometry: { type: 'Point', coordinates: [lon, lat] } };
}

/** 取得元ごとの形をそろえる。adsb.lol（ac）・adsb.fi（aircraft）・OpenSky（states）。 */
function normalizePlanes(json) {
    const list = json.ac || json.aircraft;
    if (Array.isArray(list)) {
        return list.filter(a => typeof a.lat === 'number' && typeof a.lon === 'number')
            .map(a => planeFeature(a.hex, a.flight, a.lon, a.lat, a.track ?? a.true_heading ?? 0, typeof a.alt_baro === 'number' ? a.alt_baro : null));
    }
    if (Array.isArray(json.states)) {
        // [icao24, callsign, 国, 位置の時刻, 最終受信, 経度, 緯度, 気圧高度(m), 地上, 速度, 方位, …]
        return json.states.filter(s => s[5] != null && s[6] != null)
            .map(s => planeFeature(s[0], s[1], s[5], s[6], s[10] ?? 0, s[7] != null ? s[7] * 3.281 : null));
    }
    throw new Error('知らない形のJSONです');
}

function testPlanes(n) {
    const features = [];
    for (let i = 0; i < n; i++) {
        const lat = Math.asin(Math.random() * 1.9 - 0.95) * 180 / Math.PI; // 面積が偏らないように
        features.push(planeFeature(`t${i}`, `TEST${i}`, Math.random() * 360 - 180, lat, Math.random() * 360, Math.round(Math.random() * 40000)));
    }
    return features;
}

function sourceUrl(source) {
    const c = map.getCenter();
    const b = map.getBounds();
    const lat = c.lat.toFixed(3), lon = c.lng.toFixed(3);
    const fill = u => u.replace('{lat}', lat).replace('{lon}', lon)
        .replace('{lamin}', Math.max(-90, b.getSouth()).toFixed(2)).replace('{lamax}', Math.min(90, b.getNorth()).toFixed(2))
        .replace('{lomin}', Math.max(-180, b.getWest()).toFixed(2)).replace('{lomax}', Math.min(180, b.getEast()).toFixed(2));
    if (source === 'adsblol') return fill('https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/250');
    if (source === 'adsbfi')  return fill('https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/250');
    if (source === 'opensky') return fill('https://opensky-network.org/api/states/all?lamin={lamin}&lomin={lomin}&lamax={lamax}&lomax={lomax}');
    if (source === 'relay')   return fill($('relay-url').value.trim());
    return null;
}

/** 描き終わる（idle）までの時間を測る。 */
function drawPlanes(features) {
    state.planes = { type: 'FeatureCollection', features };
    const t0 = performance.now();
    map.getSource('planes')?.setData(state.planes);
    return new Promise(resolve => {
        map.triggerRepaint();
        map.once('idle', () => resolve(Math.round(performance.now() - t0)));
    });
}

$('plane-fetch-btn').addEventListener('click', async () => {
    if (!map || !map.getSource('planes')) return;
    const statsEl = $('plane-stats');
    const source = $('plane-source').value;
    statsEl.textContent = '取得中…';

    if (source.startsWith('test')) {
        const n = Number(source.slice(4));
        const t0 = performance.now();
        const features = testPlanes(n);
        const genMs = Math.round(performance.now() - t0);
        const drawMs = await drawPlanes(features);
        statsEl.textContent = `テスト用 ${n.toLocaleString()} 機\n作る ${genMs} ms・描く ${drawMs} ms（地図を動かしたときの重さも見てください）`;
        return;
    }

    const url = sourceUrl(source);
    if (!url) { statsEl.innerHTML = '<span class="ng">中継URLを入れてください</span>'; return; }
    const t0 = performance.now();
    let res, text;
    try {
        res = await fetch(url);
        text = await res.text();
    } catch (error) {
        // CORSで断られたときもここに来る（ブラウザは理由を教えない）
        statsEl.innerHTML = `<span class="ng">取得できませんでした（${error.message}）。CORSで断られた可能性が高いです。</span>`;
        return;
    }
    const fetchMs = Math.round(performance.now() - t0);
    if (!res.ok) {
        statsEl.innerHTML = `<span class="ng">HTTP ${res.status}（${fetchMs} ms）</span>`;
        return;
    }
    let features;
    try {
        features = normalizePlanes(JSON.parse(text));
    } catch (error) {
        statsEl.innerHTML = `<span class="ng">読み取れませんでした：${error.message}</span>`;
        return;
    }
    const drawMs = await drawPlanes(features);
    const remaining = res.headers.get('x-rate-limit-remaining');
    statsEl.textContent =
        `${features.length.toLocaleString()} 機・${(text.length / 1024).toFixed(0)} KB\n` +
        `取得 ${fetchMs} ms・描く ${drawMs} ms` + (remaining ? `・残り回数 ${remaining}` : '');
});

$('plane-clear-btn').addEventListener('click', () => {
    state.planes = null;
    map?.getSource('planes')?.setData(emptyFC());
    $('plane-stats').textContent = '';
});

$('plane-source').addEventListener('change', () => {
    $('relay-row').hidden = $('plane-source').value !== 'relay';
});
try { $('relay-url').value = localStorage.getItem(RELAY_KEY) || ''; } catch { /* 使えない環境では毎回入れる */ }
$('relay-url').addEventListener('change', () => {
    try { localStorage.setItem(RELAY_KEY, $('relay-url').value.trim()); } catch { /* 同上 */ }
});

buildMap();
