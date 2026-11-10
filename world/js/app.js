// world：世界地図アプリ。段階1「国を知る」（2026-11-10）
// 地図の国（小さな国は丸印）を押すか一覧から選ぶと、国名（日英）・国旗・区分・地域・首都を出し、首都に印を付ける。
// 国境・国の情報は data/（Natural Earth 日本見解版を加工したもの。作り方は README.md）。
// 経緯：app_data/docs/world/261110_段階1_国を知る.md

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.15.0/dist/maplibre-gl.mjs';

const CURRENT_VERSION = new URL(import.meta.url).searchParams.get('v');
const DATA_VERSION = CURRENT_VERSION || '2';   // data/ もキャッシュバスティングに合わせて読み直す

const FONT_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const OFM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const FLAG_URL = iso2 => `https://cdn.jsdelivr.net/npm/flag-icons@7.6.0/flags/4x3/${iso2}.svg`;
const LOCAL_FONT = "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif";

// 区分の色（css/style.css の --st-* と同じ値）
const STATUS_COLORS = { un: '#f3efe3', nonun: '#dce8fb', dep: '#e3e3e3', disputed: '#fbdcc4' };
const STATUS_LABELS = { un: '国連加盟国', nonun: '国連非加盟の国・地域', dep: '属領・自治領など', disputed: '係争地など' };

// 地域ボタンの寄せ先（中心・ズーム）。データの外接の箱は日付変更線をまたぐ国で使えないため、手で決める
const REGION_VIEWS = {
    '':        { center: [139, 25],  zoom: 1.2 },
    'アジア':     { center: [95, 28],   zoom: 2.2 },
    'ヨーロッパ':   { center: [15, 52],   zoom: 3.0 },
    'アフリカ':    { center: [18, 2],    zoom: 2.4 },
    '北アメリカ':   { center: [-92, 32],  zoom: 2.2 },
    '南アメリカ':   { center: [-60, -20], zoom: 2.5 },
    'オセアニア':   { center: [160, -15], zoom: 2.4 },
};

const state = {
    projection: 'globe',
    bg: 'none',
    region: '',
    kind: 'un',
    query: '',
    selectedId: null,
};
let map = null;
let countries = [];          // data/countries.json の国
let countryById = new Map();
let bordersGeoJSON = null;   // 国の面（id・区分を付けたもの）
let borderLinesGeoJSON = null; // 国と国が接する線（外周は描かない。日付変更線の切れ目に線が出ないように）

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

// ===== データ =====

async function loadData() {
    const [info, topo] = await Promise.all([
        fetch(`data/countries.json?v=${DATA_VERSION}`).then(r => r.json()),
        fetch(`data/borders.json?v=${DATA_VERSION}`).then(r => r.json()),
    ]);
    countries = info.countries;
    countryById = new Map(countries.map(c => [c.id, c]));
    bordersGeoJSON = window.topojson.feature(topo, topo.objects.countries);
    borderLinesGeoJSON = window.topojson.feature(topo, topo.objects.lines);
    bordersGeoJSON.features.forEach(f => {
        const c = countryById.get(f.properties.id);
        f.properties.status = c ? c.status : 'dep';
    });
}

function labelGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: countries.map(c => ({
            type: 'Feature',
            properties: { id: c.id, name: c.ja, status: c.status, rank: c.rank, small: c.small },
            geometry: { type: 'Point', coordinates: [c.lx, c.ly] },
        })),
    };
}

function capitalGeoJSON(c) {
    return {
        type: 'FeatureCollection',
        features: (c ? c.caps : []).map(cap => ({
            type: 'Feature',
            properties: { name: cap.ja },
            geometry: { type: 'Point', coordinates: [cap.lon, cap.lat] },
        })),
    };
}

// ===== 地図 =====

/** 背景なしのスタイル（海の色だけ。国は addCountryLayers で足す）。 */
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

const statusColor = ['match', ['get', 'status'], 'un', STATUS_COLORS.un, 'nonun', STATUS_COLORS.nonun, 'disputed', STATUS_COLORS.disputed, STATUS_COLORS.dep];

