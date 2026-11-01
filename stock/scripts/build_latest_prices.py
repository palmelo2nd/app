"""
株価CSV（stock/prices/{code}.csv）の最新の終値を集め、stock/latest_prices.csv（code, date, close, jump_date）に書き出す。

アプリのラベル画面で全銘柄の配当利回りを出すために使う（2026-11-01追加）。株価CSVは銘柄ごとの別ファイルで、
アプリから全銘柄分を1件ずつ取得すると数千回のAPI呼び出しになるため、最新値だけを1ファイルにまとめておく。
jump_dateは直近1年で終値が前日比で急変した最後の日（株式分割・併合の目安）。配当データ（dividends.csv）は
分割後も取り直されず分割前の基準のまま残ることがあり、その場合は利回りが数倍に跳ねるため、アプリで注意を出すのに使う。
fetch-stock-prices-bulk.ymlの最後（毎晩の全銘柄更新の後）に実行する。手元で実行する場合：
    python stock/scripts/build_latest_prices.py --dir ../app_data/stock/prices --output ../app_data/stock/latest_prices.csv
"""
import argparse
import csv
from datetime import date, timedelta
from pathlib import Path

JUMP_LOOKBACK_DAYS = 400   # 急変を探す期間（最新日から遡る日数）
JUMP_RATIO_LOW = 0.7       # 前日比がこの範囲外なら急変とみなす（分割検出の目安。memory/配当データの株式分割対応パターンと同じ基準）
JUMP_RATIO_HIGH = 1.4


def read_latest(path: Path):
    """CSVを読み、(最終日, 最終終値, 直近の急変日 or '') を返す。データ行が無ければNone。"""
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split(",")
            if len(parts) < 2 or parts[0] == "date":
                continue
            try:
                close = float(parts[1])
            except ValueError:
                continue
            if close > 0:
                rows.append((parts[0], parts[1], close))
    if not rows:
        return None
    last_date = rows[-1][0]
    since = (date.fromisoformat(last_date) - timedelta(days=JUMP_LOOKBACK_DAYS)).isoformat()
    jump_date = ""
    for (_, _, prev), (d, _, cur) in zip(rows, rows[1:]):
        if d >= since and not (JUMP_RATIO_LOW <= cur / prev <= JUMP_RATIO_HIGH):
            jump_date = d
    return last_date, rows[-1][1], jump_date


def main():
    parser = argparse.ArgumentParser(description="最新株価の一覧（latest_prices.csv）を作る")
    parser.add_argument("--dir", required=True, help="株価CSVのディレクトリ（stock/prices）")
    parser.add_argument("--output", required=True, help="出力先（stock/latest_prices.csv）")
    args = parser.parse_args()

    rows = []
    for path in sorted(Path(args.dir).glob("*.csv")):
        latest = read_latest(path)
        if latest:
            rows.append({"code": path.stem, "date": latest[0], "close": latest[1], "jump_date": latest[2]})

    with open(args.output, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["code", "date", "close", "jump_date"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"保存しました: {args.output}（{len(rows)}銘柄）")


if __name__ == "__main__":
    main()
