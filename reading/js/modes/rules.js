// readingの「rules」（決まり）：各スレッドのCLAUDE.md・スキル・作業役の定義・生活の決まり。毎朝の自動処理が作る写し（手では直さない）。
import { startShelf } from './shelf.js?v=7';
import { SHELF_CONFIGS } from '../modules/shelfOffline.js?v=7';

export function start() {
    startShelf(SHELF_CONFIGS.rules);
}