/** 国の面・境界・名前・小さな国の丸印・首都の印。背景を替えたら（style.load）毎回足し直す。 */
function addCountryLayers() {
    const onTiles = state.bg === 'ofm';
    map.addSource('countries', { type: 'geojson', data: bordersGeoJSON });
    map.addSource('border-lines', { type: 'geojson', data: borderLinesGeoJSON });
    map.addSource('labels', { type: 'geojson', data: labelGeoJSON() });
    map.addSource('capitals', { type: 'geojson', data: capitalGeoJSON(countryById.get(state.selectedId)) });

    map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries',
        paint: { 'fill-color': statusColor, 'fill-opacity': onTiles ? 0.35 : 1 } });
    map.addLayer({ id: 'country-selected-fill', type: 'fill', source: 'countries',
        filter: ['==', ['get', 'id'], state.selectedId || ''],
        paint: { 'fill-color': '#2f6fed', 'fill-opacity': onTiles ? 0.25 : 0.22 } });
    map.addLayer({ id: 'country-line', type: 'line', source: 'border-lines',
        paint: { 'line-color': '#9aa3b2', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 5, 1] } });
    map.addLayer({ id: 'country-selected-line', type: 'line', source: 'countries',
        filter: ['==', ['get', 'id'], state.selectedId || ''],
        paint: { 'line-color': '#2f6fed', 'line-width': 2 } });

    // 小さな国の丸印（どの縮尺でも押せるように）
    map.addLayer({ id: 'small-dot', type: 'circle', source: 'labels', filter: ['==', ['get', 'small'], true],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 5, 6],
            'circle-color': statusColor,
            'circle-stroke-color': ['case', ['==', ['get', 'id'], state.selectedId || ''], '#2f6fed', '#6b7280'],
            'circle-stroke-width': ['case', ['==', ['get', 'id'], state.selectedId || ''], 2.5, 1],
        } });

    // 国名（背景の地図にも地名があるときは出さない）
    if (!onTiles) {
        map.addLayer({ id: 'country-label', type: 'symbol', source: 'labels',
            filter: ['any', ['==', ['get', 'status'], 'un'], ['==', ['get', 'status'], 'nonun'], ['>=', ['zoom'], 4]],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 5, 13],
                'symbol-sort-key': ['get', 'rank'],
                'text-variable-anchor': ['center', 'top', 'bottom'],
                'text-radial-offset': ['case', ['get', 'small'], 0.7, 0],
                'text-max-width': 6,
            },
            paint: { 'text-color': '#1a2744', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.2 } });
    }

    // 選んだ国の首都の印
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
        center: REGION_VIEWS[''].center,
        zoom: REGION_VIEWS[''].zoom,
        localIdeographFontFamily: LOCAL_FONT,   // 漢字・かなは端末の字で描く（段階0で決定）
        attributionControl: { compact: true, customAttribution: 'Natural Earth' },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    window.worldMap = map;   // 動作確認（Playwright）で地図の位置を計算するため
    map.on('style.load', () => {
        map.setProjection({ type: state.projection });
        addCountryLayers();
        collapseAttribution();
    });
    map.on('load', collapseAttribution);

    // 押した国を選ぶ。小さな国の丸印は指で押しやすいよう、まわり12pxまで拾う
    map.on('click', e => {
        const p = e.point;
        const near = map.queryRenderedFeatures([[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]], { layers: ['small-dot'] });
        const hit = near[0] || map.queryRenderedFeatures(p, { layers: ['country-fill'] })[0];
        if (hit) selectCountry(hit.properties.id, { fly: false });
    });
    map.on('mousemove', e => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['small-dot', 'country-fill'] });
        map.getCanvas().style.cursor = hit.length ? 'pointer' : '';
    });
}

function refreshSelectionOnMap() {
    if (!map || !map.getSource('countries')) return;
    const id = state.selectedId || '';
    map.setFilter('country-selected-fill', ['==', ['get', 'id'], id]);
    map.setFilter('country-selected-line', ['==', ['get', 'id'], id]);
    map.setPaintProperty('small-dot', 'circle-stroke-color', ['case', ['==', ['get', 'id'], id], '#2f6fed', '#6b7280']);
    map.setPaintProperty('small-dot', 'circle-stroke-width', ['case', ['==', ['get', 'id'], id], 2.5, 1]);
    map.getSource('capitals').setData(capitalGeoJSON(countryById.get(state.selectedId)));
}

/** 国へ寄せる。日付変更線をまたぐ国（外接の箱が180度を超える）は、名前の位置へ寄せる。 */
function flyToCountry(c) {
    const [x0, y0, x1, y1] = c.bbox;
    if (x1 - x0 > 180) {
        map.flyTo({ center: [c.lx, c.ly], zoom: 2 });
    } else {
        map.fitBounds([[x0, y0], [x1, y1]], { padding: 40, maxZoom: c.small ? 7 : 5.5, duration: 1200 });
    }
}

// ===== 選んだ国の表示 =====

function selectCountry(id, { fly = true } = {}) {
    const c = countryById.get(id);
    if (!c) return;
    state.selectedId = id;
    renderCountry(c);
    refreshSelectionOnMap();
    if (fly) flyToCountry(c);
    renderList();
}

