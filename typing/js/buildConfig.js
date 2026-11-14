// ふりっくふろっく：ストア版の切り替え（2026-11-14）。
// Web版（GitHub Pages）では false のまま。ここは手で書き換えない。
// ストア版を作るときは、typing-capacitor の scripts/sync-web.js が www/ へコピーする際に true へ書き換える。
// ブラウザでストア版の見た目を確かめたいときは、URLに ?store を付ける（app.js の STORE を参照）。
export const RELEASE_BUILD = false;
