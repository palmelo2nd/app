"""キャッシュバスティング（?v=N）の確認。git の pre-push フックから呼ぶ（警告だけで push は止めない）。

確認すること
1. 同じアプリの中で、同じファイルを違う ?v=N で読み込んでいないか（ES modules は URL が違うと別物として2回読み込まれる）
2. push する範囲で JS/CSS を変えたのに、そのファイルを読み込む ?v=N が上がっていないか

使い方
  python tools/check_version.py              # 1だけ
  python tools/check_version.py <基準のコミット>  # 1と2（基準から HEAD までの変更を見る）
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = re.compile(r"""["']([^"'?\s]+\.(?:js|css))\?v=(\d+)["']""")
SKIP = ("node_modules", "/android/", "/ios/", "/dist/", "/www/")


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, encoding="utf-8").stdout


def collect(files, read):
    """{(アプリ, 読み込まれるファイル): {v: [読み込む側のファイル:行]}}"""
    refs = {}
    for f in files:
        if not f.endswith((".html", ".js")) or any(s in "/" + f for s in SKIP):
            continue
        text = read(f)
        if text is None:
            continue
        app = f.split("/")[0]
        for n, line in enumerate(text.splitlines(), 1):
            for m in REF.finditer(line):
                if m.group(1).startswith(("http:", "https:", "//")):
                    continue
                target = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1))).replace("\\", "/")
                refs.setdefault((app, target), {}).setdefault(m.group(2), []).append(f"{f}:{n}")
    return refs


def read_now(f):
    try:
        with open(os.path.join(ROOT, f), encoding="utf-8") as fp:
            return fp.read()
    except (OSError, UnicodeDecodeError):
        return None


def main():
    files = git("ls-files").splitlines()
    now = collect(files, read_now)
    warnings = []

    for (app, target), vs in sorted(now.items()):
        if len(vs) > 1:
            detail = "、".join(f"v={v}（{', '.join(locs)}）" for v, locs in sorted(vs.items()))
            warnings.append(f"[{app}] {target} を違う値で読み込んでいます：{detail}")

    if len(sys.argv) > 1:
        base = sys.argv[1]
        changed = [f for f in git("diff", "--name-only", base, "HEAD").splitlines() if f.endswith((".js", ".css"))]
        if changed:
            base_files = git("ls-tree", "-r", "--name-only", base).splitlines()

            def read_base(f):
                r = subprocess.run(["git", "-C", ROOT, "show", f"{base}:{f}"], capture_output=True, text=True, encoding="utf-8")
                return r.stdout if r.returncode == 0 else None

            old = collect(base_files, read_base)
            for f in changed:
                for (app, target), vs in now.items():
                    if target == f and (app, target) in old and set(vs) == set(old[(app, target)]):
                        warnings.append(f"[{app}] {f} を変えましたが、?v={'/'.join(vs)} のままです")

    if warnings:
        print("キャッシュバスティング（?v=N）の確認：" + str(len(warnings)) + "件", file=sys.stderr)
        for w in warnings:
            print("  - " + w, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
