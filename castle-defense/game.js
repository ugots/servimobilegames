// Castle Defense MVP: hexagon wall, mouse/touch-aimed turret, waves, store.
// All prices and stats live in BALANCE so live tuning is one edit.
// BALANCE is one closed system (wave w, L(w) = wave length in seconds):
//   growth(w,a,b) = (1+a)^(min(w,10)-1) * (1+b)^max(0,w-10)   (fast to wave 10, slower after)
//   speed(w)     = 0.036 * growth(w, 0.08, 0.04)               (wave 1 = 0.6 of the old 0.06)
//   count(w)     = spawns(w) = 6 * growth(w, 0.10, 0.04)       (wave 1 = 6 enemies), spawnRate = count / L(w)
//   hp(w)        = enemy.hp + enemy.hpPerWave*(w-1)            (raider hp; armoured 2x, brute 3x)
//   kinds        = armoured share from wave 4, brute share from wave 8; hpMean(w) is the share-weighted hp
//   income(w)    = kills * goldPerKill(w), goldPerKill(w) = round(enemy.gold + enemy.goldPerWave*(w-1))
// Gentle curve: wave 1 is 6 slow raiders; pressure(w) = count*hpMean/L rises about a third as fast as CD2.
// tests/test_p5_balance_lead.py pins the growth ratios, the wave 1 numbers and the two pressure slopes.
export const BALANCE = {
  wall: { maxHp: 100 },
  shooter: { fireRate: 2, damage: 1 },
  enemy: { hp: 1, hpPerWave: 0.05, speed: 0.06, speedPerWave: 0.006, size: 1, sizePerWave: 0.06, damage: 6, gold: 4, goldPerWave: -0.15 },
  spawn: { baseRate: 1.4, perWave: 0.05 },
  wave: { min: 30, max: 60, step: 5 },
  // store regen (hp/s) a greedy player owns by wave w, index 0 = wave 1; CD2 values scaled 0.3 for the CD3 curve
  regenByWave: [0, 0.11, 0.23, 0.36, 0.50, 0.65, 0.81, 0.98, 1.15, 1.34],
  length(w) { return Math.min(BALANCE.wave.max, Math.max(BALANCE.wave.min, BALANCE.wave.min + BALANCE.wave.step * (w - 1))); },
  growth(w, a, b) { return Math.pow(1 + a, Math.min(w, 10) - 1) * Math.pow(1 + b, Math.max(0, w - 10)); },
  speed(w) { return 0.036 * BALANCE.growth(w, 0.08, 0.04); },
  count(w) { return 6 * BALANCE.growth(w, 0.10, 0.04); },
  armouredShare(w) { return w < 4 ? 0 : Math.min(0.5, 0.1 * (w - 3)); },
  bruteShare(w) { return w < 8 ? 0 : Math.min(0.3, 0.06 * (w - 7)); },
  hpMean(w) { const a = BALANCE.armouredShare(w), b = BALANCE.bruteShare(w); return BALANCE.hp(w) * (1 - a - b + 2 * a + 3 * b); },
  size(w) { return BALANCE.enemy.size + BALANCE.enemy.sizePerWave * (w - 1); },
  hp(w) { return BALANCE.enemy.hp + BALANCE.enemy.hpPerWave * (w - 1); },
  spawnRate(w) { return BALANCE.count(w) / BALANCE.length(w); },
  spawns(w) { return BALANCE.count(w); },
  regenAllowance(w) { const t = BALANCE.regenByWave; return t[Math.min(t.length, Math.max(1, w)) - 1]; },
  requiredAccuracy(w) {
    const Lw = BALANCE.length(w), s = BALANCE.shooter;
    const hits = BALANCE.spawns(w) * BALANCE.hpMean(w) / s.damage;
    const leaks = BALANCE.regenAllowance(w) * Lw / BALANCE.enemy.damage;
    return Math.min(1, Math.max(0, (hits - leaks) / (s.fireRate * Lw)));
  },
  bulletSpeed: 520,
  turret: { fireRate: 1.2, damage: 1 },
  items: {
    autoturret: { name: "Autoturret", price: 400, growth: 1.5, max: 6 },
    shooter_rate: { name: "Shooter fire rate", price: 100, growth: 1.4, rateMul: 1.2 },
    shooter_dmg: { name: "Shooter damage", price: 100, growth: 1.4, dmgAdd: 0.5 },
    turret_rate: { name: "Autoturret fire rate", price: 120, growth: 1.4, rateMul: 1.2 },
    turret_dmg: { name: "Autoturret damage", price: 120, growth: 1.4, dmgAdd: 0.5 },
    wall: { name: "Stronger wall", price: 75, growth: 1.4, hp: 50 },
    regen: { name: "Wall regen", price: 125, growth: 1.4, hps: 1.5 },
  },
};

const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const screens = { menu: $("menu"), store: $("store"), pause: $("pause"), over: $("over") };

let audio = null;
import("../_base/audio.js").then((m) => { audio = m.createAudio(); }).catch(() => {});
function sfx(name) { try { if (audio) audio.play(name); } catch (e) { /* audio is optional */ } }

const L = { W: 800, H: 600, minSide: 600, hexR: 84, enemyR: 13, hudPx: 24, mode: "desktop", bandH: 0, fieldH: 600 };
function layout() {
  L.W = canvas.width = window.innerWidth;
  L.H = canvas.height = window.innerHeight;
  L.mode = L.H > L.W ? "phone" : "desktop";
  L.bandH = L.mode === "phone" ? 190 : 0;
  L.fieldH = L.H - L.bandH;
  L.minSide = Math.min(L.W, L.fieldH);
  L.hexR = L.minSide * (L.mode === "phone" ? 0.2 : 0.14);
  L.enemyR = L.minSide * (L.mode === "phone" ? 0.032 : 0.02);
  L.hudPx = L.mode === "phone" ? Math.max(18, Math.round(L.W * 0.06)) : Math.round(L.H * 0.0444);
}

const g = {
  phase: "menu", wave: 0, waveTimer: 0, waveLength: 30, wallHp: BALANCE.wall.maxHp,
  wallMaxHp: BALANCE.wall.maxHp, gold: 0, enemies: [], turrets: [], paused: false,
  storeOpen: false, shots: 0, kills: 0, spawnAcc: 0, cd: 0, hitCd: 0, firing: false,
  aim: { x: 0, y: 0 }, regen: 0, fireRate: BALANCE.shooter.fireRate, damage: BALANCE.shooter.damage,
  turretFireRate: BALANCE.turret.fireRate, turretDamage: BALANCE.turret.damage,
  levels: { autoturret: 0, shooter_rate: 0, shooter_dmg: 0, turret_rate: 0, turret_dmg: 0, wall: 0, regen: 0 }, bullets: [],
};

