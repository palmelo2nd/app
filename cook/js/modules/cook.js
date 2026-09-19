// (1) インポート — なし（純粋な計算・データ加工のみ）

export const KUBUN = {
    INGREDIENT: '食材',
    TOOL: '調理器具',
    DISH: '料理',
    MEALPLAN: '献立'
};

// (2) インプット: row  (3) メイン: データ区分の一致判定  (4) アウトプット: boolean
export const isIngredientRow = row => row['データ区分'] === KUBUN.INGREDIENT;
export const isToolRow       = row => row['データ区分'] === KUBUN.TOOL;
export const isDishRow       = row => row['データ区分'] === KUBUN.DISH;
export const isMealPlanRow   = row => row['データ区分'] === KUBUN.MEALPLAN;

/**
 * JSON文字列で保持している構造化列（材料リスト・使用調理器具・調理手順・調理ログ・構成料理リスト）を配列に復元する。
 *
 * (2) インプット: value — JSON文字列 or 配列 or 空値
 * (3) メイン: 文字列ならJSON.parse、失敗時・空値は空配列を返す
 * (4) アウトプット: Array
 */
export function parseListField(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// (2) インプット: rows — 配列  (3) メイン: JSON文字列化  (4) アウトプット: JSON文字列
export function stringifyListField(rows) {
    return JSON.stringify(rows || []);
}

/**
 * 指定した食材IDを材料リストで参照している料理行を返す（食材詳細の「この食材を使う料理」逆引き用）。
 *
 * (2) インプット: mainData — 全行配列, ingredientId — 調べたい食材のID
 * (3) メイン: データ区分=料理の行のうち、材料リストに該当IDを含むものを抽出
 * (4) アウトプット: 該当する料理行の配列
 */
export function findDishesUsingIngredient(mainData, ingredientId) {
    const id = String(ingredientId);
    return mainData.filter(row =>
        isDishRow(row) &&
        parseListField(row['材料リスト']).some(item => String(item.食材ID) === id)
    );
}

/**
 * 指定した調理器具IDを使用調理器具リストで参照している料理行を返す（調理器具詳細の逆引き用）。
 *
 * (2) インプット: mainData, toolId
 * (3) メイン: データ区分=料理の行のうち、使用調理器具に該当IDを含むものを抽出
 * (4) アウトプット: 該当する料理行の配列
 */
export function findDishesUsingTool(mainData, toolId) {
    const id = String(toolId);
    return mainData.filter(row =>
        isDishRow(row) &&
        parseListField(row['使用調理器具']).some(toolIdItem => String(toolIdItem) === id)
    );
}

/**
 * 指定した料理IDを構成料理リストで参照している献立行を返す（料理詳細の「この料理を含む献立」逆引き用）。
 *
 * (2) インプット: mainData, dishId
 * (3) メイン: データ区分=献立の行のうち、構成料理リストに該当IDを含むものを抽出
 * (4) アウトプット: 該当する献立行の配列
 */
export function findMealPlansUsingDish(mainData, dishId) {
    const id = String(dishId);
    return mainData.filter(row =>
        isMealPlanRow(row) &&
        parseListField(row['構成料理リスト']).some(item => String(item.料理ID) === id)
    );
}

/**
 * 調理手順配列の所要時間（分）の合計を計算する。
 *
 * (2) インプット: steps — [{内容, 所要時間}] 形式の配列
 * (3) メイン: 所要時間を数値化して合計
 * (4) アウトプット: 合計分数（数値）
 */
export function computeDishTotalTime(steps) {
    return (steps || []).reduce((sum, step) => sum + (Number(step.所要時間) || 0), 0);
}

/**
 * 選択した料理群（献立展開後を含む）から、必要な食材と使用先料理のリストを集計する（買い物リスト）。
 * 分量は自由記述のため数値合算はせず、食材ごとに「どの料理でどれだけ使うか」を列挙する。
 *
 * (2) インプット: mainData — 全行配列, dishIds — 対象の料理ID配列
 * (3) メイン: 各料理の材料リストを展開し、食材IDごとにグルーピング
 * (4) アウトプット: [{ 食材ID, 食材名, uses: [{ 料理名, 分量, 備考 }] }]
 */
export function computeShoppingList(mainData, dishIds) {
    const idSet = new Set(dishIds.map(String));
    const dishes = mainData.filter(row => isDishRow(row) && idSet.has(String(row['ID'])));

    const grouped = new Map();
    dishes.forEach(dish => {
        parseListField(dish['材料リスト']).forEach(item => {
            const ingredientId = String(item.食材ID);
            if (!grouped.has(ingredientId)) {
                const ingredientRow = mainData.find(r => isIngredientRow(r) && String(r['ID']) === ingredientId);
                grouped.set(ingredientId, {
                    食材ID: ingredientId,
                    食材名: ingredientRow ? ingredientRow['タイトル'] : `不明な食材 #${ingredientId}`,
                    uses: []
                });
            }
            grouped.get(ingredientId).uses.push({
                料理名: dish['タイトル'],
                分量: item.分量 || '',
                備考: item.備考 || ''
            });
        });
    });

    return [...grouped.values()];
}

/**
 * 献立を構成する各料理の調理手順から、全料理が同時に仕上がるような開始タイミングの目安を計算する。
 * 最も時間がかかる料理を基準（オフセット0）とし、他の料理はその差分だけ遅らせて開始する。
 *
 * (2) インプット: mainData — 全行配列, mealPlanRow — 献立行
 * (3) メイン: 構成料理リストの各料理IDから行を引き、所要時間合計の最大値との差でオフセットを算出
 * (4) アウトプット: [{ 料理ID, 料理名, 役割, 合計時間, 開始オフセット分, 手順 }]（開始オフセットが大きいほど先に着手）
 */
export function computeMealPlanTimeline(mainData, mealPlanRow) {
    const entries = parseListField(mealPlanRow['構成料理リスト']).map(item => {
        const dish  = mainData.find(r => isDishRow(r) && String(r['ID']) === String(item.料理ID));
        const steps = dish ? parseListField(dish['調理手順']) : [];
        return {
            料理ID: item.料理ID,
            料理名: dish ? dish['タイトル'] : `不明な料理 #${item.料理ID}`,
            役割: item.役割 || '',
            合計時間: computeDishTotalTime(steps),
            手順: steps
        };
    });

    const maxTime = entries.reduce((max, e) => Math.max(max, e.合計時間), 0);

    return entries
        .map(e => ({ ...e, 開始オフセット分: maxTime - e.合計時間 }))
        .sort((a, b) => b.開始オフセット分 - a.開始オフセット分);
}

/**
 * mainDataを条件でフィルタする（一覧表示・買い物リスト対象選択などで共通利用）。
 *
 * (2) インプット: mainData, kubun — データ区分, filters — { category, tag, timeTag, difficulty, status, maxCookTime }
 * (3) メイン: データ区分一致のうえ、filtersに値がある項目だけ順に絞り込む
 * (4) アウトプット: フィルタ済み配列（元データは変更しない）
 */
export function filterRows(mainData, kubun, filters = {}) {
    let rows = mainData.filter(row => row['データ区分'] === kubun);

    if (filters.category) rows = rows.filter(r => r['カテゴリ'] === filters.category);
    if (filters.tag)      rows = rows.filter(r => (r['タグ'] || '').includes(filters.tag));
    if (filters.timeTag)  rows = rows.filter(r => (r['時間帯タグ'] || '').includes(filters.timeTag));
    if (filters.difficulty) rows = rows.filter(r => r['難易度'] === filters.difficulty);
    if (filters.status)   rows = rows.filter(r => r['ステータス'] === filters.status);
    if (filters.maxCookTime) rows = rows.filter(r => Number(r['調理時間']) > 0 && Number(r['調理時間']) <= Number(filters.maxCookTime));

    return rows;
}

/** 現在時刻を "YYYY/MM/DD HH:mm" 形式で返す（調理ログの日時初期値などに使用）。 */
export function formatNowJp() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
