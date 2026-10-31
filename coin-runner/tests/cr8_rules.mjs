// CR8 rule tests: damage function, timed effects, level logic, spiral. Run by test_cr8.py with node.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const src = path.resolve(import.meta.dirname, "..", "src");
const diff = await import(pathToFileURL(path.join(src, "difficulty.js")).href);
globalThis.localStorage = { _v: {}, getItem(k) { return this._v[k] ?? null; }, setItem(k, v) { this._v[k] = v; } };
const { Game } = await import(pathToFileURL(path.join(src, "game.js")).href);

const results = [];
function test(name, fn) {
  fn();
  results.push(name);
}

function makeGame() {
  const audio = new Proxy({}, { get: () => () => {} });
  const input = { getVector: () => ({ x: 0, y: 0 }) };
  const game = new Game({ canvas: { getContext: () => ({}) }, audio, input });
  game.width = 1920;
  game.height = 1080;
  game.controlMode = "mobile"; // entityScale 1, deterministic
  game._recomputeScale();
  game._resetRun();
  game.state = "playing";
  return game;
}

test("damage order trail < head < ship", () => {
  const t = diff.computeDamage("trail", false);
  const h = diff.computeDamage("head", false);
  const s = diff.computeDamage("ship", false);
  assert.ok(t > 0 && t < h && h < s);
  assert.equal(t / diff.TRAIL_TICK, 10); // 1 health per 0.1 s -> 10/s
});

test("shield blocks all three damage types", () => {
  for (const k of ["trail", "head", "ship"]) assert.equal(diff.computeDamage(k, true), 0);
});

test("health clamps 0..100", () => {
  assert.equal(diff.applyDamage(10, 30), 0);
  assert.equal(diff.applyDamage(100, 0), 100);
  assert.equal(diff.applyHeal(90, 30), 100);
  assert.equal(diff.applyHeal(10, 30), 40);
});

test("level table caps", () => {
  assert.equal(diff.levelParams(1).coins, 30);
  assert.equal(diff.levelParams(2).ships, 2);
  assert.equal(diff.levelParams(50).ships, 6);
  assert.equal(diff.levelParams(50).coins, 60);
  const a = diff.levelParams(1), b = diff.levelParams(2);
  assert.ok(Math.abs(b.spin / a.spin - 1.08) < 1e-9);
  assert.ok(b.fireInterval < a.fireInterval);
});

test("spiral: 4 angles 90 deg apart", () => {
  const a = diff.spiralAngles(0.3);
  assert.equal(a.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(a[i] - a[i - 1] - Math.PI / 2) < 1e-9);
});

test("volley emits 4 bullets and emit angle advances", () => {
  const g = makeGame();
  g.ships.length = 1;
  const s = g.ships[0];
  s.fireTimer = 0;
  const before = s.emitAngle;
  g._updateShips(0.016);
  assert.equal(g.bullets.filter((b) => b.active).length, 4);
  assert.ok(s.emitAngle > before);
});

test("health 0 is game over; shield blocks damage; ship damage clamps", () => {
  const g = makeGame();
  g.player.shieldUntil = g.time + 8;
  g._damage("ship", true);
  assert.equal(g.health, 100);
  g.player.shieldUntil = 0;
  g.health = 5;
  g._damage("ship", false);
  assert.equal(g.health, 0);
  assert.equal(g.state, "gameover");
});

test("ship contact: 30 once then 1 s immunity", () => {
  const g = makeGame();
  const s = g.ships[0];
  s.x = g.player.x; s.y = g.player.y;
  g._checkCollisions(0.016);
  assert.equal(g.health, 70);
  g._checkCollisions(0.016);
  assert.equal(g.health, 70);
  g.time += 1.01;
  g._checkCollisions(0.016);
  assert.equal(g.health, 40);
});

test("trail drains 1 per 0.1 s; head 8 and consumed", () => {
  const g = makeGame();
  g.ships.length = 0;
  const b = g.bullets[0];
  Object.assign(b, { active: true, ship: null, age: 1, a0: 0, sx: g.player.x - 60, sy: g.player.y, hull: 26, reach: 70 });
  const tp = { x: 0, y: 0 };
  diff.bulletPoint(b, diff.TRAIL_SPAN / 2, tp); // park the UFO on the middle of the trail, clear of the head
  g.player.x = tp.x;
  g.player.y = tp.y;
  g.player.radius = 23;
  diff.bulletPoint(b, 0, b);
  assert.ok(Math.hypot(b.x - g.player.x, b.y - g.player.y) > 23 * 0.75 + g.headRadius);
  for (let i = 0; i < 10; i++) g._checkCollisions(0.1);
  assert.ok(b.active === true);
  assert.ok(g.health <= 90);
  const g2 = makeGame();
  g2.ships.length = 0;
  const h = g2.bullets[0];
  Object.assign(h, { active: true, ship: null, age: 1, a0: 0, sx: g2.player.x, sy: g2.player.y, hull: 0, reach: 0 });
  diff.bulletPoint(h, 0, h);
  g2._checkCollisions(0.016);
  assert.equal(g2.health, 92);
  assert.equal(h.active, false);
});