const waveLengthFor = (n) => Math.min(BALANCE.wave.max, Math.max(BALANCE.wave.min, BALANCE.wave.min + BALANCE.wave.step * (n - 1)));
const cx = () => L.W / 2;
const cy = () => L.fieldH / 2;

function price(id) {
  const it = BALANCE.items[id];
  return Math.round(it.price * Math.pow(it.growth, g.levels[id]));
}

function resetRun() {
  Object.assign(g, {
    wave: 0, waveTimer: 0, wallMaxHp: BALANCE.wall.maxHp, wallHp: BALANCE.wall.maxHp, gold: 0,
    enemies: [], turrets: [], storeOpen: false, shots: 0, kills: 0, spawnAcc: 0, cd: 0, firing: false,
    regen: 0, fireRate: BALANCE.shooter.fireRate, damage: BALANCE.shooter.damage, paused: false, bullets: [],
    turretFireRate: BALANCE.turret.fireRate, turretDamage: BALANCE.turret.damage,
    levels: { autoturret: 0, shooter_rate: 0, shooter_dmg: 0, turret_rate: 0, turret_dmg: 0, wall: 0, regen: 0 },
  });
  g.aim = { x: cx(), y: cy() - L.hexR * 2 };
}

function show(name) {
  for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
}

function startWave() {
  if (g.phase === "menu" || g.phase === "over") resetRun();
  g.wave += 1;
  g.waveLength = waveLengthFor(g.wave);
  g.waveTimer = 0;
  g.spawnAcc = 0;
  g.enemies = [];
  g.storeOpen = false;
  g.paused = false;
  g.phase = "wave";
  show(null);
}

function endWave() {
  g.enemies = [];
  g.firing = false;
  g.phase = "store";
  g.storeOpen = true;
  renderStore();
  show("store");
}

function gameOver() {
  g.phase = "over";
  g.storeOpen = false;
  g.firing = false;
  $("over-line").textContent = `Reached wave ${g.wave} - ${g.kills} kills`;
  noteBest();
  sfx("gameover");
  show("over");
}

function toMenu() {
  g.phase = "menu";
  g.paused = false;
  g.storeOpen = false;
  g.enemies = [];
  noteBest();
  show("menu");
}

function buy(id) {
  const it = BALANCE.items[id];
  if (!it || g.phase !== "store") return false;
  if (id === "autoturret" && g.turrets.length >= it.max) return false;
  const p = price(id);
  if (g.gold < p) return false;
  g.gold -= p;
  g.levels[id] += 1;
  if (id === "autoturret") g.turrets.push({ vertex: g.turrets.length, cd: 0, angle: 0 });
  else if (id === "shooter_rate") g.fireRate *= it.rateMul;
  else if (id === "shooter_dmg") g.damage += it.dmgAdd;
  else if (id === "turret_rate") g.turretFireRate *= it.rateMul;
  else if (id === "turret_dmg") g.turretDamage += it.dmgAdd;
  else if (id === "wall") { g.wallMaxHp += it.hp; g.wallHp = Math.min(g.wallMaxHp, g.wallHp + it.hp); }
  else if (id === "regen") g.regen += it.hps;
  sfx("powerup");
  renderStore();
  return true;
}

function renderStore() {
  $("store-gold").textContent = `Gold: ${g.gold}  |  Wave ${g.wave} cleared`;
  const box = $("store-items");
  box.innerHTML = "";
  for (const id of Object.keys(BALANCE.items)) {
    const it = BALANCE.items[id];
    const maxed = id === "autoturret" && g.turrets.length >= it.max;
    const b = document.createElement("button");
    b.className = "btn";
    b.dataset.item = id;
    b.textContent = maxed ? `${it.name} (max)` : `${it.name} - ${price(id)} gold (owned ${g.levels[id]})`;
    b.disabled = maxed || g.gold < price(id);
    b.addEventListener("click", () => buy(id));
    box.appendChild(b);
  }
}

function spawnEnemy() {
  const a = Math.random() * Math.PI * 2;
  const r = L.enemyR * BALANCE.size(g.wave), speed = BALANCE.speed(g.wave) * L.minSide;
  const dx = Math.cos(a), dy = Math.sin(a), m = r * 2;
  const t = Math.min((L.W / 2 + m) / Math.max(1e-6, Math.abs(dx)), (L.fieldH / 2 + m) / Math.max(1e-6, Math.abs(dy)));
  const roll = Math.random(), ash = BALANCE.armouredShare(g.wave), bsh = BALANCE.bruteShare(g.wave);
  const kind = roll < bsh ? "brute" : roll < bsh + ash ? "armoured" : "raider";
  const hp = BALANCE.hp(g.wave) * (kind === "brute" ? 3 : kind === "armoured" ? 2 : 1);
  g.enemies.push({ x: cx() + dx * t, y: cy() + dy * t, hp, maxHp: hp, touching: false, r, speed, kind });
}

function vertex(i) {
  const a = (Math.PI / 3) * i - Math.PI / 2;
  return { x: cx() + Math.cos(a) * L.hexR, y: cy() + Math.sin(a) * L.hexR };
}

// Fire from (ox,oy) toward (tx,ty): spawns a travelling bullet; damage lands only on arrival.
function fire(ox, oy, tx, ty, dmg, owner) {
  let dx = tx - ox, dy = ty - oy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const sp = BALANCE.bulletSpeed;
  g.bullets.push({ x: ox, y: oy, vx: dx * sp, vy: dy * sp, dmg, owner });
}

// Where a bullet leaving (ox,oy) meets enemy e, which walks toward the hexagon centre at
// BALANCE.enemy.speed * minSide and stops when touching. Falls back to the current position.
function intercept(ox, oy, e) {
  const dx = cx() - e.x, dy = cy() - e.y, d = Math.hypot(dx, dy) || 1;
  const touchDist = L.hexR * 0.866 + e.r;
  const speed = e.speed;
  const room = d - touchDist;
  if (room <= 0 || speed <= 0) return { x: e.x, y: e.y };
  const vx = (dx / d) * speed, vy = (dy / d) * speed;
  const rx = e.x - ox, ry = e.y - oy, s = BALANCE.bulletSpeed;
  const a = speed * speed - s * s, b = 2 * (rx * vx + ry * vy), c = rx * rx + ry * ry;
  let t = -1;
  if (Math.abs(a) < 1e-9) { if (Math.abs(b) > 1e-9) t = -c / b; }
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      t = Math.min(...[t1, t2].filter((x) => x > 0), Infinity);
      if (t === Infinity) t = -1;
    }
  }
  if (!(t > 0)) return { x: e.x, y: e.y };
  const m = Math.min(speed * t, room);
  return { x: e.x + (dx / d) * m, y: e.y + (dy / d) * m };
}

