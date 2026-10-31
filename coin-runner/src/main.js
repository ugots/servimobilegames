import { AudioEngine } from "./audio.js";
import { InputManager, detectMobile } from "./input.js";
import { Game } from "./game.js";
import { createScene3D } from "./scene3d.js";
import { mountHud } from "/_base/hud.js";

const RENDER_2D = new URLSearchParams(window.location.search).get("render") === "2d";

const canvas = document.getElementById("game");
const canvas3d = document.getElementById("scene3d");
canvas3d.classList.toggle("hidden", RENDER_2D);
canvas.classList.toggle("hidden", !RENDER_2D);
// In 3D mode the shared _base HUD (hud3d, mounted below) replaces the
// game's own #hud chips so they don't double up on screen.

// _base/hud.js HUD, same fields/values as the 2D HUD chips above (Score,
// Best, Lv). Shown during play/countdown/paused, hidden on menu screens.
const pauseBestEl = document.getElementById("pauseBest");
let hud3dResizePending = false;
const hud3d = mountHud({
  fields: [
    { key: "score", label: "Score", slot: "left" },
    { key: "best", label: "Best", slot: "left" },
    { key: "level", label: "LV", slot: "centre" },
  ],
  actions: [
    {
      key: "pause",
      ariaLabel: "Pause",
      html: `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>`,
    },
  ],
  onVisibility: () => {
    if (hud3dResizePending) return;
    hud3dResizePending = true;
    requestAnimationFrame(() => {
      hud3dResizePending = false;
      resize();
    });
  },
});
// Health bar pill (top-left, wide): ice-white -> violet when healthy, amber below 50, red below 25.
const healthPill = document.createElement("div");
healthPill.className = "gk-hud-field health-pill";
// Inline sizes win over the shared pill rules (fit-content / column), which would collapse the track.
healthPill.style.cssText =
  "display:flex;flex-direction:row;align-items:center;gap:8px;width:clamp(190px,22vw,560px);min-width:0;padding:6px 10px;box-sizing:border-box;";
healthPill.innerHTML =
  '<span class="gk-hud-label">HP</span>' +
  '<div class="health-track" style="position:relative;flex:1 1 auto;min-width:70px;height:clamp(12px,1vw,26px);border-radius:999px;background:rgba(255,255,255,0.14);overflow:hidden">' +
  '<div class="health-fill" style="height:100%;width:100%;border-radius:7px;transform-origin:left center"></div></div>' +
  '<span class="health-num gk-hud-value" style="min-width:2.4em;text-align:right"></span>' +
  '<span class="health-pop" style="min-width:2.6em;font-weight:700;color:#d8c8ff"></span>';
hud3d.el.querySelector(".gk-hud-left").prepend(healthPill);
const healthFill = healthPill.querySelector(".health-fill");
const healthNum = healthPill.querySelector(".health-num");
const healthPop = healthPill.querySelector(".health-pop");
let lastHealth = 100;
let healthFlashUntil = 0;

function setHealth(health, pop = "") {
  const h = Math.max(0, Math.min(100, Math.round(health)));
  if (h < lastHealth) healthFlashUntil = performance.now() + 220;
  lastHealth = h;
  const flashing = performance.now() < healthFlashUntil;
  healthFill.style.transform = `scaleX(${h / 100})`;
  healthFill.style.background = flashing
    ? "#ffffff"
    : h < 25
      ? "#e0442f"
      : h < 50
        ? "#f0a030"
        : "linear-gradient(90deg,#eaf3ff,#9a7bff)";
  healthNum.textContent = String(h);
  healthPop.textContent = pop;
  healthPill.setAttribute("aria-label", `Health ${h} of 100`);
}

// CR12 combo: a small "x2" beside the score, shown only while the multiplier is above x1.
const comboChip = document.createElement("span");
comboChip.className = "combo-chip";
comboChip.hidden = true;
hud3d.el.querySelector('[data-key="score"]')?.appendChild(comboChip);
function setCombo(mult) {
  comboChip.hidden = !(mult > 1);
  if (mult > 1) comboChip.textContent = `x${mult}`;
}

