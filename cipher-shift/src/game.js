// Cipher Shift round logic: deal a word, turn the rings, lock or lose a life.
// Needs window.CipherRules, window.CIPHER_TARGETS and window.ENABLE_WORDS (classic scripts loaded first).
import { createDial } from "./dial.js";

const R = window.CipherRules;
const DICT = new Set(window.ENABLE_WORDS);
const STORE_KEY = "cipher_shift_v1";
const LOCK_MS = 900;

const $ = (id) => document.getElementById(id);
const dial = createDial($("cs-dial"));
const scoreEl = $("cs-score");
const livesEl = $("cs-lives");
const cardEl = $("cs-card");
const playArea = $("cs-play");

function emit(kind) {
  document.dispatchEvent(new CustomEvent("cs:sound", { detail: { kind } }));
}

function loadStore() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { best: v.best | 0, longest: v.longest | 0 };
  } catch (_) {
    return { best: 0, longest: 0 };
  }
}
function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
}

const store = loadStore();
const st = {
  wordIndex: 1, target: "", s: 0, k: 0, letters: "", score: 0, lives: 3,
  longest: 0, best: store.best, over: false,
};
let busy = false;       // a turn is animating
let pending = 0;        // timer id of the next-word delay (0 = none)
let playing = false;
let paused = false;
let used = new Set();

function drawHud() {
  scoreEl.textContent = `Words ${st.score}`;
  [...livesEl.children].forEach((seal, i) => seal.classList.toggle("lost", i >= st.lives));
}

function setLetters(word) {
  st.letters = word;
  dial.setLetters(word.split(""));
}

function dealPick() {
  let pick = R.pickWord(st.wordIndex, used, window.CIPHER_TARGETS, DICT, Math.random);
  if (!pick) { used = new Set(); pick = R.pickWord(st.wordIndex, used, window.CIPHER_TARGETS, DICT, Math.random); }
  return pick;
}

function deal() {
  const pick = dealPick();
  if (!pick) return;
  used.add(pick.target);
  st.target = pick.target;
  st.s = pick.s;
  st.k = pick.s;
  setLetters(pick.shown);
}

function showCard() {
  $("cs-card-solved").textContent = `Words solved ${st.score}`;
  $("cs-card-longest").textContent = `Longest word ${st.longest} letters`;
  $("cs-card-best").textContent = `Best ever ${store.best}`;
  cardEl.classList.remove("gk-hidden");
  const again = $("cs-again");
  if (again) again.focus({ preventScroll: true });
}

function endRound() {
  if (st.over) return;
  st.over = true;
  store.best = Math.max(store.best, st.score);
  store.longest = Math.max(store.longest, st.longest);
  st.best = store.best;
  saveStore(store);
  emit("over");
  showCard();
}

function start() {
  clearTimeout(pending);
  pending = 0;
  busy = false;
  used = new Set();
  st.wordIndex = 1;
  st.score = 0;
  st.lives = 3;
  st.longest = 0;
  st.over = false;
  st.best = store.best;
  cardEl.classList.add("gk-hidden");
  playing = true;
  paused = false;
  drawHud();
  deal();
}

function finish() {
  if (playing && !st.over) endRound();
  cardEl.classList.add("gk-hidden");
  return `${st.score} words · longest ${st.longest}`;
}

function stop() {
  clearTimeout(pending);
  pending = 0;
  playing = false;
  cardEl.classList.add("gk-hidden");
}

async function press(d) {
  if (!playing || paused || st.over || busy || pending) return;
  busy = true;
  await dial.turn(d);
  st.letters = R.shiftWord(st.letters, d);
  st.k = R.applyTurn(st.k, d);
  busy = false;
  if (!playing) return;
  if (R.isSolved(st.k)) {
    st.score += 1;
    st.longest = Math.max(st.longest, st.target.length);
    drawHud();
    dial.lockGlow();
    emit("lock");
    pending = setTimeout(() => {
      pending = 0;
      st.wordIndex += 1;
      deal();
    }, LOCK_MS);
  } else {
    st.lives -= 1;
    drawHud();
    dial.shake();
    emit("wrong");
    setTimeout(() => emit("life"), 160);
    if (st.lives <= 0) endRound();
  }
}

const KEYS = { up1: 1, up2: 2, down1: -1, down2: -2 };
for (const id in KEYS) {
  $("cs-" + id).addEventListener("click", () => press(KEYS[id]));
}
$("cs-again").addEventListener("click", start);

document.addEventListener("keydown", (e) => {
  if (!playing || paused) return;
  if (e.key === "Enter" && st.over) { e.preventDefault(); start(); return; }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    if (e.repeat) return;
    press((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 2 : 1));
  }
});

window.__cipher = {
  state() {
    return {
      wordIndex: st.wordIndex, length: st.target.length, target: st.target, k: st.k,
      letters: st.letters, score: st.score, lives: st.lives, longest: st.longest,
      best: st.best, over: st.over, animating: busy || !!pending,
    };
  },
  setWord(target, s) {
    if (!R.isUnique(target, s, DICT)) return false;
    clearTimeout(pending);
    pending = 0;
    busy = false;
    used.add(target);
    st.target = target;
    st.s = s;
    st.k = s;
    setLetters(R.shiftWord(target, s));
    return true;
  },
  setIndex(n) {
    clearTimeout(pending);
    pending = 0;
    st.wordIndex = Math.max(1, n | 0);
    deal();
  },
  rules: R,
  start, finish, stop,
  show() { playArea.classList.remove("gk-hidden"); },
  hide() { playArea.classList.add("gk-hidden"); },
  setPaused(p) { paused = !!p; },
};
