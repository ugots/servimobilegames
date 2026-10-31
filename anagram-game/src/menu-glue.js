// Wraps the Anagram Adventure game (game.js) with the shared menu kit:
// title, pause (Resume / Finish / Exit) and the finish summary.
import { mountMenu } from "../../_base/menu.js";

const playArea = document.getElementById("playArea");
function ambience(playing) {
  document.dispatchEvent(new CustomEvent("an:ambience", { detail: { playing } }));
}
function menuSound() {
  document.dispatchEvent(new CustomEvent("an:sound", { detail: { kind: "menu" } }));
}

const menu = mountMenu({
  title: "Anagram Adventure",
  howTo: "Unscramble the tiles to make a word. Three words clear a level and each level adds a letter. You have three lives; Give Up costs one. No timer.",
  onPlay: () => {
    window.AnagramGame.newRun();
    playArea.classList.remove("gk-hidden");
    ambience(true);
    menuSound();
  },
  onExit: () => {
    ambience(false);
    playArea.classList.add("gk-hidden");
    menuSound();
  },
  onPause: () => {
    ambience(false);
    menuSound();
  },
  onResume: () => {
    ambience(true);
    menuSound();
  },
  onFinish: () => {
    menuSound();
    return window.AnagramGame.summary();
  },
});

// #an-menu opens the pause overlay (which already has Exit).
document.getElementById("an-menu").addEventListener("click", () => menu.showPause());

// Title Exit, when reached from the title screen itself (no play in progress):
// closing the tab is the only real "exit" for a browser game.
document.addEventListener("click", (e) => {
  const exitLink = e.target.closest(".gk-exit-link");
  if (!exitLink) return;
  if (playArea.classList.contains("gk-hidden")) {
    window.close();
    setTimeout(() => {
      const subtitle = document.querySelector(".gk-subtitle");
      if (subtitle) subtitle.textContent = "To leave, close this browser tab. Press Play to keep going.";
    }, 200);
  }
});

// Title mark and tiles (D-037, D-039): inserted before the title h1 on the
// menu's first screen only.
const titleH1 = document.querySelector(".gk-menu-root .gk-screen h1.gk-title");
if (titleH1) {
  const mark = document.createElement("img");
  mark.className = "an-title-mark";
  mark.src = "favicon.svg";
  mark.alt = "";
  mark.setAttribute("aria-hidden", "true");
  const wrap = document.createElement("div");
  wrap.className = "lp-title-tiles";
  wrap.setAttribute("aria-hidden", "true");
  const wordEl = document.createElement("div");
  wordEl.className = "lp-title-word";
  "ANAGRAM".split("").forEach((ch) => {
    const span = document.createElement("span");
    span.className = "lp-tile lp-title-tile";
    span.textContent = ch;
    wordEl.appendChild(span);
  });
  wrap.appendChild(wordEl);
  titleH1.parentNode.insertBefore(mark, titleH1);
  titleH1.parentNode.insertBefore(wrap, titleH1);
}
