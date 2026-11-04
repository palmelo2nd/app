# アプリ共通の見た目（DESIGN.md）

新しい画面・アプリを作るときに読む。操作の流れ・ボタン名の決まりは`CLAUDE.md`の「UI/UX設計方針」にあり、ここは色・文字・形だけを決める。

- 基準：book・dream・diary・typingで使っている配色（2026-11-04に決定）
- 対象外：kanzi（公開用で独自のデザイン）、chat（暖色系）
- 既存の画面は無理に揃えない。新しく作る画面・部品から、この値を使う

## 色
CSSの先頭の`:root`に次の変数を書き、色は変数で指定する（同じ値を直接書かない）。

```css
:root {
  --navy: #1a2744;    /* 見出し・強い文字 */
  --accent: #2f6fed;  /* リンク・選択中・強調 */
  --border: #dfe3ea;  /* 枠線・区切り線 */
  --muted: #6b7280;   /* 補足・ラベル・薄い文字 */
  --soft: #eef3fe;    /* 選択中の背景・薄い強調 */
}
```

| 用途 | 値 |
|---|---|
| ページの背景 | `#f0f2f5` |
| カード・パネルの背景 | `#fff` |
| 本文の文字 | `#333` |
| 保存・決定（主ボタン） | `#28a745`（文字は白） |
| 削除・危険 | `#c0392b` |
| 注意の帯 | 背景`#fce4d6`・文字`#9c4221` |
| 上のバー（Load・Save・トークン） | brainと同じ（背景`#1e2a38`、Load`#007bff`、Save`#28a745`、キャッシュ更新`#6c757d`） |
| オンライン／オフラインの表示 | 背景`#e2f0d9`・文字`#385723`／背景`#fff2cc`・文字`#7f6000` |

## 文字
- 書体：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif`。ボタン・入力欄は`font-family: inherit`
- 大きさは4段階：本文13px／補足・ラベル12px／小さい字（件数・バッジ）11px／見出し15px（パネルの題）・22px（ページの題）
- 入力欄（input・textarea）だけは16px（iPhoneで入力時に画面が拡大されるのを防ぐ）

## 形と余白
- 角の丸み：パネル・カード10px／ボタン8px／入力欄・小さい部品6px／バッジ999px（丸）
- パネル：`background:#fff; border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin-bottom:12px`
- ページの外側の余白16px、部品の間は6〜12px
- ボタン：`padding:8px 16px; font-size:14px; font-weight:600`。小さいボタンは`padding:6px 12px; font-size:13px`。副ボタンは白地に`--navy`の文字と`--border`の枠
- 文字だけのボタン（リンク風）：`--accent`の色、12px

## 参考にする実装
- `diary/css/style.css`：変数・パネル・ボタン・入力欄
- `dream/css/style.css`：上のバー・オンライン表示