test("CR9: level 1 volley interval is 3 s and never below 1.8 s", () => {
  assert.equal(diff.levelParams(1).fireInterval, 3);
  for (let n = 1; n <= 80; n++) assert.ok(diff.levelParams(n).fireInterval >= 1.8 - 1e-12);
  assert.equal(diff.levelParams(80).fireInterval, 1.8);
  assert.ok(Math.abs(diff.levelParams(2).fireInterval / 3 - 0.94) < 1e-9);
});

test("CR9: a volley is exactly 4 bullets 90 degrees apart that orbit and stay within reach", () => {
  const g = makeGame();
  g.ships.length = 1;
  const s = g.ships[0];
  s.x = g.width / 2; s.y = g.height / 2;
  s.speed = 0;
  s.fireTimer = 0;
  g._updateShips(0.016);
  const live = g.bullets.filter((b) => b.active);
  assert.equal(live.length, 4);
  const a = live.map((b) => b.a0);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(a[i] - a[i - 1] - Math.PI / 2) < 1e-9);
  const reach = Math.min(5 * s.radius, 0.3 * Math.min(g.width, g.height));
  let maxSeen = 0;
  for (let t = 0; t < 2.0; t += 0.016) {
    s.fireTimer = 99; // no second volley
    s.x += 0.4; s.y += 0.2; // the spiral rides on the moving ship
    g._updateBullets(0.016);
    for (const b of live) {
      if (!b.active) continue;
      maxSeen = Math.max(maxSeen, Math.hypot(b.x - s.x, b.y - s.y));
      assert.ok(Math.hypot(b.x - s.x, b.y - s.y) <= reach + 1e-6);
    }
  }
  assert.ok(maxSeen > s.radius * 2); // it really spirals out
  assert.ok(reach <= 5 * s.radius && reach <= 0.3 * 1080);
  // fades over the last 0.6 s and is gone by about 2.2 s
  assert.equal(diff.bulletFade(1.5), 1);
  assert.ok(diff.bulletFade(2.0) < 1 && diff.bulletFade(2.0) > 0);
  for (let t = 0; t < 0.4; t += 0.016) g._updateBullets(0.016);
  assert.equal(g.bullets.filter((b) => b.active).length, 0);
});

test("CR9: no bullet reaches the field edge from a ship at field centre", () => {
  const g = makeGame();
  g.ships.length = 1;
  const s = g.ships[0];
  s.x = g.width / 2; s.y = g.height / 2; s.speed = 0; s.fireTimer = 0;
  g._updateShips(0.016);
  for (let t = 0; t < 2.3; t += 0.016) {
    s.fireTimer = 99;
    g._updateBullets(0.016);
    for (const b of g.bullets) if (b.active) assert.ok(b.x > 100 && b.x < g.width - 100 && b.y > 100 && b.y < g.height - 100);
  }
});

test("CR10: reach is 5 radii at level 1, +0.4 per level, capped at 8 radii and 30% of the short side", () => {
  const r = 26;
  assert.equal(diff.maxReach(r, 1920, 1080, 1), 5 * r);
  assert.ok(Math.abs(diff.maxReach(r, 1920, 1080, 6) - 7 * r) < 1e-9);
  assert.equal(diff.maxReach(r, 1920, 1080, 50), 8 * r);
  assert.equal(diff.maxReach(r, 412, 915, 50), 0.3 * 412);
  assert.ok(Math.abs(diff.bulletLife(5 * r, r) - 2.2) < 1e-9);
  assert.ok(diff.bulletLife(8 * r, r) > 2.2);
});

test("CR10: ships spawn in the field, far from the UFO, apart from each other", () => {
  const g = makeGame();
  for (let n = 0; n < 40; n++) {
    g.difficulty.level = 6;
    g._beginLevel();
    for (const s of g.ships) {
      assert.ok(s.x >= s.radius && s.x <= g.width - s.radius && s.y >= s.radius && s.y <= g.height - s.radius);
      assert.ok(Math.hypot(s.x - g.player.x, s.y - g.player.y) >= 300 * g.motionScale);
    }
    for (let i = 0; i < g.ships.length; i++)
      for (let j = i + 1; j < g.ships.length; j++)
        assert.ok(Math.hypot(g.ships[i].x - g.ships[j].x, g.ships[i].y - g.ships[j].y) >= 4 * g.ships[i].radius);
  }
});

