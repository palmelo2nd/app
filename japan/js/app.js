// japan：日本地図アプリ。段階A「都道府県を知る」（2026-11-25、brain #-41）
// 地図の県を押すか一覧から選ぶと、県名（漢字・ふりがな・英語）・地方・県庁所在地を出し、県庁所在地に印を付ける。
// 境界・県の情報は data/（国土数値情報 行政区域を加工したもの。作り方は README.md）。
// worldの js/app.js をもとにした複製（部品はアプリごとに持つ、2026-11-24）。
// 経緯：app_data/docs/japan/261125_段階A_都道府県を知る.md

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.15.0/dist/maplibre-gl.mjs';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const DATA_VERSION = CURRENT_VERSION || '1';   // data/ もキャッシュバスティングに合わせて読み直す

const FONT_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const OFM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const LOCAL_FONT = "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif";

// 地方の並びと色（css/style.css の --rg-* と同じ値）
const REGIONS = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州沖縄'];
const REGION_COLORS = {
    '北海道': '#dce8fb', '東北': '#e3f1dc', '関東': '#fbe7c6', '中部': '#e9e1f5',
    '近畿': '#fbdcd6', '中国': '#d9f0ee', '四国': '#f5efc8', '九州沖縄': '#f3dcea',
};
// 全国の寄せ先（北方領土から与那国島まで。小笠原・南鳥島は入れない）
const JAPAN_BOUNDS = [[122.5, 24.0], [149.0, 45.8]];

const state = {
    bg: 'none',
    region: '',
    query: '',
    selectedCode: null,
};
let map = null;
let prefs = [];              // data/prefs.json の県
let prefByCode = new Map();
let regionBounds = {};       // 地方 → 寄せ先の箱（data/prefs.json）
let prefsGeoJSON = null;     // 県の面（code・地方を付けたもの）
let lineGeoJSON = null;      // 県と県が接する線

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
            await Promise.all(keys.filter(k => k.startsWith('japan-')).map(k => caches.delete(k)));
        }
    } catch (error) {
        console.error(error);
    }
    location.href = location.pathname + '?nocache=' + Date.now();
});

// ===== データ =====

async function loadData() {
    const [info, topo] = await Promise.all([
        fetch(`data/prefs.json?v=${DATA_VERSION}`).then(r => r.json()),
        fetch(`data/borders.json?v=${DATA_VERSION}`).then(r => r.json()),
    ]);
    prefs = info.prefs;
    regionBounds = info.regions;
    prefByCode = new Map(prefs.map(p => [p.code, p]));
    prefsGeoJSON = window.topojson.feature(topo, topo.objects.prefs);
    lineGeoJSON = window.topojson.feature(topo, topo.objects.lines);
    prefsGeoJSON.features.forEach(f => {
        const p = prefByCode.get(f.properties.code);
        f.properties.region = p ? p.region : '';
    });
}

function labelGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: prefs.map(p => ({
            type: 'Feature',
            properties: { code: p.code, name: p.ja },
            geometry: { type: 'Point', coordinates: [p.lx, p.ly] },
        })),
    };
}

function capitalGeoJSON(p) {
    return {
        type: 'FeatureCollection',
        features: p ? [{
            type: 'Feature',
            properties: { name: p.cap.ja },
            geometry: { type: 'Point', coordinates: [p.cap.lon, p.cap.lat] },
        }] : [],
    };
}

// ===== 地図 =====

/** 背景なしのスタイル（海の色だけ。県は addPrefLayers で足す）。 */
function plainStyle() {
    return {
        version: 8,
        glyphs: FONT_URL,
        sources: {},
        layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': '#dfe8f3' } }],
    };
}

/** OpenFreeMap の地名を日本語（name:ja）優先にする。 */
function toJapaneseLabels(style) {
    style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
            layer.layout['text-field'] = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
        }
    });
    return style;
}

const regionColor = ['match', ['get', 'region'], ...REGIONS.flatMap(r => [r, REGION_COLORS[r]]), '#e3e3e3'];

