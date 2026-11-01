// Shared title/pause/game-over menu kit (D-038 complete loop, D-041 pause
// keys, D-042 auto-pause on blur). Plain ES module, no build step, no deps.
import { mountPromo } from "./promo.js";
import { showInterstitial, mountRewardButton } from "./ads.js";
import { hidesExit, portalInit, gameplayStart, gameplayStop } from "./portal.js";

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

/**
 * mountMenu({ title, onPlay, onExit, howTo, onPause, onResume })
 * Renders title screen, pause overlay, game-over overlay into <body>.
 * Returns { showTitle, showPlay, showPause, showGameOver, destroy }.
 */
export function mountMenu({ title, onPlay, onExit, howTo, onPause, onResume, onFinish, onContinue } = {}) {
  const root = el("div", "gk-menu-root");
  document.body.appendChild(root);

  // ---- Title screen ----
  const titleScreen = el("div", "gk-screen gk-hidden");
  titleScreen.appendChild(el("h1", "gk-title", title || "Game"));
  if (howTo) titleScreen.appendChild(el("p", "gk-subtitle", howTo));
  const titleButtons = el("div", "gk-buttons");
  const playBtn = el("button", "gk-btn gk-btn-primary", "Play");
  titleButtons.appendChild(playBtn);
  titleScreen.appendChild(titleButtons);
  const titleExit = el("button", "gk-exit-link", "Exit");
  titleScreen.appendChild(titleExit);
  if (hidesExit()) titleExit.style.display = "none";
  root.appendChild(titleScreen);
  const promoSlug = location.pathname.split("/").filter(Boolean).slice(-2)[0] || "";
  mountPromo({ current: promoSlug, parent: titleScreen }).el.classList.add("gk-promo-quiet");

  // ---- Pause overlay ----
  const pauseScreen = el("div", "gk-screen gk-overlay gk-hidden");
  pauseScreen.appendChild(el("h2", "gk-title-sm", "Paused"));
  const pauseButtons = el("div", "gk-buttons");
  const resumeBtn = el("button", "gk-btn gk-btn-primary", "Resume");
  pauseButtons.appendChild(resumeBtn);
  // D-038: games with no natural game-over get a "Finish" action here that
  // shows the score summary via the game-over overlay instead.
  let finishBtn = null;
  if (onFinish) {
    finishBtn = el("button", "gk-btn", "Finish");
    pauseButtons.appendChild(finishBtn);
  }
  const pauseExitBtn = el("button", "gk-btn gk-btn-quiet", "Exit");
  if (hidesExit()) pauseExitBtn.style.display = "none";
  pauseButtons.appendChild(pauseExitBtn);
  pauseScreen.appendChild(pauseButtons);
  mountPromo({ current: promoSlug, parent: pauseScreen });
  root.appendChild(pauseScreen);

  // ---- Game-over overlay ----
  const overScreen = el("div", "gk-screen gk-overlay gk-hidden");
  overScreen.appendChild(el("h2", "gk-title-sm", "Game Over"));
  const overScore = el("div", "gk-score-line", "");
  overScreen.appendChild(overScore);
  const overButtons = el("div", "gk-buttons");
  const againBtn = el("button", "gk-btn gk-btn-primary", "Play again");
  const overExitBtn = el("button", "gk-btn gk-btn-quiet", "Exit");
  overButtons.appendChild(againBtn);
  if (hidesExit()) overExitBtn.style.display = "none";
  overButtons.appendChild(overExitBtn);
  overScreen.appendChild(overButtons);
  mountRewardButton(overButtons, { onReward: onContinue && (() => { hideAll(); paused = false; onContinue(); }) });
  mountPromo({ current: promoSlug, parent: overScreen });
  root.appendChild(overScreen);

  const screens = [titleScreen, pauseScreen, overScreen];
  function hideAll() { screens.forEach((s) => s.classList.add("gk-hidden")); }

  let paused = false;

  portalInit();
  function showTitle() { hideAll(); titleScreen.classList.remove("gk-hidden"); paused = false; }
  function showPlay() { hideAll(); paused = false; gameplayStart(); }
  function showPause() {
    if (paused) return;
    paused = true;
    hideAll();
    pauseScreen.classList.remove("gk-hidden");
    gameplayStop();
    if (onPause) onPause();
  }
  function hidePause() {
    if (!paused) return;
    paused = false;
    hideAll();
    gameplayStart();
    if (onResume) onResume();
  }
  function showGameOver(score) {
    hideAll();
    overScore.textContent = score !== undefined ? `Score: ${score}` : "";
    overScreen.classList.remove("gk-hidden");
    paused = true;
    gameplayStop();
    showInterstitial({ key: promoSlug });
  }

  playBtn.addEventListener("click", () => { showPlay(); if (onPlay) onPlay(); });
  resumeBtn.addEventListener("click", hidePause);
  if (finishBtn) {
    finishBtn.addEventListener("click", () => {
      const score = onFinish();
      showGameOver(score);
    });
  }
  pauseExitBtn.addEventListener("click", () => { showTitle(); if (onExit) onExit(); });
  overExitBtn.addEventListener("click", () => { showTitle(); if (onExit) onExit(); });
  titleExit.addEventListener("click", () => { if (onExit) onExit(); });
  againBtn.addEventListener("click", () => { showPlay(); if (onPlay) onPlay(); });

  function isOnTitleOrOver() {
    return !titleScreen.classList.contains("gk-hidden") || !overScreen.classList.contains("gk-hidden");
  }

  document.addEventListener("keydown", (e) => {
    if (isOnTitleOrOver()) return;
    if (e.code === "Space" || e.code === "Escape" || e.code === "KeyP") {
      e.preventDefault();
      if (paused) hidePause(); else showPause();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !isOnTitleOrOver()) showPause();
  });
  window.addEventListener("blur", () => {
    if (!isOnTitleOrOver()) showPause();
  });

  showTitle();

  return {
    showTitle,
    showPlay,
    showPause,
    hidePause,
    showGameOver,
    destroy() { root.remove(); },
  };
}
