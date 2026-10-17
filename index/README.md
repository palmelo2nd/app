# Index

既存アプリ（brain・stock・cook・book・dream・memory・kanzi・diary・chat）へのリンク集。

- **トークン欄／読込／保存**：brainと同じ見た目。「保存」で入力したPATをindex用キーと各アプリのlocalStorageキーへ一括書き込みし、各アプリがそのトークンで起動する（同一オリジンのlocalStorage共有を利用）。「読込」は保存済みトークンを欄に戻す（index未保存なら既存アプリの値を流用）。
- **キャッシュ更新**：キャッシュ破棄＋強制再読込。右隣に`v${N}`でバージョン表示。
- **リンク先**：`../<アプリ名>/`。indexは自前のデータを持たないため`app_data/index`は現状空。
- キャッシュバスティング：`index.html`と`js/app.js`（import文含む）の`?v=N`を同じ値で更新する。