function moveBullets(dt) {
  const keep = [];
  for (const b of g.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let hit = null;
    for (const e of g.enemies) {
      if (Math.hypot(e.x - b.x, e.y - b.y) <= e.r) { hit = e; break; }
    }
    if (hit) {
      hit.hp -= b.dmg;
      if (hit.hp <= 0) {
        g.enemies.splice(g.enemies.indexOf(hit), 1);
        g.gold += Math.round(BALANCE.enemy.gold + (g.wave - 1) * BALANCE.enemy.goldPerWave);
        g.kills += 1;
        sfx("score");
      }
      continue;
    }
    if (b.x < 0 || b.y < 0 || b.x > L.W || b.y > L.H) continue;
    keep.push(b);
  }
  g.bullets = keep;
}

function update(dt) {
  if (g.phase !== "wave") return;
  g.waveTimer += dt;
  g.cd -= dt;

  const turn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  if (turn && !g.paused) {
    const ang = Math.atan2(g.aim.y - cy(), g.aim.x - cx()) + turn * 2.5 * dt;
    g.aim.x = cx() + Math.cos(ang) * 3 * L.hexR; g.aim.y = cy() + Math.sin(ang) * 3 * L.hexR;
  }

  g.spawnAcc += BALANCE.spawnRate(g.wave) * dt;
  while (g.spawnAcc >= 1) { g.spawnAcc -= 1; spawnEnemy(); }

  let dps = 0;
  for (const e of g.enemies) {
    const speed = e.speed, touchDist = L.hexR * 0.866 + e.r;
    const dx = cx() - e.x, dy = cy() - e.y, d = Math.hypot(dx, dy) || 1;
    if (d <= touchDist) { e.touching = true; dps += BALANCE.enemy.damage; }
    else { const s = Math.min(speed * dt, d - touchDist); e.x += (dx / d) * s; e.y += (dy / d) * s; }
  }
  g.hitCd -= dt;
  if (dps > 0) {
    g.wallHp -= dps * dt;
    // short quiet blip (soft interface tone), at most ~3 per second
    if (g.hitCd <= 0) { sfx("menu"); g.hitCd = 0.33; }
  }
  if (g.regen > 0 && g.wallHp > 0) g.wallHp = Math.min(g.wallMaxHp, g.wallHp + g.regen * dt);

  if (g.firing && g.cd <= 0) shoot();

  for (const t of g.turrets) {
    t.cd -= dt;
    if (t.cd > 0 || !g.enemies.length) continue;
    const v = vertex(t.vertex);
    let near = null, nd = Infinity;
    for (const e of g.enemies) { const d = Math.hypot(e.x - v.x, e.y - v.y); if (d < nd) { nd = d; near = e; } }
    if (near) {
      const p = intercept(v.x, v.y, near);
      fire(v.x, v.y, p.x, p.y, g.turretDamage, "turret");
      t.cd = 1 / g.turretFireRate;
    }
  }

  moveBullets(dt);

  if (g.wallHp <= 0) { g.wallHp = 0; gameOver(); return; }
  if (g.waveTimer >= g.waveLength) endWave();
}

function shoot() {
  if (g.phase !== "wave" || g.paused || g.cd > 0) return;
  g.cd = 1 / g.fireRate;
  g.shots += 1;
  fire(cx(), cy(), g.aim.x, g.aim.y, g.damage, "center");
}

function pause(on) {
  if (g.phase !== "wave") return;
  g.paused = on;
  if (on) g.firing = false;
  screens.pause.classList.toggle("hidden", !on);
}

// ---- input ----
function setAim(e) {
  const r = canvas.getBoundingClientRect();
  g.aim.x = ((e.clientX - r.left) / r.width) * L.W;
  g.aim.y = ((e.clientY - r.top) / r.height) * L.H;
}
canvas.addEventListener("pointermove", setAim);
canvas.addEventListener("pointerdown", (e) => {
  setAim(e);
  if (g.phase !== "wave" || g.paused) return;
  g.firing = true;
  shoot();
});
const stopFire = () => { g.firing = false; };
canvas.addEventListener("pointerup", stopFire);
canvas.addEventListener("pointercancel", stopFire);
canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") stopFire(); });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
// joystick (phone): drag #cd-stick to aim; the cannon fires while deflected (mag >= 0.25)
const stick = { dx: 0, dy: 0, mag: 0, id: null };
const stickEl = $("cd-stick"), knobEl = stickEl.querySelector(".cd-knob");
function moveStick(e) {
  const r = stickEl.getBoundingClientRect(), rad = r.width / 2;
  let dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  stick.dx = dx; stick.dy = dy; stick.mag = Math.hypot(dx, dy);
  knobEl.style.transform = `translate(${dx * rad * 0.6}px, ${dy * rad * 0.6}px)`;
  if (stick.mag >= 0.25) {
    const a = Math.atan2(dy, dx);
    g.aim.x = cx() + Math.cos(a) * 3 * L.hexR; g.aim.y = cy() + Math.sin(a) * 3 * L.hexR;
    g.firing = g.phase === "wave" && !g.paused;
  } else g.firing = false;
}
function releaseStick() {
  stick.dx = stick.dy = stick.mag = 0; stick.id = null;
  knobEl.style.transform = "translate(0px, 0px)";
  g.firing = false;
}
stickEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  stick.id = e.pointerId;
  try { stickEl.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
  moveStick(e);
});
stickEl.addEventListener("pointermove", (e) => { if (stick.id === e.pointerId) moveStick(e); });
stickEl.addEventListener("pointerup", (e) => { if (stick.id === e.pointerId) releaseStick(); });
stickEl.addEventListener("pointercancel", (e) => { if (stick.id === e.pointerId) releaseStick(); });
$("cd-pause").addEventListener("click", () => pause(true));

