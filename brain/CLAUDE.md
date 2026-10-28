# 開発方針：タスク管理アプリ（Webフロントエンド版）

**Why:** 再起動時にも一貫した設計・実装を維持するための厳格ルール集。
**How to apply:** 新機能追加・バグ修正・リファクタリング時は必ずこのルールを参照すること。

---

## 1. ファイル構成・命名規則

| ファイル | 役割 |
|---|---|
| `index.html` | エントリポイント。DOM構造のみ。直接JSロジックは書かない |
| `css/style.css` | UIデザイン・レイアウト定義 |
| `js/app.js` | メイン制御（管制塔）。イベント監視・DOM操作に専念 |
| `js/modules/*.js` | 機能ロジック。1機能1ファイル |

### 現在の modules 構成
`github.js`（リモート通信）／`storage.js`（LocalStorageキャッシュ）／`dataModel.js`（列定義・Markdownパース／文字列化）／`task.js`（タスクロジック・フィルタ、1日タスク判定`isDayPlanRow`・通常タスク判定`isNormalTaskRow`）／`calendar.js`（カレンダー表示ロジック）／`master.js`（マスタ整合性チェック）／`recurring.js`（繰り返しタスク）／`excel.js`（Excelエクスポート・インポート）／`workCalendar.js`／`merge.js`（mainDataの3-wayマージ。ID列をキーに base/local/remote を比較し自動解決。保存フロー内 `app.js` の `mergeMainData` 呼び出しから使用）／`report.js`（報告タブ）／`aiReview.js`（AI確認タブ）

### modules の関数構成（必須4段落）
1. インポート（外部モジュール・ライブラリ）
2. インプット（引数でデータ・トークンを受け取る）
3. メイン機能（計算・データ加工・API通信）
4. アウトプット（`return` で結果を返す）

**禁止:** modules内でのDOM操作（`document.getElementById` 等）、OWNERやREPO名などの定数のハードコード（必ずインプットとして受け取る）。

---

## 2. データ操作・通信ルール（最優先）

### データファイル
- リモートのデータ本体は GitHub リポジトリ `palmelo2nd/app_data` 内 `brain/data.md`（旧 `todo.md`）。Front Matter（`---` で囲んだJSON）に `mainData` / `masterData` を保持する。
- アプリ本体のコードは別リポジトリ（GitHub Pages 想定。リモート: `palmelo2nd/app`）で管理する。**データとコードは別リポジトリ**であり、変更時はそれぞれ個別にコミット・pushする必要がある点に注意。
- ローカルパス: コード = `app/brain`、データ = `app_data/brain`（`data.md`）。

### オフライン完全対応
- データ読み書きは `github.js`（リモート）と `storage.js`（LocalStorageキャッシュ）を必ず経由する。
- **読み込み:** GitHub API → 成功時はテキスト＋SHA をLocalStorageキャッシュ。失敗時はキャッシュから復元。
- **書き込み:** 保存ボタン押下 → 即座にLocalStorage更新 → GitHubへPUT送信。圏外失敗時もデータはローカルに保持＋ユーザー通知。
- **注意:** LocalStorageキャッシュが残っていると、GitHub側を更新してもアプリ表示が古いままになることがある。データ不整合の調査時はまず「キャッシュ更新／Load」操作を確認する。

### データパース・整合性
- Markdownデータ属性の操作はオブジェクトのキー名ベースで行う。行番号・インデックス依存のアクセスは禁止。
- 列名（変数名）を変更する場合、以下の3箇所すべてを揃える必要がある（1箇所でも漏れると `master.js` の整合性チェックで警告が出る）:
  1. `dataModel.js` の `MAIN_DATA_COLUMNS` / `MASTER_DATA_COLUMNS`
  2. `data.md` 内の実データの **キー名**（各行のプロパティ名）
  3. `data.md` の `masterData` 内、`(M)変数名` 列の**値**として登録されている変数名一覧（キー名とは別に、値として変数名文字列が保持されている）

---

## 3. 実装の心得