// Centred LEVEL banner (about 1.5 s, driven by game.banner).
const levelBanner = document.createElement("div");
levelBanner.setAttribute("aria-live", "polite");
levelBanner.style.cssText =
  "position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);z-index:30;pointer-events:none;display:none;" +
  "font:800 clamp(40px,9vw,120px)/1 system-ui,sans-serif;letter-spacing:0.08em;color:#f2f6ff;" +
  "text-shadow:0 0 24px #8a6cff,0 0 60px #5b3cc4;";
document.body.appendChild(levelBanner);
function setBanner(text) {
  if (text) levelBanner.textContent = text;
  // LEVEL CLEARED: large, centred, gold glow, scales in then holds (styles.css .level-cleared); LEVEL N as before.
  levelBanner.classList.toggle("level-cleared", text === "LEVEL CLEARED");
  levelBanner.style.display = text ? "block" : "none";
}

function mountPowerStatus(scoreChip) {
  if (!scoreChip.classList.contains("power-pill")) scoreChip.classList.add("score-chip");
  const status = document.createElement("div");
  status.className = "power-status";
  status.hidden = true;
  const rows = {};
  for (const kind of ["shield", "slow", "speed", "magnet"]) {
    const row = document.createElement("div");
    row.className = "power-row";
    row.hidden = true;
    const text = document.createElement("div");
    text.className = "power-row-text";
    const label = document.createElement("span");
    label.className = "power-label";
    const value = document.createElement("span");
    value.className = "power-value";
    text.append(label, value);
    const track = document.createElement("div");
    track.className = "power-track";
    const fill = document.createElement("div");
    fill.className = "power-fill";
    track.appendChild(fill);
    row.append(text, track);
    status.appendChild(row);
    rows[kind] = { row, label, value, fill };
  }
  scoreChip.appendChild(status);
  return { status, rows };
}

// 3D HUD: the power-up timer is its own pill (not inside the score pill).
const powerPill = document.createElement("div");
powerPill.className = "gk-hud-field power-pill";
powerPill.hidden = true;
hud3d.el.querySelector(".gk-hud-left").appendChild(powerPill);

const powerStatuses = [
  mountPowerStatus(powerPill),
  mountPowerStatus(document.getElementById("hudScore").closest(".hud-chip")),
];

