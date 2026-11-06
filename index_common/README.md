# Index（共通コード）

2026-11-02：旧`index/`を`index_common/`に改名し、転送ページは削除した（入口は`index_my`／`index_fam`／`index_save`のみ）。このフォルダはページを持たず、各入口が読み込む`js/`・`css/`の置き場。

**用途別INDEX（2026-11-02）**：入口は`index_my`（my＝app_data）／`index_fam`（family＝family_data）／`index_save`（save＝save_data）の3つ。各入口の`index.html`は`window.INDEX_CONFIG`で用途を渡し、`index_common/`の`js/app.js`・`css/style.css`を共通で読み込む。メニュー（表示するアプリ）は各データリポジトリの`index/apps.json`（`{"apps": ["stock", ...]}`）で決める。トークンは用途ごとに保存し（`index_pat_token_<データリポジトリ名>`）、INDEXを開くたびにその用途のトークンと`app_data_repo`（読むデータリポジトリ）を各アプリ用キーへ書き込む。stock・cook・diary・typing・noteは`app_data_repo`に従い、その他のアプリはapp_data固定。

既存アプリ（brain・stock・cook・book・dream・memory・kanzi・diary・typing・chat）へのリンク集。

- **トークン欄／読込／保存**：brainと同じ見た目。「保存」で入力したPATをindex用キーと各アプリのlocalStorageキーへ一括書き込みし、各アプリがそのトークンで起動する（同一オリジンのlocalStorage共有を利用）。「読込」は保存済みトークンを欄に戻す（index未保存なら既存アプリの値を流用）。
- **キャッシュ更新**：キャッシュ破棄＋強制再読込。右隣に`v${N}`でバージョン表示。
- **リンク先**：`../<アプリ名>/`。indexは自前のデータを持たないため`app_data/index`は現状空。
- キャッシュバスティング：`index.html`と`js/app.js`（import文含む）の`?v=N`を同じ値で更新する。
