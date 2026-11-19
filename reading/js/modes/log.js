// readingの「log」（記録）：作業ログ・取り組みの現在地（HUB・引き継ぎ・labの検討メモ）・出張と宿泊。毎朝の自動処理が作る写し（手では直さない）。
import { startShelf } from './shelf.js?v=2';

export function start() {
    startShelf({ mode: 'log', dir: 'reading/04_log', listFile: 'shelf.md', listKey: 'shelfData', title: 'log（記録）' });
}
