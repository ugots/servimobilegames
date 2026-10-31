import { createAudio } from "../_base/audio.js";
import { createAmbient } from "./ambient.js";
import { celebrate, clearCelebration } from "./celebrate.js";
import * as hop from "./hop.js";

const audio = createAudio({
  menu: "../_base/assets/sfx/interface-sounds/click_001.ogg",
  score: "../_base/assets/sfx/interface-sounds/confirmation_001.ogg",
  levelup: "../_base/assets/sfx/digital-audio/powerUp3.ogg",
  hit: "../_base/assets/sfx/interface-sounds/click_002.ogg",
});

const screens = {
  name: document.getElementById("screen-name"),
  menu: document.getElementById("screen-menu"),
  picker: document.getElementById("screen-pick"),
  look: document.getElementById("screen-look"),
  practice: document.getElementById("screen-practice"),
  challenge: document.getElementById("screen-challenge"),
  finish: document.getElementById("screen-finish"),
  hop: document.getElementById("screen-hop"),
};

function getName() {
  try { return localStorage.getItem("numgame_name"); } catch { return null; }
}
function setName(v) {
  try { localStorage.setItem("numgame_name", v); } catch {}
}
function getDone() {
  try { return JSON.parse(localStorage.getItem("numgame_done")) || { practice: [], challenge: [] }; }
  catch { return { practice: [], challenge: [] }; }
}
function setDone(v) {
  try { localStorage.setItem("numgame_done", JSON.stringify(v)); } catch {}
}

function savedMute() {
  try { return localStorage.getItem("numgame_muted") === "true"; } catch { return false; }
}
const state = { mode: null, n: null, k: 1, muted: savedMute() };
const ambient = createAmbient();
ambient.setMuted(state.muted);
const timers = { advance: null, feedback: null };
let scenePaused = false;
function cancelTimer(key) {
  if (timers[key]) clearTimeout(timers[key].id);
  timers[key] = null;
}
function armTimer(key) {
  const timer = timers[key];
  timer.started = performance.now();
  timer.id = setTimeout(() => {
    timers[key] = null;
    timer.callback();
  }, timer.remaining);
}
function schedule(key, callback, delay) {
  cancelTimer(key);
  timers[key] = { callback, remaining: delay, id: null, started: 0 };
  if (!scenePaused) armTimer(key);
}
function clearPending() {
  Object.keys(timers).forEach(cancelTimer);
}
function playSound(name) {
  if (!state.muted) audio.play(name);
}
function cancelSpeech() {
  window.speechSynthesis?.cancel();
}
const VOICE_ENABLED = false;
function speak(text) {
  cancelSpeech();
  if (!VOICE_ENABLED || state.muted || scenePaused || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.rate = .9;
  utterance.pitch = 1.3;
  window.speechSynthesis.speak(utterance);
}
function updateScene() {
  const paused = document.hidden || !document.hasFocus();
  if (paused === scenePaused) return;
  scenePaused = paused;
  if (paused) ambient.pause();
  else ambient.resume();
  document.body.classList.toggle("scene-paused", paused);
  if (paused) cancelSpeech();
  Object.keys(timers).forEach((key) => {
    const timer = timers[key];
    if (!timer) return;
    if (paused) {
      clearTimeout(timer.id);
      timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.started));
    } else armTimer(key);
  });
}
document.addEventListener("visibilitychange", updateScene);
window.addEventListener("blur", updateScene);
window.addEventListener("focus", updateScene);
function updateZoom() {
  const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
  document.body.style.setProperty("--page-zoom", zoom);
}
window.addEventListener("resize", updateZoom);
new ResizeObserver(updateZoom).observe(document.body);
updateZoom();
const soundToggle = document.getElementById("sound-toggle");
function updateSoundControl() {
  soundToggle.setAttribute("aria-pressed", String(state.muted));
  soundToggle.setAttribute("aria-label", state.muted ? "Unmute sound" : "Mute sound");
}
updateSoundControl();
// Web Audio is unlocked by the first permitted user gesture, never at page load.
document.addEventListener("pointerdown", () => ambient.resume(), { passive: true });
document.addEventListener("keydown", () => ambient.resume());

