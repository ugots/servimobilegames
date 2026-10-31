import { createAudio } from "../../_base/audio.js";

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
let ambientContext = null;
let ambientNodes = [];
let tickTimer = 0;

function updateButton() {
  const name = muted ? "Sound off" : "Sound on";
  button.setAttribute("aria-label", name);
  button.setAttribute("title", name);
  button.setAttribute("aria-pressed", String(muted));
}

// Three quiet layers suit play without a timer: a warm pad with a slowly moving
// filter, soft room tone, and sparse wooden ticks. Nodes exist only while the
// game is audible, so every restart has exactly one bed.
function stopAmbient() {
  clearTimeout(tickTimer);
  if (!ambientContext) return;
  for (const node of ambientNodes) {
    try { node.stop(); } catch (_) {}
  }
  ambientNodes = [];
  ambientContext.close();
  ambientContext = null;
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
  // Master ambient gain: 0 to 1 over 2 s from the first tap or key.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  master.connect(ctx.destination);

  // 1. Pad: detuned saw and triangle near 110 Hz and 165 Hz, lowpass 500-900 Hz moved by a 0.05 Hz LFO.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 700;
  padFilter.Q.value = 0.7;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.035;
  padFilter.connect(padGain).connect(master);
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoDepth.gain.value = 200;
  lfo.connect(lfoDepth).connect(padFilter.frequency);
  lfo.start();
  ambientNodes.push(lfo);
  [[110, "sawtooth", -6], [110, "triangle", 7], [165, "sawtooth", 5], [165, "triangle", -8]].forEach(([frequency, type, detune]) => {
    const oscillator = ctx.createOscillator();
    const voice = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;
    voice.gain.value = 0.5;
    oscillator.connect(voice).connect(padFilter);
    oscillator.start();
    ambientNodes.push(oscillator);
  });

  // 2. Room tone: looped generated noise through a 300 Hz lowpass.
  const seconds = 2;
  const noise = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const room = ctx.createBufferSource();
  room.buffer = noise;
  room.loop = true;
  const roomFilter = ctx.createBiquadFilter();
  roomFilter.type = "lowpass";
  roomFilter.frequency.value = 300;
  const roomGain = ctx.createGain();
  roomGain.gain.value = 0.012;
  room.connect(roomFilter).connect(roomGain).connect(master);
  room.start();
  ambientNodes.push(room);

  // 3. Wooden ticks: a 40 ms bandpassed noise click at 1.2-2 kHz, one every 4-9 s.
  function scheduleTick() {
    tickTimer = setTimeout(() => {
      if (ambientContext !== ctx) return;
      const click = ctx.createBufferSource();
      click.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1200 + Math.random() * 800;
      band.Q.value = 6;
      const env = ctx.createGain();
      const t = ctx.currentTime;
      env.gain.setValueAtTime(0.04, t);
      env.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
      click.connect(band).connect(env).connect(master);
      click.start(t, Math.random(), 0.04);
      scheduleTick();
    }, 4000 + Math.random() * 5000);
  }
  scheduleTick();
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
});