test("CR10: ships wander on their own headings, never leave the field, never home on the UFO", () => {
  const g = makeGame();
  g.difficulty.level = 3;
  g._beginLevel();
  const h0 = g.ships.map((s) => s.heading);
  assert.equal(new Set(h0).size, g.ships.length);
  for (const s of g.ships) s.fireTimer = 1e9;
  for (let t = 0; t < 60; t += 0.016) {
    g._updateShips(0.016);
    for (const s of g.ships) assert.ok(s.x >= s.radius && s.x <= g.width - s.radius && s.y >= s.radius && s.y <= g.height - s.radius);
  }
  assert.ok(g.ships.every((s, i) => s.heading !== h0[i]));
});

test("CR10: desktop cross time is 2.3 s", () => {
  const text = readFileSync(path.join(src, "game.js"), "utf8");
  assert.ok(text.includes("DESKTOP_CROSS_SECONDS = 2.3"));
  assert.ok(text.includes("p.x += vec.x * p.speed * dt * slowFactor;")); // mobile expression unchanged
});

test("CR9: per-ship fire timers start at random offsets", () => {
  const g = makeGame();
  g.controlMode = "desktop";
  g.difficulty.level = 6;
  g._beginLevel();
  const t = g.ships.map((s) => s.fireTimer);
  assert.equal(t.length, 8); // CR12: 6 roamers plus 2 chasers at level 6
  assert.ok(new Set(t).size > 1);
  for (const v of t) assert.ok(v >= diff.FIRE_WARN && v <= 3);
});

test("timed power-ups end on their timers", () => {
  const g = makeGame();
  g._applyPowerUp("shield");
  g._applyPowerUp("slow");
  g._applyPowerUp("speed");
  assert.equal(g.getActivePowerUps().length, 3);
  g.time += 6.01;
  assert.deepEqual(g.getActivePowerUps().map((p) => p.kind), ["shield"]);
  g.time += 2;
  assert.equal(g.getActivePowerUps().length, 0);
  g.health = 90;
  g._applyPowerUp("health");
  assert.equal(g.health, 100);
});

test("levels: coins stop at count, level ends only when all collected, clears field, level 2 has 2 ships", () => {
  const g = makeGame();
  for (let i = 0; i < 400; i++) {
    g._spawnLoop(1);
    if (g.coins.length >= 10) g.coins = []; // pretend collected to keep spawning
  }
  assert.equal(g.coinsSpawned, 30);
  g.coins.push({ x: 0, y: 0, radius: 9, spin: 0, bob: 0, id: 9999 });
  g.powerUps.push({ x: 0, y: 0, radius: 12, bob: 0, id: 9998, kind: "shield" });
  g.bullets[0].active = true;
  g.update(0.016);
  assert.equal(g.difficulty.level, 1); // one coin still uncollected
  assert.equal(g.phase, "play");
  g.coins = [];
  g.update(0.016);
  assert.equal(g.phase, "fade"); // CR12: 0.5 s fade, then the victory burst, then the banner
  assert.equal(g.difficulty.level, 1);
  for (let i = 0; i < 40; i++) g.update(0.02);
  assert.equal(g.phase, "victory");
  assert.equal(g.ships.length, 0);
  assert.equal(g.powerUps.length, 0);
  assert.equal(g.bullets.filter((b) => b.active).length, 0);
  assert.equal(g.banner, "LEVEL CLEARED"); // CR15b: victory phase is 2.5 s
  for (let i = 0; i < 130; i++) g.update(0.02);
  assert.equal(g.difficulty.level, 2);
  assert.equal(g.banner, "LEVEL 2");
  for (let i = 0; i < 120; i++) g.update(0.02);
  assert.equal(g.banner, null);
  assert.equal(g.ships.length, 1); // CR17a: phone ships at level 2 = ceil(2/2)
  assert.equal(g.coinsSpawned <= 60, true);
});

