# world（世界地図アプリ）の決まり

共通ルールは `app/CLAUDE.md` と `app/DESIGN.md`。ここには world だけの決まりを書く。

- **公開リポジトリに置かないもの**：APIキー・トークン・中継URLのような端末ごとの設定（端末の localStorage に `world-` で始まるキーで置く）、再配布が禁止されたデータ（OpenSky の取得結果など）。**Why:** `app` は public で GitHub Pages から誰でも読めるため。
- **キャッシュ名**：Cache Storage・localStorage のキーは `world-` で始める。「キャッシュ更新」で消すのも `world-` で始まるものだけ（`app/CLAUDE.md` 2章）。
- **地図ライブラリ**：MapLibre GL JS 6（ESMだけの配布なので `import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@<版>/dist/maplibre-gl.mjs'`）。版は固定で書く。
- **日本語の文字は「端末の字」**（`localIdeographFontFamily`）を使う。**Why:** 段階0の確認で、サーバーの字にすると漢字・かなの配信が36〜38件（約400KB）増え、表示も遅くなったため。ラテン文字用に `glyphs`（OpenFreeMap の `Noto Sans Regular`）は要る。
- **飛行機の取得はブラウザから直接できない**（OpenSky・adsb.lol・adsb.fi とも CORS で拒否。OpenSky は `Access-Control-Allow-Origin: https://opensky-network.org` 固定）。段階2では中継（Cloudflare Workers など）を通す。
- **地球儀で日付変更線をまたぐ国**（ロシア・フィジー・米国・キリバス）：Natural Earth は±180°で切ってあるので面は乱れない（段階0の world-atlas 110m ではロシアが北極のまわりに乱れた）。ただし国の外周をそのまま線にすると±180°に縦線が出るので、**境界の線は国と国が接する線（mapshaper の `-innerlines`、`borders.json` の `lines`）だけを描く**。国へ寄せるときも、外接の箱が180°を超える国（ロシアなど）は名前の位置へ寄せる（`flyToCountry`）。データを作り直したら、地球儀でチュクチ半島・フィジー・アリューシャンを見て確かめる。
- **データは `tools/build_data.py` で作る**（手で `data/` を直さない）。国の名前の言い換え（`NAME_FIX`、外務省の略称にそろえる）、首都の手直し（`CAPITAL_FIX`。Natural Earth の Admin-0 capital(alt) には旧首都・最大都市・係争地の都市が混じる。例：日本に京都、モロッコにアイウン）、国連加盟国193の一覧（`UN`）もここにある。**Why:** Natural Earth を新しい版にしたときに、同じ手直しをもう一度かけられるようにするため。
- **「国」は国連加盟国193**。区分は `status`（`un`／`nonun`＝バチカン・コソボ・台湾・パレスチナ／`dep`＝属領・自治領など／`disputed`＝Natural Earth で Disputed・Indeterminate のもの）。色は `css/style.css` の `--st-*` と `js/app.js` の `STATUS_COLORS` の両方にある（そろえて変える）。
- **データのキャッシュバスティング**：`data/` は `?v=`（`js/app.js` の `DATA_VERSION`＝自分の `?v=`）で読む。データを作り直したら `index.html` の `?v=` を上げる。

経緯：`app_data/docs/world/261110_段階0_試作.md`・`261110_段階1_国を知る.md`