// Ila-proof (D-060): guard gameplay taps and screen transitions. Home, sound,
// and profile remain ordinary one-tap controls even immediately after play.
const TAP_LOCK_MS = 600;
let lastAcceptedTap = -Infinity;
function lockInput() { lastAcceptedTap = performance.now(); }
document.addEventListener("click", (e) => {
  const gated = e.target.closest(".num-tile, .choice, #pr-card, #ct-card, #lk-card, #trick-btn");
  if (!gated) return;
  const now = performance.now();
  if (now - lastAcceptedTap < TAP_LOCK_MS) {
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  lastAcceptedTap = now;
}, true);
// No selection, no context menu, no drag, no pinch — a 3.5-year-old's taps
// should never highlight text, open a menu, or drag an image/SVG.
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("selectstart", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());
document.querySelectorAll("img, svg").forEach((el) => { el.draggable = false; });

// D-045 (iPad only): touch sparkle on button taps, purely decorative.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let sparkleCount = 0;
document.addEventListener("pointerdown", (e) => {
  if (!document.documentElement.classList.contains("ipad") || reduceMotion) return;
  if (!e.target.closest("button")) return;
  if (sparkleCount >= 6) return;
  const img = document.createElement("img");
  img.src = "assets/svg/sparkle.svg";
  img.className = "ipad-sparkle";
  img.style.left = `${e.clientX}px`;
  img.style.top = `${e.clientY}px`;
  sparkleCount++;
  img.addEventListener("animationend", () => { img.remove(); sparkleCount--; });
  document.getElementById("fx-layer").appendChild(img);
}, true);

function show(name) {
  for (const key in screens) {
    screens[key].hidden = key !== name;
  }
  lockInput();
}

function goHome() {
  hop.stop();
  clearPending();
  cancelSpeech();
  chChoices.classList.remove("locked");
  document.querySelectorAll(".burst, .fly-piece").forEach((piece) => piece.remove());
  clearCelebration();
  playSound("menu");
  show("menu");
}

const HOLD_MS = 2000;
document.querySelectorAll(".home-btn").forEach((btn) => btn.addEventListener("click", goHome));
soundToggle.addEventListener("click", () => {
  state.muted = !state.muted;
  try { localStorage.setItem("numgame_muted", String(state.muted)); } catch {}
  updateSoundControl();
  ambient.setMuted(state.muted);
  if (!state.muted) ambient.resume();
  if (state.muted) cancelSpeech();
  else {
    playSound("menu");
    if (!screens.practice.hidden) speak(state.k * state.n);
  }
});
document.getElementById("name-badge").addEventListener("click", () => {
  playSound("menu");
  openNameGate();
});
let escHoldTimer = null;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.repeat && !escHoldTimer) {
    escHoldTimer = setTimeout(() => { escHoldTimer = null; goHome(); }, HOLD_MS);
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Escape" && escHoldTimer) { clearTimeout(escHoldTimer); escHoldTimer = null; }
});

document.getElementById("btn-look").addEventListener("click", () => selectMode("look"));
document.getElementById("btn-practice").addEventListener("click", () => selectMode("practice"));
document.getElementById("btn-challenge").addEventListener("click", () => selectMode("challenge"));
hop.init({ screenEl: screens.hop, show, goHome, playSound, getName, celebrate, clearCelebration, isMuted: () => state.muted });
document.getElementById("btn-hop").addEventListener("click", () => { playSound("menu"); hop.start(); });