- グローバル状態（現在のSHA、パース済みタスク配列等）は `js/app.js` または専用状態管理オブジェクトで保持する。
- DOM内テキストをデータソースとして直接扱うことは禁止。データ構造を常に正とする。
- 外部ライブラリ（marked.js、SheetJS/XLSX等）は `index.html` でCDN経由ロード、JS側では `window.marked` / `window.XLSX` 等グローバルオブジェクト経由で使用。modules内での個別インポート禁止。
- データは「マスタ系（`masterData`：カテゴリ・タグ・プロジェクト・ステータス等の親子関係定義）」と「メイン系（`mainData`：日々のタスク・INBOX・報告等）」に分離して管理する（`dataModel.js` の `MAIN_DATA_COLUMNS` / `MASTER_DATA_COLUMNS` として実装済み）。
- 仕様の不明点は勝手に進めずユーザーに確認する。
- **キャッシュバスティング（2026-09-13導入、stock/kanziアプリと同じ方式）**：`index.html`の`css/style.css`／`js/app.js`参照、`js/app.js`の全import文、`js/modules/calendar.js`（`task.js`）・`excel.js`（`dataModel.js`）・`merge.js`（`task.js`・`dataModel.js`）・`report.js`（`task.js`）・`recurring.js`（`dataModel.js`・`task.js`）が内部importする分には、ブラウザキャッシュ対策として`?v=N`をクエリ文字列で付けている（Why：ES modulesはURLごとにブラウザキャッシュされるため、更新後もブラウザが古いモジュールを使い続け、動作確認が困難になっていたため。従来はcss=8・app.js=20と別々の値で管理されており、内部importのモジュール群には一切`?v=N`が付いていなかった＝個々のmodules更新がキャッシュされ続けるリスクがあった。この変更で1本の値に統一した）。**How to apply:** `js/app.js`・`js/modules/*.js`・`css/style.css`のいずれかを変更してコミットする際は、上記すべての`?v=N`を同じ新しい値（現在の値+1）に一括で書き換えること（`grep -rn "?v=" index.html js/app.js js/modules/calendar.js js/modules/excel.js js/modules/merge.js js/modules/recurring.js`で現在の値を確認できる）。import文のModuleSpecifierは仕様上「文字列リテラルのみ」（変数・テンプレートリテラル不可）のため、`CURRENT_VERSION`のような変数化はできず、各行に直接書く。既存の「キャッシュ更新」ボタン（top-bar、`cache-reset-btn`）がキャッシュ破棄＋強制再読込の手動の逃げ道を担っており、そのすぐ右に現在のバージョン（`v${N}`）を表示するバッジ（`app-version-badge`）を追加した。`js/app.js`が自分自身の`import.meta.url`から`?v=N`の値を読み取って表示するため、バッジ表示のための追加の同期作業は不要。

---

## 4. カテゴリフィルタ・状態管理のルール

- フィルタ状態の取得・適用は `task.js` / `calendar.js` に集約する（タグ・プロジェクト・ステータスの複数選択フィルタとして実装済み）。
- 絞り込み表示時は元データ（マスター配列）を破壊せず、フィルタ済み複製配列（シャローコピー）を描画用に渡す。

```js
// js/app.js の新機能追加パターン（例）
import { filterTasks } from './modules/task.js';
const filtered = filterTasks(allTasks, selectedCategory);
updateView(filtered); // 画面描画
```

---

## 5. ドキュメント保守方針

- このアプリに限らず、`brain`配下の各アプリ（`code/brain`、`code/stock`等）で、一定のまとまった機能を実装・変更したら、都度そのアプリの`README.md`に反映する。
- **Why:** READMEはページ単位で章立てされた「何ができるか」を示す利用者・開発者向け資料であり、実装と乖離すると資料としての価値が下がる。
- **How to apply:** 新機能追加・既存機能の仕様変更・タブ/ページ構成の変更など、ひとまとまり完了したタイミングで該当章を更新する。些細な内部リファクタや未完成の途中変更では都度更新しなくてよい。章構成そのものが大きく変わった場合は、README同士の使い回しやコード未確認での推測記述はせず、実装（`index.html`/`js/app.js`/`js/modules/*.js`）を実際に確認してから書く。READMEの章立てスタイルはアプリごとに確立された慣習を踏襲し、勝手に統一しない。

## 不具合修正履歴

- 2026-09-01: `loadFromGitproject`（読込処理）で、GitHub APIからの取得に失敗し、かつ端末内キャッシュも無い場合（初回読込・キャッシュクリア後・トークンの権限不足等）、エラーメッセージもアラートも一切表示されず無言で失敗する不具合を修正。トークンの権限不足で読み込めない場合に「反応が無い」ように見える原因になっていた。以後は`#network-status-top`等に赤色の`error-badge`（「読み込み失敗」）を表示し、エラー内容（HTTPステータス等）と`OWNER/REPO`（アクセス権限を確認すべきリポジトリ）を含むアラートを出す（`css/style.css`に`.error-badge`追加）。修正の副次的な確認として、Playwrightで実際の`app_data`のdata.md内容をモックしたGitHub APIレスポンスを読み込ませ、カレンダー・タスク一覧が正常に描画されること（＝読込成功後は通常どおり使える状態になること）も確認済み。