test("CR12: level ends 7 s after the last coin spawns, with no coin collected", () => {
  const g = makeGame();
  g.ships.length = 0;
  g.coins.push({ x: 0, y: 0, radius: 9, spin: 0, bob: 0, id: 9997 }); // never collected
  g.spawnTimers.power = 1e9;
  for (let i = 0; i < 400; i++) {
    g._spawnLoop(1);
    g.coins = g.coins.filter((c) => c.id === 9997);
  }
  assert.equal(g.coinsSpawned, 30);
  assert.equal(g.endTimer, diff.LEVEL_END_DELAY);
  assert.equal(diff.LEVEL_END_DELAY, 7);
  for (let i = 0; i < 69; i++) g.update(0.1);
  assert.equal(g.phase, "play");
  for (let i = 0; i < 3; i++) g.update(0.1);
  assert.equal(g.phase, "fade");
});

test("CR12: combo multiplier x1, x2 at 3, x3 at 6, capped x4", () => {
  assert.deepEqual([1, 2, 3, 5, 6, 8, 9, 30].map(diff.comboMultiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
  const g = makeGame();
  g.ships.length = 0;
  g.bullets.forEach((b) => (b.active = false));
  for (let i = 0; i < 3; i++) {
    g.coins.push({ x: g.player.x, y: g.player.y, radius: 9, spin: 0, bob: 0, id: 8000 + i });
    g.time += 0.1;
    g._checkCollisions(0.016);
  }
  assert.equal(g.score, 10 + 10 + 20);
  assert.equal(g.comboMultiplierNow, 2);
  g.time += 2; // gap longer than COMBO_GAP resets the chain
  assert.equal(g.comboMultiplierNow, 1);
  g.coins.push({ x: g.player.x, y: g.player.y, radius: 9, spin: 0, bob: 0, id: 8100 });
  g._checkCollisions(0.016);
  assert.equal(g.score, 50);
  assert.equal(g.comboChain, 1);
});

test("CR12: chasers join from level 3 (two from 6), keep 3 ship radii from every other ship, drift at 60% speed", () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9].map(diff.chaserCount), [0, 0, 1, 1, 2, 2]);
  const g = makeGame();
  g.controlMode = "desktop";
  g.difficulty.level = 6;
  g._beginLevel();
  const chasers = g.ships.filter((s) => s.kind === "chaser");
  const roamers = g.ships.filter((s) => s.kind === "roamer");
  assert.equal(chasers.length, 2);
  assert.equal(roamers.length, 6);
  assert.ok(Math.abs(chasers[0].speed / roamers[0].speed - 0.6) < 1e-9);
  assert.ok(Math.abs(chasers[0].radius / roamers[0].radius - 0.8) < 1e-9);
  for (const s of g.ships) s.fireTimer = 1e9;
  chasers[1].x = chasers[0].x + 1; // start them on top of each other
  chasers[1].y = chasers[0].y;
  const keep = 3 * g.shipBaseRadius;
  let minGap = Infinity;
  for (let t = 0; t < 40; t += 0.016) {
    g._updateShips(0.016);
    for (const c of chasers) for (const o of g.ships) if (o !== c) minGap = Math.min(minGap, Math.hypot(c.x - o.x, c.y - o.y));
  }
  assert.ok(minGap >= keep * 0.95, `min gap ${minGap} < ${keep}`);
});

test("CR15a: roamer is bigger than the player on desktop and mobile; player stays 23 * scale; head is 9", () => {
  for (const mode of ["mobile", "desktop"]) {
    const g = makeGame();
    g.controlMode = mode;
    g._recomputeScale();
    g._resetRun();
    g._beginLevel();
    const roamer = g.ships.find((s) => s.kind === "roamer");
    assert.ok(roamer.radius > g.player.radius, `${mode}: roamer ${roamer.radius} <= player ${g.player.radius}`);
    assert.ok(Math.abs(g.player.radius - 23 * g.entityScale) < 1e-9);
    assert.ok(Math.abs(roamer.radius - 26 * g.entityScale) < 1e-9);
  }
  assert.equal(makeGame().headRadius, 9);
});

test("CR12: boss on every 5th level fires rings of 12; no boss otherwise", () => {
  assert.deepEqual([4, 5, 6, 10].map(diff.isBossLevel), [false, true, false, true]);
  const g = makeGame();
  g.difficulty.level = 5;
  g._beginLevel();
  const boss = g.ships.find((s) => s.kind === "boss");
  assert.ok(boss);
  assert.ok(Math.abs(boss.radius / g.shipBaseRadius - 3) < 1e-9);
  for (const s of g.ships) if (s !== boss) s.fireTimer = 1e9;
  boss.fireTimer = 0;
  g._updateShips(0.016);
  assert.equal(g.bullets.filter((b) => b.active).length, 12);
  g.difficulty.level = 4;
  g._beginLevel();
  assert.ok(!g.ships.some((s) => s.kind === "boss"));
});

