// Dormant ad hook (MKT1). Plain ES module, no deps. See ADS.md.
// Never throws and never blocks the game; nothing shows unless a wrapper provides an ad provider.
import { portalActive, requestMidgameAd, requestRewardedAd } from "./portal.js";
const TIMEOUT = 15000;
let fake = false;
try { fake = /[?&]ads=fake\b/.test(location.search); } catch (e) {}

function installFake() {
  if (!fake || window.ServiAds) return;
  const run = (cb) => {
    const o = document.createElement("div");
    o.className = "gk-fake-ad";
    o.textContent = "Test ad";
    o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000c;color:#fff;font:700 32px sans-serif;display:flex;align-items:center;justify-content:center";
    document.body.appendChild(o);
    setTimeout(() => { o.remove(); cb(true); }, 2000);
  };
  window.ServiAds = { showRewarded: run, showInterstitial: run };
}
installFake();

export function adsAvailable() {
  try { return portalActive() || !!(window.Capacitor?.Plugins?.AdMob || window.ServiAds || window.AndroidAds); } catch (e) { return false; }
}

// Ask the detected provider; resolves true/false (reward or shown), never rejects, 15 s cap.
function ask(kind) {
  if (portalActive()) return kind === "rewarded" ? requestRewardedAd().then((r) => r.rewarded) : requestMidgameAd().then(() => true);
  return new Promise((resolve) => {
    let done = false;
    const cleanups = [];
    const fin = (v) => { if (done) return; done = true; cleanups.forEach((f) => { try { f(); } catch (e) {} }); resolve(!!v); };
    const t = setTimeout(() => fin(false), TIMEOUT);
    cleanups.push(() => clearTimeout(t));
    try {
      const rewarded = kind === "rewarded";
      const admob = window.Capacitor?.Plugins?.AdMob;
      if (window.ServiAds) {
        window.ServiAds[rewarded ? "showRewarded" : "showInterstitial"]((r) => fin(rewarded ? r : true));
      } else if (window.AndroidAds) {
        const h = (e) => fin(rewarded ? !!(e.detail && (e.detail.rewarded ?? e.detail)) : true);
        window.addEventListener("servi-ad-result", h);
        cleanups.push(() => window.removeEventListener("servi-ad-result", h));
        window.AndroidAds[rewarded ? "showRewarded" : "showInterstitial"]();
      } else if (admob) {
        if (rewarded) {
          const l = admob.addListener && admob.addListener("rewardVideoReward", () => fin(true));
          if (l && l.then) l.then((x) => cleanups.push(() => x.remove && x.remove())).catch(() => {});
          Promise.resolve(admob.prepareRewardVideoAd({ adId: window.SERVI_ADMOB_REWARDED || "" }))
            .then(() => admob.showRewardVideoAd()).then(() => setTimeout(() => fin(false), 3000)).catch(() => fin(false));
        } else {
          Promise.resolve(admob.prepareInterstitial({ adId: window.SERVI_ADMOB_INTERSTITIAL || "" }))
            .then(() => admob.showInterstitial()).then(() => fin(true)).catch(() => fin(false));
        }
      } else fin(false);
    } catch (e) { fin(false); }
  });
}

export function showInterstitial({ every = 3, key = "game" } = {}) {
  try {
    if (!adsAvailable()) return Promise.resolve();
    const k = "servi_ads_" + key;
    const n = (parseInt(localStorage.getItem(k), 10) || 0) + 1;
    localStorage.setItem(k, String(n));
    if (n % every !== 0) return Promise.resolve();
    return ask("interstitial").then(() => {}, () => {});
  } catch (e) { return Promise.resolve(); }
}

export function showRewarded() {
  try {
    if (!adsAvailable()) return Promise.resolve({ rewarded: false });
    return ask("rewarded").then((r) => ({ rewarded: !!r }), () => ({ rewarded: false }));
  } catch (e) { return Promise.resolve({ rewarded: false }); }
}

export function mountRewardButton(container, { label = "Watch an ad to continue", onReward } = {}) {
  try {
    if (!container || !adsAvailable()) return null;
    const b = document.createElement("button");
    b.className = "btn gk-btn gk-reward-btn";
    b.textContent = label;
    b.addEventListener("click", () => {
      showRewarded().then((r) => { if (r.rewarded && onReward) onReward(); });
    });
    container.appendChild(b);
    return b;
  } catch (e) { return null; }
}

// For index.html games: mount the reward button; when `el` becomes visible, fire an interstitial.
export function hookGameOver(el, key, buttons) {
  try {
    if (!el) return;
    mountRewardButton(buttons || el);
    const vis = () => !el.hidden && !el.classList.contains("hidden") && !el.classList.contains("gk-hidden");
    let was = vis();
    new MutationObserver(() => { const v = vis(); if (v && !was) showInterstitial({ key }); was = v; })
      .observe(el, { attributes: true, attributeFilter: ["class", "hidden"] });
  } catch (e) {}
}

window.gkAds = { adsAvailable, showInterstitial, showRewarded, mountRewardButton };