function updateBadge() {
  document.getElementById("name-badge-text").textContent = getName() || "Who's playing?";
}
function openNameGate() {
  const input = document.getElementById("name-input");
  input.value = getName() || "";
  show("name");
  input.focus();
}
function saveName() {
  const input = document.getElementById("name-input");
  const v = input.value.trim().slice(0, 12);
  setName(v);
  updateBadge();
  playSound("menu");
  show("menu");
}
document.getElementById("name-go").addEventListener("click", saveName);
document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveName();
});
function selectMode(mode) {
  playSound("menu");
  state.mode = mode;
  document.getElementById("pick-mode-icon").src =
    mode === "look" ? "assets/svg/dino-mint.svg" : mode === "practice" ? "assets/svg/dino-pink.svg" : "assets/svg/star.svg";
  const done = getDone()[mode] || [];
  document.querySelectorAll(".num-tile").forEach((tile) => {
    tile.classList.toggle("done", done.includes(Number(tile.dataset.n)));
  });
  show("picker");
}

document.querySelectorAll(".num-tile").forEach((tile) => {
  tile.addEventListener("click", () => {
    playSound("menu");
    state.n = Number(tile.dataset.n);
    state.k = 1;
    startMode();
  });
});

function startMode() {
  clearPending();
  if (state.mode === "look") startLook();
  else if (state.mode === "practice") startPractice();
  else startChallenge();
}

/* ---------- star progress row ---------- */
function buildStars(container, count) {
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const img = document.createElement("img");
    img.className = "star unlit";
    img.src = "assets/svg/star.svg";
    img.alt = "";
    container.appendChild(img);
  }
}
function setStars(container, litCount) {
  [...container.children].forEach((img, i) => {
    img.classList.toggle("lit", i < litCount);
    img.classList.toggle("unlit", i >= litCount);
  });
}

/* ---------- Practice ---------- */
const prNum = document.getElementById("pr-num");
const prProgress = document.getElementById("pr-progress");
const prCard = document.getElementById("pr-card");

function startPractice() {
  setupTrick();
  buildStars(prProgress, 12);
  renderPractice();
  show("practice");
}
function renderPractice() {
  setStars(prProgress, state.k);
  prNum.textContent = state.k * state.n;
  speak(state.k * state.n);
  prNum.classList.remove("pr-num-pop");
  void prNum.offsetHeight;
  prNum.classList.add("pr-num-pop");
}
function practiceAdvance() {
  if (state.k >= 12) return;
  playSound("score");
  celebrate(prCard);
  state.k += 1;
  renderPractice();
  if (state.k === 12) {
    schedule("advance", () => { show("finish"); renderFinish(); }, 1600);
  }
}
prCard.addEventListener("click", (e) => { if (e.detail === 0) return; practiceAdvance(); });
document.addEventListener("keydown", (e) => {
  if (screens.practice.hidden) return;
  if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
    e.preventDefault();
    counting ? countAdvance() : practiceAdvance();
  }
});

/* ---------- Tricks (NO LOOK helpers, per table) ---------- */
const TRICKS = { 3: { label: "Count 3", step: 1 } };
const prScreen = screens.practice;
const ctWheel = document.getElementById("ct-wheel");
const ctStrip = document.getElementById("ct-strip");
const ctCard = document.getElementById("ct-card");
const trickBtn = document.getElementById("trick-btn");
let counting = false, ctValue = 0, ctLast = 0;

