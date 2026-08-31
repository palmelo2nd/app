# 技術調査

スマホアプリ化（iOS/Android向けストア配信）の技術方針を検討・記録するフォルダ。

## 中身

| ファイル | 役割 |
|---|---|
| （本README） | アプリ化方式（Capacitor等）の比較・検討 |
| [データ構造設計.md](./データ構造設計.md) | 10級〜1級・9ジャンル対応のための`data/`配下のスキーマ設計（未承認） |
| [外部データソース調査.md](./外部データソース調査.md) | 1級までの級別漢字一覧を外部から調達するためのデータソース調査（CC0データセットを特定） |
| [意味データ_未解決文字リスト.md](./意味データ_未解決文字リスト.md) | Wiktionaryで意味が見つからなかった字の一覧（級別）。今後の追加調査・辞書での人手確認の対象リスト |
| [熟語データ拡張_調査.md](./熟語データ拡張_調査.md) | `jukugo.json`を学年2以上に拡張するための出典調査。熟字訓（読みが独特な熟語）の扱いに関する課題と対応案 |

## 方針（2026-08-29時点）

既存の`03_開発`（Web版：`index.html`/`css/`/`js/`）はHTML/CSS/JSベースのまま維持し、これをネイティブアプリとして配信できる形にラップする方向で検討する。フルスクラッチでのネイティブ書き直し（React Native/Flutter等）は現時点では選ばない。

## 検討中の選択肢（ラップ方式の比較）

| 方式 | 概要 | メリット | 留意点 |
|---|---|---|---|
| **Capacitor**（Ionic製） | 既存Web資産をWebViewで包み、ネイティブAPI（ファイル・通知等）にJSからアクセス可能にするブリッジ | 現状の`js/modules`構成をほぼそのまま流用できる。ストア審査実績が豊富。プラグインエコシステムが活発 | ビルドにXcode（iOS）／Android Studio（Android）が必要。ネイティブっぽい操作感の作り込みは別途必要 |
| **Cordova/PhoneGap** | Capacitorの前身にあたる同種の仕組み | 情報量が多く枯れている | 近年はCapacitorへの移行が主流、新規採用は下火 |
| **PWA + TWA（Trusted Web Activity）** | PWA化してAndroidはTWAでPlay Storeに、iOSはApp Clip/ホーム画面追加等で対応 | 追加のネイティブビルド環境が不要な場合がある | iOSでのPWAはApp Store配信に制約が大きく、iOS/Android両対応の要件を満たしにくい |

現状、**Capacitor**が「既存資産の流用度」「ストア配信実績」の両面で最有力候補。ただし以下は要調査。

## Capacitorと「言語で並行開発」系（React Native/Flutter）の違い（2026-08-29追記）

「VSCodeでiOS/Android向けを並行開発できる言語」というのは、おそらく**React Native**（JavaScript/TypeScript）か**Flutter**（Dart）のことを指している。これらとCapacitorは考え方が根本的に異なる。

- **Capacitorは新しい言語ではない**。今のkanziアプリ（HTML/CSS/バニラJS）を**ほぼそのまま**、ネイティブアプリの殻（WebView）で包む仕組み。アプリの中身は変わらず「Webページ」のまま
- **React Native／Flutterは、UIをネイティブの部品として作り直す**フレームワーク。HTML/CSS/DOMは使わず、それぞれ専用の書き方でボタンや画面を組み立てる。既存の`index.html`／`css/style.css`はそのままでは使えず、画面（UI）は事実上作り直しになる

