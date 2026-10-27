# brain_temp：ナレッジの一時退避先

**Why:** brainをタスク管理専用にするため（2026-10-28決定）、brainに登録されていたナレッジ70件（データ区分=ナレッジ、1日タスクを除く）をここへ退避した。本来の移行先（別ツール）が決まるまでの仮置き場。
**How to apply:** 新機能の追加はしない。移行先へ引っ越しが済んだら、このアプリ（コード`app/brain_temp`・データ`app_data/brain_temp`）ごと削除する。

- コードは2026-10-28時点の`app/brain`をそのままコピーしたもの。開発ルールの詳細はコピー元の`brain/CLAUDE.md`に準ずる。
- brainとの違いは次の3点のみ：
  - データの保存先：`js/app.js`の`PATH`を`brain_temp/data.md`にした
  - LocalStorageのキー：キャッシュ（`brain_temp_cached_tasks`/`brain_temp_cached_sha`）と報告テーマ（`brain_temp_report_last_theme`）をbrainとは別にした。同じオリジン（GitHub Pages）でbrainのキャッシュと混ざらないようにするため。PAT（`brain_pat_token`）はbrainと共用する
  - 画面タイトル：Brain Temp
- データ（`app_data/brain_temp/data.md`）の`masterData`は、退避した時点のbrainのものをそのまま複製している。
