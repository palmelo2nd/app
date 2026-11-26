// 勉強用ビュー（表と裏を順に見るだけ。箱番号・学習履歴は変えない）の並び順を作る
// 1. インポート：なし

// 2. インプット：mainData（全カード）、kubun（種別）、random（true＝ランダム／false＝登録順）
export function buildStudyList(mainData, kubun, random) {
    // 3. メイン機能
    const list = mainData.filter(r => r['種別'] === kubun);
    if (random) {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
    }
    // 4. アウトプット
    return list;
}