function setupTrick() {
  counting = false;
  prScreen.classList.remove("counting");
  const t = TRICKS[state.n];
  trickBtn.hidden = !t;
  trickBtn.textContent = t ? t.label : "";
  trickBtn.setAttribute("aria-pressed", "false");
}
function startCount() {
  const t = TRICKS[state.n];
  counting = true;
  ctValue = state.k * state.n;
  ctLast = 0;
  ctStrip.innerHTML = "";
  for (let v = t.step; v <= 12 * state.n; v += t.step) {
    const span = document.createElement("span");
    span.className = v % state.n === 0 ? "lk-item ct-loud" : "lk-item ct-soft";
    span.dataset.v = v;
    span.textContent = v;
    ctStrip.appendChild(span);
  }
  prScreen.classList.add("counting");
  trickBtn.setAttribute("aria-pressed", "true");
  renderCount();
}
function renderCount() {
  const t = TRICKS[state.n];
  setStars(prProgress, Math.floor(ctValue / state.n));
  [...ctStrip.children].forEach((item) => {
    const p = (Number(item.dataset.v) - ctValue) / t.step;
    item.dataset.pos = p >= 2 ? "far-up" : p === 1 ? "up" : p === 0 ? "mid" : p === -1 ? "down" : "far-down";
  });
}
function stopCount() {
  counting = false;
  prScreen.classList.remove("counting");
  trickBtn.setAttribute("aria-pressed", "false");
  state.k = Math.floor(ctValue / state.n);
  renderPractice();
}
function countAdvance() {
  const t = TRICKS[state.n];
  if (ctValue >= 12 * state.n) return;
  const now = performance.now();
  if (now - ctLast < 350) return;
  ctLast = now;
  ctValue += t.step;
  renderCount();
  if (ctValue % state.n === 0) {
    state.k = ctValue / state.n;
    playSound("score");
    celebrate(ctCard);
    const mid = ctStrip.querySelector('[data-pos="mid"]');
    if (mid) {
      mid.classList.remove("lk-pop");
      void mid.offsetHeight;
      mid.classList.add("lk-pop");
    }
  } else {
    playSound("hit");
  }
  if (ctValue === 12 * state.n) {
    schedule("advance", () => { show("finish"); renderFinish(); }, 1600);
  }
}
ctCard.addEventListener("click", (e) => { if (e.detail === 0) return; countAdvance(); });
trickBtn.addEventListener("click", () => {
  if ((counting ? ctValue : state.k * state.n) >= 12 * state.n) return;
  playSound("menu");
  counting ? stopCount() : startCount();
  trickBtn.blur();
});

/* ---------- Look ---------- */
const lkStrip = document.getElementById("lk-strip");
const lkCard = document.getElementById("lk-card");
const lkProgress = document.getElementById("lk-progress");
let lkLast = 0;

function startLook() {
  buildStars(lkProgress, 12);
  lkStrip.innerHTML = "";
  for (let i = 1; i <= 12; i++) {
    const span = document.createElement("span");
    span.className = "lk-item";
    span.textContent = i * state.n;
    lkStrip.appendChild(span);
  }
  lkLast = 0;
  renderLook();
  show("look");
}
function renderLook() {
  setStars(lkProgress, state.k - 1);
  [...lkStrip.children].forEach((item, idx) => {
    const p = (idx + 1) - state.k;
    item.dataset.pos = p >= 2 ? "far-up" : p === 1 ? "up" : p === 0 ? "mid" : p === -1 ? "down" : "far-down";
  });
}
function lookAdvance() {
  if (state.k > 12) return;
  const now = performance.now();
  if (now - lkLast < 350) return;
  lkLast = now;
  playSound("hit");
  celebrate(lkCard);
  speak(state.k * state.n);
  state.k += 1;
  if (state.k <= 12) {
    renderLook();
  } else {
    setStars(lkProgress, 12);
    const mid = lkStrip.querySelector('[data-pos="mid"]');
    if (mid) {
      mid.classList.remove("lk-pop");
      void mid.offsetHeight;
      mid.classList.add("lk-pop");
    }
    schedule("advance", () => { show("finish"); renderFinish(); }, 1600);
  }
}
lkCard.addEventListener("click", (e) => { if (e.detail === 0) return; lookAdvance(); });
document.addEventListener("keydown", (e) => {
  if (screens.look.hidden) return;
  if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
    e.preventDefault();
    lookAdvance();
  }
});

/* ---------- Challenge ---------- */
const chCountLabel = document.getElementById("ch-count-label");
const chShown = document.getElementById("ch-shown");
const chChoices = document.getElementById("ch-choices");
const chKind = document.getElementById("ch-kind");
const chDino = document.getElementById("ch-dino");
const chProgress = document.getElementById("ch-progress");

