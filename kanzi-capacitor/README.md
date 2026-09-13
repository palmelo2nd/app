# kanzi-capacitor

[kanzi](../kanzi/)（漢字検定対策アプリ）をCapacitorでネイティブアプリ（iOS/Android）化するためのラッパープロジェクト。2026-09-14作成。

## なぜ`kanzi/`の中ではなく兄弟フォルダか

当初`kanzi/capacitor/`（`kanzi/`直下）に作る想定だったが、CapacitorのCLIは`webDir`に`../`（親ディレクトリそのもの）を指定することを明示的に禁止している（`checkWebDir`が`['', '.', '..', '../', './']`を無効値として弾く）。`kanzi/`直下にネストする限りこの制約を避けられないため、`kanzi/`と同じ階層（兄弟ディレクトリ）に置くことにした。

## `www/`フォルダとsync-webスクリプト

CapacitorのCLIには`.capacitorignore`のような「webDir配下の一部だけ除外する」仕組みが無く、`webDir`に指定したフォルダを**丸ごと**ネイティブ側にコピーする。`kanzi/`をそのまま`webDir`にすると、`00_市場調査`等の企画ドキュメント・`CLAUDE.md`・`README.md`まで一緒にアプリへ同梱されてしまうため、実行に必要なファイルだけを`www/`へコピーしてから、それを`webDir`として使う方式にした。

- `scripts/sync-web.js`：`../kanzi/`から`index.html`・`css/`・`js/`・`data/`だけを`www/`へコピーする（それ以外の企画ドキュメント類は対象外）
- `www/`は**Gitで追跡しない**（`.gitignore`参照）。`kanzi/`側が唯一のソースであり、`www/`は毎回`sync-web`で作り直す派生物として扱う
- `npm run sync`で「sync-web実行 → `cap sync`（Android/iOS双方へ反映）」を一括実行する

**編集は必ず`kanzi/`側（`index.html`/`css/`/`js/`/`data/`）に対して行うこと。`www/`を直接編集しても次の`sync-web`実行で上書きされて消える。**

## アプリ情報

- **アプリ名**：漢字検定対策アプリ
- **バンドルID（`appId`）**：`com.oulab.kanzi`（**注意**：ストア登録後は変更不可。アプリ名は変更可能）

## RELEASE_BUILDフラグとの関係（重要）

`kanzi/js/app.js`の`RELEASE_BUILD`定数は、開発中は`false`のまま（TOPページからリリース／開発／設定を選べる、開発者向けの状態）。

**実際にストア提出用のネイティブビルドを作る際は、`kanzi/js/app.js`の`RELEASE_BUILD`を`true`に変更してから`npm run sync`を実行すること。** `true`にすると、アプリがTOPページを経由せず一般ユーザー向けの「リリース」フロー（タイトル→勉強モード→対象級→ジャンル→クイズ）から直接起動し、開発者専用機能（開発タブ・GitHub PAT同期欄）への導線も消える（詳細は[kanzi/CLAUDE.md](../kanzi/CLAUDE.md)「4. 実装の心得」参照）。開発を続ける場合は`false`に戻すのを忘れないこと。

## 現状のステータス（2026-09-14）

- [x] `npm install`（`@capacitor/core`・`@capacitor/android`・`@capacitor/ios`・`@capacitor/cli`）
- [x] `capacitor.config.json`作成（appName＝漢字検定対策アプリ、appId＝com.oulab.kanzi、webDir＝www）
- [x] `android/`プラットフォーム追加（`npx cap add android`で正常にスキャフォールド完了）
- [x] `ios/`プラットフォーム追加（`npx cap add ios`でスキャフォールドは完了。**ただし実ビルド・実機/シミュレータでの動作確認にはmacOS＋Xcodeが必須**で、この開発環境（Windows）では未検証。[01_技術調査/README.md](../kanzi/01_技術調査/README.md)の「iOSビルド環境の確保」参照）
- [ ] Android Studioでの実機/エミュレータ動作確認（未実施。Android Studio・SDKのセットアップが別途必要）
- [ ] Xcodeでの実機/シミュレータ動作確認（未実施。Mac実機またはクラウドビルドサービスが必要）
- [ ] `fetch`（`data/*.json`）・LocalStorageがWebView上で問題なく動作するかの疎通確認（[01_技術調査/README.md](../kanzi/01_技術調査/README.md)の既存TODOと同一）

## 今後の最適化候補（未対応、任意）

`www/data/`には現状、全12級分の`kanjiMaster.json`（約3.4MB）・`jukugo.json`（約5.8MB）・`strokeOrder.json`（約15.8MB）もそのままコピーされている。実際のストア配布ビルド（`RELEASE_BUILD=true`）はこれらを一切fetchせず、10級・9級の軽量版（`*_10_9kyu.json`、合計約0.8MB）しか使わないため、`sync-web.js`に「リリース用モード」を追加し、本体側のフルデータをアプリバイナリから除外すれば、さらに約25MBの削減が見込める。現時点では優先度低（機能上の問題ではなく、バイナリサイズの最適化のみ）。

## よく使うコマンド

```bash
npm run sync-web       # kanzi/ → www/ の同期のみ
npm run sync           # sync-web + cap sync（Android/iOS双方に反映）
npm run open:android   # Android Studioでandroid/を開く（要Android Studio）
npm run open:ios       # Xcodeでios/を開く（要macOS + Xcode）
```
