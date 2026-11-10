# world の data/ を作る：Natural Earth 10m 日本見解版（_jpn）を mapshaper で軽くし、国の情報（名前・国旗・首都・地域・区分）をまとめる
#
# 使い方（README.md の「データの作り方」）：
#   python build_data.py <元データのフォルダ> [簡略化の割合（既定 10%）]
#   元データのフォルダには Natural Earth の GitHub（nvkelso/natural-earth-vector）の geojson/ から
#   ne_10m_admin_0_countries_jpn.geojson と ne_10m_populated_places.geojson を置く。mapshaper は npx で動かす。
# Natural Earth の _jpn は 10m にしか無いので、10m を 10% に簡略化して 50m 相当の細かさにしている。
import json, subprocess, collections, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
RAW_DIR = sys.argv[1]
SIMPLIFY = sys.argv[2] if len(sys.argv) > 2 else '10%'
os.makedirs(OUT, exist_ok=True)

UN = set("""AFG ALB DZA AND AGO ATG ARG ARM AUS AUT AZE BHS BHR BGD BRB BLR BEL BLZ BEN BTN BOL BIH BWA BRA BRN BGR BFA BDI CPV KHM CMR CAN CAF TCD CHL CHN COL COM COG CRI CIV HRV CUB CYP CZE PRK COD DNK DJI DMA DOM ECU EGY SLV GNQ ERI EST SWZ ETH FJI FIN FRA GAB GMB GEO DEU GHA GRC GRD GTM GIN GNB GUY HTI HND HUN ISL IND IDN IRN IRQ IRL ISR ITA JAM JPN JOR KAZ KEN KIR KWT KGZ LAO LVA LBN LSO LBR LBY LIE LTU LUX MDG MWI MYS MDV MLI MLT MHL MRT MUS MEX FSM MCO MNG MNE MAR MOZ MMR NAM NRU NPL NLD NZL NIC NER NGA MKD NOR OMN PAK PLW PAN PNG PRY PER PHL POL PRT QAT KOR MDA ROU RUS RWA KNA LCA VCT WSM SMR STP SAU SEN SRB SYC SLE SGP SVK SVN SLB SOM ZAF SSD ESP LKA SDN SUR SWE CHE SYR TJK THA TLS TGO TON TTO TUN TUR TKM TUV UGA UKR ARE GBR TZA USA URY UZB VUT VEN VNM YEM ZMB ZWE""".split())
assert len(UN) == 193
NE_TO_ISO = {'SDS': 'SSD'}            # Natural Earth の ADM0_A3 が ISO と違うもの
NON_UN_STATES = {'VAT', 'KOS', 'TWN', 'PSX'}   # 国連に加盟していない国（オブザーバー・承認が分かれる国）

# 名前：Natural Earth の NAME_JA は正式名に近いものがあるので、ふだん使う名前（外務省の略称）にそろえる
NAME_FIX = {'TWN': '台湾', 'KOS': 'コソボ', 'PGA': '南沙諸島', 'USA': 'アメリカ合衆国',
            'CHN': '中国', 'KOR': '韓国', 'PRK': '北朝鮮', 'THA': 'タイ', 'MLI': 'マリ', 'MNG': 'モンゴル',
            'CAF': '中央アフリカ', 'ZAF': '南アフリカ'}

