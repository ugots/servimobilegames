import { createAudio } from "../../_base/audio.js";

const audio = createAudio({
  pick: "../_base/assets/sfx/interface-sounds/click_001.ogg",
  drop: "../_base/assets/sfx/interface-sounds/click_002.ogg",
  menu: "../_base/assets/sfx/interface-sounds/click_001.ogg",
  accept: "../_base/assets/sfx/interface-sounds/confirmation_001.ogg",
  reject: "../_base/assets/sfx/interface-sounds/click_002.ogg",
  newpot: "../_base/assets/sfx/digital-audio/powerUp3.ogg",
  found_mid: "../_base/assets/sfx/interface-sounds/confirmation_002.ogg",
  found_big: "../_base/assets/sfx/digital-audio/powerUp2.ogg",
  clear: "../_base/assets/sfx/digital-audio/powerUp1.ogg",
});

const button = document.getElementById("lp-sound");
const preferenceKey = "letter-pot-sound-muted";
let muted = false;
try { muted = localStorage.getItem(preferenceKey) === "true"; } catch (_) {}
let gestured = false;
let playing = false;
let ambientContext = null;
let ambientNodes = [];

function updateButton() {
  const name = muted ? "Sound off" : "Sound on";
  button.setAttribute("aria-label", name);
  button.setAttribute("title", name);
  button.setAttribute("aria-pressed", String(muted));
}

// W21: a three-layer bed (warm pad, soft room tone, sparse wooden ticks) into
// one master gain. Nodes exist only while the game is audible, so every
// restart has one bed; the shared mute stops every node and the tick timer.
const MASTER_TARGET = 0.022;
let master = null;
let tickTimer = null;

Object.defineProperty(window, "__lpAudio", {
  value: Object.freeze({
    sources: () => ambientNodes.length,
    gain: () => (master ? master.gain.value : 0),
    target: MASTER_TARGET,
    running: () => !!ambientContext,
  }),
  writable: false,
});

function stopAmbient() {
  clearTimeout(tickTimer);
  tickTimer = null;
  if (!ambientContext) return;
  for (const node of ambientNodes) {
    try { node.stop(); } catch (_) {}
  }
  ambientNodes = [];
  master = null;
  ambientContext.close();
  ambientContext = null;
}

function playTick(ctx) {
  const now = ctx.currentTime;
  const pitch = 700 + Math.random() * 400;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  osc.type = Math.random() < 0.5 ? "triangle" : "sine";
  osc.frequency.value = pitch;
  filter.type = "bandpass";
  filter.frequency.value = pitch;
  env.gain.setValueAtTime(0.0001, now);
  env.gain.linearRampToValueAtTime(0.5, now + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.082);
  osc.connect(filter).connect(env).connect(master);
  osc.start(now);
  osc.stop(now + 0.1);
}

function scheduleTick(ctx) {
  tickTimer = setTimeout(() => {
    if (ambientContext !== ctx) return;
    playTick(ctx);
    scheduleTick(ctx);
  }, 4000 + Math.random() * 5000);
}

function syncAmbient() {
  if (muted || !gestured || !playing || document.hidden) {
    stopAmbient();
    return;
  }
  if (ambientContext) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  ambientContext = ctx;
  master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(MASTER_TARGET, ctx.currentTime + 2);
  master.connect(ctx.destination);
  // a. warm pad: low C major through one slowly moving lowpass
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.Q.value = 0.7;
  padFilter.frequency.value = 650;
  const padGain = ctx.createGain();
  padGain.gain.value = 1;
  padFilter.connect(padGain).connect(master);
  const filterLfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  filterLfo.frequency.value = 0.05;
  lfoDepth.gain.value = 250;
  filterLfo.connect(lfoDepth).connect(padFilter.frequency);
  filterLfo.start();
  ambientNodes.push(filterLfo);
  [130.81, 196, 261.63, 329.63].forEach((frequency, i) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = i % 2 ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.25;
    oscillator.connect(gain).connect(padFilter);
    oscillator.start();
    ambientNodes.push(oscillator);
  });
  // b. room tone: looped 2 s white noise, lowpassed at 300 Hz
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 300;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.25;
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  noise.start();
  ambientNodes.push(noise);
  // c. sparse wooden ticks every 4-9 s
  scheduleTick(ctx);
  ctx.resume().catch(() => { if (ambientContext === ctx) stopAmbient(); });
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
document.addEventListener("lp:ambience", (event) => {
  playing = !!event.detail?.playing;
  syncAmbient();
});
// Space activates the focused button; keep the shared game's Space-to-pause
// shortcut from taking that keystroke first.
button.addEventListener("keydown", (event) => {
  if (event.code === "Space") event.stopPropagation();
});
button.addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(preferenceKey, String(muted)); } catch (_) {}
  updateButton();
  syncAmbient();
});
document.addEventListener("lp:sound", (event) => {
  if (!muted && !document.hidden && event.detail && event.detail.kind) audio.play(event.detail.kind);
});
