// Wraps the existing Number Game (untouched, in app.js) with the shared
// menu/HUD/audio kit. The "What's your name?" card still runs, but only
// after Play is pressed on the title menu.
import { mountMenu } from "../_base/menu.js";
import { mountHud } from "../_base/hud.js";
import { createAudio } from "../_base/audio.js";

const playArea = document.getElementById("playArea");
const nameGate = document.getElementById("name-gate");
const audio = createAudio();
const hud = mountHud({ fields: [{ key: "stickers", label: "Stickers" }] });

function revealGame() {
  if (localStorage.getItem("numgame_name")) {
    playArea.classList.remove("gk-hidden");
  } else {
    nameGate.classList.remove("gk-hidden");
    // app.js's own name-go handler hides #name-gate via inline style once
    // a name is chosen; reveal the play area right after that happens.
    const goBtn = document.getElementById("name-go");
    const input = document.getElementById("name-input");
    const reveal = () => { nameGate.classList.add("gk-hidden"); playArea.classList.remove("gk-hidden"); };
    goBtn.addEventListener("click", reveal, { once: true });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") reveal(); }, { once: true });
  }
  hud.show();
}

// No natural game over (endless practice modes); Finish shows the sticker
// count as the score summary, per the spec's fallback rule.
const menu = mountMenu({
  title: "Number Fun",
  howTo: "Pick a mode above and tap the right answer to earn stickers.",
  onPlay: () => { revealGame(); audio.play("menu"); },
  onExit: () => {
    playArea.classList.add("gk-hidden");
    nameGate.classList.add("gk-hidden");
    hud.hide();
    audio.play("menu");
  },
  onFinish: () => document.getElementById("sticker-sheet")?.children.length || 0,
});

// Track the sticker sheet the game already renders to fire the score
// sound + HUD update whenever app.js awards a sticker.
const sheet = document.getElementById("sticker-sheet");
if (sheet) {
  let lastCount = 0;
  new MutationObserver(() => {
    const count = sheet.children.length;
    if (count > lastCount) audio.play("score");
    lastCount = count;
    hud.update({ stickers: count });
  }).observe(sheet, { childList: true });
}

// "wrong" flash class the game already applies to buttons -> hit sound.
document.addEventListener(
  "click",
  (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("wrong")) {
      audio.play("hit");
    }
  },
  true
);
