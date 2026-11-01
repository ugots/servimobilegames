import { createAudio } from "../../_base/audio.js";
import { createAmbient } from "./ambient.js";

const SFX = "../_base/assets/sfx/";
const audio = createAudio({
  pick: SFX + "interface-sounds/click_001.ogg",
  drop: SFX + "interface-sounds/click_002.ogg",
  accept: SFX + "interface-sounds/confirmation_001.ogg",
  wrong: SFX + "digital-audio/lowDown.ogg",
  levelup: SFX + "digital-audio/powerUp2.ogg",
  lifelost: SFX + "digital-audio/lowDown.ogg",
  // _base audio has no playbackRate, so the nearest existing file stands in for powerUp2 at 0.7
  runover: SFX + "digital-audio/lowRandom.ogg",
  menu: SFX + "interface-sounds/click_001.ogg",
});

const button = document.getElementById("an-sound");
const preferenceKey = "anagram-ladder-sound-muted";
let muted = false;
try { muted = localStorage.getItem(preferenceKey) === "true"; } catch (_) {}
let gestured = false;
let playing = false;
const ambient = createAmbient();
window.ambientNodes = () => ambient.nodeCount();
window.ambientRunning = () => ambient.running();

function updateButton() {
  const name = muted ? "Sound off" : "Sound on";
  button.setAttribute("aria-label", name);
  button.setAttribute("title", name);
  button.setAttribute("aria-pressed", String(muted));
}

// The bed itself lives in ambient.js; this file keeps only the gating.
function stopAmbient() {
  ambient.stop();
}

function syncAmbient() {
  if (muted || !gestured || !playing || document.hidden) {
    stopAmbient();
    return;
  }
  ambient.start();
}

updateButton();
document.addEventListener("pointerdown", (event) => {
  if (!event.isTrusted) return;
  gestured = true;
  syncAmbient();
}, { capture: true });
document.addEventListener("keydown", (event) => {
  if (!event.isTrusted) return;
  gestured = true;
  syncAmbient();
}, { capture: true });
document.addEventListener("visibilitychange", syncAmbient);
document.addEventListener("an:ambience", (event) => {
  playing = !!event.detail?.playing;
  syncAmbient();
});
// Space activates the focused button; keep the shared menu's Space-to-pause
// shortcut from taking that keystroke first.
button.addEventListener("keydown", (event) => {
  if (event.code === "Space") event.stopPropagation();
});
// One mute governs the ambient bed and every effect.
button.addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(preferenceKey, String(muted)); } catch (_) {}
  updateButton();
  syncAmbient();
});
document.addEventListener("an:sound", (event) => {
  if (!muted && !document.hidden && event.detail && event.detail.kind) audio.play(event.detail.kind);
  if (!muted && event.detail && event.detail.kind === "levelup") ambient.rise();
});
