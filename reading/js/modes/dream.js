// readingの「dream」（目指す）：人生の目標・お金・習慣チャレンジ・やりたいこと・教養マップ。旧dreamアプリのd01〜d05。
import { startShelf } from './shelf.js?v=5';

export function start() {
    startShelf({ mode: 'dream', dir: 'reading/02_dream', listFile: 'dreams.md', listKey: 'dreamData', title: 'dream（目指す）' });
}
