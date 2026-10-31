// Castle Defense MVP: hexagon wall, mouse/touch-aimed turret, waves, store.
// All prices and stats live in BALANCE so live tuning is one edit.
// BALANCE is one closed system (wave w, L(w) = wave length in seconds):
//   spawns(w)    = (spawn.baseRate + spawn.perWave*(w-1)) * L(w)
//   hp(w)        = enemy.hp + enemy.hpPerWave*(w-1)            (smooth, fractional ramp, no cliff)
//   total hp(w)  = spawns(w) * hp(w)
//   income(w)    = kills * goldPerKill(w), goldPerKill(w) = round(enemy.gold + enemy.goldPerWave*(w-1))
//   dps          = shooter.fireRate*damage + turrets * turretFireRate*turretDamage
// Easing curve: waves 1-3 enemies have hp <= shooter damage (one-shot kills) and wave 2 spawns
// at most 5% faster than wave 1, so the start is easy; from wave 4 hp and spawn rise gradually.
// tests/test_p5_balance_lead.py buys greedily with income: dps/(total hp / L) rises into wave 2,
// then eases down slowly, never below 0.6 of wave 1 through wave 10.
export const BALANCE = {
  wall: { maxHp: 100 },
  shooter: { fireRate: 2, damage: 1 },
  enemy: { hp: 1, hpPerWave: 0.05, speed: 0.06, speedPerWave: 0.006, size: 1, sizePerWave: 0.06, damage: 6, gold: 4, goldPerWave: -0.15 },
  spawn: { baseRate: 1.4, perWave: 0.05 },
  wave: { min: 30, max: 60, step: 5 },
  // store regen (hp/s) a greedy player owns by wave w, index 0 = wave 1
  regenByWave: [0, 0.38, 0.78, 1.21, 1.68, 2.17, 2.7, 3.26, 3.84, 4.46],
  length(w) { return Math.min(BALANCE.wave.max, Math.max(BALANCE.wave.min, BALANCE.wave.min + BALANCE.wave.step * (w - 1))); },
  speed(w) { return BALANCE.enemy.speed + BALANCE.enemy.speedPerWave * (w - 1); },
  size(w) { return BALANCE.enemy.size + BALANCE.enemy.sizePerWave * (w - 1); },
  hp(w) { return BALANCE.enemy.hp + BALANCE.enemy.hpPerWave * (w - 1); },
  spawnRate(w) { return BALANCE.spawn.baseRate + BALANCE.spawn.perWave * (w - 1); },
  spawns(w) { return BALANCE.spawnRate(w) * BALANCE.length(w); },
  regenAllowance(w) { const t = BALANCE.regenByWave; return t[Math.min(t.length, Math.max(1, w)) - 1]; },
  requiredAccuracy(w) {
    const Lw = BALANCE.length(w), s = BALANCE.shooter;
    const hits = BALANCE.spawns(w) * BALANCE.hp(w) / s.damage;
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

const L = { W: 800, H: 600, minSide: 600, hexR: 84, enemyR: 13, hudPx: 24, mode: "desktop" };
function layout() {
  L.W = canvas.width = window.innerWidth;
  L.H = canvas.height = window.innerHeight;
  L.minSide = Math.min(L.W, L.H);
  L.mode = L.H > L.W ? "phone" : "desktop";
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
const cy = () => L.H / 2;

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
  const t = Math.min((L.W / 2 + m) / Math.max(1e-6, Math.abs(dx)), (L.H / 2 + m) / Math.max(1e-6, Math.abs(dy)));
  const hp = BALANCE.hp(g.wave);
  g.enemies.push({ x: cx() + dx * t, y: cy() + dy * t, hp, maxHp: hp, touching: false, r, speed });
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
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Escape" || e.code === "KeyP") {
    if (g.phase !== "wave") return;
    e.preventDefault();
    pause(!g.paused);
  }
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
function drawSky(t, mix) {
  // mix 0 = day, 0.5 = dusk, 1 = night; the menu uses dusk
  const horizon = L.H * 0.62;
  const top = mix < 0.5 ? hexLerp("#5d8fc9", "#1b2340", mix * 2) : hexLerp("#1b2340", "#0b1028", (mix - 0.5) * 2);
  const hor = mix < 0.5 ? hexLerp("#e9d6a3", "#c9774a", mix * 2) : hexLerp("#c9774a", "#3a2a4a", (mix - 0.5) * 2);
  const gr = ctx.createLinearGradient(0, 0, 0, horizon);
  gr.addColorStop(0, top); gr.addColorStop(1, hor);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, L.W, L.H);
  if (!fx.stars) { const r = seeded(7); fx.stars = Array.from({ length: 60 }, () => ({ x: r(), y: r() * 0.5, p: r() * 6.28, s: 0.6 + r() * 1.4 })); }
  const vis = Math.min(1, mix * 2);
  for (const s of fx.stars) {
    ctx.globalAlpha = (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.p))) * vis;
    ctx.fillStyle = "#fff6d8";
    ctx.beginPath(); ctx.arc(s.x * L.W, s.y * L.H, s.s * Math.max(1, L.minSide / 600), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#ffffff";
  for (const [k, yy] of [[0, 0.16], [1, 0.34]]) {
    const span = L.W + 400, x0 = ((k * 0.55 * span + t * 8) % span) - 200, y0 = L.H * yy, u = L.minSide * 0.05;
    for (const [dx, dy, rx, ry] of [[0, 0, 3, 1], [-2.2, 0.3, 2, 0.8], [2.4, 0.2, 2.2, 0.8], [0.4, -0.6, 2, 0.9]]) {
      ctx.beginPath(); ctx.ellipse(x0 + dx * u, y0 + dy * u, rx * u, ry * u, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
function drawGround() {
  const hr = L.hexR, horizon = L.H * 0.62;
  ctx.fillStyle = "#2f3a22"; ctx.fillRect(0, horizon, L.W, L.H - horizon);
  const gr = ctx.createRadialGradient(cx(), cy(), hr * 0.5, cx(), cy(), hr * 1.9);
  gr.addColorStop(0, "#4a5a32"); gr.addColorStop(1, "rgba(47,58,34,0)");
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx(), cy(), hr * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(30,24,14,0.35)"; ctx.lineWidth = hr * 0.18;
  ctx.beginPath(); ctx.arc(cx(), cy(), hr * 1.05, 0, Math.PI * 2); ctx.stroke();
  const r = seeded(31);
  for (let i = 0; i < 24; i++) {
    const a = r() * 6.283, d = hr * (1.15 + r() * 0.7), x = cx() + Math.cos(a) * d, y = cy() + Math.sin(a) * d * 0.9;
    if (i % 3 === 0) { ctx.fillStyle = "#8d887c"; ctx.beginPath(); ctx.ellipse(x, y, hr * 0.04, hr * 0.028, 0, 0, 6.283); ctx.fill(); }
    else { ctx.strokeStyle = "#6f8644"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x - 1, y - hr * 0.08); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - hr * 0.1); ctx.moveTo(x + 3, y); ctx.lineTo(x + 3, y - hr * 0.07); ctx.stroke(); }
  }
}
function hexPath() { ctx.beginPath(); for (let i = 0; i < 6; i++) { const v = vertex(i); if (i) ctx.lineTo(v.x, v.y); else ctx.moveTo(v.x, v.y); } ctx.closePath(); }
function drawWall(aimAng) {
  const hr = L.hexR, frac = g.wallHp / g.wallMaxHp;
  ctx.save(); hexPath(); ctx.clip();
  const gr = ctx.createLinearGradient(0, cy() - hr, 0, cy() + hr);
  gr.addColorStop(0, "#8a8578"); gr.addColorStop(1, "#5b574d");
  ctx.fillStyle = gr; ctx.fillRect(cx() - hr, cy() - hr, hr * 2, hr * 2);
  ctx.strokeStyle = "rgba(42,38,32,0.55)"; ctx.lineWidth = 1.5;
  for (let k = 1; k <= 3; k++) {
    const y = cy() - hr + (hr * 2 * k) / 4;
    ctx.beginPath(); ctx.moveTo(cx() - hr, y); ctx.lineTo(cx() + hr, y); ctx.stroke();
    for (let x = cx() - hr + (k % 2) * hr * 0.2; x < cx() + hr; x += hr * 0.4) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + hr / 2); ctx.stroke(); }
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
  // crenellations: alternating merlons along each edge, depth 0.08*hexR, pushed outward
  ctx.fillStyle = "#7c776b"; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = vertex(i), b = vertex((i + 1) % 6), ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey);
    const nx = (ey / len), ny = -(ex / len), n = 6, d = hr * 0.08;
    const sg = (nx * (a.x - cx()) + ny * (a.y - cy())) >= 0 ? 1 : -1;
    for (let k = 0; k < n; k += 2) {
      const p = (k + 0.1) / n, q = (k + 0.9) / n;
      const x1 = a.x + ex * p, y1 = a.y + ey * p, x2 = a.x + ex * q, y2 = a.y + ey * q;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + nx * sg * d, y1 + ny * sg * d); ctx.lineTo(x2 + nx * sg * d, y2 + ny * sg * d); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  ctx.lineWidth = Math.max(3, hr * 0.05); ctx.strokeStyle = "#2a2620"; hexPath(); ctx.stroke();
  // gate on the edge nearest the aim angle
  let bi = 0, bd = 9;
  for (let i = 0; i < 6; i++) {
    const a = vertex(i), b = vertex((i + 1) % 6), ma = Math.atan2((a.y + b.y) / 2 - cy(), (a.x + b.x) / 2 - cx());
    const dd = Math.abs(Math.atan2(Math.sin(ma - aimAng), Math.cos(ma - aimAng)));
    if (dd < bd) { bd = dd; bi = i; }
  }
  const a = vertex(bi), b = vertex((bi + 1) % 6), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ia = Math.atan2(my - cy(), mx - cx());
  ctx.save(); ctx.translate(mx, my); ctx.rotate(ia + Math.PI / 2);
  const gw = hr * 0.2, gh = hr * 0.3;
  ctx.fillStyle = "#2b1d12"; ctx.strokeStyle = "#8a5a2b"; ctx.lineWidth = Math.max(2, hr * 0.035);
  ctx.beginPath(); ctx.moveTo(-gw, 0); ctx.lineTo(-gw, -gh + gw); ctx.arc(0, -gh + gw, gw, Math.PI, 0); ctx.lineTo(gw, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawTorches(t) {
  for (const [n, i] of [4, 5, 1, 2].entries()) {
    const v = vertex(i), h = L.hexR * (0.16 + 0.025 * Math.sin(t * 9 + n)), w = L.hexR * 0.055;
    ctx.fillStyle = "#3b2414"; ctx.fillRect(v.x - w * 0.35, v.y - L.hexR * 0.05, w * 0.7, L.hexR * 0.1);
    for (const [k, col, s] of [[0, "rgba(255,120,30,0.95)", 1], [1, "rgba(255,225,120,0.95)", 0.6]]) {
      const fh = h * s, fy = v.y - L.hexR * 0.05;
      const gr = ctx.createRadialGradient(v.x, fy - fh * 0.3, 1, v.x, fy - fh * 0.3, fh);
      gr.addColorStop(0, col); gr.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(v.x, fy - fh); ctx.quadraticCurveTo(v.x + w * s * 1.4, fy - fh * 0.25, v.x, fy); ctx.quadraticCurveTo(v.x - w * s * 1.4, fy - fh * 0.25, v.x, fy - fh); ctx.fill();
    }
  }
}
function drawRaider(t) {
  const y = L.H * (L.mode === "phone" ? 0.80 : 0.70), u = L.enemyR, p = (t % 18) / 18;
  const x = -u * 3 + p * (L.W + u * 6), bob = Math.sin(t * 10) * 0.08 * u;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(x, y + u, u * 0.9, u * 0.3, 0, 0, 6.283); ctx.fill();
  ctx.fillStyle = "#14181f";
  ctx.fillRect(x - u * 0.45, y - u * 0.7 + bob, u * 0.9, u * 1.4);
  ctx.beginPath(); ctx.arc(x, y - u * 1.0 + bob, u * 0.4, 0, 6.283); ctx.fill();
  ctx.fillRect(x + u * 0.4, y - u * 0.5 + bob, u * 0.9, u * 0.14);
  const sw = Math.sin(t * 10) * u * 0.35;
  ctx.fillRect(x - u * 0.35 + sw, y + u * 0.6, u * 0.25, u * 0.5); ctx.fillRect(x + u * 0.1 - sw, y + u * 0.6, u * 0.25, u * 0.5);
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
  const gr = ctx.createRadialGradient(x - hr * 0.07, y - hr * 0.07, 1, x, y, hr * 0.24);
  gr.addColorStop(0, "#9a958a"); gr.addColorStop(1, "#5e5a50");
  ctx.fillStyle = gr; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, hr * 0.24, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#2a2620";
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; ctx.beginPath(); ctx.arc(x + Math.cos(a) * hr * 0.2, y + Math.sin(a) * hr * 0.2, Math.max(1.2, hr * 0.014), 0, 6.283); ctx.fill(); }
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const back = fx.recoil * 0.12 * hr, len = hr * 0.62, w = hr * 0.07;
  const bg = ctx.createLinearGradient(0, -w, 0, w);
  bg.addColorStop(0, "#d6a54a"); bg.addColorStop(1, "#7a5418");
  ctx.fillStyle = bg; ctx.strokeStyle = "#3b2a10";
  ctx.fillRect(-back, -w, len, w * 2); ctx.strokeRect(-back, -w, len, w * 2);
  ctx.fillStyle = "#e6bd63"; ctx.fillRect(len - back - hr * 0.06, -w * 1.25, hr * 0.06, w * 2.5);
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
  const v = vertex(q.vertex), r = L.hexR * 0.11;
  let near = null, nd = Infinity;
  for (const e of g.enemies) { const d = Math.hypot(e.x - v.x, e.y - v.y); if (d < nd) { nd = d; near = e; } }
  const a = near ? Math.atan2(near.y - v.y, near.x - v.x) : Math.atan2(v.y - cy(), v.x - cx());
  ctx.save(); ctx.translate(v.x, v.y);
  ctx.rotate(a); ctx.fillStyle = "#4a463e"; ctx.fillRect(0, -r * 0.2, r * 1.5, r * 0.4); ctx.rotate(-a);
  const gr = ctx.createLinearGradient(-r, 0, r, 0); gr.addColorStop(0, "#a09b90"); gr.addColorStop(1, "#5e5a50");
  ctx.fillStyle = gr; ctx.strokeStyle = "#2a2620"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#7a2e22";
  ctx.beginPath(); ctx.moveTo(-r * 1.1, -r * 0.2); ctx.lineTo(0, -r * 1.7); ctx.lineTo(r * 1.1, -r * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawEnemy(e, t) {
  const u = e.r, tier = e.maxHp < 1.5 ? 0 : e.maxHp < 2.5 ? 1 : 2;
  let sd = fx.seeds.get(e); if (sd === undefined) { sd = Math.random() * 6.28; fx.seeds.set(e, sd); }
  const fl = (fx.hitUntil.get(e) || 0) > performance.now() / 1000, c = (col) => (fl ? "#ffffff" : col);
  const bob = e.touching ? 0 : Math.sin(t * 10 + sd) * 0.08 * u;
  ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.beginPath(); ctx.ellipse(e.x, e.y + u * 0.8, u * 0.95, u * 0.35, 0, 0, 6.283); ctx.fill();
  ctx.save(); ctx.translate(e.x, e.y + bob); ctx.rotate(Math.atan2(cy() - e.y, cx() - e.x));
  ctx.strokeStyle = "#1a1410"; ctx.lineWidth = Math.max(1.2, u * 0.08);
  const body = tier === 0 ? "#a3402e" : tier === 1 ? "#8f9aa6" : "#5f6b3a";
  const bw = u * (tier === 2 ? 0.95 : 0.78);
  ctx.fillStyle = c(body); ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.8, bw, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c(tier === 0 ? "#e0b48a" : tier === 1 ? "#b9c3cd" : "#7d8a4a");
  ctx.beginPath(); ctx.arc(u * 0.12, 0, u * 0.42, 0, 6.283); ctx.fill(); ctx.stroke();
  if (tier === 0) {
    ctx.fillStyle = c("#cfd6dd"); ctx.fillRect(u * 0.3, u * 0.35, u * 0.95, u * 0.14); ctx.strokeRect(u * 0.3, u * 0.35, u * 0.95, u * 0.14);
  } else if (tier === 1) {
    ctx.fillStyle = c("#c0392b"); ctx.beginPath(); ctx.moveTo(-u * 0.1, -u * 0.12); ctx.lineTo(u * 0.5, 0); ctx.lineTo(-u * 0.1, u * 0.12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c("#6d7882"); ctx.beginPath(); ctx.ellipse(u * 0.6, -u * 0.5, u * 0.25, u * 0.4, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = c("#e8e0c8");
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(u * 0.1, s * u * 0.32); ctx.lineTo(u * 0.35, s * u * 0.85); ctx.lineTo(u * 0.4, s * u * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = c("#6b4a2a"); ctx.save(); ctx.translate(u * 0.7, u * 0.5); ctx.rotate(-0.4); ctx.fillRect(0, -u * 0.1, u * 0.9, u * 0.2); ctx.beginPath(); ctx.arc(u * 0.9, 0, u * 0.24, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.restore();
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
  if (!phone && fx.logoOk) { ctx.save(); ctx.globalAlpha = 0.8; ctx.drawImage(fx.logo, pad, pad, lg, lg); ctx.restore(); gx = pad + lg + pad * 0.6; }
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
  ctx.fillText(`Wave ${g.wave}`, L.W - pad, pad);
  ctx.font = `${label}px ${face}`;
  ctx.fillText(`${Math.max(0, Math.ceil(g.waveLength - g.waveTimer))}s`, L.W - pad, pad + px * 1.1);
  // wall bar in a shield-like plate
  const bw = L.W * (phone ? 0.4 : 0.36), bh = Math.max(12, px * 0.42), bx = (L.W - bw) / 2, by = pad + px * 0.1;
  const ph = bh + px * 0.3, plx = bx - px * 0.9, plw = bw + px * 1.1, ply = by - px * 0.15;
  ctx.fillStyle = "#3b2a1a"; ctx.strokeStyle = "#a8834f"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(plx, ply, plw, ph, ph * 0.4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#3a1f1f"; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#d9534f"; ctx.fillRect(bx, by, bw * Math.max(0, g.wallHp / g.wallMaxHp), bh);
  ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  const sx = plx + px * 0.45, sy = ply + ph / 2, sr = px * 0.3;
  ctx.fillStyle = "#8ca3c4"; ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx - sr, sy - sr); ctx.lineTo(sx + sr, sy - sr); ctx.lineTo(sx + sr, sy + sr * 0.2); ctx.quadraticCurveTo(sx + sr * 0.6, sy + sr, sx, sy + sr * 1.2); ctx.quadraticCurveTo(sx - sr * 0.6, sy + sr, sx - sr, sy + sr * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (phone && fx.logoOk) { ctx.save(); ctx.globalAlpha = 0.8; ctx.drawImage(fx.logo, (L.W - lg) / 2, ply + ph + pad * 0.4, lg, lg); ctx.restore(); }
}

// ---- draw ----
function draw() {
  const t = performance.now() / 1000;
  lastDraw = t;
  if (g.phase === "menu") {
    drawSky(t, 0.5);
    drawGround();
    drawWall(-Math.PI / 2);
    drawTorches(t);
    drawRaider(t);
    return;
  }
  const dt = Math.min(0.05, t - (fx.lastT || t));
  fx.lastT = t;
  const mix = Math.max(0, Math.min(1, (g.wave - 1) / 8));
  const ang = Math.atan2(g.aim.y - cy(), g.aim.x - cx());
  drawSky(t, mix);
  drawGround();
  drawWall(ang);
  trackFx(dt);
  for (const e of g.enemies) drawEnemy(e, t);
  for (const q of g.turrets) drawAutoTurret(q);
  drawTurret(ang, dt);
  for (const b of g.bullets) drawBullet(b);
  drawFx(dt);
  if (g.phase === "wave") drawCrosshair();
  drawHud(t);
}

function levelStats(w) {
  return {
    wave: w, speed: BALANCE.speed(w), size: BALANCE.size(w), hp: BALANCE.hp(w),
    spawnsPerSec: BALANCE.spawnRate(w), regenAllowance: BALANCE.regenAllowance(w),
    requiredAccuracy: BALANCE.requiredAccuracy(w),
  };
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!g.paused) update(dt);
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
  spawnEnemyAt(x, y, hp = 1) {
    const w = Math.max(1, g.wave);
    g.enemies.push({ x, y, hp, maxHp: hp, touching: false, r: L.enemyR * BALANCE.size(w), speed: BALANCE.speed(w) * L.minSide });
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
  get layout() { return L; },
  BALANCE,
  update, startWave, endWave, buy,
};
