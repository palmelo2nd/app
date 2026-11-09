# world（世界地図アプリ）の決まり

共通ルールは `app/CLAUDE.md` と `app/DESIGN.md`。ここには world だけの決まりを書く。

- **公開リポジトリに置かないもの**：APIキー・トークン・中継URLのような端末ごとの設定（端末の localStorage に `world-` で始まるキーで置く）、再配布が禁止されたデータ（OpenSky の取得結果など）。**Why:** `app` は public で GitHub Pages から誰でも読めるため。
- **キャッシュ名**：Cache Storage・localStorage のキーは `world-` で始める。「キャッシュ更新」で消すのも `world-` で始まるものだけ（`app/CLAUDE.md` 2章）。
- **地図ライブラリ**：MapLibre GL JS 6（ESMだけの配布なので `import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@<版>/dist/maplibre-gl.mjs'`）。版は固定で書く。
- **日本語の文字は「端末の字」**（`localIdeographFontFamily`）を使う。**Why:** 段階0の確認で、サーバーの字にすると漢字・かなの配信が36〜38件（約400KB）増え、表示も遅くなったため。ラテン文字用に `glyphs`（OpenFreeMap の `Noto Sans Regular`）は要る。
- **飛行機の取得はブラウザから直接できない**（OpenSky・adsb.lol・adsb.fi とも CORS で拒否。OpenSky は `Access-Control-Allow-Origin: https://opensky-network.org` 固定）。段階2では中継（Cloudflare Workers など）を通す。
- **地球儀で日付変更線をまたぐ国**（ロシアなど）は、データによって北極のまわりに輪のような乱れが出る（world-atlas 110m のロシアで確認）。段階1で Natural Earth を mapshaper で加工したら、地球儀で必ず確かめる。

経緯：`app_data/docs/world/261110_段階0_試作.md`