function startChallenge() {
  chCountLabel.textContent = `Counting by ${state.n}s`;
  chChoices.classList.remove("locked");
  buildStars(chProgress, 12);
  chDino.src = "assets/svg/dino-stego.svg";
  renderChallenge();
  show("challenge");
}

function pickChoices(a) {
  const windows = [
    [a - 2, a - 1, a],
    [a - 1, a, a + 1],
    [a, a + 1, a + 2],
  ].filter((w) => w.every((v) => v >= 1));
  const w = windows[Math.floor(Math.random() * windows.length)];
  return [...w].sort((x, y) => x - y);
}

function renderChallenge() {
  cancelTimer("feedback");
  setStars(chProgress, state.k);
  chKind.hidden = true;
  chKind.classList.remove("show");
  chDino.src = "assets/svg/dino-stego.svg";
  const shown = state.k * state.n;
  const a = (state.k + 1) * state.n;
  chShown.textContent = shown;
  const opts = pickChoices(a);
  chChoices.innerHTML = "";
  opts.forEach((v) => {
    const btn = document.createElement("button");
    btn.className = v >= 100 ? "choice triple-digit" : "choice";
    btn.dataset.v = v;
    btn.textContent = v;
    btn.addEventListener("click", () => onChoice(btn, v, a));
    chChoices.appendChild(btn);
  });
  lockInput();
}

function onChoice(btn, v, a) {
  if (scenePaused || btn.disabled || chChoices.classList.contains("locked")) return;
  if (v === a) {
    cancelTimer("feedback");
    cancelSpeech();
    chKind.hidden = true;
    chChoices.classList.add("locked");
    [...chChoices.children].forEach((c) => (c.disabled = true));
    celebrate(btn);
    chDino.src = "assets/svg/dino-stego-cheer.svg";
    playSound("score");
    setStars(chProgress, state.k + 1);
    clearPending();
    schedule("advance", () => {
      chChoices.classList.remove("locked");
      if (a === 12 * state.n) {
        show("finish");
        renderFinish();
        return;
      }
      state.k += 1;
      renderChallenge();
    }, 1100);
  } else {
    btn.disabled = true;
    btn.classList.remove("wrong");
    void btn.offsetWidth;
    btn.classList.add("wrong");
    chDino.src = "assets/svg/dino-stego-encourage.svg";
    chKind.hidden = false;
    chKind.classList.add("show");
    playSound("hit");
    speak("Try again");
    schedule("feedback", () => {
      chDino.src = "assets/svg/dino-stego.svg";
      chKind.classList.remove("show");
      chKind.hidden = true;
    }, 1500);
  }
}

/* ---------- Finish ---------- */
function renderFinish() {
  clearPending();
  cancelSpeech();
  const finishSpecies = { practice: "trex", look: "bronto", challenge: "stego" };
  document.querySelector(".finish-dino").src = `assets/svg/dino-${finishSpecies[state.mode]}-cheer.svg`;
  const label = `${getName() || "You"} can count by ${state.n}s!`;
  document.getElementById("finish-count-label").textContent = label;
  buildStars(document.getElementById("finish-stars"), 12);
  setStars(document.getElementById("finish-stars"), 12);
  const arc = [10, 7, 4.5, 2.5, 1, 0, 0, 1, 2.5, 4.5, 7, 10];
  [...document.getElementById("finish-stars").children].forEach((star, i) => star.style.setProperty("--arc", arc[i]));
  playSound("levelup");
  speak(label);
  celebrate(document.querySelector(".finish-dino"), { big: true });
  const done = getDone();
  const list = done[state.mode] || (done[state.mode] = []);
  if (!list.includes(state.n)) list.push(state.n);
  setDone(done);
  document.getElementById("finish-collect").textContent = `${list.length} of 12 done!`;
}
document.getElementById("btn-again").addEventListener("click", () => {
  playSound("menu");
  state.k = 1;
  startMode();
});
document.getElementById("btn-menu").addEventListener("click", goHome);

updateBadge();
if (getName() === null) show("name");
