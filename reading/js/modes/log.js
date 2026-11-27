// readingの「log」（記録）：作業ログ・取り組みの現在地（HUB・引き継ぎ・labの検討メモ）・出張と宿泊。毎朝の自動処理が作る写し（手では直さない）。
import { startShelf } from './shelf.js?v=6';
import { SHELF_CONFIGS } from '../modules/shelfOffline.js?v=6';

export function start() {
    startShelf(SHELF_CONFIGS.log);
}
