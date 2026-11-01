// Portal SDK adapter (CrazyGames / Poki). Plain ES module, no deps. Never throws, never blocks.
// Outside a portal every call is a no-op that resolves at once. Host comes from window.GK_PORTAL (see promo.js).
// SDK method names below are written from memory and NOT checked against the docs: (verify) each one.
//  CrazyGames (verify): script https://sdk.crazygames.com/crazygames-sdk-v3.js, CrazyGames.SDK.init(),
//    SDK.game.gameplayStart()/gameplayStop()/happytime(), SDK.ad.requestAd("midgame"|"rewarded", {adStarted, adFinished, adError}),
//    SDK.game.loadingStart()/loadingStop().
//  Poki (verify): script https://game-cdn.poki.com/scripts/v2/poki-sdk.js, PokiSDK.init(), gameLoadingFinished(),
//    gameplayStart()/gameplayStop(), commercialBreak(), rewardedBreak().
// During an ad a "gk-ad" window event fires ({detail:{playing:true|false}}); games mute/unmute on it
// (_base/audio.js has no global mute to call).
import { portalName, NO_PROMO } from "./promo.js";

const CG_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const POKI_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
const TIMEOUT = 20000;
const portal = portalName();
const isCG = portal === "crazygames";
const isPoki = portal === "poki";
let ready = null;
let loading = true;

export function portalActive() { return isCG || isPoki; }
export function hidesExit() { return NO_PROMO.includes(portal); }

function ad(on) { try { window.dispatchEvent(new CustomEvent("gk-ad", { detail: { playing: on } })); } catch (e) {} }
function sdk() { try { return isCG ? window.CrazyGames && window.CrazyGames.SDK : null; } catch (e) { return null; } }
function poki() { try { return isPoki ? window.PokiSDK : null; } catch (e) { return null; } }
function safe(f) { try { return f(); } catch (e) { return undefined; } }

function load(url) {
  return new Promise((resolve) => {
    try {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    } catch (e) { resolve(false); }
  });
}

export function portalInit() {
  if (ready) return ready;
  if (!portalActive()) return (ready = Promise.resolve(false));
  ready = load(isCG ? CG_URL : POKI_URL).then((ok) => {
    if (!ok) return false;
    if (isCG) return Promise.resolve(safe(() => window.CrazyGames.SDK.init())).then(() => { if (loading) loadingStart(); return true; }, () => false);
    return Promise.resolve(safe(() => window.PokiSDK.init())).then(() => { safe(() => window.PokiSDK.gameLoadingFinished()); return true; }, () => false);
  }).catch(() => false);
  return ready;
}

export function loadingStart() { const s = sdk(); if (s) safe(() => s.game.loadingStart()); }
export function loadingStop() { loading = false; const s = sdk(); if (s) safe(() => s.game.loadingStop()); }
export function gameplayStart() { const s = sdk(), p = poki(); if (s) safe(() => s.game.gameplayStart()); else if (p) safe(() => p.gameplayStart()); }
export function gameplayStop() { const s = sdk(), p = poki(); if (s) safe(() => s.game.gameplayStop()); else if (p) safe(() => p.gameplayStop()); }
export function happyTime() { const s = sdk(); if (s) safe(() => s.game.happytime()); }

function run(kind) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; clearTimeout(t); ad(false); resolve(v); };
    const t = setTimeout(() => fin(false), TIMEOUT);
    if (!portalActive()) return fin(false);
    portalInit().then((ok) => {
      if (!ok) return fin(false);
      const s = sdk(), p = poki();
      const rewarded = kind === "rewarded";
      if (s) {
        safe(() => s.ad.requestAd(kind, {
          adStarted: () => ad(true),
          adFinished: () => fin(true),
          adError: () => fin(false),
        }));
      } else if (p) {
        ad(true);
        Promise.resolve(safe(() => rewarded ? p.rewardedBreak() : p.commercialBreak()))
          .then((r) => fin(rewarded ? !!r : true), () => fin(false));
      } else fin(false);
    });
  });
}

export function requestMidgameAd() { return run("midgame").then(() => {}); }
export function requestRewardedAd() { return run("rewarded").then((r) => ({ rewarded: !!r })); }

// For index.html games: gameplayStart/Stop and a midgame hook from two elements' visibility.
export function hookPortal(playEl, overEl) {
  try {
    portalInit();
    const vis = (e) => !!e && !e.hidden && !e.classList.contains("hidden") && !e.classList.contains("gk-hidden");
    const sync = () => { if (vis(overEl)) gameplayStop(); else if (vis(playEl)) gameplayStart(); else if (playEl) gameplayStop(); };
    const o = new MutationObserver(sync);
    [playEl, overEl].forEach((e) => e && o.observe(e, { attributes: true, attributeFilter: ["class", "hidden"] }));
    sync();
  } catch (e) {}
}

window.gkPortal = { portalInit, gameplayStart, gameplayStop, happyTime, requestMidgameAd, requestRewardedAd, loadingStart, loadingStop, hookPortal };