# 首都：Natural Earth の Admin-0 capital(alt) には、旧首都・最大都市・係争地の都市が混じるので、複数あるものは手で決める
CAPITAL_FIX = {
    'JPN': [('東京', 'Tokyo', '')],
    'CHN': [('北京', 'Beijing', '')],
    'TWN': [('台北', 'Taipei', '')],
    'KOR': [('ソウル', 'Seoul', '')],
    'BEN': [('ポルトノボ', 'Porto-Novo', '憲法上の首都'), ('コトヌー', 'Cotonou', '政府の所在地')],
    'BOL': [('スクレ', 'Sucre', '憲法上の首都'), ('ラパス', 'La Paz', '政府の所在地')],
    'CHL': [('サンティアゴ', 'Santiago', '')],
    'CIV': [('ヤムスクロ', 'Yamoussoukro', '首都'), ('アビジャン', 'Abidjan', '事実上の首都（政府機関の多く）')],
    'ISR': [('エルサレム', 'Jerusalem', 'イスラエルが首都とする（日本など多くの国は認めていない）'), ('テルアビブ', 'Tel Aviv', '日本など多くの国が大使館を置く')],
    'LKA': [('スリジャヤワルダナプラコッテ', 'Sri Jayawardenepura Kotte', '首都'), ('コロンボ', 'Colombo', '最大の都市・行政の中心')],
    'MAR': [('ラバト', 'Rabat', '')],
    'MMR': [('ネピドー', 'Naypyidaw', '')],
    'MYS': [('クアラルンプール', 'Kuala Lumpur', '首都'), ('プトラジャヤ', 'Putrajaya', '行政の中心')],
    'NGA': [('アブジャ', 'Abuja', '')],
    'NLD': [('アムステルダム', 'Amsterdam', '憲法上の首都'), ('ハーグ', 'The Hague', '政府・国会の所在地')],
    'PHL': [('マニラ', 'Manila', '')],
    'SWZ': [('ムババーネ', 'Mbabane', '行政上の首都'), ('ロバンバ', 'Lobamba', '王室・国会の所在地')],
    'TZA': [('ドドマ', 'Dodoma', '首都'), ('ダルエスサラーム', 'Dar es Salaam', '最大の都市・旧首都')],
    'ZAF': [('プレトリア', 'Pretoria', '行政上の首都'), ('ケープタウン', 'Cape Town', '立法上の首都'), ('ブルームフォンテーン', 'Bloemfontein', '司法上の首都')],
    'PSX': [('ラマッラー', 'Ramallah', '自治政府の所在地')],
    'SDS': [('ジュバ', 'Juba', '')],
    'NRU': [('ヤレン', 'Yaren', '公式の首都はなく、政府の所在地', (166.920, -0.547))],
}

CONTINENT_JA = {'Asia': 'アジア', 'Europe': 'ヨーロッパ', 'Africa': 'アフリカ', 'North America': '北アメリカ',
                'South America': '南アメリカ', 'Oceania': 'オセアニア', 'Antarctica': '南極', 'Seven seas (open ocean)': 'インド洋・大西洋の島'}
SUBREGION_JA = {
    'Eastern Asia': '東アジア', 'South-Eastern Asia': '東南アジア', 'Southern Asia': '南アジア', 'Central Asia': '中央アジア', 'Western Asia': '西アジア',
    'Northern Europe': '北ヨーロッパ', 'Western Europe': '西ヨーロッパ', 'Southern Europe': '南ヨーロッパ', 'Eastern Europe': '東ヨーロッパ',
    'Northern Africa': '北アフリカ', 'Western Africa': '西アフリカ', 'Middle Africa': '中部アフリカ', 'Eastern Africa': '東アフリカ', 'Southern Africa': '南部アフリカ',
    'Northern America': '北アメリカ', 'Central America': '中央アメリカ', 'Caribbean': 'カリブ', 'South America': '南アメリカ',
    'Australia and New Zealand': 'オーストラリア・ニュージーランド', 'Melanesia': 'メラネシア', 'Micronesia': 'ミクロネシア', 'Polynesia': 'ポリネシア',
    'Antarctica': '南極', 'Seven seas (open ocean)': '大洋の島',
}

RAW = os.path.join(RAW_DIR, 'ne_10m_admin_0_countries_jpn.geojson')
src = json.load(open(RAW, encoding='utf-8'))['features']
places = json.load(open(os.path.join(RAW_DIR, 'ne_10m_populated_places.geojson'), encoding='utf-8'))['features']

# --- 国境：mapshaper で軽くして TopoJSON に（持つ属性は id だけ） ---
# 境界の線は国と国が接する線（innerlines）だけにする。国の外周をそのまま線にすると、日付変更線（±180°）で切った所に縦線が出るため
subprocess.run(['npx', 'mapshaper', RAW, '-filter-fields', 'ADM0_A3', '-rename-fields', 'id=ADM0_A3', '-rename-layers', 'countries',
                '-simplify', SIMPLIFY, 'keep-shapes', '-clean',
                '-innerlines', '+', 'name=lines',
                '-o', 'format=topojson', 'quantization=100000', 'target=*', f'{OUT}/borders.json'], check=True, shell=True)

# 簡略化後の形から外接の大きさを測る（小さな国を丸印にするため）
topo = json.load(open(f'{OUT}/borders.json', encoding='utf-8'))

# --- 国の情報 ---
by_admin = {f['properties']['ADMIN']: f['properties'] for f in src}
cap_src = collections.defaultdict(list)
for f in places:
    p = f['properties']
    if p['FEATURECLA'] in ('Admin-0 capital', 'Admin-0 capital alt'):
        cap_src[p['ADM0_A3']].append(p)
