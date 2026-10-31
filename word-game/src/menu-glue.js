// Wraps the existing Letter Pot game (untouched, in game.js) with the
// shared menu/HUD/audio kit. Watches the DOM the game already renders
// instead of editing game.js's own logic.
import { mountMenu } from "../../_base/menu.js";
import { mountHud } from "../../_base/hud.js";

const playArea = document.getElementById("playArea");
function ambience(playing) {
  document.dispatchEvent(new CustomEvent("lp:ambience", { detail: { playing } }));
}
const hud = mountHud({
  fields: [
    { key: "found", label: "Found" },
    { key: "score", label: "Score" },
    { key: "best", label: "Best" },
    { key: "alltime", label: "All-time" },
  ],
});
document.querySelector(".app-header").insertBefore(hud.el, document.getElementById("lp-menu"));

function currentFound() {
  const list = document.getElementById("found-list");
  return list ? list.children.length : 0;
}

function readProgress() {
  const s = window.LetterPot && window.LetterPot.snapshot ? window.LetterPot.snapshot() : null;
  return { n: s ? s.found.length : 0, target: s ? s.possible.length : 0 };
}

function readAllTime() {
  const el = document.getElementById("new-tally");
  const m = el && el.textContent.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function sync() {
  const { n, target } = readProgress();
  const s = window.LetterPot && window.LetterPot.snapshot ? window.LetterPot.snapshot() : null;
  hud.update({ found: `${n} / ${target}`, alltime: readAllTime(), score: s ? s.score : 0, best: s ? s.best : 0 });
}

let potStartAllTime = null;
document.addEventListener("lp:potstart", () => { potStartAllTime = readAllTime(); });
document.addEventListener("lp:score", sync);

// No natural game over (calm, no-timer word game); Finish shows the
// found-word count as the score summary, per the spec's fallback rule.
const menu = mountMenu({
  title: "Letter Pot",
  howTo: "Drag or tap letter tiles to build a word. No timer, no rush.",
  onPlay: () => {
    ambience(true);
    playArea.classList.remove("gk-hidden");
    hud.show();
    sync();
    if (potStartAllTime === null) potStartAllTime = readAllTime();
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
  },
  onExit: () => {
    ambience(false);
    playArea.classList.add("gk-hidden");
    hud.hide();
    hideSummary();
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
  },
  onPause: () => {
    ambience(false);
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
  },
  onResume: () => {
    ambience(true);
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
  },
  onFinish: () => {
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
    return currentFound();
  },
});

// Title Exit, when reached from the title screen itself (no play in
// progress): closing the tab is the only real "exit" for a browser game.
document.addEventListener("click", (e) => {
  const exitLink = e.target.closest(".gk-exit-link");
  if (!exitLink) return;
  if (playArea.classList.contains("gk-hidden")) {
    window.close();
    setTimeout(() => {
      const subtitle = document.querySelector(".gk-subtitle");
      if (subtitle) {
        subtitle.textContent = "To leave, close this browser tab. Press Play to keep going.";
      }
    }, 200);
  }
});

// Track "found this pot" list to fire the score sound + HUD update
// whenever the game's own logic adds a found word.
const foundList = document.getElementById("found-list");
if (foundList) {
  let lastCount = foundList.children.length;
  new MutationObserver(() => {
    const count = foundList.children.length;
    lastCount = count;
    sync();
  }).observe(foundList, { childList: true });
}

const progressEl = document.getElementById("round-progress");
const tallyEl = document.getElementById("new-tally");
if (progressEl) {
  new MutationObserver(sync).observe(progressEl, { childList: true, characterData: true, subtree: true });
}
if (tallyEl) {
  new MutationObserver(sync).observe(tallyEl, { childList: true, characterData: true, subtree: true });
}

// #lp-menu opens the pause overlay (which already has Exit).
const menuBtn = document.getElementById("lp-menu");
if (menuBtn) {
  menuBtn.addEventListener("click", () => menu.showPause());
}

// Pot summary card: gates the deal of a new pot behind a summary screen.
const summary = document.getElementById("lp-summary");
const summaryScore = document.getElementById("lp-summary-score");
const summaryNew = document.getElementById("lp-summary-new");
const summaryWords = document.getElementById("lp-summary-words");
const nextBtn = document.getElementById("next-pot");
const summaryNextBtn = document.getElementById("lp-summary-next");
const summaryKeepBtn = document.getElementById("lp-summary-keep");
const summaryExitBtn = document.getElementById("lp-summary-exit");
let bypass = false;

function hideSummary() {
  if (summary) summary.classList.add("gk-hidden");
}

function showSummary() {
  const { n, target } = readProgress();
  if (summaryScore) summaryScore.textContent = `${n} of ${target} words found · ${(window.LetterPot && window.LetterPot.snapshot().score) || 0} points`;
  if (summaryNew) {
    summaryNew.textContent = `New to you this pot: ${readAllTime() - (potStartAllTime || 0)}`;
  }
  if (summaryWords) {
    summaryWords.innerHTML = "";
    const list = document.getElementById("found-list");
    if (list) {
      Array.from(list.children).forEach((li) => {
        const clone = document.createElement("li");
        clone.textContent = li.textContent;
        summaryWords.appendChild(clone);
      });
    }
  }
  if (summary && summary.classList.contains("gk-hidden")) {
    summary.classList.remove("gk-hidden");
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
  }
  if (summaryNextBtn) summaryNextBtn.focus();
}

if (nextBtn) {
  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest("#next-pot") || bypass) return;
      if (currentFound() === 0) return;
      e.stopPropagation();
      showSummary();
    },
    true
  );
}

if (summaryNextBtn) {
  summaryNextBtn.addEventListener("click", () => {
    hideSummary();
    bypass = true;
    nextBtn.click();
    bypass = false;
    potStartAllTime = readAllTime();
  });
}
if (summaryKeepBtn) {
  summaryKeepBtn.addEventListener("click", () => {
    hideSummary();
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
    if (nextBtn) nextBtn.focus();
  });
}
if (summaryExitBtn) {
  summaryExitBtn.addEventListener("click", () => {
    ambience(false);
    hideSummary();
    menu.showTitle();
    playArea.classList.add("gk-hidden");
    hud.hide();
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "menu" } }));
  });
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!summary || summary.classList.contains("gk-hidden")) return;
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (summaryKeepBtn) summaryKeepBtn.click();
    } else if (e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (summaryNextBtn) summaryNextBtn.click();
    } else if (e.code === "Space" || e.code === "KeyP") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true
);

// Title tiles (D-037 real art): inserted before the title h1 on the menu's
// first screen only.
const titleH1 = document.querySelector(".gk-menu-root .gk-screen h1.gk-title");
if (titleH1) {
  const wrap = document.createElement("div");
  wrap.className = "lp-title-tiles";
  wrap.setAttribute("aria-hidden", "true");
  ["LETTER", "POT"].forEach((word) => {
    const wordEl = document.createElement("div");
    wordEl.className = "lp-title-word";
    word.split("").forEach((ch) => {
      const span = document.createElement("span");
      span.className = "lp-tile lp-title-tile";
      span.textContent = ch;
      wordEl.appendChild(span);
    });
    wrap.appendChild(wordEl);
  });
  titleH1.parentNode.insertBefore(wrap, titleH1);
}
