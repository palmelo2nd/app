// readingの「dream」（目指す）：人生の目標・お金・習慣チャレンジ・やりたいこと・教養マップ。旧dreamアプリのd01〜d05。
import { startShelf } from './shelf.js?v=7';
import { SHELF_CONFIGS } from '../modules/shelfOffline.js?v=7';

export function start() {
    startShelf(SHELF_CONFIGS.dream);
}