place_by_en = {}
for f in places:
    p = f['properties']
    place_by_en.setdefault(p['NAME'], p)
    place_by_en.setdefault(p['NAMEASCII'], p)

def bbox_of(geom):
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: walk(x)
    walk(geom['coordinates'])
    return min(xs), min(ys), max(xs), max(ys)

def area_deg2(geom):
    # 外周の面積（度の二乗、緯度で補正）。小さな国の判定だけに使う
    import math
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    total = 0
    for poly in polys:
        ring = poly[0]; s = 0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            s += (x2 - x1) * (y1 + y2) / 2
        lat = sum(y for _, y in ring) / len(ring)
        total += abs(s) * math.cos(math.radians(lat))
    return total

def continent_ja(p):
    # 「Seven seas（大洋の島）」の国（モルディブ・モーリシャス・セーシェルなど）は、国連の地域分けで大陸に入れる
    if p['CONTINENT'] == 'Seven seas (open ocean)':
        if p['REGION_UN'] == 'Asia': return 'アジア'
        if p['REGION_UN'] == 'Africa': return 'アフリカ'
        if p['REGION_UN'] == 'Americas': return '南アメリカ' if p['SUBREGION'] == 'South America' else '北アメリカ'
    return CONTINENT_JA[p['CONTINENT']]

countries = []
for f in src:
    p = f['properties']
    a3 = p['ADM0_A3']
    iso3 = NE_TO_ISO.get(a3, a3)
    if iso3 in UN: status = 'un'
    elif a3 in NON_UN_STATES: status = 'nonun'
    elif p['TYPE'] in ('Disputed', 'Indeterminate'): status = 'disputed'
    else: status = 'dep'
    ja = NAME_FIX.get(a3) or p['NAME_JA'] or p['NAME']
    sov = ''
    if a3 == 'USG':
        sov = 'キューバ（アメリカ合衆国が租借）'
    elif status == 'dep' or (status == 'disputed' and p['SOVEREIGNT'] != p['ADMIN']):
        sp = by_admin.get(p['SOVEREIGNT'])
        sov = (NAME_FIX.get(sp['ADM0_A3']) or sp['NAME_JA']) if sp else p['SOVEREIGNT']
    # 首都
    caps = []
    if a3 in CAPITAL_FIX:
        for cja, cen, note, *pos in CAPITAL_FIX[a3]:
            if pos:   # Natural Earth に無い町は座標を直接書く
                lon, lat = pos[0]
            else:
                q = place_by_en.get(cen)
                assert q, (a3, cen)
                lon, lat = q['LONGITUDE'], q['LATITUDE']
            caps.append({'ja': cja, 'en': cen, 'note': note, 'lon': round(lon, 3), 'lat': round(lat, 3)})
    else:
        for q in cap_src.get(a3, []):
            caps.append({'ja': q['NAME_JA'] or q['NAME'], 'en': q['NAME'], 'note': '', 'lon': round(q['LONGITUDE'], 3), 'lat': round(q['LATITUDE'], 3)})
    if status == 'un':
        assert len(caps) >= 1, (a3, ja)
    x0, y0, x1, y1 = bbox_of(f['geometry'])
    area = area_deg2(f['geometry'])
    iso2 = p['ISO_A2_EH'] if p['ISO_A2_EH'] not in ('-99', None) else ''
    countries.append({
        'id': a3, 'ja': ja, 'en': p['NAME_EN'] or p['NAME'], 'iso2': iso2.lower(), 'status': status, 'sov': sov,
        'cont': continent_ja(p), 'sub': SUBREGION_JA.get(p['SUBREGION'], p['SUBREGION']),
        'lx': round(p['LABEL_X'], 3), 'ly': round(p['LABEL_Y'], 3),
        'bbox': [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
        'small': area < 1.0,           # 約1万km²未満（目安）。どの縮尺でも押せるよう丸印を出す
        'rank': p['LABELRANK'],
        'caps': caps,
    })

countries.sort(key=lambda c: c['ja'])
json.dump({'source': 'Natural Earth 10m admin 0 countries (Japan POV) / populated places, v5.2.0-pre（パブリックドメイン）。mapshaper で簡略化 ' + SIMPLIFY,
           'countries': countries}, open(f'{OUT}/countries.json', 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, separators=(',', ':'))
c = collections.Counter(x['status'] for x in countries)
print('status', dict(c), 'small', sum(x['small'] for x in countries))
print('sizes', os.path.getsize(f'{OUT}/borders.json'), os.path.getsize(f'{OUT}/countries.json'))
