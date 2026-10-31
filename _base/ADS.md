# Dormant ad hook (ads.js)

Games use `_base/ads.js` (also `window.gkAds`). Nothing shows in a browser; ads appear
only when the Android wrapper provides one of these providers (detected at runtime).

## Provider shapes
1. Capacitor: `window.Capacitor.Plugins.AdMob` from `@capacitor-community/admob`.
   Set `window.SERVI_ADMOB_REWARDED` / `window.SERVI_ADMOB_INTERSTITIAL` to ad unit ids.
   Reward = the `rewardVideoReward` event.
2. `window.ServiAds` (injected JS object):
   `showRewarded(cb)` calls `cb(true)` when the reward is earned, else `cb(false)`;
   `showInterstitial(cb)` calls `cb()` when closed.
3. `window.AndroidAds` (addJavascriptInterface bridge): `showRewarded()` and
   `showInterstitial()`; the wrapper then dispatches window event `servi-ad-result`
   with `detail: { rewarded: true|false }` (or a bare boolean).

Every request times out after 15 s (rewarded resolves false). An interstitial shows
on every 3rd game over per game (localStorage key `servi_ads_<slug>`).

## TWA caveat
A Trusted Web Activity has no JS bridge, so no provider can exist and ads are not
possible, unless ServiAds is supplied some other way (e.g. a Custom Tabs postMessage
relay). Use Capacitor or a WebView wrapper for ads.

## Test switch
Add `?ads=fake` to any game URL: installs a fake provider that shows a "Test ad"
overlay for 2 s, then reports rewarded true. The reward button then shows on game over.

## Game integration
- menu.js games: game over calls `showInterstitial`; `mountMenu({ onContinue })` makes
  the reward button hide game over and run onContinue.
- coin-runner, castle-defense, number-game: `hookGameOver()` in the index.html module.

## app-ads.txt (hub root, once an AdMob publisher id exists)
google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