/** 県の面・境界・名前・県庁所在地の印。背景を替えたら（style.load）毎回足し直す。 */
function addPrefLayers() {
    const onTiles = state.bg === 'ofm';
    map.addSource('prefs', { type: 'geojson', data: prefsGeoJSON });
    map.addSource('pref-lines', { type: 'geojson', data: lineGeoJSON });
    map.addSource('labels', { type: 'geojson', data: labelGeoJSON() });
    map.addSource('capitals', { type: 'geojson', data: capitalGeoJSON(prefByCode.get(state.selectedCode)) });

    map.addLayer({ id: 'pref-fill', type: 'fill', source: 'prefs',
        paint: { 'fill-color': regionColor, 'fill-opacity': onTiles ? 0.35 : 1 } });
    map.addLayer({ id: 'pref-selected-fill', type: 'fill', source: 'prefs',
        filter: ['==', ['get', 'code'], state.selectedCode || ''],
        paint: { 'fill-color': '#2f6fed', 'fill-opacity': onTiles ? 0.25 : 0.22 } });
    map.addLayer({ id: 'pref-line', type: 'line', source: 'pref-lines',
        paint: { 'line-color': '#9aa3b2', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1.2] } });
    map.addLayer({ id: 'pref-selected-line', type: 'line', source: 'prefs',
        filter: ['==', ['get', 'code'], state.selectedCode || ''],
        paint: { 'line-color': '#2f6fed', 'line-width': 2 } });

    // 県名（背景の地図にも地名があるときは出さない）
    if (!onTiles) {
        map.addLayer({ id: 'pref-label', type: 'symbol', source: 'labels',
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14],
                'text-max-width': 6,
            },
            paint: { 'text-color': '#1a2744', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.2 } });
    }

    // 選んだ県の県庁所在地の印
    map.addLayer({ id: 'capital-dot', type: 'circle', source: 'capitals',
        paint: { 'circle-radius': 5, 'circle-color': '#c0392b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'capital-label', type: 'symbol', source: 'capitals',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12,
                  'text-anchor': 'left', 'text-offset': [0.7, 0], 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': '#c0392b', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
}

/** 出典の表示を閉じた状態にする（スマホで最初から開いて地図の下を隠すため）。 */
function collapseAttribution() {
    const el = document.querySelector('.maplibregl-ctrl-attrib');
    if (!el) return;
    el.classList.remove('maplibregl-compact-show');
    el.removeAttribute('open');
}

async function setStyleForBackground() {
    if (state.bg === 'ofm') {
        const style = toJapaneseLabels(await (await fetch(OFM_STYLE_URL)).json());
        map.setStyle(style, { diff: false });
    } else {
        map.setStyle(plainStyle(), { diff: false });
    }
}

function buildMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: plainStyle(),
        bounds: JAPAN_BOUNDS,
        fitBoundsOptions: { padding: 10 },
        localIdeographFontFamily: LOCAL_FONT,   // 漢字・かなは端末の字で描く（worldの段階0で決定）
        attributionControl: { compact: true, customAttribution: '国土数値情報（行政区域）を加工' },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    window.japanMap = map;   // 動作確認（Playwright）で地図の位置を計算するため
    map.on('style.load', () => {
        map.setProjection({ type: 'mercator' });   // 平面だけ（地球儀なし。labで決定）
        addPrefLayers();
        collapseAttribution();
    });
    map.on('load', collapseAttribution);

    map.on('click', e => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['pref-fill'] })[0];
        if (hit) selectPref(hit.properties.code, { fly: false });
    });
    map.on('mousemove', e => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['pref-fill'] });
        map.getCanvas().style.cursor = hit.length ? 'pointer' : '';
    });
}

function refreshSelectionOnMap() {
    if (!map || !map.getSource('prefs')) return;
    const code = state.selectedCode || '';
    map.setFilter('pref-selected-fill', ['==', ['get', 'code'], code]);
    map.setFilter('pref-selected-line', ['==', ['get', 'code'], code]);
    map.getSource('capitals').setData(capitalGeoJSON(prefByCode.get(state.selectedCode)));
}

function flyToBounds(b, maxZoom) {
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, maxZoom, duration: 1200 });
}

// ===== 選んだ県の表示 =====

function selectPref(code, { fly = true } = {}) {
    const p = prefByCode.get(code);
    if (!p) return;
    state.selectedCode = code;
    renderPref(p);
    refreshSelectionOnMap();
    if (fly) flyToBounds(p.bbox, 9);
    renderList();
}

