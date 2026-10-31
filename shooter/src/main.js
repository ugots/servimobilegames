import { mountMenu } from "/_base/menu.js";
import { mountHud } from "/_base/hud.js";
import { createRenderer } from "./render.js";
import { mountTitleSky } from "./title_sky.js";

const cfg = SHOOTER_CONFIG;
const canvas = document.getElementById("field");
const renderer = createRenderer(canvas, cfg);
const params = new URLSearchParams(location.search);
if (params.get("shot") === "1") window.__shooterStars = { setClock: (seconds) => renderer.setStarClock(seconds) };

const bgOnly = params.get("shot") === "1" && params.get("bgonly") === "1";

let u = null;
let frame = 0;
let pointer = null;

let state = ShooterSim.create(cfg, cfg.seed);
let playing = false;
let paused = false;
let acc = 0;
let last = 0;
let frameEvents = [];

const desktop = ShooterInputDesktop.create(() => playing && !paused);
const mobile = window.ShooterInputMobile ? window.ShooterInputMobile.create(() => playing && !paused) : null;
const sound = window.ShooterSound ? window.ShooterSound.create() : null;

const SVG = (waves) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/>${waves}</svg>`;
const SOUND_ON = SVG('<path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/>');
const SOUND_OFF = SVG('<path d="M16 9l5 6M21 9l-5 6"/>');
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>';

let highScore = 0;
try {
  highScore = parseInt(localStorage.getItem("shooter.highScore"), 10) || 0;
} catch (e) {}
let overShown = false;

const hud = mountHud({
  fields: [
    { key: "score", label: "Score", slot: "left" },
    { key: "wave", label: "Wave", slot: "left" },
    { key: "lives", label: "Lives", slot: "right" },
  ],
  actions: [
    { key: "pause", ariaLabel: "Pause", html: PAUSE_ICON },
    { key: "sound", ariaLabel: "Sound", html: SOUND_ON },
  ],
});

const menu = mountMenu({
  title: "Asteroid Breaker",
  howTo: '<span class="shooter-desktop-howto">Arrows turn and thrust. Space fires. Shift jumps through hyperspace. Esc pauses.</span><span class="shooter-mobile-howto">Tap the left pads to nudge, hold to turn. Hold the middle to thrust, hold the right to fire.</span>',
  onPlay: startGame,
  onExit: exitToMenu,
  onPause() {
    paused = true;
    if (sound) sound.stop();
    desktop.clear();
  },
  onResume() {
    paused = false;
    if (sound) sound.start();
    last = performance.now();
  },
});
const titleEl = document.querySelector(".gk-menu-root .gk-title");
const logo = document.createElement("img");
logo.className = "shooter-logo";
logo.src = "favicon.svg";
logo.alt = "";
titleEl.before(logo);
mountTitleSky(titleEl.closest(".gk-screen"));
hud.buttons.pause.style.pointerEvents = "auto";
hud.buttons.pause.addEventListener("click", () => menu.showPause());

function toggleMute() {
  if (!sound) return;
  sound.setMuted(!sound.isMuted());
  syncSoundButton();
}
function syncSoundButton() {
  const m = !!sound && sound.isMuted();
  hud.buttons.sound.setAttribute("aria-pressed", m ? "true" : "false");
  hud.buttons.sound.innerHTML = m ? SOUND_OFF : SOUND_ON;
}
hud.buttons.sound.style.pointerEvents = "auto";
hud.buttons.sound.addEventListener("click", toggleMute);
syncSoundButton();

// Game Over: High Score line and the desktop restart prompt, next to the menu's own score line.
const scoreLine = document.querySelector(".gk-score-line");
const bestEl = document.createElement("div");
bestEl.id = "shooter-best";
bestEl.className = "gk-score-line";
scoreLine.after(bestEl);
const promptEl = document.createElement("p");
promptEl.id = "shooter-restart";
promptEl.className = "gk-subtitle";
promptEl.textContent = "Space or Enter to play again";
bestEl.after(promptEl);

function commitHighScore() {
  if (state.score > highScore) {
    highScore = state.score;
    try {
      localStorage.setItem("shooter.highScore", String(highScore));
    } catch (e) {}
  }
}

function showGameOver() {
  commitHighScore();
  overShown = true;
  menu.showGameOver(state.score);
  bestEl.textContent = `High Score: ${highScore}`;
}

document.addEventListener("keydown", (e) => {
  if (!overShown || e.repeat) return;
  if (e.code !== "Space" && e.code !== "Enter") return;
  e.preventDefault();
  menu.showPlay();
  startGame();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !e.repeat) toggleMute();
});

function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

function gameConfig() {
  if (!isPortrait()) return cfg;
  return Object.freeze({
    ...cfg,
    fieldW: cfg.portraitFieldW,
    fieldH: cfg.portraitFieldH,
    bulletLife: cfg.portraitBulletLife,
    turnRate: cfg.turnRate * cfg.mobileTurnFactor,
  });
}

// Pause composition (both devices): the shared kit has no Restart, so add one beside Resume. It reuses the
// same fresh-game lifecycle as Play, after committing a pending high score, and only acts while paused in play.
const pauseTitle = [...document.querySelectorAll(".gk-menu-root .gk-title-sm")].find((h) => h.textContent === "Paused");
const restartBtn = document.createElement("button");
restartBtn.type = "button";
restartBtn.id = "shooter-restart-btn";
restartBtn.className = "gk-btn";
restartBtn.textContent = "Restart";
restartBtn.setAttribute("aria-label", "Restart game");
pauseTitle.nextElementSibling.insertBefore(restartBtn, pauseTitle.nextElementSibling.children[1] || null);
restartBtn.addEventListener("click", () => {
  if (!playing || !paused) return;
  commitHighScore();
  menu.showPlay();
  startGame();
});

function startGame() {
  state = ShooterSim.create(gameConfig(), cfg.seed);
  if (mobile) {
    mobile.show(false);
    mobile.show(true);
  }
  overShown = false;
  playing = true;
  paused = false;
  acc = 0;
  last = performance.now();
  desktop.clear();
  renderer.clearEffects();
  if (sound) sound.start();
  hud.show();
  syncHud();
}

function exitToMenu() {
  if (sound) sound.stop();
  if (mobile) mobile.show(false);
  playing = false;
  paused = false;
  overShown = false;
  hud.hide();
}

function syncHud() {
  hud.update({ score: state.score, lives: Math.max(0, state.lives), wave: Math.max(1, state.wave) });
}

// Destruction presentation: compare entity identity before/after each fixed step so every
// destruction is seen exactly once, however many steps run in one rendered frame. Read-only.
function observe() {
  return {
    rocks: state.rocks.map((r) => ({ ref: r, x: r.x, y: r.y, size: r.size })),
    saucers: state.saucers.map((s) => ({ ref: s, x: s.x, y: s.y })),
    ship: state.ship,
    alive: state.ship.alive,
    sx: state.ship.x,
    sy: state.ship.y,
  };
}

function presentDestruction(before) {
  const evs = state.events.slice();
  for (const r of before.rocks) {
    if (!state.rocks.includes(r.ref)) renderer.explode("rock", r.x, r.y, r.size);
  }
  let attacker = false;
  for (const s of before.saucers) {
    if (state.saucers.includes(s.ref)) continue;
    // A saucer that left the arena is not a destruction (its x is past the field edge).
    if (s.ref.x < 0 || s.ref.x > state.cfg.fieldW) continue;
    renderer.explode("attacker", s.ref.x, s.ref.y);
    attacker = true;
  }
  if (attacker) {
    const i = evs.indexOf("explodeMedium");
    if (i >= 0) evs[i] = "attackerExplode";
    else evs.push("attackerExplode");
  }
  // Death only: the ship object flips alive -> dead (invulnerability blinking never does).
  if (before.alive && !state.ship.alive && before.ship === state.ship) renderer.explode("player", before.sx, before.sy);
  return evs;
}

function pauseForFocus() {
  if (playing && !paused) menu.showPause();
}
window.addEventListener("blur", pauseForFocus);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseForFocus();
});

function readInput() {
  const d = desktop.read();
  const m = mobile ? mobile.read() : null;
  if (!m) return d;
  return {
    left: d.left || m.left,
    right: d.right || m.right,
    thrust: d.thrust || m.thrust,
    fire: d.fire || m.fire,
    hyper: d.hyper || m.hyper,
  };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  renderer.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
}

function onPointer(e) {
  pointer = [(e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)];
}
window.addEventListener("pointermove", onPointer);
window.addEventListener("pointerdown", onPointer);

function view() {
  const f = state.cfg;
  if (isPortrait()) {
    // Phone composition: portrait field on top, the control zone below it.
    const dpr = window.devicePixelRatio || 1;
    const zone = cfg.portraitControlsH * dpr;
    const scale = Math.min(canvas.width / f.fieldW, (canvas.height - zone) / f.fieldH);
    return { scale, ox: (canvas.width - f.fieldW * scale) / 2, oy: 0, w: canvas.width, h: canvas.height };
  }
  const scale = Math.min(canvas.width / f.fieldW, canvas.height / f.fieldH);
  return {
    scale,
    ox: (canvas.width - f.fieldW * scale) / 2,
    oy: (canvas.height - f.fieldH * scale) / 2,
    w: canvas.width,
    h: canvas.height,
  };
}

function tick(now) {
  if (playing && !paused) {
    acc += Math.min((now - last) / 1000, cfg.fixedDt * 5);
    frameEvents = [];
    while (acc >= cfg.fixedDt) {
      const before = observe();
      ShooterSim.step(state, readInput(), cfg.fixedDt);
      const evs = presentDestruction(before);
      frameEvents.push(...state.events);
      if (sound) sound.play(evs);
      acc -= cfg.fixedDt;
      if (state.mode === "over") break;
    }
    if (sound) {
      sound.heartbeat(state, now);
      sound.setThrust(state.ship.alive && !!state.ship.thrusting);
    }
    syncHud();
    if (state.mode === "over") {
      playing = false;
      if (sound) sound.stop(true);
      if (mobile) mobile.show(false);
      hud.hide();
      showGameOver();
    }
  }
  last = now;
  u = ShooterUniforms.next(u, Object.assign({}, state, { events: frameEvents }), now / 1000, pointer, cfg.look);
  frameEvents = [];
  renderer.draw(state, bgOnly ? { ...view(), bgOnly: true } : view(), u);
  frame += 1;
  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);
resize();

if (params.get("shot") === "1") {
  window.__shooter = {
    get state() {
      return state;
    },
    get frame() {
      return frame;
    },
    uniforms() {
      return u;
    },
    shipScreen() {
      const dpr = window.devicePixelRatio || 1;
      const v = view();
      return { x: (v.ox + state.ship.x * v.scale) / dpr, y: (v.oy + state.ship.y * v.scale) / dpr };
    },
    step(n) {
      for (let i = 0; i < n; i++) ShooterSim.step(state, readInput(), cfg.fixedDt);
      syncHud();
    },
    spawnSaucer() {
      const s = ShooterSim.spawnSaucer(state);
      s.small = false;
      s.r = cfg.saucerRadiusLarge;
      s.x = cfg.fieldW * 0.3;
      s.y = cfg.fieldH * 0.3;
      s.vx = 0;
      return s;
    },
    forceGameOver() {
      state.lives = 0;
      state.ship.alive = false;
      state.mode = "over";
      playing = false;
      if (mobile) mobile.show(false);
      hud.hide();
      showGameOver();
    },
    highScore() {
      return highScore;
    },
    muted() {
      return !!sound && sound.isMuted();
    },
    paused() {
      return paused;
    },
    soundStats() {
      return sound ? sound.stats() : { blips: 0 };
    },
  };
}

requestAnimationFrame(tick);