## 用語変更履歴

- 2026-07-13: 上位概念を表す変数名を「ハブ」→「プロジェクト」に変更。対象: `dataModel.js`の列名、`hub.js`→`project.js`（ファイル名・関数名）、`data.md`内のキー名および`(M)変数名`の値、UI表示ラベル全般。データファイル名も`todo.md`→`data.md`に変更。
- 2026-07-27: 「旧タスク整理」タブ（`calendar-`/`dayedit-`/`taskorg-`/`gantt-`系、フラットな`プロジェクト`列によるカレンダー／ガントチャート整理画面）を削除。機能はすべて「タスク整理」（`calendar2-`/`dayedit2-`/`taskorg2-`系、親ID方式）へ統合済み。あわせて未使用だった`project.js`（フラットプロジェクト管理）も削除。
- 2026-07-27: フラット`プロジェクト`列の残り2用途を移行。(1) タスク実行タブの編集パネルのプロジェクト欄を親ID方式のPJ(n層)階層プルダウンに変更。(2) 1日タスク（DAYPLAN）の判定を`プロジェクト='1日タスク'`から`データ区分=ナレッジ・PARA区分=1日タスク`（`calendar.js`の`isDayPlanRow`）に変更（作業ログ的な性質のためナレッジ扱いに）。旧形式データは`app.js`の`applyContent`内で読み込み時に自動変換する。
- 2026-07-27: マスタ側のフラット「プロジェクト」定義をコードから完全に削除。`dataModel.js`の`MAIN_DATA_COLUMNS`から`プロジェクト`、`MASTER_DATA_COLUMNS`から`(M)プロジェクト_親`/`(M)プロジェクト_子`/`(M)プロジェクト_ステータス`を除去。`task.js`の`isProjectActive`/`filterProjectsByCategory`、`app.js`の`getFilteredProjects`、`master.js`のプロジェクト親カテゴリ整合性チェックも削除。データ側（`data.md`）も利用者が`プロジェクト`列の値・`(M)プロジェクト_*`マスタ行・`(M)変数名=プロジェクト`行を削除済み。あわせて`app.js`の`applyContent`にあった旧形式1日タスク（プロジェクト=1日タスク）→新形式（データ区分=ナレッジ・PARA区分=1日タスク）の自動変換コードも、既存データの移行が完了したため削除（一時的な移行用コードだったため）。フラット`プロジェクト`方式は完全に廃止済み。
- 2026-08-17: 1日タスク（DAYPLAN）のタイムラインを、重なりに応じて列が増減する方式から**固定4列**に変更。内容欄の書式を「`[列番号] HH:MM-HH:MM #ID ラベル`」に拡張（`列番号`は省略可。省略時＝旧データ・未整理タスクは重なりに応じた自動詰め込みにフォールバックする、`js/modules/calendar.js`の`assignCalendarColumns`）。列1は「開始予定・終了予定が既に時刻まで決まっているタスク」の定位置で重なりを気にせずそのまま配置、列2〜4は時間未定タスクの作業枠で、＋ボタンは常に列4へ9:00起点30分刻みで次の空きを探して追加する（`computeDayPlanTimeSlot`）。タイムライン上のブロックはドラッグで縦（時刻・15分刻み）横（列）双方に移動でき、列2〜4内で時間が重なった場合は衝突した既存ブロックの直後へ、さらに後続と重なればそれも連鎖的に押し出して解消する（`resolveDayPlanColumnCollision`／`placeDayPlanBlock`）。押し出しの結果24:00を超える場合は何も書き換えずキャンセルする。ドラッグ中の重なり警告（赤枠オーバーレイ）機能は廃止。タイムラインのチップからは時刻表示（HH:MM-HH:MM）を削除しタイトルのみ表示（対応中タスク一覧など他のチップの時刻表示はそのまま）。
- 2026-08-17: タスクのバッジ（チップ）左端に優先度ドット（`優先度`列の値：高=赤／中=黄／低=緑、想定外の値は非表示）を追加（`getPriorityDotClass`）。対応中／対応待ち／属性未設定タスクなど、1日タスクへの追加チェック用チップは全箇所に＋ボタンを配置するよう統一。属性未設定タスクの「日付」判定は、開始予定・終了予定が空欄の場合に加え、値はあっても日付部分を含まない（時刻のみ入力）場合も未設定として拾うよう修正（`parseSlashDateOnly`で日付部分の有無を判定）。
- 2026-08-17: PAT（GitHub Personal Access Token）のlocalStorage保存タイミングを、従来の「読込」実行時のみから、「読込・保存・Excel出力・Excel入力」の全操作時に拡張（`persistCurrentToken`）。編集フォームの開始予定・終了予定の自動補完仕様を変更：開始予定の日付を入力すると終了予定の日付に同じ日付を自動セット、開始予定の時（時間）を入力すると開始予定の分を0・終了予定を「時+1・分0」に自動セット（日付をまたぐ判定は行わない）。「開始/終了リセット」ボタンを追加（開始予定・終了予定の日付・時・分を一括で空欄に戻す）。ステータスを「完了」に変更した際の完了日自動セットは、完了日が未入力の場合のみ行うよう変更（入力済みなら上書きしない）。
- 2026-09-25: 報告タブ（`report.js`）を、完了済みタスクを自動的にプールする方式から、自由記述の「エントリ」を都度追記していく方式へ再設計。背景：完了済みタスクのチップだけでは報告に必要な粒度と合わず、かつ全作業をアプリのタスクとして登録しているわけではないため対象外の情報が扱えなかった。新設のPARA区分`エントリ`行（内容＝自由記述、Input＝タグ付けしたテーマノードIDのカンマ区切り、複数テーマに同時タグ付け可）を、常時表示の「クイック追記」から都度追加する。報告タイミング行の備考欄DSLは`#ID 報告|中断 メモ`（3択＋理由メモ）から`#ID 報告|見送り`（2択、メモなし）へ簡略化（`parseReportOccasionEntries`→`parseReportResolutions`、`getReportPool`→`getReportEntryPool`にリネーム）。「見送り」は解決扱いにせずプールに残し続け、見送った回の日付を履歴として保持・表示することで、過去資料を見返さなくても前回何を見送ったか分かるようにした。「報告」を選んで保存すると、該当エントリの内容が下書きへ箇条書きで自動転記される。
- 2026-10-14: 報告タブをテーマ×報告先のマトリクスへ再設計（`report.js`全面書換）。新PARA区分`テーマ`を追加し、エントリは1テーマに属して`Input`=テーマID・`Output`=報告先ごとの状態DSL（`sN 予定|見送り|済 yyyy/mm/dd`、行が無い＝対象外）を持つ。タイミング行は日付（開始予定）と下書き（内容）のみとし、旧備考の`#ID 報告|見送り`方式と報告先タグ（旧Input）は廃止。旧形式エントリは`sanitizeMainDataLegacyFields`内の`migrateLegacyReportEntries`で「未分類」テーマへ自動移行。背景：成果の全体像が見えず編集しにくかったため。
- 2026-07-27: 繰返しタスクの親子関係を`繰返し親ID`列から親ID方式へ統合。`dataModel.js`の`MAIN_DATA_COLUMNS`から`繰返し親ID`を削除。子タスク生成時（`recurring.js`の`buildChild`）は`親ID`＝繰返しテンプレート自身のIDを設定する（プロジェクト所属はテンプレートの`親ID`をさらに辿って判定、多段階の階層になる）。`繰返し識別子`は繰返しテンプレート行にのみ残し、生成される子タスクには付与しない。`task.js`に`isRecurringParentRow`/`isRecurringChildRow`を追加し、`isEligibleParentRow`は繰返しテンプレートを親候補から除外するよう変更（誤って一般タスクの親に選ばれないようにするため）。`getProjectRootRows`・`getProject2ParentRows`・`getProject2AllParentRowsForAdmin`・`matchesProjectRootFilter`にも、繰返しテンプレートをプロジェクト一覧・フィルタから除外する処理を追加（単独の繰返しテンプレートがプロジェクトとして一覧に紛れ込むのを防ぐため）。旧形式データ（`繰返し親ID`列）は`app.js`の`applyContent`内で読み込み時に自動変換する。
- 2026-10-27: タスク管理のサブタブ右端に「AI確認」タブを追加（`js/modules/aiReview.js`新設）。AI秘書がdata.mdへ仮登録した行を確認するための画面。`MAIN_DATA_COLUMNS`に`AI原案`（AI秘書の登録時点の値をJSON文字列で保持。アプリ側では書き換えない）と`AI確認`（空欄＝未確認／`確認済 yyyy/mm/dd`）を追加。「修正あり」は列に保存せず、現在の値と`AI原案`の比較（`diffAiDraft`）で都度判定する。Why：app.js内の更新経路が40箇所以上あり、各所で修正フラグを立てる方式では漏れが出るため（ドラッグ・PJ一括編集による移動も比較なら確実に拾える）。従来の`備考=AI_yymmdd`マーカーは新規登録では使わない（既存行はそのまま）。
- 2026-10-28: brainをタスク管理専用にする方針を決定（ナレッジはほとんど使われていなかったため）。ナレッジとして登録されていた70件（`データ区分=ナレッジ`のうち1日タスク以外）は、別アプリ`brain_temp`へ退避した。あわせてナレッジタブ（一覧・Zettelkasten型の詳細パネル・専用ビューア「料理」「読書」）を削除し、`zettel.js`・`recipe.js`・`reading.js`も削除した。データ編集タブ・INBOXの「ナレッジ」区分の分岐、マスタの`ナレッジ`関連の行、1日タスクは、同日中に次の項目で片付けた。
- 2026-10-28: 1日タスク（DAYPLAN）を`データ区分=ナレッジ`から`データ区分=タスク`（PARA区分=1日タスクはそのまま）へ移行。定数と判定（`DAYPLAN_KUBUN`/`DAYPLAN_PARA`/`isDayPlanRow`）は`calendar.js`から`task.js`へ移し（`calendar.js`は再export）、新設の`isNormalTaskRow`（データ区分=タスクかつ1日タスクではない）で、一覧・件数・カレンダー・親候補などの母集団を絞り込むよう統一した。**How to apply:** 「通常のタスク」を数えたり一覧したりする処理を新しく書くときは、`r['データ区分'] === 'タスク'`ではなく`isNormalTaskRow(r)`を使うこと（1日タスクが紛れ込むのを防ぐため）。旧形式データ（端末キャッシュ等）は`sanitizeMainDataLegacyFields`内で読み込み時に自動変換する（一時的な移行用コード。しばらくしたら削除してよい）。あわせて、データ編集タブのナレッジ区分の分岐とInput/Output/PARA区分の入力欄、`MASTER_DATA_COLUMNS`の`(M)Input`/`(M)Output`を削除。データ側のマスタからも`(M)PARA区分`・`(M)Input`・`(M)Output`の変数定義、データ区分`ナレッジ`、ステータスの親`ナレッジ`（一時メモ・永久保存）、タグ`料理`・`読書`を削除した。`PARA区分`・`Input`・`Output`の列は1日タスクと報告機能が使うため残し、マスタの変数分類を`共通`に直した。
- 2026-10-28: 上部のタブを「タスク管理」「Info」の2つに整理。(1) INBOXタブを廃止し、タスク管理タブ最上部（フィルタの上）に既定で閉じた「クイック登録」Expanderを置いた。登録はデータ区分=タスク・ステータス等は空欄で行い、「属性未設定タスク」一覧をINBOXの代わりにする（マスタのデータ区分からINBOXも削除）。(2) データ編集タブ（edit2、INBOX／タスク統合編集）を削除。メインデータ・マスタデータの生テーブルはInfoタブへ移し、README・メインデータ・マスタデータの3つの閉じたExpanderを並べた（表は開いている間だけ描画）。(3) 編集フォームの一括編集（チェックボックスで複数選択中の「適用」）を、フォームの全項目を書き込む方式から、**フォームに読み込んだ時点から変更した項目だけを反映する**方式に修正（`dayedit2FormBaseline`／`getDayedit2ChangedFields`）。Why：全項目を書き込んでいたため、表示中の1件のタイトル・内容などで他のタスクまで上書きされる不具合があった（ブラウザで再現確認済み）。一括編集中は変更した項目の入力欄を黄色で色付けし、フォーム上部に案内バナーを出す（`updateDayedit2BulkChangeHighlight`）。**How to apply:** 編集フォームに新しい入力欄を追加するときは、`DAYEDIT2_FIELD_ELEMENT_IDS`にも「列名→要素ID」を追加すること（追加しないと、一括編集で変更しても色が付かない。反映自体は行の差分で判定するので漏れない）。
- 2026-10-28: mainDataの保存形式を変更し、**空欄（空文字）の列は保存しない**ようにした（`dataModel.js`の`compactMainRow`を`stringifyMarkdown`で適用）。読込時は`parseMarkdown`内の`normalizeMainRow`で`MAIN_DATA_COLUMNS`の全列を空文字で補い、列順もそろえるため、アプリ内部では従来どおり全列がある前提で扱える。`merge.js`の行比較（`rowsEqual`）も、空欄とキー無しを同じ扱いにし列順の違いを無視するよう変更した（変更しないと、空欄を省いただけの行が「変更あり」と判定され、不要な競合が出るため）。Why：全フィールドの約58%が空欄で、ファイルの半分近くを占めていたため（759KB→425KB、約44%削減）。旧バージョン（v32）のコードで空欄省略後のデータを読んでも表示が変わらないことを確認済み。**How to apply:** AI秘書などがPythonでdata.mdを読むときは、列が省かれていることがあるので`row.get('列名', '')`で読むこと。書き込み時は空欄の列を含めても省いてもよい（次にアプリで保存したときに省かれる）。
- 2026-10-28: 「データ区分」「PARA区分」の2列を廃止し、新設の「システム」列（`MAIN_DATA_COLUMNS`のIDの次。値はオブジェクト）の「種別」へ統合した（段階①）。種別なし＝通常のタスク／`1日タスク`／`報告`（`報告区分`：構造・テーマ・エントリ・タイミング）／`勤務カレンダー`。判定は`task.js`の`getSystemInfo`／`getRowKind`／`isDayPlanRow`／`isNormalTaskRow`、報告は`report.js`の`isReportKind`経由に集約。`createReportRow`は第4引数で報告区分を受け取る形に変更。旧形式（データ区分・PARA区分）の行は`sanitizeMainDataLegacyFields`で読み込みのたびにシステム列へ変換する（旧バージョンの端末やAI秘書の書き込みに備え、当面残す）。マスタからは`(M)データ区分`列と、データ区分・PARA区分・(M)データ区分の変数定義を削除し、`システム`の変数定義（分類：共通）を追加。システム列のオブジェクトは、`dataModel.js`の`formatCellValue`でJSON文字列にして表示・比較する（Infoタブの生データ表、競合解決画面、Excel出力）。JSON文字列で入ってきた値は`normalizeMainRow`でオブジェクトへ戻す。Why：全行がタスクになり、データ区分が行の種類を区別する目印としてしか機能していなかったため。ユーザーの発案で、アプリ管理用の情報を1列に集約する方針にした（段階②：報告のInput・Output、段階③：AI原案・AI確認、段階④：繰返しテンプレート（現・備考）も順次システム列へ移す予定）。**How to apply:** 行の種類の判定は必ず`getRowKind`等の関数を通し、`row['システム']`を直接比較しない。新しい種類の特殊行を追加するときは`KIND_*`定数を`task.js`に追加すること。
- 2026-10-28: 報告の「Input」「Output」列を廃止し、システム列の項目へ移した（段階②）。テーマ行・タイミング行のInput→`報告先`、エントリ行のInput→`テーマID`・Output→`報告状態`（中身の書式は従来どおり。報告状態は`sN 予定|済 yyyy/mm/dd|見送り`のDSL文字列のまま）。読み書きは`report.js`の`getReportField`／`setReportField`と定数`REPORT_KEY_VENUES`／`REPORT_KEY_THEME`／`REPORT_KEY_STATES`経由、新規作成は`createReportRow`の第6引数（システム列の項目）で渡す。システム列の書き換えは`task.js`の`setSystemField`を通し、キーを`SYSTEM_KEY_ORDER`の順に並べ直す（Why：キー順が端末ごとに違うと`merge.js`の比較で変更ありと判定され、余計な競合が出るため）。旧形式（Input・Output列）は`sanitizeMainDataLegacyFields`内の`moveReportFieldsToSystemColumn`で読み込みのたびに移す（システム列に同じ項目があればそちらを優先）。`migrateLegacyReportEntries`（2026-10-14以前の形式の変換）はその前に実行され、旧Input・Output列を直接扱う。マスタからInput・Outputの変数定義を削除。**How to apply:** システム列に新しい項目を足すときは、`SYSTEM_KEY_ORDER`にも追加すること。
