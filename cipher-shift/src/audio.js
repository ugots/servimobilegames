import { createAudio } from "../../_base/audio.js";

// Six sounds, one shared mute (D-037). interface-sounds/error_004.ogg is not in the shared kit,
// so "life" uses digital-audio/lowRandom.ogg (nearest low error tone).
const SFX = "../_base/assets/sfx/";
const audio = createAudio({
  click: SFX + "interface-sounds/click_002.ogg",
  lock: SFX + "interface-sounds/confirmation_001.ogg",
  wrong: SFX + "digital-audio/lowDown.ogg",
  life: SFX + "digital-audio/lowRandom.ogg",
  over: SFX + "digital-audio/powerUp2.ogg",
  menu: SFX + "interface-sounds/click_001.ogg",
});

const button = document.getElementById("cs-sound");
const preferenceKey = "cipher_shift_muted";
let muted = false;
try { muted = localStorage.getItem(preferenceKey) === "true"; } catch (_) {}

function updateButton() {
  const name = muted ? "Sound off" : "Sound on";
  button.setAttribute("aria-label", name);
  button.setAttribute("title", name);
  button.setAttribute("aria-pressed", String(muted));
}
updateButton();

// Space activates the focused button; keep the menu's Space-to-pause from taking it first.
button.addEventListener("keydown", (event) => {
  if (event.code === "Space") event.stopPropagation();
});
button.addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(preferenceKey, String(muted)); } catch (_) {}
  updateButton();
  applyBedMute();
});

// Ambient bed (Joe 2026-10-31): three quiet layers built from _base clips, started at the first tap,
// faded in over 2 s, governed by the same mute. Own AudioContext; every failure is swallowed.
//   1. room tone: impactSoft_medium_000 looped at 0.22x speed through a 380 Hz low-pass
//   2. slow brass/wind texture: phaseJump1 looped at 0.18x speed, band-passed, gain swelled by a 0.06 Hz LFO
//   3. soft ticks: chips-collide-1..3 at random 2-7 s gaps, random pitch and level
const bed = { ctx: null, master: null, started: false };
const BED_LEVEL = 0.5;
function applyBedMute() {
  if (!bed.master) return;
  const t = bed.ctx.currentTime;
  bed.master.gain.cancelScheduledValues(t);
  bed.master.gain.setTargetAtTime(muted ? 0 : BED_LEVEL, t, muted ? 0.05 : 0.6);
}
async function loadBuf(name) {
  const res = await fetch(SFX + name);
  return bed.ctx.decodeAudioData(await res.arrayBuffer());
}
async function startBed() {
  if (bed.started) return;
  bed.started = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    bed.ctx = ctx;
    bed.master = ctx.createGain();
    bed.master.gain.value = 0;
    bed.master.connect(ctx.destination);
    const [room, wind, c1, c2, c3] = await Promise.all([
      loadBuf("impact-sounds/impactSoft_medium_000.ogg"),
      loadBuf("digital-audio/phaseJump1.ogg"),
      loadBuf("casino-audio/chips-collide-1.ogg"),
      loadBuf("casino-audio/chips-collide-2.ogg"),
      loadBuf("casino-audio/chips-collide-3.ogg"),
    ]);
    const loop = (buf, rate) => {
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
      return s;
    };
    const roomSrc = loop(room, 0.22);
    const roomLp = ctx.createBiquadFilter(); roomLp.type = "lowpass"; roomLp.frequency.value = 380;
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.55;
    roomSrc.connect(roomLp).connect(roomGain).connect(bed.master);
    const windSrc = loop(wind, 0.18);
    const windBp = ctx.createBiquadFilter(); windBp.type = "bandpass"; windBp.frequency.value = 520; windBp.Q.value = 0.6;
    const windGain = ctx.createGain(); windGain.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.1;
    lfo.connect(lfoDepth).connect(windGain.gain);
    windSrc.connect(windBp).connect(windGain).connect(bed.master);
    roomSrc.start(); windSrc.start(); lfo.start();
    const ticks = [c1, c2, c3];
    const tick = () => {
      if (!muted && !document.hidden) {
        const s = ctx.createBufferSource();
        s.buffer = ticks[Math.floor(Math.random() * ticks.length)];
        s.playbackRate.value = 0.7 + Math.random() * 0.4;
        const g = ctx.createGain(); g.gain.value = 0.05 + Math.random() * 0.07;
        s.connect(g).connect(bed.master);
        s.start();
      }
      setTimeout(tick, 2000 + Math.random() * 5000);
    };
    setTimeout(tick, 2500);
    const t = ctx.currentTime;
    bed.master.gain.setValueAtTime(0, t);
    bed.master.gain.linearRampToValueAtTime(muted ? 0 : BED_LEVEL, t + 2);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) ctx.suspend().catch(() => {}); else ctx.resume().catch(() => {});
    });
  } catch (_) {}
}
for (const ev of ["pointerdown", "keydown"]) {
  document.addEventListener(ev, startBed, { once: true, capture: true });
}
document.addEventListener("cs:sound", (event) => {
  if (!muted && !document.hidden && event.detail && event.detail.kind) audio.play(event.detail.kind);
});