function renderPref(p) {
    $('pref-hint').hidden = true;
    $('pref-info').hidden = false;
    $('pref-name').textContent = p.ja;
    $('pref-sub').textContent = `${p.kana}・${p.en}`;
    const regionEl = $('pref-region');
    regionEl.innerHTML = '';
    const badge = document.createElement('span');
    badge.className = 'badge badge-region';
    badge.style.background = REGION_COLORS[p.region];
    badge.textContent = p.region;
    regionEl.appendChild(badge);
    $('pref-capital').textContent = `${p.cap.ja}（${p.cap.kana}・${p.cap.en}）`;
}

// ===== 一覧・検索 =====

/** カタカナをひらがなに（検索は、ひらがなにそろえて比べる）。 */
function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function matchesQuery(p, q) {
    if (!q) return true;
    const qh = toHiragana(q);
    const qe = q.toLowerCase();
    return [p.ja, p.kana, p.cap.ja, p.cap.kana].some(s => s.includes(q) || s.includes(qh))
        || p.en.toLowerCase().includes(qe) || p.cap.en.toLowerCase().includes(qe);
}

function renderList() {
    const listEl = $('pref-list');
    const q = state.query.trim();
    const rows = prefs.filter(p => (!state.region || p.region === state.region) && matchesQuery(p, q));
    $('list-count').textContent = `${rows.length} 件`;

    listEl.innerHTML = '';
    if (!rows.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '見つかりません';
        listEl.appendChild(li);
        return;
    }
    const frag = document.createDocumentFragment();
    REGIONS.forEach(region => {
        const inRegion = rows.filter(p => p.region === region);
        if (!inRegion.length) return;
        const head = document.createElement('li');
        head.className = 'region-head';
        head.textContent = `${region}（${inRegion.length}）`;
        frag.appendChild(head);
        inRegion.forEach(p => {
            const li = document.createElement('li');
            li.dataset.code = p.code;
            if (p.code === state.selectedCode) li.classList.add('selected');
            const sw = document.createElement('span');
            sw.className = 'pref-swatch';
            sw.style.background = REGION_COLORS[p.region];
            li.appendChild(sw);
            const name = document.createElement('span');
            name.className = 'li-name';
            name.textContent = p.ja;
            const sub = document.createElement('span');
            sub.className = 'li-en';
            sub.textContent = `${p.kana}・県庁所在地 ${p.cap.ja}`;
            name.appendChild(sub);
            li.appendChild(name);
            frag.appendChild(li);
        });
    });
    listEl.appendChild(frag);
}

$('pref-list').addEventListener('click', e => {
    const li = e.target.closest('li[data-code]');
    if (!li) return;
    selectPref(li.dataset.code);
    $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('search-input').addEventListener('input', e => {
    state.query = e.target.value;
    renderList();
});

// ===== ボタン =====

function renderRegionBar() {
    const bar = $('region-bar');
    ['', ...REGIONS].forEach(region => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.region = region;
        btn.textContent = region || '全国';
        if (region === state.region) btn.classList.add('active');
        bar.appendChild(btn);
    });
    bar.addEventListener('click', e => {
        const btn = e.target.closest('button[data-region]');
        if (!btn) return;
        state.region = btn.dataset.region;
        bar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        if (state.region) flyToBounds(regionBounds[state.region], 8);
        else map.fitBounds(JAPAN_BOUNDS, { padding: 10, duration: 1200 });
        renderList();
    });
}

function renderLegend() {
    const el = $('legend');
    REGIONS.forEach(region => {
        const span = document.createElement('span');
        const sw = document.createElement('i');
        sw.className = 'sw';
        sw.style.background = REGION_COLORS[region];
        span.append(sw, region);
        el.appendChild(span);
    });
}

$('bg-seg').addEventListener('click', e => {
    const btn = e.target.closest('button[data-v]');
    if (!btn || state.bg === btn.dataset.v) return;
    state.bg = btn.dataset.v;
    $('bg-seg').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    setStyleForBackground().catch(error => alert(`背景の地図を読み込めませんでした：${error.message}`));
});

// ===== はじめ =====
(async () => {
    renderRegionBar();
    renderLegend();
    try {
        await loadData();
    } catch (error) {
        $('pref-hint').textContent = `県のデータを読み込めませんでした（${error.message}）。キャッシュ更新を押してください。`;
        return;
    }
    renderList();
    buildMap();
})();
