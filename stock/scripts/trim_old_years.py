"""
株価CSV（stock/prices/{code}.csv）から古い年の行を切り出し、ローカルの保管フォルダへ移す年1回の整理用スクリプト（2026-11-02追加）。

運用：stock_dataには「過去10年＋今年」（最大11年分）だけを置き、毎年1/1ごろに最古の1年を外す
（ディフェンシブ判定が「今年を除く過去10年」で計算するため、それより前はアプリで使わない）。
初回は2027/1/1に2013〜2016年をまとめて外す。

保管先：stock_archive/prices/{年}.csv（code,date,close の縦持ち。git管理外のローカルのみ）。
既に保管済みの (code, date) は重複して書かない（途中で止まって再実行しても安全）。
保管ファイルを書いてから株価CSVを上書きするので、途中で止まっても行が失われることはない。

使い方（Desktop/app/app/stock で実行。先に stock_data を git pull しておく）：
    python scripts/trim_old_years.py --dry-run     # 外す行数の確認だけ
    python scripts/trim_old_years.py               # 実行 → stock_data で commit・push
"""
import argparse
import datetime
import sys
from pathlib import Path

import pandas as pd


def archive_rows(archive_dir: Path, rows: pd.DataFrame) -> int:
    """年ごとに保管ファイルへ追記する（既にある (code, date) は除く）。追記した行数を返す。"""
    added = 0
    for year, part in rows.groupby(rows["date"].str[:4]):
        path = archive_dir / f"{year}.csv"
        if path.exists():
            existing = pd.read_csv(path, dtype={"code": str, "date": str})
            keys = set(zip(existing["code"], existing["date"]))
            part = part[[(c, d) not in keys for c, d in zip(part["code"], part["date"])]]
            merged = pd.concat([existing, part]).sort_values(["code", "date"])
        else:
            merged = part.sort_values(["code", "date"])
        if len(part):
            merged.to_csv(path, index=False)
            added += len(part)
    return added


def main():
    parser = argparse.ArgumentParser(description="株価CSVから古い年の行をローカルの保管フォルダへ移す（年1回）")
    parser.add_argument("--dir", default="../../../stock_data/stock/prices", help="株価CSVのディレクトリ")
    parser.add_argument("--archive-dir", default="../../../stock_archive/prices", help="保管先（git管理外）")
    parser.add_argument("--keep-past-years", type=int, default=10, help="今年に加えて残す過去の年数（既定10）")
    parser.add_argument("--this-year", type=int, default=datetime.date.today().year, help="基準の年（既定は今年）")
    parser.add_argument("--dry-run", action="store_true", help="外す行数を表示するだけで、ファイルは変更しない")
    args = parser.parse_args()

    cutoff_year = args.this_year - args.keep_past_years  # この年より前を外す
    prices_dir = Path(args.dir)
    files = sorted(prices_dir.glob("*.csv"))
    if not files:
        print(f"株価CSVが見つかりませんでした: {prices_dir}", file=sys.stderr)
        sys.exit(1)

    archive_dir = Path(args.archive_dir)
    if not args.dry_run:
        archive_dir.mkdir(parents=True, exist_ok=True)

    print(f"{cutoff_year}年より前の行を外します（残すのは{cutoff_year}〜{args.this_year}年）")
    total = 0
    changed = 0
    batch = []
    for path in files:
        df = pd.read_csv(path, dtype={"date": str})
        old = df["date"].str[:4].astype(int) < cutoff_year
        n = int(old.sum())
        if n == 0:
            continue
        total += n
        changed += 1
        if args.dry_run:
            continue
        moved = df[old].copy()
        moved.insert(0, "code", path.stem)
        batch.append((path, df[~old], moved))
        # 保管→上書きの順で、200銘柄ごとにまとめて書く（メモリを抑えつつ、保管前に元を消さない）
        if len(batch) >= 200:
            flush(batch, archive_dir)
            batch = []
    if batch:
        flush(batch, archive_dir)

    mode = "（確認のみ）" if args.dry_run else ""
    print(f"対象 {changed}銘柄・{total}行{mode}")


def flush(batch, archive_dir: Path):
    archive_rows(archive_dir, pd.concat([m for _, _, m in batch]))
    for path, kept, _ in batch:
        kept.to_csv(path, index=False)


if __name__ == "__main__":
    main()
