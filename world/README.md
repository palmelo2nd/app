# World（世界地図）

世界地図で、国・飛行機・紛争・物流などを見るアプリ（個人用、メニューは index_my だけ）。地図は MapLibre GL JS（背景地図なし・地球儀が基本）。

## 今の状態：段階1「国を知る」（2026-11-10）
- **地図**：国を区分ごとに色分けして表示（国連加盟国193／国連非加盟の国・地域／属領・自治領など／係争地など）。国境は Natural Earth の日本見解版。「表示」で地球儀・平面、背景なし・地図（OpenFreeMap、拡大して見たいとき）を切り替える
- **国を選ぶ**：地図の国を押す（小さな国は丸印。まわり12pxまで拾う）か、一覧から選ぶ。国名（日本語・英語）・国旗・区分（属領はどこの国の領域か）・地域・首都（複数あれば全部、役割の説明つき）が出て、地図の首都に赤い印が付く。一覧から選ぶとその国へ寄せる
- **地域ボタン**（地図の上）：全体・アジア・ヨーロッパ・アフリカ・北アメリカ・南アメリカ・オセアニア。その地域へ寄せ、一覧もその地域に絞る
- **一覧・検索**：国名・首都を日本語（ひらがなでも可）・英語で探す。既定は国連加盟国だけ、「すべての地域」で250件
- 出典の表示は右下の「i」（最初は閉じている）

## データ（`data/`）
- `borders.json`：国の面（`countries`、属性は `id`＝Natural Earth の ADM0_A3）と、国と国が接する線（`lines`）の TopoJSON。約500KB
- `countries.json`：国ごとの情報（`ja`・`en`・`iso2`（国旗）・`status`・`sov`（属領の宗主国）・`cont`/`sub`（地域）・`lx`/`ly`（名前の位置）・`bbox`・`small`・`caps`（首都））。約75KB
- 作り方：`tools/build_data.py`（Natural Earth 10m `_jpn` を mapshaper で 10% に簡略化。名前の言い換え・首都の手直し・国連加盟国の一覧もこの中）
  ```
  python world/tools/build_data.py <ne_10m_admin_0_countries_jpn.geojson と ne_10m_populated_places.geojson を置いたフォルダ>
  ```
- 出典：Natural Earth（パブリックドメイン）、国旗は flag-icons（MIT、jsDelivr から読む）

## 今後
- 段階2以降：飛行機（OpenSky。ブラウザから直接取れないので中継が要る）、紛争（UCDP）、物流（IMF PortWatch）

計画と結果：`app_data/docs/world/`