test("CR12: magnet pulls coins within 10 UFO radii and nothing else", () => {
  const g = makeGame();
  g.ships.length = 0;
  const r = g.player.radius;
  const near = { x: g.player.x + 3 * r, y: g.player.y, radius: 9, spin: 0, bob: 0, id: 7001 };
  const far = { x: g.player.x + 12 * r, y: g.player.y, radius: 9, spin: 0, bob: 0, id: 7002 };
  g.coins.push(near, far);
  g._updateCoins(0.1); // no magnet: no pull
  assert.equal(near.x, g.player.x + 3 * r);
  g._applyPowerUp("magnet");
  assert.ok(g.getActivePowerUps().some((p) => p.kind === "magnet" && p.duration === 8));
  g._updateCoins(0.1);
  assert.ok(near.x < g.player.x + 3 * r);
  assert.equal(far.x, g.player.x + 12 * r);
  assert.equal(diff.MAGNET_RANGE, 10);
  assert.equal(diff.MAGNET_PULL, 650);
  assert.equal(diff.BOSS_REACH_FRAC, 0.5);
});

test("CR17a: roamers per level: desktop min(level,6), phone min(ceil(level/2),4)", () => {
  const count = (mode, level) => {
    const g = makeGame();
    g.controlMode = mode;
    g.difficulty.level = level;
    g._beginLevel();
    return g.ships.filter((s) => s.kind === "roamer").length;
  };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((l) => count("mobile", l)), [1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map((l) => count("desktop", l)), [1, 2, 3, 4, 5, 6, 6, 6]);
});

test("CR17a: boss ring reaches 0.5 of the shorter side, roamer keeps the 0.3 cap", () => {
  const g = makeGame();
  g.difficulty.level = 5;
  g._beginLevel();
  const boss = g.ships.find((s) => s.kind === "boss");
  const params = diff.levelParams(5);
  for (const b of g.bullets) b.active = false;
  g._fireVolley(boss, params, 12);
  const reach = 0.5 * Math.min(g.width, g.height);
  const bossBullet = g.bullets.find((b) => b.active);
  assert.ok(Math.abs(bossBullet.life - diff.bulletLife(reach, boss.radius)) < 1e-9);
  assert.ok(diff.maxReach(boss.radius, g.width, g.height, 5) <= 0.3 * Math.min(g.width, g.height) + 1e-9);
});

test("CR17b: bullet core (b.x, b.y) equals the simulated bulletPoint at lag 0", () => {
  const b = { active: true, age: 0.7, a0: 0.4, sx: 500, sy: 300, hull: 20, reach: 180, life: 2.2 };
  const p = { x: 0, y: 0 };
  diff.bulletPoint(b, 0, b);
  diff.bulletPoint(b, 0, p);
  assert.equal(b.x, p.x);
  assert.equal(b.y, p.y);
  diff.bulletPoint(b, diff.TRAIL_SPAN * 0.25, p); // ribbon points trail behind the core
  assert.ok(Math.hypot(p.x - b.x, p.y - b.y) > 0);
});

test("CR12: near miss sparks once per 0.25 s without damage", () => {
  const g = makeGame();
  g.ships.length = 0;
  const b = g.bullets[0];
  const reach = g.player.radius * 0.75 + g.headRadius * g.entityScale;
  Object.assign(b, { active: true, ship: null, age: 0.1, a0: 0, sx: g.player.x + reach + 4, sy: g.player.y, hull: 0, reach: 0, life: 2.2 });
  diff.bulletPoint(b, 0, b);
  g.time = 10;
  g._checkCollisions(0.016);
  assert.equal(g.lastNearMiss, 10);
  assert.equal(g.health, 100);
  assert.equal(b.active, true);
  g.time = 10.1;
  g._checkCollisions(0.016);
  assert.equal(g.lastNearMiss, 10); // inside the 0.25 s gap
});

test("CR12: desktop objects scale to 0.7 and enemies pace 1.5; mobile unchanged", () => {
  assert.equal(diff.DESKTOP_ENEMY_PACE, 1.5);
  assert.equal(diff.DESKTOP_OBJECT_SCALE, 0.7);
  const g = makeGame();
  assert.equal(g.entityScale, 1);
  g.controlMode = "desktop";
  g._recomputeScale();
  assert.ok(Math.abs(g.entityScale - (0.7 * 56) / 23) < 1e-9);
  assert.equal(diff.computeDamage("trail", false) < diff.computeDamage("head", false), true);
});

console.log(JSON.stringify({ passed: results }));
