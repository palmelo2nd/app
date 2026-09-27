# 開発方針：読書ビューア（プロトタイプ）

**Why:** myselfワークスペースの`book-reading`スキルで文字起こしした専門書の本文を、トークンを使わずに何度でも読み返せるようにするためのビューア。brainの「読書メモ」機能（本→章メモ→QAカード）とは別に、ページ単位の完全な逐語転記＋ページ画像との照合を主目的として独立させた（2026-09-27、ユーザー判断）。
**How to apply:** 新機能追加・変更時は必ずこのルールを参照すること。brain/cookと共通する設計思想（[ルートCLAUDE.md](../CLAUDE.md)参照）は重複説明を省略している。

---

## 1. ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | エントリポイント。DOM構造のみ |
| `css/style.css` | UIデザイン。常時表示バーはbrainと同一スタイル・文言（Excel出力／入力ボタンのみ非搭載） |
| `js/app.js` | メイン制御 |
| `js/modules/github.js` | GitHub API通信（`fetchFile`のみ。読み取り専用のため`saveFile`は無し） |
| `js/modules/storage.js` | LocalStorageキャッシュ（`book_`接頭辞） |
| `js/modules/dataModel.js` | data.mdのFront Matter（JSON）パース |

## 2. データ

- リモート: `palmelo2nd/app_data`リポジトリ `book/data.md`。ローカルパス: `app_data/book/data.md`
- Front Matter（JSON）に`bookData`（本の一覧）／`chapterData`（章ごとの本文）の2配列を保持
- `chapterData`の`本文`列に、章単位で文字起こしした本文をMarkdown文字列として丸ごと保持する（brainのような列分割はしない）
- **読み取り専用**：現状アプリ側からデータを書き込む機能は無い。本文の追加・更新は`book-reading`スキル側でdata.mdを直接編集し、コミット・pushする運用

## 3. 常時表示バー（brainとの相違点）

- brainと同じ位置づけの「読込」「保存」「トークン入力」「同期ステータス」「キャッシュ更新」「バージョン表示」を踏襲
- 「保存」ボタンはbrainと異なり、**データをGitHubへ書き込む機能ではなく、入力中のトークンをLocalStorageへ保存するだけ**（読み取り専用アプリのため）
- Excel出力／入力ボタンは搭載しない

## 4. 開発履歴

- 2026-09-27: 新規作成。ローカルのみで動くプロトタイプ（`myself/book_app/`、manifest.json方式）を経て、brain/cookと同じGitHub同期構成（`app/book`＋`app_data/book`）に移行。