| 項目 | Capacitor（現行維持） | React Native | Flutter |
|---|---|---|---|
| 言語 | HTML/CSS/JavaScript（今のまま） | JavaScript／TypeScript | Dart（新しく習得が必要） |
| 既存コード資産の再利用度 | 非常に高い（ほぼそのまま） | 中〜低（`progress.js`等の純粋なロジックはJSのまま流用しやすいが、`app.js`のDOM操作・`index.html`・`style.css`は書き直し） | 低い（言語自体が別物なので、ロジックも含め実質的に書き直し） |
| UIの実体 | WebView内のHTML/CSS（Webページと同じ） | JSから実際のiOS/Android標準UI部品を操作（見た目はよりネイティブに近い） | Flutter自身の描画エンジンが画面を全部自前で描く（OS標準部品は使わない。プラットフォーム間の見た目は逆に統一されやすい） |
| VSCode対応 | 対応（普通のWeb開発＋Capacitor CLI） | 対応（拡張機能が充実、定番の組み合わせ） | 対応（Flutter/Dart拡張が非常に充実、Google公式もVSCodeを推奨） |
| ネイティブらしい操作感 | やや弱い（Webの延長線） | 高い | 高い（ただし独自描画のため、OS標準UIと細部の挙動が微妙に異なる場合がある） |
| このアプリでの開発規模の目安 | 最小（既存資産をほぼ活用） | 中規模の作り直し | 最大規模の作り直し（言語習得コストも加わる） |

### 全方式共通の重要な制約：iOSビルドにはXcode（Mac環境）が必要

**Capacitor／React Native／Flutterのどれを選んでも、iOSアプリの最終ビルド・ストア提出にはApple製のXcodeが必要で、これはWindows上のVSCodeだけでは完結しない。** VSCodeはあくまで「コードを書くエディタ」で、iOS向けの最終的なコンパイル・署名・提出作業はmacOS上のXcodeでしか行えない（これはどのフレームワークを使っても変わらないAppleの制約）。対応方法は主に2つ：

- 実機のMacを用意する（購入／中古／レンタル）
- クラウドビルドサービスを使う（例：Capacitor＝Ionic Appflow・Codemagic、React Native＝Expo EAS Build、Flutter＝Codemagic等。VSCode上で書いたコードをクラウドへpushし、クラウド上のMacでビルドしてもらう）

Android側はWindows＋Android Studio（またはCapacitor/RN/FlutterのCLI）だけで完結できる。

### 現時点の推奨

既存のkanziアプリが100%HTML/CSS/バニラJSで、[CLAUDE.md](../CLAUDE.md)にモジュール構成の厳格なルールもある状態なので、**Capacitorでの現行維持がもっとも投資対効果が高い**。React Native/Flutterへの切り替えは「UIを事実上作り直す」規模の投資になるため、[00_市場調査](../00_市場調査/README.md)で見えてきた「段階的アンロックでUIの継続性を武器にする」という戦略とも相性が良いのはCapacitor側（画面の作り自体を変えずに済むため）。RN/Flutterへの切り替えは、Capacitorで実際に配信してみて「Webの限界」を感じてから再検討するのでも遅くない。

## 未調査・要確認事項

- [ ] Capacitorでの`fetch`（`data/kanjiMaster.json`読み込み）・LocalStorage・GitHub API通信（`github.js`）がWebView上で問題なく動作するか
- [ ] オフライン対応（現状の設計の核）がCapacitor環境でも同様に機能するか
- [ ] Apple Developer Program（年額）／Google Play Developer（登録料）の費用・審査要件
- [ ] アプリ内でのGitHub Personal Access Token入力UIが、ストア審査（プライバシー・セキュリティ要件）上問題にならないか
- [ ] オフラインファースト設計とストアの「ネットワーク常時接続を前提としないこと」等のガイドラインとの整合
- [ ] 課金機能を入れる場合、ストア課金（In-App Purchase／Google Play Billing）の実装要否（[00_市場調査](../00_市場調査/README.md)の価格モデル検討と連動）
- [ ] iOSビルド環境の確保（Mac実機を用意するか、クラウドビルドサービスを使うか）の方針決定

## ステータス

- [x] ラップ方式の候補整理（本README）
- [ ] Capacitorでの動作検証（小さなプロトタイプでの疎通確認）
- [ ] 開発環境構築手順の確立（Xcode/Android Studio）
