// (1) インポート — なし（AdMobのプラグインは呼び出し側から受け取る）

// ふりっくふろっく：広告（Google AdMob。ストア版だけ。2026-11-14）。
// 方針はストア公開タスク一覧「D3 広告の方針」：
//  ・バナーはレベル一覧と結果画面だけ。プレイ中・解説・レベルのパネル（「挑戦する」ボタン）を開いている間は出さない
//  ・全画面広告は「ステージの間」＝結果画面のボタンを押したあとだけ。3プレイに1回、かつ前の全画面広告から3分以上あける
//  ・Lv5まで（allowed() が false の間）は、バナーも全画面広告も出さない
//  ・広告の内容は全年齢（G）。通信できない・読み込めないときは、広告が出ないだけで遊べる（失敗はすべて無視する）
// アプリを開いた直後・閉じるとき・プレイを途中でやめたときは出さない（呼び出し側が betweenStages を使うのは結果画面のボタンだけ）。
//
// 使い方（app.js）：
//   const ads = createAds(window.Capacitor?.Plugins?.AdMob, { ...ADS, allowed, onBannerHeight });
//   ads.setScreen('list'|'result'|'play'|'guide'|'sheet');  // 画面が変わるたび
//   ads.countPlay();                                         // 1プレイ終わるたび
//   const shown = await ads.betweenStages();                 // 結果画面のボタンを押したとき（全画面広告を出したら true）

const PLAYS_PER_INTERSTITIAL = 3;
const MIN_INTERVAL_MS = 3 * 60 * 1000;
const SHOW_TIMEOUT_MS = 120 * 1000; // 閉じた知らせが来ないときも、この時間で先へ進める

/**
 * (2) インプット: AdMob（Capacitorのプラグイン。無ければ何もしない）,
 *     { testing, bannerId, interstitialId, allowed: () => boolean, onBannerHeight: (px) => void }
 * (4) アウトプット: { setScreen, countPlay, betweenStages }
 */
export function createAds(AdMob, { testing, bannerId, interstitialId, allowed, onBannerHeight }) {
    if (!AdMob) return { setScreen() {}, countPlay() {}, betweenStages: async () => false };

    let ready = false;
    let screen = 'list';
    let bannerCreated = false;
    let bannerShown = false;
    let interstitialReady = false;
    let plays = 0;
    let lastShownAt = 0;
    let finishShow = null; // 全画面広告を出している間だけ、閉じたときに呼ぶ関数

    const ignore = () => {};
    AdMob.addListener('bannerAdSizeChanged', (size) => { if (bannerShown) onBannerHeight(size?.height || 0); });
    AdMob.addListener('interstitialAdFailedToLoad', () => { interstitialReady = false; });
    AdMob.addListener('interstitialAdDismissed', () => finishShow?.());
    AdMob.addListener('interstitialAdFailedToShow', () => finishShow?.());

    function prepare() {
        AdMob.prepareInterstitial({ adId: interstitialId, isTesting: testing })
            .then(() => { interstitialReady = true; })
            .catch(() => { interstitialReady = false; });
    }

    function applyBanner() {
        if (!ready) return;
        const want = (screen === 'list' || screen === 'result') && allowed();
        if (want && !bannerShown) {
            bannerShown = true;
            const p = bannerCreated
                ? AdMob.resumeBanner()
                : AdMob.showBanner({ adId: bannerId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: testing });
            bannerCreated = true;
            p.catch(() => { bannerShown = false; bannerCreated = false; onBannerHeight(0); });
        } else if (!want && bannerShown) {
            bannerShown = false;
            onBannerHeight(0);
            AdMob.hideBanner().catch(ignore);
        }
    }

    AdMob.initialize({
        initializeForTesting: testing,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
        maxAdContentRating: 'General', // 全年齢（G）
    }).then(() => { ready = true; prepare(); applyBanner(); }).catch(ignore);

    return {
        setScreen(name) {
            screen = name;
            applyBanner();
        },
        countPlay() {
            plays++;
        },
        async betweenStages() {
            if (!ready || !interstitialReady || !allowed()) return false;
            if (plays < PLAYS_PER_INTERSTITIAL || Date.now() - lastShownAt < MIN_INTERVAL_MS) return false;
            interstitialReady = false;
            await new Promise((resolve) => {
                const timer = setTimeout(() => finishShow?.(), SHOW_TIMEOUT_MS);
                finishShow = () => { clearTimeout(timer); finishShow = null; resolve(); };
                AdMob.showInterstitial().catch(() => finishShow?.());
            });
            plays = 0;
            lastShownAt = Date.now();
            prepare(); // 次の分を読み込んでおく
            return true;
        },
    };
}
