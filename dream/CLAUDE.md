# 開発方針：dream（夢・構想の見える化ビューア）

**Why:** 「教養マップ」のようなMermaid主体のマップ型コンテンツを、bookアプリ（専門書の逐語転記用）から切り離して専用に管理するため新設（2026-10-12、ユーザー判断）。見た目・操作はbookに揃えた読み取り専用ビューア。
**How to apply:** 新機能追加・変更時は本ファイルを参照。共通ルールは[ルートCLAUDE.md](../CLAUDE.md)、レイアウトの元になったbookは[../book/CLAUDE.md](../book/CLAUDE.md)を参照。

---

## 1. ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | エントリポイント。常時表示バーはbookと同一 |
| `css/style.css` | bookのCSSから必要部分を抽出。Mermaid用のステータス色（`.todo/.doing/.done`）を含む |
| `js/app.js` | 棚（一覧）→ 目次付きページビュー。Mermaid遅延ロード |
| `js/modules/github.js` | `fetchFile`のみ（読み取り専用） |
| `js/modules/storage.js` | LocalStorageキャッシュ（`dream_`接頭辞。トークンは`book_pat_token`へのフォールバックあり） |
| `js/modules/dataModel.js` | Front Matter（JSON）パース、章・ページの並べ替え |

## 2. データ

- リモート: `palmelo2nd/app_data` の `dream/` 配下（ローカル: `app_data/dream/`）
- `dream/dreams.md`：`dreamData`（一覧。ID・名前・概要・ステータス・開始日）
- `dream/<ID>.md`：`chapterData`（ID・章タイトル・開始順序）＋`pageData`（ID・順序・表示ページ・PDFページ・本文）。bookの本ファイルと同形式
- 読み取り専用（既読・ハイライト・画像は無し）。ページ追記は`.claude/skills/book-reading/scripts/book_data.py`の`add-page`/`add-chapter`にファイルパスを明示して行う（`add-book`はbook専用のため使わず、`dreams.md`は直接編集）

## 3. 教養マップのルール

- 1ページ目＝全体マップ（株式投資を中心に8分野（確率・統計、行動経済学、心理学、経営・戦略論、経済学、地政学、会計・財務、産業・技術）。分野間の関係図で、その先のブランチは持たない）。分野に着手したら、その分野を中心とした分野別マップのページを追加する（例：2p＝株式投資のマップ）
- 状態は文字色で表す：灰＝未着手（`:::todo`）／青太字＝進行中（`:::doing`）／緑太字＝完了（`:::done`）。ルート円は白地＋状態色の枠線
- 完了の基準：分野ごとに「人に語れるテーマ」を数個作れたら完了（完成のない分野なので区切りとして）
- Mermaidのmindmapは`classDef`が使えないため、ノード直下の別行に`:::クラス名`を書く（同一行は構文エラー）。色付けはCSS側

## 4. キャッシュバスティング

`?v=N`をCSS/JSに付与。バージョンバッジは`app.js`の`import.meta.url`由来のため、app.jsを上げた時のみ表示が変わる。

## 5. 履歴

- 2026-10-12：作成（v1）。bookの`b07_教養マップ`を`d01_教養マップ`として移設。