function updatePowerStatuses(powers) {
  const active = new Map(powers.map((power) => [power.kind, power]));
  powerPill.hidden = active.size === 0;
  for (const { status, rows } of powerStatuses) {
    status.hidden = active.size === 0;
    for (const [kind, { row, label, value, fill }] of Object.entries(rows)) {
      const power = active.get(kind);
      row.hidden = !power;
      if (!power) continue;
      const reading = `${Math.ceil(power.remaining)}s`;
      label.textContent = power.label;
      value.textContent = reading;
      row.setAttribute("aria-label", `${power.label} ${reading}`);
      fill.style.backgroundColor = power.color;
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, power.remaining / power.duration))})`;
    }
  }
}

function currentComposition() {
  return window.innerWidth <= 700 ? "mobile" : "desktop";
}
let scene3d = RENDER_2D ? null : createScene3D({ canvas: canvas3d, composition: currentComposition() });
let scene3dComposition = currentComposition();
const els = {
  hud: document.getElementById("hud"),
  hudScore: document.getElementById("hudScore"),
  hudBest: document.getElementById("hudBest"),
  hudLevel: document.getElementById("hudLevel"),
  menu: document.getElementById("menu"),
  howto: document.getElementById("howto"),
  countdown: document.getElementById("countdown"),
  countdownNumber: document.getElementById("countdownNumber"),
  pauseScreen: document.getElementById("pauseScreen"),
  gameOver: document.getElementById("gameOver"),
  thanks: document.getElementById("thanks"),
  joystick: document.getElementById("joystick"),
  joystickKnob: document.getElementById("joystickKnob"),
  playBtn: document.getElementById("playBtn"),
  howToBtn: document.getElementById("howToBtn"),
  howtoBackBtn: document.getElementById("howtoBackBtn"),
  soundBtn: document.getElementById("soundBtn"),
  soundToggle: document.getElementById("soundToggle"),
  exitBtn: document.getElementById("exitBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  pauseMenuBtn: document.getElementById("pauseMenuBtn"),
  retryBtn: document.getElementById("retryBtn"),
  gameOverMenuBtn: document.getElementById("gameOverMenuBtn"),
  thanksBackBtn: document.getElementById("thanksBackBtn"),
  finalScore: document.getElementById("finalScore"),
  finalBest: document.getElementById("finalBest"),
  newBestLine: document.getElementById("newBestLine"),
  menuBest: document.getElementById("menuBest"),
  controlModeSelect: document.getElementById("controlModeSelect"),
};
if (!RENDER_2D) els.hud.style.display = "none";
// #app is its own stacking context; lift the speaker button out so the mobile HUD bar never covers it.
document.body.appendChild(els.soundToggle);
setHealth(100);

const audio = new AudioEngine();
const SOUND_KEY = "coinRunnerSoundEnabled";
try {
  audio.setEnabled(localStorage.getItem(SOUND_KEY) !== "false");
} catch (e) {
  // Private browsing or blocked storage still leaves the sound control usable.
}
function syncSoundLabels() {
  const label = `Sound: ${audio.enabled ? "On" : "Off"}`;
  els.soundBtn.textContent = label;
  els.soundToggle.setAttribute("aria-label", label);
  els.soundToggle.setAttribute("aria-pressed", String(audio.enabled));
  els.soundToggle.classList.toggle("is-off", !audio.enabled);
}
syncSoundLabels();
const input = new InputManager({ joystickEl: document.getElementById("joystickBase"), joystickKnobEl: els.joystickKnob, canvas });

const game = new Game({
  canvas,
  audio,
  input,
  onStateChange: applyStateToDom,
  onHudUpdate: ({ score, level, health, powers = [], banner = null, combo = 1, pop = "" }) => {
    els.hudScore.textContent = String(score);
    setCombo(combo);
    els.hudLevel.textContent = String(level);
    setHealth(health, pop);
    setBanner(banner);
    // Live "Best" chip during play (was static at 0 - only the best/final
    // screens updated it before). Reflects the running best, including this
    // run overtaking it.
    els.hudBest.textContent = String(Math.max(getBest(), score));
    pauseBestEl.textContent = String(Math.max(getBest(), score));
    hud3d.update({ score, best: Math.max(getBest(), score), level });
    updatePowerStatuses(powers);
  },
});

const ALL_SCREENS = ["menu", "howto", "countdown", "pauseScreen", "gameOver", "thanks"];

function applyStateToDom(state) {
  if (state !== "playing" && state !== "paused") {
    updatePowerStatuses([]);
    setBanner(null);
  }
  for (const key of ALL_SCREENS) els[key].classList.add("hidden");
  els.hud.classList.add("hidden");
  els.joystick.classList.add("hidden");
  hud3d.hide();

  if (state === "playing" && !document.hidden) audio.ambientStart();
  else audio.ambientStop();

  if (state === "menu") {
    els.menu.classList.remove("hidden");
    els.menuBest.textContent = getBest();
  } else if (state === "howto") {
    els.howto.classList.remove("hidden");
  } else if (state === "countdown") {
    els.countdown.classList.remove("hidden");
    els.hud.classList.remove("hidden");
    if (!RENDER_2D) hud3d.show();
    setHealth(100);
    if (controlMode === "mobile") els.joystick.classList.remove("hidden");
  } else if (state === "playing") {
    els.hud.classList.remove("hidden");
    if (!RENDER_2D) hud3d.show();
    if (controlMode === "mobile") els.joystick.classList.remove("hidden");
  } else if (state === "paused") {
    els.pauseScreen.classList.remove("hidden");
    els.hud.classList.remove("hidden");
    if (!RENDER_2D) hud3d.show();
    if (controlMode === "mobile") els.joystick.classList.remove("hidden");
  } else if (state === "gameover") {
    els.gameOver.classList.remove("hidden");
    const r = game.lastResult || { score: 0, best: getBest(), isNew: false };
    els.finalScore.textContent = String(r.score);
    els.finalBest.textContent = String(r.best);
    els.newBestLine.classList.toggle("is-new", r.isNew);
  } else if (state === "thanks") {
    els.thanks.classList.remove("hidden");
  }
}

function getBest() {
  return Number(localStorage.getItem("coinRunnerBest") || 0);
}

// ---------- Control mode (desktop vs mobile), independent compositions ----------

let controlMode = "desktop";

function resolveControlMode() {
  const override = els.controlModeSelect.value;
  if (override === "desktop" || override === "mobile") return override;
  return detectMobile() ? "mobile" : "desktop";
}

function applyControlMode() {
  controlMode = resolveControlMode();
  input.mode = controlMode;
  game.setControlMode(controlMode);
  document.body.classList.toggle("mode-desktop", controlMode === "desktop");
  document.body.classList.toggle("mode-mobile", controlMode === "mobile");
  if (game.state === "playing" || game.state === "paused" || game.state === "countdown") {
    els.joystick.classList.toggle("hidden", controlMode !== "mobile");
  }
}

els.controlModeSelect.addEventListener("change", applyControlMode);
window.addEventListener("resize", applyControlMode);
applyControlMode();

// ---------- Sizing ----------

function resize() {
  const w = window.innerWidth;
  const top =
    !RENDER_2D &&
    document.body.classList.contains("mode-mobile") &&
    document.body.classList.contains("gk-hud-on")
      ? hud3d.el.offsetHeight
      : 0;
  canvas3d.style.top = canvas.style.top = top + "px";
  const h = window.innerHeight - top;
  game.setSize(w, h);
  if (scene3d) {
    const comp = currentComposition();
    if (comp !== scene3dComposition) {
      scene3dComposition = comp;
      scene3d = createScene3D({ canvas: canvas3d, composition: comp });
    }
    scene3d.resize(w, h, game.width, game.height);
  }
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 60));
resize();

// ---------- Countdown ----------

function runCountdown(onDone) {
  game.setState("countdown");
  game.centerPlayer(); // WP G3.2: avoid the (0,0) corner default during "GO!"
  let n = 3;
  els.countdownNumber.textContent = String(n);
  audio.countdownBeep(false);
  const tick = () => {
    n -= 1;
    if (n > 0) {
      els.countdownNumber.textContent = String(n);
      audio.countdownBeep(false);
      setTimeout(tick, 700);
    } else {
      els.countdownNumber.textContent = "GO!";
      audio.countdownBeep(true);
      setTimeout(onDone, 500);
    }
  };
  setTimeout(tick, 700);
}

// ---------- Menu wiring ----------

function withClick(el, fn, confirm = false) {
  el.addEventListener("click", () => {
    try {
      audio.resume();
      confirm ? audio.menuConfirm() : audio.menuClick();
    } catch (e) {
      console.warn("audio", e);
    }
    fn();
  });
}

withClick(
  els.playBtn,
  () => {
    runCountdown(() => game.startRun());
  },
  true
);
withClick(els.howToBtn, () => game.setState("howto"));
withClick(els.howtoBackBtn, () => game.setState("menu"));
// One handler for the menu Sound button, the always-visible speaker button and the M key.
function toggleSound() {
  const nowOn = !audio.enabled;
  audio.setEnabled(nowOn);
  try {
    localStorage.setItem(SOUND_KEY, String(nowOn));
  } catch (e) {
    // Keep the current session's choice when storage is unavailable.
  }
  syncSoundLabels();
  if (nowOn && game.state === "playing" && !document.hidden) audio.ambientStart();
}
withClick(els.soundBtn, toggleSound);
withClick(els.soundToggle, toggleSound);
withClick(els.exitBtn, () => game.setState("thanks"));
withClick(els.thanksBackBtn, () => game.setState("menu"));

withClick(els.pauseBtn, () => game.pause());
withClick(hud3d.buttons.pause, () => {
  if (game.state === "paused") game.resume();
  else if (game.state === "playing") game.pause();
});
withClick(els.resumeBtn, () => game.resume());
withClick(els.pauseMenuBtn, () => game.setState("menu"));

withClick(els.retryBtn, () => runCountdown(() => game.startRun()), true);
withClick(els.gameOverMenuBtn, () => game.setState("menu"));

function instantRestart() {
  try {
    audio.resume();
    audio.menuConfirm();
  } catch (e) {
    console.warn("audio", e);
  }
  runCountdown(() => game.startRun());
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !e.repeat && controlMode === "desktop") toggleSound();
  if (e.code === "Escape" || e.code === "KeyP") {
    if (game.state === "playing") game.pause();
    else if (game.state === "paused") game.resume();
  }
  // Space bar also toggles pause, desktop only (WP12); on the game-over screen
  // it's the instant-restart key instead (WP5), so the two never collide.
  if (e.code === "Space" && controlMode === "desktop") {
    if (game.state === "playing") {
      e.preventDefault();
      game.pause();
    } else if (game.state === "paused") {
      e.preventDefault();
      game.resume();
    }
  }
  // Instant restart: one key from game-over, no menu round trip (WP5).
  if (game.state === "gameover" && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    instantRestart();
  }
});

// Instant restart: one tap anywhere on the game-over screen (not just the
// button) also restarts immediately, as long as it isn't the "Main menu" link.
els.gameOver.addEventListener("click", (e) => {
  if (game.state !== "gameover") return;
  if (e.target.closest("#gameOverMenuBtn")) return;
  if (e.target.closest("#retryBtn")) return; // already wired via withClick
  instantRestart();
});

// Auto-pause when the tab/window loses focus or is hidden, and show the pause
// screen when the player returns (WP2 audit item, folded into WP5).
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.state === "playing") game.pause();
});
window.addEventListener("blur", () => {
  if (game.state === "playing") game.pause();
});

// ---------- Main loop ----------

let lastTime = performance.now();
let checkedPlaceholders = false;
const LOW_STATES = new Set(["menu", "howto", "thanks", "gameover", "paused"]);
let lastRender3d = 0;
let qualityScene = null;
let qualityMode = null;
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  game.update(dt);
  if (RENDER_2D) {
    game.render();
  } else {
    const mode = LOW_STATES.has(game.state) ? "menu" : "full";
    if (scene3d !== qualityScene || mode !== qualityMode) {
      scene3d.setQuality(mode);
      qualityScene = scene3d;
      qualityMode = mode;
      lastRender3d = 0;
    }
    if (mode === "menu" && now - lastRender3d < 66) {
      requestAnimationFrame(loop);
      return;
    }
    lastRender3d = now;
    game.render3d(scene3d);
    scene3d.renderer.render(scene3d.scene, scene3d.camera);
    if (!checkedPlaceholders) {
      checkedPlaceholders = true;
      scene3d.assertNoPlaceholders();
    }
  }
  requestAnimationFrame(loop);
}

game.setState("menu");
requestAnimationFrame(loop);

// Exposed for the release-check script (verify.py) only, to force a
// deterministic game-over screenshot instead of waiting on random collisions.
// Gated behind ?debug=1 so it is never present in a normal play session.
if (new URLSearchParams(window.location.search).get("debug") === "1") {
  window.__coinRunnerGame = game;
}
