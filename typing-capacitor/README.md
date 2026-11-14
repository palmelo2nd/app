# typing-capacitor

[typing](../typing/)（ふりっくふろっく）を、Capacitorで Android アプリにするためのラッパープロジェクト。2026-11-14作成。作りは [kanzi-capacitor](../kanzi-capacitor/README.md) と同じ兄弟フォルダ方式（CapacitorのCLIが `webDir` に `../` を指定できないため）。

## アプリ情報

- **アプリ名**：ふりっくふろっく（ストアの表示名は「ふりっくふろっく - スマホの文字入力練習」。ストアの画面で入れる）
- **バンドルID（`appId`）**：`com.oulab.flickflock`（**ストア登録後は変更できない**。ストア公開タスク一覧 D5）
- iPhone版は後回し（D2）なので、`ios/` はまだ追加していない

## `www/` と sync-web

`scripts/sync-web.js` が `../typing/` から `index.html`・`css/`・`js/` だけを `www/` にコピーし、**ストア版に切り替える**（コピー先の `js/buildConfig.js` の `RELEASE_BUILD` だけを `true` にする。Web版の `typing/` 側は `false` のまま）。

- 入れないもの：企画文書（`05_リリース_ストア申請/` など）・README・試作（`tools/`）・iPhoneの画面写し（`img/`。ストア版の解説は専用キーボードの図を使う）
- コピーのあと、外部から読み込むもの（CDNのscript・css・画像・fetch）が無いことを確かめ、あれば止まる
- `www/` はGitで追跡しない。**編集は必ず `typing/` 側で行う**（`www/` を直しても次の sync-web で消える）

## アイコン・スプラッシュ

- 元の絵は `assets/icon-foreground.svg`（フリックの十字。文字を使わない独自の図形）と `assets/icon-background.svg`（青のグラデーション）
- `npm run icons`（`scripts/gen-icons.js`）で、アダプティブアイコン・古いAndroid用のアイコン・スプラッシュ・ストア用512px（`assets/store-icon-512.png`）を作る。`cap sync` では上書きされない
- 今の絵は仮（Claudeの案）。差し替えるときはSVGを直して `npm run icons`

## Androidの設定（`npx cap add android` のあとに手で入れたもの）

- `android/app/src/main/AndroidManifest.xml` の activity に `android:screenOrientation="portrait"`（縦向き固定）

## ビルド

Java は **JDK 21**（`~/.jdks/jdk-21.0.12.1+1`）を使う。Android Studio 同梱の Java 25 は、Capacitor 8 の Gradle 8.14 が対応しておらずビルドが止まる。

```bash
npm install
npm run sync              # sync-web（ストア版に切り替えてコピー）＋ cap sync
cd android
JAVA_HOME=~/.jdks/jdk-21.0.12.1+1 ANDROID_HOME=~/AppData/Local/Android/Sdk ./gradlew.bat assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

エミュレータで確かめる：

```bash
SDK=~/AppData/Local/Android/Sdk
$SDK/emulator/emulator.exe -avd Pixel_8 -no-window -no-audio -gpu swiftshader_indirect &
$SDK/platform-tools/adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
$SDK/platform-tools/adb.exe shell am start -n com.oulab.flickflock/.MainActivity
$SDK/platform-tools/adb.exe exec-out screencap -p > screen.png
```

## 署名付きAAB（提出ファイル）

- 鍵はリポジトリの外：`~/flickflock-keystore/flickflock-upload.jks` と `keystore.properties`（パスワード入り。**Gitに入れない・チャットに貼らない**。本人がフォルダごとバックアップする）
- `android/app/build.gradle` が `keystore.properties`（環境変数 `FLICKFLOCK_KEYSTORE_PROPERTIES` で場所を変えられる）を読んで署名する。ファイルが無い環境では署名なしでビルドされる

```bash
npm run sync
cd android
JAVA_HOME=~/.jdks/jdk-21.0.12.1+1 ANDROID_HOME=~/AppData/Local/Android/Sdk ./gradlew.bat bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

- 出し直すときは `android/app/build.gradle` の `versionCode` を1つ上げる（同じ番号は受け付けられない）
