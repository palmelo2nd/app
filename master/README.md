# Master（管理者用の入口）

2026-11-02作成。管理者（my）が3つの用途別INDEXを行き来しやすくするためのページ。どのメニューからもリンクしない。

- **トークン**：my（app_data）／save（save_data）／family（family_data）の3つを、用途別INDEXと同じキー（`index_pat_token_<データリポジトリ名>`）に保存する。保存しても「現在の用途」（`app_data_repo`）は変えない（切り替えは移動先のINDEXが行う）。
- **開く**：`../index_my/`等へ普通に移動するだけ。移動先のINDEXが自分の用途のトークンを読み込み、各アプリへ引き継ぐ。URLにはトークンを載せない。
- **表示の条件**：公開ページなので開くこと自体は防げない。myのトークンでapp_dataに届くことを確かめたときだけ「開く」を出す（各用途の行は、その用途のトークンも届くときだけ）。
- **注意**：saveやfamilyのINDEXを開いたあとにbrain等を直接開くと、トークンが切り替わったままで読み込めない。Masterに戻ってmyを開けば元に戻る。
- キャッシュバスティング：`index.html`と`js/app.js`（import文含む）の`?v=N`を揃える。共通の`storage.js`・`style.css`はindex_commonの値（現在v6）に合わせる。