const keys = {};
document.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") { keys[e.code] = true; e.preventDefault(); return; }
  if (e.code === "Space") {
    if (g.phase !== "wave") return;
    e.preventDefault();
    if (!g.paused && !e.repeat) { g.firing = true; shoot(); }
    return;
  }
  if (e.code === "Escape" || e.code === "KeyP") {
    if (g.phase !== "wave") return;
    e.preventDefault();
    pause(!g.paused);
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") keys[e.code] = false;
  if (e.code === "Space") g.firing = false;
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
window.addEventListener("blur", () => pause(true));
window.addEventListener("resize", layout);

$("btn-play").addEventListener("click", () => { sfx("menu"); startWave(); });
$("btn-howto").addEventListener("click", () => $("howto").classList.toggle("hidden"));
$("btn-next").addEventListener("click", () => { sfx("menu"); show(null); startWave(); });
$("btn-resume").addEventListener("click", () => pause(false));
$("btn-pause-exit").addEventListener("click", () => { screens.pause.classList.add("hidden"); toMenu(); });
$("btn-restart").addEventListener("click", () => { startWave(); });
$("btn-exit").addEventListener("click", toMenu);

// ---- scene helpers (canvas only; fx state is separate from g) ----
const fx = { stars: null, logo: null, logoOk: false, bestWave: 0 };
const hexLerp = (a, b, m) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * m)).join(",")})`;
};
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// Overhead field: the camera looks straight down; scatter (flecks, stones, bushes) is seeded in field fractions.
function fieldScatter() {
  const key = `${L.W}x${L.H}x${L.hexR}`;
  if (fx.scatterKey === key) return fx.scatter;
  const W = L.W, H = L.H, hr = L.hexR, r = seeded(11), q = { flecks: [], stones: [], bushes: [] };
  for (let i = 0; i < 400; i++) q.flecks.push({ x: r() * W, y: r() * H, s: 1 + Math.floor(r() * 3), c: r() < 0.6 ? "#5f8c3e" : "#2f5224" });
  const spot = (minD) => { for (let k = 0; k < 20; k++) { const x = r() * W, y = r() * H; if (Math.hypot(x - cx(), y - cy()) > minD) return { x, y }; } return { x: 0, y: 0 }; };
  for (let i = 0; i < 30; i++) { const p = spot(hr * 1.6); q.stones.push({ x: p.x, y: p.y, rx: hr * (0.03 + r() * 0.03), ry: hr * (0.022 + r() * 0.025), a: r() * 3 }); }
  for (let i = 0; i < 12; i++) { const p = spot(hr * 1.8); q.bushes.push({ x: p.x, y: p.y, s: hr * (0.1 + r() * 0.08), a: r() * 6 }); }
  fx.scatterKey = key; fx.scatter = q;
  return q;
}
function drawField(t) {
  const W = L.W, H = L.fieldH, hr = L.hexR, x0 = cx(), y0 = cy(), far = Math.hypot(W, H) / 2, q = fieldScatter();
  const gr = ctx.createRadialGradient(x0, y0, hr * 0.5, x0, y0, far);
  gr.addColorStop(0, "#4f7a35"); gr.addColorStop(0.5, "#3f6a2c"); gr.addColorStop(1, "#34592a");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, L.H);
  for (const f of q.flecks) { ctx.fillStyle = f.c; ctx.fillRect(f.x, f.y, f.s, f.s); }
  // worn dirt paths from the viewport edge to the hex, at k*60+30 degrees (they meet the towers)
  ctx.fillStyle = "rgba(155,131,88,0.55)";
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 + 30) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, d0 = hr * 0.9, d1 = far * 1.2, w0 = hr * 0.11, w1 = hr * 0.06;
    ctx.beginPath();
    ctx.moveTo(x0 + dx * d0 + nx * w0, y0 + dy * d0 + ny * w0); ctx.lineTo(x0 + dx * d1 + nx * w1, y0 + dy * d1 + ny * w1);
    ctx.lineTo(x0 + dx * d1 - nx * w1, y0 + dy * d1 - ny * w1); ctx.lineTo(x0 + dx * d0 - nx * w0, y0 + dy * d0 - ny * w0);
    ctx.closePath(); ctx.fill();
  }
  for (const s of q.stones) {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(s.x + 2, s.y + 3, s.rx, s.ry, s.a, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#8d887c"; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.rx, s.ry, s.a, 0, 6.283); ctx.fill();
  }
  for (const b of q.bushes) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (const [ox, oy, k] of [[0, 0, 1], [0.7, 0.2, 0.75], [-0.6, 0.3, 0.7]]) { ctx.beginPath(); ctx.arc(b.x + ox * b.s + 3, b.y + oy * b.s + 4, b.s * k, 0, 6.283); ctx.fill(); }
    for (const [ox, oy, k, c] of [[0, 0, 1, "#244d1e"], [0.7, 0.2, 0.75, "#2c5a24"], [-0.6, 0.3, 0.7, "#2c5a24"], [0.1, -0.2, 0.5, "#3a6a2c"]]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(b.x + ox * b.s, b.y + oy * b.s, b.s * k, 0, 6.283); ctx.fill(); }
  }
}
function drawVignette() {
  const far = Math.hypot(L.W, L.fieldH) / 2, gr = ctx.createRadialGradient(cx(), cy(), 0.55 * Math.max(L.W, L.fieldH), cx(), cy(), Math.max(far, 0.55 * Math.max(L.W, L.fieldH) + 1));
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, L.W, L.H);
}
function drawGround() {
  // trodden dirt apron around the curtain wall, 1.05-1.35 x hexR
  const hr = L.hexR;
  ctx.strokeStyle = "rgba(155,131,88,0.6)"; ctx.lineWidth = hr * 0.3;
  ctx.beginPath(); ctx.arc(cx(), cy(), hr * 1.2, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(60,44,24,0.25)"; ctx.lineWidth = hr * 0.06;
  ctx.beginPath(); ctx.arc(cx(), cy(), hr * 1.1, 0, Math.PI * 2); ctx.stroke();
  const r = seeded(31);
  for (let i = 0; i < 24; i++) {
    const a = r() * 6.283, d = hr * (1.08 + r() * 0.25), x = cx() + Math.cos(a) * d, y = cy() + Math.sin(a) * d;
    ctx.fillStyle = i % 3 === 0 ? "#8d887c" : "#7c6a44"; ctx.beginPath(); ctx.ellipse(x, y, hr * 0.03, hr * 0.02, a, 0, 6.283); ctx.fill();
  }
}
function hexPath() { ctx.beginPath(); for (let i = 0; i < 6; i++) { const v = vertex(i); if (i) ctx.lineTo(v.x, v.y); else ctx.moveTo(v.x, v.y); } ctx.closePath(); }
const INNER = 0.78; // inner hex radius as a fraction of hexR: the wall band is vertex(i) .. INNER*vertex(i)
function innerPath() { ctx.beginPath(); for (let i = 0; i < 6; i++) { const v = vertex(i); const x = cx() + (v.x - cx()) * INNER, y = cy() + (v.y - cy()) * INNER; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); }
function drawWall(aimAng, fracIn) {
  const hr = L.hexR, frac = fracIn === undefined ? g.wallHp / g.wallMaxHp : fracIn;
  // courtyard: flagstones inside the inner hex
  ctx.save(); innerPath(); ctx.fillStyle = "#7d7466"; ctx.fill(); ctx.clip();
  ctx.strokeStyle = "rgba(50,44,36,0.45)"; ctx.lineWidth = 1;
  const fs = hr * 0.18, fr = seeded(77);
  for (let k = -5; k <= 5; k++) {
    ctx.beginPath(); ctx.moveTo(cx() - hr, cy() + k * fs); ctx.lineTo(cx() + hr, cy() + k * fs); ctx.stroke();
    for (let x = cx() - hr + ((k & 1) ? fs * 0.5 : 0); x < cx() + hr; x += fs) { ctx.beginPath(); ctx.moveTo(x, cy() + k * fs); ctx.lineTo(x, cy() + (k + 1) * fs); ctx.stroke(); }
  }
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  for (let i = 0; i < 30; i++) ctx.fillRect(cx() + (fr() - 0.5) * hr * 1.6, cy() + (fr() - 0.5) * hr * 1.6, fs * 0.9, fs * 0.5);
  ctx.restore();
  // the curtain wall band (outer hex minus inner hex) with the stone gradient, joints, cracks and damage tint
  ctx.save(); ctx.beginPath();
  for (let i = 0; i < 6; i++) { const v = vertex(i); if (i) ctx.lineTo(v.x, v.y); else ctx.moveTo(v.x, v.y); }
  ctx.closePath();
  for (let i = 0; i < 6; i++) { const v = vertex(i), x = cx() + (v.x - cx()) * INNER, y = cy() + (v.y - cy()) * INNER; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath(); ctx.clip("evenodd");
  const gr = ctx.createLinearGradient(0, cy() - hr, 0, cy() + hr);
  gr.addColorStop(0, "#8a8578"); gr.addColorStop(1, "#5b574d");
  ctx.fillStyle = gr; ctx.fillRect(cx() - hr, cy() - hr, hr * 2, hr * 2);
  ctx.strokeStyle = "rgba(42,38,32,0.55)"; ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = vertex(i), b = vertex((i + 1) % 6), ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey), nx = ey / len, ny = -ex / len;
    const sg = (nx * (a.x - cx()) + ny * (a.y - cy())) >= 0 ? 1 : -1, bd = hr * 0.866 * (1 - INNER) * 0.5 * sg;
    ctx.beginPath(); ctx.moveTo(a.x - nx * bd, a.y - ny * bd); ctx.lineTo(b.x - nx * bd, b.y - ny * bd); ctx.stroke();
    for (let k = 1; k < 8; k++) { const x = a.x + ex * k / 8, y = a.y + ey * k / 8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - nx * bd * 2, y - ny * bd * 2); ctx.stroke(); }
  }
  const nCr = frac < 0.25 ? 3 : frac < 0.5 ? 2 : frac < 0.75 ? 1 : 0;
  if (nCr) {
    ctx.strokeStyle = "#1a1510"; ctx.lineWidth = Math.max(1.5, hr * 0.02);
    for (let i = 0; i < 6; i++) {
      const a = vertex(i), b = vertex((i + 1) % 6), r = seeded(200 + i);
      for (let c = 0; c < nCr; c++) {
        const p = 0.2 + 0.6 * ((c + r() * 0.6) / 3);
        let x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
        const dx = cx() - x, dy = cy() - y, dl = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) { x += (dx / dl) * hr * 0.11 + (r() - 0.5) * hr * 0.14; y += (dy / dl) * hr * 0.11 + (r() - 0.5) * hr * 0.14; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
  }
  if (frac < 1) { ctx.fillStyle = `rgba(60,20,10,${(1 - frac) * 0.45})`; ctx.fillRect(cx() - hr, cy() - hr, hr * 2, hr * 2); }
  ctx.restore();
  // gate on the edge nearest the aim angle (found first so the merlons leave a gap there)
  let bi = 0, bd = 9;
  for (let i = 0; i < 6; i++) {
    const a = vertex(i), b = vertex((i + 1) % 6), ma = Math.atan2((a.y + b.y) / 2 - cy(), (a.x + b.x) / 2 - cx());
    const dd = Math.abs(Math.atan2(Math.sin(ma - aimAng), Math.cos(ma - aimAng)));
    if (dd < bd) { bd = dd; bi = i; }
  }
  // merlons: small squares sitting on the band's outer edge, size 0.06*hexR
  const ms = hr * 0.06;
  ctx.fillStyle = "#9a9588"; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = vertex(i), b = vertex((i + 1) % 6), ex = b.x - a.x, ey = b.y - a.y, ang = Math.atan2(ey, ex);
    for (let k = 1; k < 8; k++) {
      if (i === bi && Math.abs(k / 8 - 0.5) < 0.2) continue;
      ctx.save(); ctx.translate(a.x + ex * k / 8, a.y + ey * k / 8); ctx.rotate(ang);
      ctx.fillRect(-ms / 2, -ms / 2, ms, ms); ctx.strokeRect(-ms / 2, -ms / 2, ms, ms); ctx.restore();
    }
  }
  ctx.lineJoin = "round"; ctx.lineWidth = Math.max(3, hr * 0.045); ctx.strokeStyle = "#2a2620"; hexPath(); ctx.stroke();
  ctx.lineWidth = Math.max(2, hr * 0.03); innerPath(); ctx.stroke();
  const a = vertex(bi), b = vertex((bi + 1) % 6), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ia = Math.atan2(my - cy(), mx - cx());
  // gate from above: dark passage across the band, drawbridge plank outside it (local +x points away from the keep)
  ctx.save(); ctx.translate(mx, my); ctx.rotate(ia);
  const gh = hr * 0.11, gi = hr * 0.866 * (1 - INNER), gp = hr * 0.17;
  ctx.fillStyle = "#8a5a2b"; ctx.strokeStyle = "#3b2410"; ctx.lineWidth = 1.5;
  ctx.fillRect(0, -gh * 0.85, gp, gh * 1.7); ctx.strokeRect(0, -gh * 0.85, gp, gh * 1.7);
  ctx.beginPath(); for (let k = 1; k < 4; k++) { ctx.moveTo(gp * k / 4, -gh * 0.85); ctx.lineTo(gp * k / 4, gh * 0.85); } ctx.stroke();
  ctx.fillStyle = "#2b1d12"; ctx.fillRect(-gi, -gh, gi, gh * 2);
  ctx.strokeStyle = "#8a5a2b"; ctx.lineWidth = Math.max(2, hr * 0.03); ctx.strokeRect(-gi, -gh, gi, gh * 2);
  ctx.restore();
  // six round towers on the vertices: stone top, conical roof seen from above
  const tr = hr * 0.16;
  for (let i = 0; i < 6; i++) {
    const v = vertex(i);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.arc(v.x + tr * 0.2, v.y + tr * 0.28, tr, 0, 6.283); ctx.fill();
    const tg = ctx.createRadialGradient(v.x - tr * 0.3, v.y - tr * 0.3, 1, v.x, v.y, tr);
    tg.addColorStop(0, "#a09b90"); tg.addColorStop(1, "#5e5a50");
    ctx.fillStyle = tg; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(2, hr * 0.03);
    ctx.beginPath(); ctx.arc(v.x, v.y, tr, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#7a2e22"; ctx.strokeStyle = "#4a1a12"; ctx.lineWidth = Math.max(1.5, hr * 0.02);
    ctx.beginPath(); ctx.arc(v.x, v.y, tr * 0.72, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); for (let k = 0; k < 6; k++) { const aa = k * Math.PI / 3 + 0.4; ctx.moveTo(v.x, v.y); ctx.lineTo(v.x + Math.cos(aa) * tr * 0.72, v.y + Math.sin(aa) * tr * 0.72); } ctx.stroke();
  }
}
function drawTorches(t) {
  // braziers: a flickering fire glow on each tower top
  const hr = L.hexR;
  for (let i = 0; i < 6; i++) {
    const v = vertex(i), rad = hr * 0.07 * (1 + 0.15 * Math.sin(t * 9 + i));
    const gr = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, rad * 1.6);
    gr.addColorStop(0, "#ffcf6b"); gr.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(v.x, v.y, rad * 1.6, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#fff0b0"; ctx.beginPath(); ctx.arc(v.x, v.y, rad * 0.4, 0, 6.283); ctx.fill();
  }
}
function drawTitleRaiders(t) {
  // three raiders walk in from three edges along the dirt paths, looping every 18 s (menu only; never touches g)
  const far = Math.hypot(L.W, L.fieldH) / 2 * 1.1, stop = L.hexR * 0.866 + L.enemyR * 1.6;
  if (!fx.titleRaiders) fx.titleRaiders = [0, 1, 2].map(() => ({ x: 0, y: 0, r: 0, touching: false, hp: 1, maxHp: 1, kind: "raider" }));
  fx.titleRaiders.forEach((e, k) => {
    const p = ((t + k * 6) % 18) / 18, a = (k * 120 + 30) * Math.PI / 180, d = far + (stop - far) * p;
    e.r = L.enemyR * 1.1; e.x = cx() + Math.cos(a) * d; e.y = cy() + Math.sin(a) * d;
    drawEnemy(e, t);
  });
}
function noteBest() {
  try {
    const n = Math.max(Number(localStorage.getItem("castle.bestWave")) || 0, g.wave);
    if (n > 0) localStorage.setItem("castle.bestWave", String(n));
    fx.bestWave = n;
  } catch (e) { /* storage is optional */ }
  for (const id of ["best-wave", "over-best"]) {
    const el = $(id);
    if (!el) continue;
    el.textContent = `Best: wave ${fx.bestWave}`;
    el.classList.toggle("hidden", !(fx.bestWave > 0));
  }
}
try { fx.bestWave = Number(localStorage.getItem("castle.bestWave")) || 0; } catch (e) { /* storage is optional */ }
let lastDraw = 0;

// ---- play-field drawing (canvas only; state in fx, never in g) ----
Object.assign(fx, { lastShots: 0, recoil: 0, flash: 0, seen: [], seenB: [], hpSeen: new WeakMap(), hitUntil: new WeakMap(), parts: [], lastTimer: 0, seeds: new WeakMap() });
function addParts(list) { fx.parts.push(...list); if (fx.parts.length > 300) fx.parts.splice(0, fx.parts.length - 300); }
function trackFx(dt) {
  if (g.shots < fx.lastShots) fx.lastShots = g.shots;
  if (g.shots > fx.lastShots) { fx.recoil = 1; fx.flash = 0.08; fx.lastShots = g.shots; }
  const now = performance.now() / 1000;
  const live = new Set(g.enemies), liveB = new Set(g.bullets);
  const ok = g.phase === "wave" && g.waveTimer >= fx.lastTimer;
  fx.lastTimer = g.waveTimer;
  if (ok) {
    for (const s of fx.seen) {
      if (live.has(s.e)) continue;
      const out = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283 + i, sp = s.r * (1.2 + (i % 3) * 0.5);
        out.push({ k: "puff", x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45, max: 0.45, r: s.r * 0.4 });
      }
      out.push({ k: "gold", x: s.x, y: s.y, vx: 0, vy: -s.r * 2, life: 0.45, max: 0.45, r: s.r * 0.3 });
      addParts(out);
    }
    for (const b of fx.seenB) {
      if (liveB.has(b.ref)) continue;
      const step = Math.hypot(b.vx, b.vy) * Math.max(dt, 0.016);
      const e = fx.seen.find((s) => Math.hypot(s.x - b.x, s.y - b.y) <= 1.5 * s.r + step);
      if (!e) continue;
      const out = [];
      for (let i = 0; i < 5; i++) {
        const a = Math.atan2(b.vy, b.vx) + Math.PI + (i - 2) * 0.5, sp = e.r * 5;
        out.push({ k: "spark", x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.18, max: 0.18, r: e.r * 0.5 });
      }
      addParts(out);
    }
  }
  fx.seen = g.enemies.map((e) => ({ e, x: e.x, y: e.y, r: e.r }));
  fx.seenB = g.bullets.map((b) => ({ ref: b, x: b.x, y: b.y, vx: b.vx, vy: b.vy }));
  for (const e of g.enemies) {
    const last = fx.hpSeen.get(e);
    if (last !== undefined && e.hp < last) fx.hitUntil.set(e, now + 0.1);
    fx.hpSeen.set(e, e.hp);
  }
}
function drawFx(dt) {
  ctx.save();
  ctx.lineCap = "round";
  fx.parts = fx.parts.filter((p) => p.life > 0);
  for (const p of fx.parts) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    const k = Math.max(0, p.life / p.max);
    ctx.globalAlpha = k;
    if (p.k === "spark") {
      ctx.strokeStyle = "#ffe55a"; ctx.lineWidth = Math.max(2, p.r * 0.4);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
    } else {
      ctx.fillStyle = p.k === "gold" ? "#f2c14e" : "#8b7d6b";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.k === "puff" ? 1.6 - k * 0.6 : 1), 0, 6.283); ctx.fill();
    }
  }
  ctx.restore();
}
function drawTurret(ang, dt) {
  const hr = L.hexR, x = cx(), y = cy();
  fx.recoil = Math.max(0, fx.recoil - dt * 8);
  // keep platform seen from above (radius 0.26*hexR), then the barrel as a rotated top-down rectangle
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.arc(x + hr * 0.04, y + hr * 0.06, hr * 0.26, 0, 6.283); ctx.fill();
  const gr = ctx.createRadialGradient(x - hr * 0.07, y - hr * 0.07, 1, x, y, hr * 0.26);
  gr.addColorStop(0, "#9a958a"); gr.addColorStop(1, "#5e5a50");
  ctx.fillStyle = gr; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, hr * 0.26, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#2a2620";
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; ctx.beginPath(); ctx.arc(x + Math.cos(a) * hr * 0.22, y + Math.sin(a) * hr * 0.22, Math.max(1.2, hr * 0.014), 0, 6.283); ctx.fill(); }
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const back = fx.recoil * 0.12 * hr, len = hr * 0.62, w = hr * 0.07;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-back + hr * 0.02, -w + hr * 0.04, len, w * 2);
  const bg = ctx.createLinearGradient(0, -w, 0, w);
  bg.addColorStop(0, "#d6a54a"); bg.addColorStop(1, "#7a5418");
  ctx.fillStyle = bg; ctx.strokeStyle = "#3b2a10";
  ctx.fillRect(-back, -w, len, w * 2); ctx.strokeRect(-back, -w, len, w * 2);
  ctx.fillStyle = "#e6bd63"; ctx.fillRect(len - back - hr * 0.06, -w * 1.25, hr * 0.06, w * 2.5); ctx.strokeRect(len - back - hr * 0.06, -w * 1.25, hr * 0.06, w * 2.5);
  if (fx.flash > 0) {
    fx.flash -= dt;
    const fg = ctx.createRadialGradient(len, 0, 1, len, 0, hr * 0.25);
    fg.addColorStop(0, "rgba(255,246,200,0.95)"); fg.addColorStop(1, "rgba(255,160,40,0)");
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(len, 0, hr * 0.25, 0, 6.283); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = "#e0a93a"; ctx.beginPath(); ctx.arc(x, y, hr * 0.08, 0, 6.283); ctx.fill();
}
function drawAutoTurret(q) {
  const v = vertex(q.vertex), r = L.hexR * 0.12;
  let near = null, nd = Infinity;
  for (const e of g.enemies) { const d = Math.hypot(e.x - v.x, e.y - v.y); if (d < nd) { nd = d; near = e; } }
  const a = near ? Math.atan2(near.y - v.y, near.x - v.x) : Math.atan2(v.y - cy(), v.x - cx());
  ctx.save(); ctx.translate(v.x, v.y);
  // top-down: a stone cap on the tower, small barrel aimed at the nearest enemy (draw only)
  const gr = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r); gr.addColorStop(0, "#b3aea2"); gr.addColorStop(1, "#6a665c");
  ctx.fillStyle = gr; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.rotate(a); ctx.fillStyle = "#d6a54a"; ctx.fillRect(0, -r * 0.22, r * 1.5, r * 0.44); ctx.strokeRect(0, -r * 0.22, r * 1.5, r * 0.44);
  ctx.fillStyle = "#e6bd63"; ctx.fillRect(r * 1.25, -r * 0.3, r * 0.25, r * 0.6);
  ctx.restore();
}
function drawEnemy(e, t) {
  // seen from above: kind (Part D) wins, maxHp is the fallback; local +x faces the keep
  const kind = e.kind || (e.maxHp < 1.5 ? "raider" : e.maxHp < 2.5 ? "armoured" : "brute");
  const u = e.r, tier = kind === "raider" ? 0 : kind === "armoured" ? 1 : 2;
  let sd = fx.seeds.get(e); if (sd === undefined) { sd = Math.random() * 6.28; fx.seeds.set(e, sd); }
  const fl = (fx.hitUntil.get(e) || 0) > performance.now() / 1000, c = (col) => (fl ? "#ffffff" : col);
  const swing = e.touching ? 0 : Math.sin(t * 10 + sd) * u * 0.4;
  ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.beginPath(); ctx.ellipse(e.x + u * 0.15, e.y + u * 0.2, u * 1.0, u * 0.85, 0, 0, 6.283); ctx.fill();
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(cy() - e.y, cx() - e.x));
  ctx.strokeStyle = "#1a1410"; ctx.lineWidth = Math.max(1.2, u * 0.08);
  ctx.fillStyle = c("#2a2018");
  ctx.beginPath(); ctx.ellipse(swing, -u * 0.32, u * 0.34, u * 0.18, 0, 0, 6.283); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-swing, u * 0.32, u * 0.34, u * 0.18, 0, 0, 6.283); ctx.fill();
  const body = tier === 0 ? "#a3402e" : tier === 1 ? "#8f9aa6" : "#5f6b3a";
  const bw = u * (tier === 2 ? 1.0 : 0.78);
  ctx.fillStyle = c(body); ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.62, bw, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  if (tier === 2) {
    ctx.fillStyle = c("#e8e0c8");
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(u * 0.2, s * u * 0.3); ctx.lineTo(u * 0.5, s * u * 0.72); ctx.lineTo(u * 0.4, s * u * 0.22); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  ctx.fillStyle = c(tier === 0 ? "#e0b48a" : tier === 1 ? "#b9c3cd" : "#7d8a4a");
  ctx.beginPath(); ctx.arc(u * 0.12, 0, u * 0.4, 0, 6.283); ctx.fill(); ctx.stroke();
  if (tier === 0) {
    ctx.strokeStyle = c("#cfd6dd"); ctx.lineWidth = Math.max(1.5, u * 0.14); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(u * 0.3, u * 0.55); ctx.lineTo(u * 1.25, u * 0.55); ctx.stroke();
  } else if (tier === 1) {
    ctx.fillStyle = c("#c0392b"); ctx.fillRect(-u * 0.1, -u * 0.08, u * 0.6, u * 0.16);
    ctx.strokeStyle = c("#6d7882"); ctx.lineWidth = Math.max(2, u * 0.22); ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, u * 0.95, -1.25, -0.25); ctx.stroke();
  }
  ctx.restore();
}
function drawBullet(b) {
  const tu = b.owner === "turret", w = Math.max(3, L.enemyR * 0.35);
  ctx.save(); ctx.lineCap = "round"; ctx.shadowBlur = 12; ctx.shadowColor = tu ? "#7fe0a4" : "#ffd36b";
  const tx = b.x - b.vx * 0.04, ty = b.y - b.vy * 0.04;
  ctx.strokeStyle = tu ? "#7fe0a4" : "#ffd36b"; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = tu ? "#d8ffe8" : "#fff6c8"; ctx.lineWidth = w * 0.45;
  ctx.beginPath(); ctx.moveTo(tx + (b.x - tx) * 0.4, ty + (b.y - ty) * 0.4); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}
function drawCrosshair() {
  const r = L.enemyR * 0.9, x = g.aim.x, y = g.aim.y;
  ctx.save(); ctx.globalAlpha = 0.9; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(2, L.enemyR * 0.14);
  ctx.beginPath(); ctx.arc(x, y, r, 0.25, Math.PI / 2 - 0.25); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r, Math.PI + 0.25, Math.PI * 1.5 - 0.25); ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * r * 0.5, y + dy * r * 0.5); ctx.lineTo(x + dx * r * 1.45, y + dy * r * 1.45); }
  ctx.stroke(); ctx.restore();
}
function drawHud(t) {
  const px = L.hudPx, label = Math.round(px / 2), pad = Math.round(px * 0.5), face = "system-ui, sans-serif";
  if (!fx.logo) { fx.logo = new Image(); fx.logo.onload = () => { fx.logoOk = true; }; fx.logo.src = "favicon.svg"; }
  const lg = px * 0.9, phone = L.mode === "phone";
  let gx = pad;
  if (fx.logoOk) { ctx.save(); ctx.globalAlpha = 0.8; ctx.drawImage(fx.logo, pad, pad, lg, lg); ctx.restore(); }
  gx = pad + lg + pad * 0.6;
  // coin + gold
  const cr = px * 0.38, ccx = gx + cr, ccy = pad + px * 0.5;
  const cg = ctx.createLinearGradient(0, ccy - cr, 0, ccy + cr); cg.addColorStop(0, "#f9d66b"); cg.addColorStop(1, "#b8862b");
  ctx.fillStyle = cg; ctx.strokeStyle = "#6d4a12"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#e9b94a"; ctx.beginPath(); ctx.arc(ccx, ccy, cr * 0.62, 0, 6.283); ctx.stroke();
  ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "#f2c14e";
  ctx.font = `bold ${px}px ${face}`;
  ctx.fillText(`${g.gold}`, gx + cr * 2 + pad * 0.5, pad);
  ctx.font = `${label}px ${face}`; ctx.fillStyle = "#e8ecf2";
  ctx.fillText("GOLD", gx, pad + px * 1.1);
  ctx.textAlign = "right";
  ctx.font = `bold ${px}px ${face}`;
  const rx = L.W - 76;  // clear of the DOM #cd-pause button (52 px + 12 px margin)
  ctx.fillText(`Wave ${g.wave}`, rx, pad);
  ctx.font = `${label}px ${face}`;
  ctx.fillText(`${Math.max(0, Math.ceil(g.waveLength - g.waveTimer))}s`, rx, pad + px * 1.1);
  // wall bar in a shield-like plate: centred at top on desktop, under the gold row on phone
  const bw = L.W * (phone ? 0.5 : 0.36), bh = Math.max(12, px * 0.42), bx = (L.W - bw) / 2 + (phone ? px * 0.4 : 0), by = (phone ? pad + px * 1.1 + label + pad * 0.6 : pad) + px * 0.1;
  const ph = bh + px * 0.3, plx = bx - px * 0.9, plw = bw + px * 1.1, ply = by - px * 0.15;
  ctx.fillStyle = "#3b2a1a"; ctx.strokeStyle = "#a8834f"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(plx, ply, plw, ph, ph * 0.4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#3a1f1f"; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#d9534f"; ctx.fillRect(bx, by, bw * Math.max(0, g.wallHp / g.wallMaxHp), bh);
  ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  const sx = plx + px * 0.45, sy = ply + ph / 2, sr = px * 0.3;
  ctx.fillStyle = "#8ca3c4"; ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx - sr, sy - sr); ctx.lineTo(sx + sr, sy - sr); ctx.lineTo(sx + sr, sy + sr * 0.2); ctx.quadraticCurveTo(sx + sr * 0.6, sy + sr, sx, sy + sr * 1.2); ctx.quadraticCurveTo(sx - sr * 0.6, sy + sr, sx - sr, sy + sr * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
}

// ---- draw ----
function draw() {
  const t = performance.now() / 1000;
  lastDraw = t;
  if (g.phase === "menu") {
    // same top-down field as play: slow sweeping turret, three raiders walking in; g is never changed here
    const mdt = Math.min(0.05, t - (fx.lastT || t));
    fx.lastT = t;
    drawField(t);
    drawGround();
    drawWall(t * 0.3, 1);
    drawTorches(t);
    drawTurret(t * 0.3, mdt);
    drawTitleRaiders(t);
    drawVignette();
    return;
  }
  const dt = Math.min(0.05, t - (fx.lastT || t));
  fx.lastT = t;
  const ang = Math.atan2(g.aim.y - cy(), g.aim.x - cx());
  drawField(t);
  drawGround();
  drawWall(ang);
  drawTorches(t);
  trackFx(dt);
  for (const q of g.turrets) drawAutoTurret(q);
  drawTurret(ang, dt);
  for (const e of g.enemies) drawEnemy(e, t);
  for (const b of g.bullets) drawBullet(b);
  drawFx(dt);
  drawVignette();
  if (g.phase === "wave") drawCrosshair();
  drawHud(t);
}

function levelStats(w) {
  return {
    wave: w, speed: BALANCE.speed(w), size: BALANCE.size(w), hp: BALANCE.hp(w),
    spawnsPerSec: BALANCE.spawnRate(w), regenAllowance: BALANCE.regenAllowance(w),
    requiredAccuracy: BALANCE.requiredAccuracy(w),
    count: BALANCE.count(w), armouredShare: BALANCE.armouredShare(w), bruteShare: BALANCE.bruteShare(w),
  };
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!g.paused) update(dt);
  const live = g.phase === "wave" && !g.paused;
  $("cd-pause").classList.toggle("hidden", !live);
  $("cd-controls").classList.toggle("hidden", !(live && L.mode === "phone"));
  draw();
  requestAnimationFrame(frame);
}

layout();
resetRun();
noteBest();
requestAnimationFrame(frame);

window.__castleGame = {
  get phase() { return g.phase; },
  get wave() { return g.wave; },
  get waveTimer() { return g.waveTimer; },
  get waveLength() { return g.waveLength; },
  get wallHp() { return g.wallHp; },
  set wallHp(v) { g.wallHp = v; },
  get wallMaxHp() { return g.wallMaxHp; },
  get gold() { return g.gold; },
  set gold(v) { g.gold = v; },
  get enemies() { return g.enemies; },
  get turrets() { return g.turrets; },
  get bullets() { return g.bullets; },
  get fireRate() { return g.fireRate; },
  get damage() { return g.damage; },
  get turretFireRate() { return g.turretFireRate; },
  get turretDamage() { return g.turretDamage; },
  spawnEnemyAt(x, y, hp = 1, kind = "raider") {
    const w = Math.max(1, g.wave);
    g.enemies.push({ x, y, hp, maxHp: hp, touching: false, r: L.enemyR * BALANCE.size(w), speed: BALANCE.speed(w) * L.minSide, kind });
  },
  levelStats,
  fire, shoot,
  get store() {
    return { open: g.storeOpen, items: Object.keys(BALANCE.items).map((id) => ({ id, price: price(id), level: g.levels[id] })) };
  },
  get paused() { return g.paused; },
  get shots() { return g.shots; },
  get firing() { return g.firing; },
  get aim() { return g.aim; },
  get aimAngle() { return Math.atan2(g.aim.y - cy(), g.aim.x - cx()); },
  get stick() { return { dx: stick.dx, dy: stick.dy, mag: stick.mag }; },
  get layout() { return L; },
  get center() { return { x: cx(), y: cy() }; },
  BALANCE,
  update, startWave, endWave, buy,
};
