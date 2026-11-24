# japan の data/ を作る：国土数値情報「行政区域」（N03）を mapshaper で県ごとにまとめて軽くし、県の情報（prefs.json）を作る
#
# 使い方（README.md の「データの作り方」）：
#   python build_data.py <N03のシェープファイル（.shp）> [簡略化の割合（既定 0.7%）] [小さな島を落とす面積 km²（既定 0.5）]
#   N03 は https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html の全国版（zip、約800MB）。
#   zip から N03-YYYYMMDD.shp/.shx/.dbf/.cpg/.prj を取り出して渡す。元データはリポジトリに置かない。mapshaper は npx で動かす。
# 北方領土（根室振興局の6村・歯舞群島は根室市）・竹島（隠岐の島町）は N03 に入っている（2026年版で確認）。
# 竹島・沖ノ鳥島・南鳥島などの小さな島は、面積で落とさずに残す（KEEP_BOXES）。
import json, subprocess, os, sys, math, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prefs_table import PREFS, REGIONS, CAPITAL_WARD

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
SRC = sys.argv[1]
SIMPLIFY = sys.argv[2] if len(sys.argv) > 2 else '0.7%'
MIN_KM2 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
SOURCE_URL = 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html'
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='japan-build-')

# 面積で落とさない小さな島（経度・緯度の箱）：竹島、沖ノ鳥島、南鳥島、尖閣諸島、与那国島の周り
KEEP_BOXES = [
    (131.8, 37.2, 131.95, 37.3),     # 竹島
    (136.0, 20.4, 136.15, 20.45),    # 沖ノ鳥島
    (153.9, 24.2, 154.05, 24.35),    # 南鳥島
    (123.4, 25.6, 124.6, 26.0),      # 尖閣諸島
]

def mapshaper(*args):
    subprocess.run(['npx', '-y', 'mapshaper', *args], check=True, shell=True)

name_to_code = {p[1]: p[0] for p in PREFS}
code_expr = 'code = N03_007 ? N03_007.slice(0,2) : (' + json.dumps(name_to_code, ensure_ascii=False) + ')[N03_001]'
keep_expr = ' || '.join(f'(this.bounds[0]>={a} && this.bounds[1]>={b} && this.bounds[2]<={c} && this.bounds[3]<={d})' for a, b, c, d in KEEP_BOXES)

# --- 1. 県の面：県コードを付けて県ごとにまとめ、小さな島（ほかと接しない面）を落としてから簡略化する ---
# 島を落とすのはまとめた後（まとめる前に面積で落とすと、内陸の小さな飛び地などが穴になるため）。
# 竹島などは KEEP_BOXES の箱にある面を別に取り出し、あとで足し戻す
mapshaper(SRC, '-each', code_expr, '-filter-fields', 'code', '-dissolve', 'code',
          '-filter-islands', f'min-area={MIN_KM2}km2', '-simplify', SIMPLIFY, 'keep-shapes', '-o', f'{TMP}/main.shp')
# 残す小さな島は簡略化しない（簡略化すると keep-shapes でも竹島などが消えたため。もともと頂点が少ないので軽い）
mapshaper(SRC, '-filter', keep_expr, '-each', code_expr, '-filter-fields', 'code', '-o', f'{TMP}/keep.shp')
mapshaper('-i', f'{TMP}/main.shp', f'{TMP}/keep.shp', 'combine-files', '-merge-layers', 'force',
          '-dissolve', 'code', '-o', f'{TMP}/prefs.geojson')
# -clean は使わない（竹島・沖ノ鳥島のような小さな島を「細い隙間」として消してしまうため。簡略化で交差は直る）
mapshaper(f'{TMP}/prefs.geojson', '-rename-layers', 'prefs', '-innerlines', '+', 'name=lines',
          '-o', 'format=topojson', 'quantization=100000', 'target=*', f'{OUT}/borders.json')
# 県名の位置（面の中の点）
mapshaper(f'{TMP}/prefs.geojson', '-points', 'inner', '-o', f'{TMP}/labels.geojson')

# --- 2. 県庁所在地の印：その市区の面（簡略化前）をまとめ、面の中の点 ---
# 政令指定都市は市全体だと中心が県庁から離れる（京都市など）ので、県庁のある区で取る（CAPITAL_WARD）
def cap_cond(p):
    ward = CAPITAL_WARD.get(p[0])
    cond = f"N03_001=='{p[1]}' && N03_004=='{p[8]}'"
    return f"({cond} && N03_005=='{ward}')" if ward else f"({cond})"
cap_expr = ' || '.join(cap_cond(p) for p in PREFS)
mapshaper(SRC, '-filter', cap_expr, '-each', code_expr, '-dissolve', 'code', '-points', 'inner', '-o', f'{TMP}/capitals.geojson')

# --- 3. 県の情報 ---
def ring_area(ring):
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:]))) / 2

def parts(geom):
    return [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']

def fly_bbox(geom):
    """寄せる先の箱：いちばん大きい島の5%以上の島だけで取る（東京都の小笠原・南鳥島などで箱が広がりすぎないように）。"""
    ps = parts(geom)
    areas = [ring_area(p[0]) for p in ps]
    big = max(areas)
    xs, ys = [], []
    for p, a in zip(ps, areas):
        if a >= big * 0.05:
            xs += [c[0] for c in p[0]]
            ys += [c[1] for c in p[0]]
    return [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)]

geo = {f['properties']['code']: f['geometry'] for f in json.load(open(f'{TMP}/prefs.geojson', encoding='utf-8'))['features']}
labels = {f['properties']['code']: f['geometry']['coordinates'] for f in json.load(open(f'{TMP}/labels.geojson', encoding='utf-8'))['features']}
caps = {f['properties']['code']: f['geometry']['coordinates'] for f in json.load(open(f'{TMP}/capitals.geojson', encoding='utf-8'))['features']}
assert set(geo) == set(labels) == set(caps) == {p[0] for p in PREFS}, (sorted(set(geo) ^ {p[0] for p in PREFS}), sorted(set(caps)))

prefs = []
for code, ja, kana, en, region, cap_ja, cap_kana, cap_en, _ in PREFS:
    lx, ly = labels[code]
    cx, cy = caps[code]
    prefs.append({'code': code, 'ja': ja, 'kana': kana, 'en': en, 'region': region,
                  'cap': {'ja': cap_ja, 'kana': cap_kana, 'en': cap_en, 'lon': round(cx, 4), 'lat': round(cy, 4)},
                  'lx': round(lx, 4), 'ly': round(ly, 4), 'bbox': fly_bbox(geo[code])})

regions = {}
for r in REGIONS:
    bs = [p['bbox'] for p in prefs if p['region'] == r]
    regions[r] = [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)]

json.dump({'source': f'国土数値情報（行政区域データ）N03 2026年版（国土交通省、CC BY 4.0）{SOURCE_URL} をもとに作成。県ごとにまとめ、mapshaper で簡略化 {SIMPLIFY}、{MIN_KM2}km²未満の島を除く（竹島・沖ノ鳥島・南鳥島・尖閣諸島は残す）',
           'prefs': prefs, 'regions': regions},
          open(f'{OUT}/prefs.json', 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, separators=(',', ':'))
print('prefs', len(prefs), 'borders.json', os.path.getsize(f'{OUT}/borders.json'), 'bytes', 'prefs.json', os.path.getsize(f'{OUT}/prefs.json'), 'bytes')
