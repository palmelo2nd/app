// readingの「rules」（決まり）：各スレッドのCLAUDE.md・スキル・作業役の定義・生活の決まり。毎朝の自動処理が作る写し（手では直さない）。
import { startShelf } from './shelf.js?v=3';

export function start() {
    startShelf({ mode: 'rules', dir: 'reading/03_rules', listFile: 'shelf.md', listKey: 'shelfData', title: 'rules（決まり）' });
}
