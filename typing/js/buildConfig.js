// ふりっくふろっく：ストア版の切り替え（2026-11-14）。
// Web版（GitHub Pages）では false のまま。ここは手で書き換えない。
// ストア版を作るときは、typing-capacitor の scripts/sync-web.js が www/ へコピーする際に true へ書き換える。
// ブラウザでストア版の見た目を確かめたいときは、URLに ?store を付ける（app.js の STORE を参照）。
export const RELEASE_BUILD = false;

// 広告（AdMob。ストア版だけで使う）。広告のIDは秘密の情報ではない（アプリの中に入るもの）。
// 【要差し替え】今はGoogleのテスト用のID（testing: true）。AdMobのアカウントを作ったら（1-4章、本人）、
// 本番の広告ユニットIDに替えて testing を false にする。アプリのIDは typing-capacitor の strings.xml（admob_app_id）。
export const ADS = {
    testing: true,
    bannerId: 'ca-app-pub-3940256099942544/9214589741',       // テスト用：アダプティブバナー
    interstitialId: 'ca-app-pub-3940256099942544/1033173712', // テスト用：全画面広告
};
