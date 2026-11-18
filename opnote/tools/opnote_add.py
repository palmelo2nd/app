"""操作ノート（opnote）に項目を1つ足す・直す（2026-11-18、brain #1706）。bookスレッドが使う。

使い方:
  python opnote_add.py <notes.mdのパス> <分類ID> <題> <問い> <答え> <本文ファイル> [--id 項目ID] [--date YYYY/MM/DD]

- 分類ID：phone（スマホ）／pc（パソコン）。無い分類IDを渡すとエラー（分類を増やすときはnotes.mdのcategoryDataを直接足す）
- 題：一覧に出る名前（例：「文字をコピーする」）
- 問い・答え：後で復習アプリで出題する形（例：「選んだ文字をコピーするには？」→「Ctrl+C」）。1文で短く
- 本文ファイル：手順などのMarkdown（UTF-8）。キーは<kbd>Ctrl</kbd>のように書くと枠つきで出る
- --id を付けるとその項目を書き換える（メモはそのまま残す）。付けなければ新しい項目を末尾に足す
- 同じ分類に同じ題があるときは、--idなしでもその項目を書き換える
- ファイルが無ければ作る。書いたあと、git add・commit・pushは呼び出し側で行う（save_dataリポジトリ）
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

DEFAULT_CATEGORIES = [{"ID": "phone", "名前": "スマホ", "並び順": 1}, {"ID": "pc", "名前": "パソコン", "並び順": 2}]


def load(path: Path):
    if not path.exists():
        return {"categoryData": DEFAULT_CATEGORIES, "itemData": []}, "\n"
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    return json.loads(m.group(1)), text[m.end():] or "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("notes")
    ap.add_argument("category")
    ap.add_argument("title")
    ap.add_argument("question")
    ap.add_argument("answer")
    ap.add_argument("body_file")
    ap.add_argument("--id")
    ap.add_argument("--date", default=dt.date.today().strftime("%Y/%m/%d"))
    a = ap.parse_args()

    path = Path(a.notes)
    data, tail = load(path)
    if not any(c["ID"] == a.category for c in data["categoryData"]):
        sys.exit(f"分類IDが見つかりません: {a.category}（あるのは {[c['ID'] for c in data['categoryData']]}）")
    body = Path(a.body_file).read_text(encoding="utf-8").strip() + "\n"
    items = data["itemData"]
    item = next((it for it in items if it["ID"] == a.id), None) if a.id else \
        next((it for it in items if it["分類"] == a.category and it["題"] == a.title), None)
    if a.id and not item:
        sys.exit(f"項目IDが見つかりません: {a.id}")
    if item:
        item.update({"分類": a.category, "題": a.title, "問い": a.question, "答え": a.answer, "本文": body})
        action = "updated"
    else:
        nums = [int(m.group(1)) for it in items if (m := re.match(r"^i(\d+)$", it["ID"]))]
        order = max([it.get("並び順", 0) for it in items if it["分類"] == a.category] + [0]) + 1
        item = {"ID": f"i{max(nums + [0]) + 1:04d}", "分類": a.category, "題": a.title, "問い": a.question,
                "答え": a.answer, "本文": body, "並び順": order, "登録日": a.date, "メモ": []}
        items.append(item)
        action = "added"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\n" + json.dumps(data, ensure_ascii=False, indent=2) + "\n---" + tail, encoding="utf-8", newline="\n")
    print(action, item["ID"], item["題"])


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