function renderCountry(c) {
    $('country-hint').hidden = true;
    $('country-info').hidden = false;
    const flag = $('country-flag');
    if (c.iso2) {
        flag.src = FLAG_URL(c.iso2);
        flag.alt = `${c.ja}の旗`;
        flag.hidden = false;
    } else {
        flag.removeAttribute('src');
        flag.hidden = true;
    }
    $('country-name').textContent = c.ja;
    $('country-en').textContent = c.en;

    const statusEl = $('country-status');
    statusEl.innerHTML = '';
    const badge = document.createElement('span');
    badge.className = `badge badge-${c.status}`;
    badge.textContent = STATUS_LABELS[c.status];
    statusEl.appendChild(badge);
    if (c.sov) statusEl.append(`　${c.sov}${c.id === 'USG' ? '' : 'の領域'}`);

    $('country-region').textContent = c.sub && c.sub !== c.cont ? `${c.cont}（${c.sub}）` : c.cont;

    const capEl = $('country-capitals');
    capEl.innerHTML = '';
    if (!c.caps.length) {
        capEl.textContent = '—';
    } else {
        c.caps.forEach(cap => {
            const div = document.createElement('div');
            div.textContent = `${cap.ja}（${cap.en}）`;
            if (cap.note) {
                const note = document.createElement('span');
                note.className = 'cap-note';
                note.textContent = `　${cap.note}`;
                div.appendChild(note);
            }
            capEl.appendChild(div);
        });
    }
}

// ===== 一覧・検索 =====

/** ひらがなをカタカナに（「ふらんす」でも「フランス」が見つかるように）。 */
function toKatakana(s) {
    return s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

function matchesQuery(c, q) {
    if (!q) return true;
    const qk = toKatakana(q);
    const qe = q.toLowerCase();
    if (c.ja.includes(qk) || c.ja.includes(q) || c.en.toLowerCase().includes(qe)) return true;
    return c.caps.some(cap => cap.ja.includes(qk) || cap.ja.includes(q) || cap.en.toLowerCase().includes(qe));
}

function renderList() {
    const listEl = $('country-list');
    const q = state.query.trim();
    const rows = countries.filter(c =>
        (state.kind === 'all' || c.status === 'un') &&
        (!state.region || c.cont === state.region) &&
        matchesQuery(c, q));

    const unCount = rows.filter(c => c.status === 'un').length;
    $('list-count').textContent = state.kind === 'all'
        ? `${rows.length} 件（国連加盟国 ${unCount}）`
        : `${rows.length} か国`;

    listEl.innerHTML = '';
    if (!rows.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '見つかりません';
        listEl.appendChild(li);
        return;
    }
    const frag = document.createDocumentFragment();
    rows.forEach(c => {
        const li = document.createElement('li');
        li.dataset.id = c.id;
        if (c.id === state.selectedId) li.classList.add('selected');
        if (c.iso2) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = FLAG_URL(c.iso2);
            img.alt = '';
            li.appendChild(img);
        } else {
            const blank = document.createElement('span');
            blank.className = 'flag-blank';
            li.appendChild(blank);
        }
        const name = document.createElement('span');
        name.className = 'li-name';
        name.textContent = c.ja;
        const en = document.createElement('span');
        en.className = 'li-en';
        en.textContent = c.status === 'un' ? c.en : `${c.en}・${STATUS_LABELS[c.status]}`;
        name.appendChild(en);
        li.appendChild(name);
        frag.appendChild(li);
    });
    listEl.appendChild(frag);
}

$('country-list').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    selectCountry(li.dataset.id);
    $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('search-input').addEventListener('input', e => {
    state.query = e.target.value;
    renderList();
});

// ===== ボタン =====

function setupSeg(id, key, onChange) {
    $(id).addEventListener('click', e => {
        const btn = e.target.closest('button[data-v]');
        if (!btn || state[key] === btn.dataset.v) return;
        state[key] = btn.dataset.v;
        $(id).querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        onChange();
    });
}
setupSeg('kind-seg', 'kind', renderList);
setupSeg('proj-seg', 'projection', () => map.setProjection({ type: state.projection }));
setupSeg('bg-seg', 'bg', () => setStyleForBackground().catch(error => alert(`背景の地図を読み込めませんでした：${error.message}`)));

$('region-bar').addEventListener('click', e => {
    const btn = e.target.closest('button[data-region]');
    if (!btn) return;
    state.region = btn.dataset.region;
    $('region-bar').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    const view = REGION_VIEWS[state.region];
    map.flyTo({ center: view.center, zoom: view.zoom, duration: 1200 });
    renderList();
});

// ===== はじめ =====
(async () => {
    try {
        await loadData();
    } catch (error) {
        $('country-hint').textContent = `国のデータを読み込めませんでした（${error.message}）。キャッシュ更新を押してください。`;
        return;
    }
    renderList();
    buildMap();
})();
