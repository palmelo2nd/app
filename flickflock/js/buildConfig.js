// ふりっくふろっく：ストア版の切り替え（2026-11-14）。
// 2026-11-19、商用版をtyping（Web版「文字入力」）から切り分けてこのフォルダ（flickflock）にした（brain #1710）。
// 商用版は端末内保存だけにするため、Web（myのINDEXから開く確認用）でも常にストア版として動かす（true のまま）。
// false にすると、GitHubの共有記録（typing/records.md）を読み書きするWeb版の動きになるので、変えないこと。
// typing-capacitor の scripts/sync-web.js は、ここが true であることを確かめてから www/ へコピーする。
export const RELEASE_BUILD = true;

// 広告（AdMob。ストア版だけで使う）。広告のIDは秘密の情報ではない（アプリの中に入るもの）。
// 【要差し替え】今はGoogleのテスト用のID（testing: true）。AdMobのアカウントを作ったら（1-4章、本人）、
// 本番の広告ユニットIDに替えて testing を false にする。アプリのIDは typing-capacitor の strings.xml（admob_app_id）。
export const ADS = {
    testing: true,
    bannerId: 'ca-app-pub-3940256099942544/9214589741',       // テスト用：アダプティブバナー
    interstitialId: 'ca-app-pub-3940256099942544/1033173712', // テスト用：全画面広告
};
