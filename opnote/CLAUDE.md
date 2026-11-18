# 開発方針：opnote（操作ノート）

**Why:** ご両親（たま）とのやり取りを良くする取り組み（lab：`office/lab/works/261118_スマホマスター計画.md`、brain #1570）の「できることを増やす」の枝。スマホ・パソコンで教えた操作を項目ごとに残し、忘れたときに見返せるようにする（2026-11-18、brain #1706）。
**How to apply:** 画面・データの詳細は[README.md](README.md)。共通ルールは[ルートCLAUDE.md](../CLAUDE.md)、見た目は[DESIGN.md](../DESIGN.md)、兄弟アプリは[skillmap](../skillmap/CLAUDE.md)。

- **本文はbookスレッドが書く**（ユーザーが教えた内容を伝え、bookスレッドが`tools/opnote_add.py`で`save_data/opnote/notes.md`へ足す）。アプリから書き込むのはメモだけ
- **各項目は問いと答えに分けて持つ**（例：「選んだ文字をコピーするには？」→「Ctrl+C」）。後で、教えた内容を出題する復習アプリに使うため（lab、後のアイデア）。問い・答えは1文で短く
- 使う人はご両親とユーザー。言葉は前向きに、操作は押す・書くだけ。文字はDESIGN.mdより1段大きい（skillmapと同じ）
- スキルマップの「できることを増やす」の枝（`save_data/skillmap/map.md`の`n3`）の`リンク`からここへ来る
- 書き込みは1操作ずつ「取り直して当てて保存」（`noteModel.js`の`applyOp`）

## 履歴
- 2026-11-18：作成（v1）。分類・一覧・項目のページ（問いと答え・本文・前後）・メモ（追加・自分の分の削除）・設定。index_saveのメニューに追加、`tools/opnote_add.py`を用意
