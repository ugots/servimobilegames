import { Player, Coin, Ship, PowerUp, randomPowerKind, spawnBurst, createBulletPool } from "./entities.js";
import {
  DifficultyManager,
  HEALTH_MAX,
  HEALTH_PICKUP,
  TRAIL_TICK,
  SHIP_IMMUNITY,
  levelParams,
  spiralAngles,
  maxReach,
  bulletLife,
  bulletPoint,
  FIRE_WARN,
  TRAIL_SPAN,
  computeDamage,
  applyDamage,
  applyHeal,
  timedActive,
  DESKTOP_OBJECT_SCALE,
  LEVEL_END_DELAY,
  FADE_SECONDS,
  VICTORY_SECONDS,
  comboMultiplier,
  isBossLevel,
  chaserCount,
  bossInterval,
  CHASER_SCALE,
  CHASER_SPEED,
  CHASER_KEEP,
  BOSS_SCALE,
  BOSS_SPEED,
  BOSS_RING,
  BOSS_REACH_FRAC,
  MAGNET_RANGE,
  MAGNET_PULL,
  NEAR_MISS_RADII,
  NEAR_MISS_GAP,
} from "./difficulty.js";

const POWER_DURATION = { shield: 8, slow: 6, speed: 6, magnet: 8 };
const POWER_COLORS = { health: "#b28cff", shield: "#8fd0ff", slow: "#35b8c8", speed: "#ffb02e", magnet: "#ff7ad9" };
const POWER_LABELS = { shield: "Shield", slow: "Slow Enemy", speed: "Speed", magnet: "Magnet" };
const POWER_FIELDS = [["shield", "shieldUntil"], ["slow", "slowUntil"], ["speed", "speedUntil"], ["magnet", "magnetUntil"]];
const DESKTOP_CROSS_SPEED = 1920 / 2.3; // desktop UFO px/s at 1920 wide; scales the mobile magnet pull
const SMALL_SHAKE_MS = 150; // victory explosion and boss ring
const POWER_GAP = 12; // about one pickup per 12 s during a level
const MAX_PICKUPS = 2;
const BANNER_SECONDS = 1.5;
const POP_SECONDS = 1.2;
const SLOW_FACTOR = 0.4; // ships, bullets, spin and trails while slow-enemy runs
const SPEED_FACTOR = 1.5;
const COMBO_GAP = 0.7; // seconds; a coin pickup after this long resets the chime pitch
const PLAYER_BASE_RADIUS = 23; // must match Player.radius in entities.js (WP17/CR.6)
const DESKTOP_CROSS_SECONDS = 2.3; // desktop UFO crosses the field width in about 2.3 s

export class Game {
  constructor({ canvas, audio, input, onStateChange, onHudUpdate }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.audio = audio;
    this.input = input;
    this.onStateChange = onStateChange;
    this.onHudUpdate = onHudUpdate;

    this.width = 0;
    this.height = 0;
    this.state = "menu"; // menu | howto | countdown | playing | paused | gameover | thanks
    this.difficulty = new DifficultyManager();

    // Timed screen shake (WP5 juice parameters).
    this.shakeAmplitude = 0;
    this.shakeDuration = 0;
    this.shakeElapsed = 0;
    // Hit-stop: brief full freeze of gameplay logic on impact (WP5).
    this.hitStop = 0;
    this.time = 0;

    // Entity sizing is per composition, not shared: mobile keeps its authored
    // Pixel-9-tuned scale (1x); desktop derives a larger scale from the live
    // viewport. See _computeEntityScale.
    this.controlMode = "desktop";
    this.entityScale = 1;
    this.motionScale = 1;

    this.bullets = createBulletPool(); // allocated once, reused for the whole session
    this.headRadius = 9;

    this._resetRun();
  }

  setControlMode(mode) {
    this.controlMode = mode;
    if (this.width) this._recomputeScale();
  }

  _computeEntityScale() {
    if (this.controlMode !== "desktop") return 1; // mobile: unchanged, Pixel-9-tuned
    const shortSide = Math.min(this.width, this.height);
    // 4.4% of short side, clamp 56-80 (P5, 2026-09-25)
    const targetPlayerRadius = clamp(shortSide * 0.044, 56, 80);
    return (DESKTOP_OBJECT_SCALE * targetPlayerRadius) / PLAYER_BASE_RADIUS; // CR12: desktop objects shrink
  }

  /** Old (pre-P5) entity scale, kept so speed does not change with the P5 visual size bump. */
  _computeMotionScale() {
    if (this.controlMode !== "desktop") return 1; // mobile: unchanged
    const shortSide = Math.min(this.width, this.height);
    const targetPlayerRadius = clamp(shortSide * 0.022, 28, 40);
    return targetPlayerRadius / PLAYER_BASE_RADIUS;
  }

  _recomputeScale() {
    this.entityScale = this._computeEntityScale();
    this.motionScale = this._computeMotionScale();
  }

  /** Applies the current composition's entity scale to a freshly spawned entity. */
  _applyScale(entity) {
    const s = this.entityScale;
    const m = this.motionScale;
    entity.radius *= s;
    if (entity.speed !== undefined) entity.speed *= m;
    return entity;
  }

  _resetRun() {
    this.player = this._applyScale(new Player(this.width / 2, this.height / 2));
    this.coins = [];
    this.ships = [];
    this.powerUps = [];
    this.particles = [];
    for (const b of this.bullets) b.active = false;
    this.score = 0;
    this.health = HEALTH_MAX;
    this.difficulty.reset();
    this.shakeAmplitude = 0;
    this.shakeElapsed = 0;
    this.shakeDuration = 0;
    this.hitStop = 0;
    this.comboCount = 0; // pitch step, capped at 8
    this.comboChain = 0; // quick pickups in a row, drives the score multiplier
    this.lastCoinTime = -999;
    this.lastNearMiss = -999;
    this.fadeAlpha = 1;
    this.endTimer = null;
    this.lastHitSound = -999;
    this.trailAcc = 0;
    this.popText = "";
    this.popUntil = 0;
    this.banner = null;
    this.bannerT = 0;
    this._beginLevel();
  }

  /** Starts the coin set of the current level and brings in its ships. */
  _beginLevel() {
    const params = this.difficulty.params;
    this.phase = "play"; // play | fade | victory | banner
    this.banner = null;
    this.fadeAlpha = 1;
    this.endTimer = null; // starts when the last coin of the level spawns
    this.coinsSpawned = 0;
    this.spawnTimers = { coin: 0, power: POWER_GAP };
    this.ships.length = 0;
    this.shipBaseRadius = this._applyScale(new Ship(0, 0)).radius;
    const roamerCount = this.controlMode === "mobile" ? Math.min(Math.ceil(params.level / 2), 4) : params.ships;
    const kinds = Array.from({ length: roamerCount }, () => "roamer");
    for (let i = chaserCount(params.level); i > 0; i--) kinds.push("chaser");
    if (isBossLevel(params.level)) kinds.push("boss");
    for (const kind of kinds) {
      const ship = this._applyScale(new Ship(0, 0));
      ship.kind = kind;
      [ship.x, ship.y] = this._randomShipPoint(ship.radius, kind === "boss" ? BOSS_SCALE : 1);
      ship.speed = params.shipSpeed * this.motionScale;
      if (kind === "chaser") {
        ship.radius *= CHASER_SCALE;
        ship.speed *= CHASER_SPEED;
      } else if (kind === "boss") {
        ship.radius *= BOSS_SCALE;
        ship.speed *= BOSS_SPEED;
      }
      ship.fireTimer =
        kind === "boss" ? 1.5 : FIRE_WARN + Math.random() * (params.fireInterval - FIRE_WARN); // random per-ship start offset
      this.ships.push(ship);
    }
  }

  /** The level timer ran out or every coin is collected: fade what is left, then the victory burst, then the banner. */
  _endLevel() {
    this.phase = "fade";
    this.phaseT = FADE_SECONDS;
    this.fadeAlpha = 1;
    this.trailAcc = 0;
  }

  _startVictory() {
    this.coins.length = 0;
    this.ships.length = 0;
    this.powerUps.length = 0;
    for (const b of this.bullets) b.active = false;
    this.fadeAlpha = 1; // the lists are empty now
    this.phase = "victory";
    this.phaseT = VICTORY_SECONDS;
    this.banner = "LEVEL CLEARED";
    this.audio.victory();
    this._triggerShake(5, SMALL_SHAKE_MS);
    if (this.scene3d) {
      this.scene3d.spawnVictory(this.width / 2, this.height / 2);
      this.scene3d.shakeCamera(SMALL_SHAKE_MS);
    }
  }

  _startBanner() {
    this.difficulty.level += 1;
    this.phase = "banner";
    this.bannerT = BANNER_SECONDS;
    this.banner = `LEVEL ${this.difficulty.level}`;
    if (this.scene3d) this.scene3d.flashLevelUp();
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * (window.devicePixelRatio || 1));
    this.canvas.height = Math.round(height * (window.devicePixelRatio || 1));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    this._recomputeScale();
    if (this.player) {
      this.player.x = Math.min(this.player.x, width - 20);
      this.player.y = Math.min(this.player.y, height - 20);
    }
  }

  setState(state) {
    this.state = state;
    if (this.onStateChange) this.onStateChange(state);
  }

  startRun() {
    this._resetRun();
    this.time = 0;
    this.player.x = this.width / 2;
    this.player.y = this.height / 2;
    this.setState("playing");
    this._emitHud();
  }

  /** Centers the player on the field without resetting run state (WP G3.2). */
  centerPlayer() {
    if (!this.player || !this.width || !this.height) return;
    this.player.x = this.width / 2;
    this.player.y = this.height / 2;
  }

  pause() {
    if (this.state === "playing") this.setState("paused");
  }

  resume() {
    if (this.state === "paused") this.setState("playing");
  }

  _emitHud() {
    if (!this.onHudUpdate) return;
    this.onHudUpdate({
      score: this.score,
      level: this.difficulty.displayLevel,
      health: this.health,
      powers: this.getActivePowerUps(),
      banner: this.banner,
      combo: this.comboMultiplierNow,
      pop: this.time < this.popUntil ? this.popText : "",
    });
  }

  /** Live score multiplier: above x1 only while the chain is still inside the quick-pickup gap. */
  get comboMultiplierNow() {
    return this.time - this.lastCoinTime <= COMBO_GAP ? comboMultiplier(this.comboChain) : 1;
  }

  update(dt) {
    if (this.state === "playing") this.time += dt;
    if (this.shakeElapsed < this.shakeDuration) this.shakeElapsed += dt;
    this._updateParticles(dt);

    if (this.state !== "playing") return;

    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      return; // full freeze of gameplay logic for the hit-stop window
    }

    this._movePlayer(dt);
    if (this.phase === "banner") {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this._beginLevel();
    } else if (this.phase === "fade") {
      this.phaseT -= dt;
      this.fadeAlpha = Math.max(0, this.phaseT / FADE_SECONDS);
      if (this.phaseT <= 0) this._startVictory();
    } else if (this.phase === "victory") {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this._startBanner();
    } else {
      if (this.endTimer !== null) this.endTimer -= dt;
      this._spawnLoop(dt);
      this._updateCoins(dt);
      this._updateShips(dt);
      this._updateBullets(dt);
      this._updatePowerUps(dt);
      this._checkExpirations();
      this._checkCollisions(dt);
      const params = this.difficulty.params;
      // Hidden timer: LEVEL_END_DELAY after the last coin spawns, or earlier when every coin is collected.
      const allSpawned = this.coinsSpawned >= params.coins;
      if (this.state === "playing" && allSpawned && (this.coins.length === 0 || (this.endTimer !== null && this.endTimer <= 0))) this._endLevel();
    }
    this._emitHud();
  }

  /** Timed screen shake, amplitude decaying linearly to zero (WP5 juice parameters). */
  _triggerShake(desktopAmplitude, durationMs) {
    const mobileFactor = this.controlMode === "mobile" ? 0.5 : 1;
    this.shakeAmplitude = desktopAmplitude * mobileFactor;
    this.shakeDuration = durationMs / 1000;
    this.shakeElapsed = 0;
  }

  _currentShakeMagnitude() {
    if (this.shakeElapsed >= this.shakeDuration || this.shakeDuration <= 0) return 0;
    const t = this.shakeElapsed / this.shakeDuration;
    return this.shakeAmplitude * (1 - t);
  }

  _enemySlow() {
    return timedActive(this.player.slowUntil, this.time) ? SLOW_FACTOR : 1;
  }

  _movePlayer(dt) {
    const p = this.player;
    const px = p.x;
    const py = p.y;
    const vec = this.input.getVector(p.x, p.y);
    // Speed power-up multiplies the UFO's own speed; 1 when it is not running.
    const slowFactor = timedActive(p.speedUntil, this.time) ? SPEED_FACTOR : 1;
    // Desktop only: the UFO crosses the field width in about 2 s. Mobile keeps the original expression.
    if (this.controlMode === "desktop") {
      const deskSpeed = this.width / DESKTOP_CROSS_SECONDS;
      p.x += vec.x * deskSpeed * dt * slowFactor;
      p.y += vec.y * deskSpeed * dt * slowFactor;
    } else {
      p.x += vec.x * p.speed * dt * slowFactor;
      p.y += vec.y * p.speed * dt * slowFactor;
    }
    // Ship-contact knockback decays quickly.
    p.x += p.knockVx * dt;
    p.y += p.knockVy * dt;
    const decay = Math.max(0, 1 - 6 * dt);
    p.knockVx *= decay;
    p.knockVy *= decay;
    p.x = Math.max(p.radius, Math.min(this.width - p.radius, p.x));
    p.y = Math.max(p.radius, Math.min(this.height - p.radius, p.y));
    if (vec.x !== 0 || vec.y !== 0) p.facing = Math.atan2(vec.y, vec.x);
    p.vx = dt > 0 ? (p.x - px) / dt : 0;
    p.vy = dt > 0 ? (p.y - py) / dt : 0;
  }

  _spawnLoop(dt) {
    const params = this.difficulty.params;
    this.spawnTimers.coin -= dt;
    this.spawnTimers.power -= dt;

    if (this.spawnTimers.coin <= 0 && this.coinsSpawned < params.coins && this.coins.length < params.liveCoinCap) {
      this.coins.push(this._applyScale(new Coin(...this._randomPoint(30))));
      this.coinsSpawned += 1;
      if (this.coinsSpawned >= params.coins) this.endTimer = LEVEL_END_DELAY;
      this.spawnTimers.coin = this.difficulty.spawnIntervalCoin;
    }
    if (this.spawnTimers.power <= 0 && this.powerUps.length < MAX_PICKUPS) {
      this.powerUps.push(this._applyScale(new PowerUp(randomPowerKind(), ...this._randomPoint(30))));
      this.spawnTimers.power = POWER_GAP;
    }
  }

  _randomPoint(margin) {
    return [margin + Math.random() * (this.width - margin * 2), margin + Math.random() * (this.height - margin * 2)];
  }

  /** Anywhere in the field, 300 motion px from the UFO and 2 ship diameters from other ships; retried. */
  _randomShipPoint(radius, mult = 1) {
    const minDist = 300 * this.motionScale;
    const minGap = 4 * radius * mult;
    const m = radius * mult;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 60; i++) {
      const pt = this._randomPoint(m);
      const dPlayer = Math.hypot(pt[0] - this.player.x, pt[1] - this.player.y);
      let dShip = Infinity;
      for (const s of this.ships) dShip = Math.min(dShip, Math.hypot(pt[0] - s.x, pt[1] - s.y));
      if (dPlayer >= minDist && dShip >= minGap) return pt;
      const score = Math.min(dPlayer - minDist, dShip - minGap); // fallback: least-violating candidate
      if (score > bestScore) {
        bestScore = score;
        best = pt;
      }
    }
    return best;
  }

  _updateCoins(dt) {
    const p = this.player;
    const magnet = timedActive(p.magnetUntil, this.time);
    const range = MAGNET_RANGE * p.radius;
    const pull = this.controlMode === "desktop" ? MAGNET_PULL : MAGNET_PULL * (p.speed / DESKTOP_CROSS_SPEED);
    for (const c of this.coins) {
      c.spin += dt * 4;
      c.bob += dt * 3;
      if (magnet) {
        const d = dist(p, c);
        if (d < range && d > 0) {
          const step = Math.min(d, pull * dt);
          c.x += ((p.x - c.x) / d) * step;
          c.y += ((p.y - c.y) / d) * step;
        }
      }
    }
  }

  /** Ships drift slowly toward the UFO, spin slowly, and fire 4-bullet spiral volleys. */
  _updateShips(dt) {
    const slow = this._enemySlow();
    const params = this.difficulty.params;
    const pace = this.difficulty.enemySpeedMul;
    for (const s of this.ships) {
      s.rot += s.spin * slow * dt;
      if (s.kind === "chaser") {
        this._chaseShip(s, dt * slow, pace);
      } else {
        this._wanderShip(s, dt * slow);
        const step = s.speed * pace * slow * dt;
        s.x += Math.cos(s.heading) * step;
        s.y += Math.sin(s.heading) * step;
        s.x = clamp(s.x, s.radius, this.width - s.radius);
        s.y = clamp(s.y, s.radius, this.height - s.radius);
      }
      s.fireTimer -= dt * slow;
      if (s.fireTimer <= 0) {
        if (s.kind === "boss") {
          s.fireTimer += bossInterval(params.level);
          this._fireVolley(s, params, BOSS_RING);
          s.emitAngle += 0.26;
          this._triggerShake(4, SMALL_SHAKE_MS);
          if (this.scene3d) this.scene3d.shakeCamera(SMALL_SHAKE_MS);
        } else {
          s.fireTimer += params.fireInterval;
          this._fireVolley(s, params);
          s.emitAngle += params.spin * params.fireInterval; // emit angle advances every volley
        }
      }
    }
  }

  /** Chaser: drifts toward the UFO at 60% of the roamer speed and steers away from every other ship so chasers never bunch. */
  _chaseShip(s, dt, pace) {
    const p = this.player;
    const base = this.shipBaseRadius || s.radius;
    let dx = p.x - s.x;
    let dy = p.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    for (const o of this.ships) {
      if (o === s) continue;
      const ox = s.x - o.x;
      const oy = s.y - o.y;
      const od = Math.hypot(ox, oy) || 1e-3;
      const zone = Math.max(CHASER_KEEP * base, s.radius + o.radius) * 1.6;
      if (od < zone) {
        const w = (zone - od) / zone;
        dx += (ox / od) * w * 3;
        dy += (oy / od) * w * 3;
      }
    }
    const len = Math.hypot(dx, dy) || 1;
    s.heading = Math.atan2(dy, dx);
    const step = s.speed * pace * dt;
    s.x += (dx / len) * step;
    s.y += (dy / len) * step;
    s.x = clamp(s.x, s.radius, this.width - s.radius);
    s.y = clamp(s.y, s.radius, this.height - s.radius);
    // Hard floor on the gap: never closer than 3 ship radii (or touching a boss).
    // A few passes, so resolving one neighbour cannot leave the chaser inside another.
    for (let pass = 0; pass < 4; pass++) {
      let pushed = false;
      for (const o of this.ships) {
        if (o === s) continue;
        const keep = Math.max(CHASER_KEEP * base, s.radius + o.radius);
        const ox = s.x - o.x;
        const oy = s.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od < keep - 1e-6) {
          const nx = od > 1e-6 ? ox / od : 1;
          const ny = od > 1e-6 ? oy / od : 0;
          s.x = o.x + nx * keep;
          s.y = o.y + ny * keep;
          pushed = true;
        }
      }
      s.x = clamp(s.x, s.radius, this.width - s.radius);
      s.y = clamp(s.y, s.radius, this.height - s.radius);
      if (!pushed) break;
    }
  }

  /** Per-ship wander: own heading and turn rate (0.3-0.6 rad/s, re-rolled every 1.5-3 s); turns back from edges over about 1 s. */
  _wanderShip(s, dt) {
    s.turnTimer -= dt;
    if (s.turnTimer <= 0) {
      s.turnTimer = 1.5 + Math.random() * 1.5;
      s.turnRate = (0.3 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1);
    }
    const zone = s.radius * 2 + s.speed * this.motionScale; // about 1 s of travel plus a hull
    const nearEdge = s.x < zone || s.y < zone || s.x > this.width - zone || s.y > this.height - zone;
    if (nearEdge) {
      // Steer toward the field centre at up to pi rad/s: a half turn takes about 1 s, no bounce, no stop.
      const want = Math.atan2(this.height / 2 - s.y, this.width / 2 - s.x);
      const diff = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading));
      const maxTurn = Math.PI * dt;
      s.heading += clamp(diff, -maxTurn, maxTurn);
    } else {
      s.heading += s.turnRate * dt;
    }
  }

  /** `count` 4 is the spiral volley; the boss passes 12 for an even ring. */
  _fireVolley(ship, params, count = 4) {
    const angles =
      count === 4 ? spiralAngles(ship.emitAngle) : Array.from({ length: count }, (_, k) => ship.emitAngle + (k * Math.PI * 2) / count);
    const reach =
      ship.kind === "boss"
        ? BOSS_REACH_FRAC * Math.min(this.width, this.height)
        : maxReach(ship.radius, this.width, this.height, params.level);
    const life = bulletLife(reach, ship.radius);
    for (let k = 0; k < count; k++) {
      const b = this._freeBullet();
      if (!b) return;
      b.active = true;
      b.ship = ship;
      b.age = 0;
      b.a0 = angles[k];
      b.sx = ship.x;
      b.sy = ship.y;
      b.hull = ship.radius;
      b.reach = reach;
      b.life = life;
      b.x = ship.x + Math.cos(angles[k]) * ship.radius;
      b.y = ship.y + Math.sin(angles[k]) * ship.radius;
    }
  }

  _freeBullet() {
    const pool = this.bullets;
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
    return null;
  }

  _updateBullets(dt) {
    const slow = this._enemySlow();
    const pool = this.bullets;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (!b.active) continue;
      b.age += dt * slow; // slowed with everything else
      if (b.age >= b.life) {
        b.active = false;
        b.ship = null;
        continue;
      }
      // The spiral rides on its ship's current centre.
      if (b.ship) {
        b.sx = b.ship.x;
        b.sy = b.ship.y;
      }
      bulletPoint(b, 0, b);
    }
  }

  _updatePowerUps(dt) {
    for (const pu of this.powerUps) pu.bob += dt * 3;
  }

  _updateParticles(dt) {
    for (const part of this.particles) {
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.vx *= 0.92;
      part.vy *= 0.92;
      part.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  _checkExpirations() {
    const p = this.player;
    for (const [kind, field] of POWER_FIELDS) {
      const ended = `_${kind}Ended`;
      if (p[field] > 0 && this.time >= p[field] && !p[ended]) {
        p[ended] = true;
        this.audio.powerUpEnd();
      }
    }
  }

  _checkCollisions(dt) {
    const p = this.player;
    const now = this.time;
    const shielded = timedActive(p.shieldUntil, now);

    // Coins
    this.coins = this.coins.filter((c) => {
      const hit = dist(p, c) < p.radius + c.radius;
      if (hit) {
        if (this.time - this.lastCoinTime > COMBO_GAP) {
          this.comboCount = 0;
          this.comboChain = 0;
        }
        this.comboCount = Math.min(this.comboCount + 1, 8);
        this.comboChain += 1;
        this.score += 10 * comboMultiplier(this.comboChain);
        this.lastCoinTime = this.time;
        this.audio.coin(this.comboCount);
        spawnBurst(this.particles, c.x, c.y, "#f4c542", 8, { minLife: 0.15, maxLife: 0.3 });
        if (this.scene3d) this.scene3d.spawnCoinBurst(c.x, c.y);
      }
      return !hit;
    });

    // Power-ups
    this.powerUps = this.powerUps.filter((pu) => {
      const hit = dist(p, pu) < p.radius + pu.radius;
      if (hit) {
        this._applyPowerUp(pu.kind);
        this.audio.superCoin();
        spawnBurst(this.particles, pu.x, pu.y, POWER_COLORS[pu.kind], 16);
        if (this.scene3d) this.scene3d.spawnBurst3D(pu.x, pu.y, pu.kind, 32);
      }
      return !hit;
    });

    // Bullets: head hit (8, bullet consumed) and trail contact (1 per 0.1 s).
    const headReach = p.radius * 0.75 + this.headRadius * this.entityScale;
    const trailReach = p.radius * 0.6 + 3 * this.entityScale;
    let touchingTrail = false;
    const pool = this.bullets;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (!b.active) continue;
      const headDist = Math.hypot(p.x - b.x, p.y - b.y);
      if (headDist < headReach) {
        b.active = false;
        this._damage("head", shielded);
        continue;
      }
      // Near miss: a bullet passing just outside the head reach gives a tiny spark and a tick; no score, no damage change.
      if (headDist < headReach + NEAR_MISS_RADII * this.headRadius * this.entityScale && now - this.lastNearMiss >= NEAR_MISS_GAP) {
        this.lastNearMiss = now;
        this.audio.tick();
        if (this.scene3d) this.scene3d.spawnNearMiss(b.x, b.y);
      }
      if (!touchingTrail) {
        if (b.age > 0) {
          // The trail follows the bullet's spiral: test head -> mid -> tail as two segments.
          bulletPoint(b, TRAIL_SPAN / 2, TRAIL_MID);
          bulletPoint(b, TRAIL_SPAN, TRAIL_END);
          if (
            segDist(p.x, p.y, b.x, b.y, TRAIL_MID.x, TRAIL_MID.y) < trailReach ||
            segDist(p.x, p.y, TRAIL_MID.x, TRAIL_MID.y, TRAIL_END.x, TRAIL_END.y) < trailReach
          ) {
            touchingTrail = true;
          }
        }
      }
    }
    if (touchingTrail) {
      this.trailAcc += dt;
      while (this.trailAcc >= TRAIL_TICK && this.state === "playing") {
        this.trailAcc -= TRAIL_TICK;
        this._damage("trail", shielded);
      }
    } else {
      this.trailAcc = 0;
    }

    // Ships: 30 once, then 1 s of ship-damage immunity and a knockback.
    if (this.state === "playing" && now >= p.shipImmuneUntil) {
      for (const s of this.ships) {
        if (dist(p, s) < p.radius + s.radius * 0.9) {
          p.shipImmuneUntil = now + SHIP_IMMUNITY;
          const d = dist(p, s) || 1;
          const kick = 520 * this.motionScale;
          p.knockVx = ((p.x - s.x) / d) * kick;
          p.knockVy = ((p.y - s.y) / d) * kick;
          this._damage("ship", shielded);
          break;
        }
      }
    }
  }

  _damage(kind, shielded) {
    const p = this.player;
    const amount = computeDamage(kind, shielded);
    if (amount <= 0) {
      if (kind !== "trail" && this.time - this.lastHitSound > 0.25) {
        this.lastHitSound = this.time;
        this.audio.deflect(); // absorbed by the shield
      }
      return;
    }
    this.health = applyDamage(this.health, amount);
    p.flickerUntil = this.time + (kind === "ship" ? 0.8 : 0.3);
    if (kind === "trail") {
      if (this.time - this.lastHitSound > 0.3) {
        this.lastHitSound = this.time;
        this.audio.crackle();
      }
    } else {
      this.lastHitSound = this.time;
      if (kind === "ship") this.audio.explosionBig();
      else this.audio.explosionSmall();
      this._triggerShake(kind === "ship" ? 9 : 5, kind === "ship" ? 200 : 120);
      this.hitStop = kind === "ship" ? 0.055 : 0.03;
      spawnBurst(this.particles, p.x, p.y, "#ff9d2e", kind === "ship" ? 18 : 10, { minLife: 0.3, maxLife: 0.5 });
      if (this.scene3d) {
        this.scene3d.spawnBurst3D(p.x, p.y, "hit", kind === "ship" ? 48 : 24);
        this.scene3d.flashHit();
        this.scene3d.shakeCamera();
      }
    }
    if (this.health <= 0) this._endRun();
  }

  _applyPowerUp(kind) {
    const p = this.player;
    if (kind === "health") {
      this.health = applyHeal(this.health, HEALTH_PICKUP);
      this.popText = `+${HEALTH_PICKUP}`;
      this.popUntil = this.time + POP_SECONDS;
    } else if (kind === "shield") {
      p.shieldUntil = this.time + POWER_DURATION.shield;
      p._shieldEnded = false;
    } else if (kind === "slow") {
      p.slowUntil = this.time + POWER_DURATION.slow;
      p._slowEnded = false;
    } else if (kind === "speed") {
      p.speedUntil = this.time + POWER_DURATION.speed;
      p._speedEnded = false;
    } else if (kind === "magnet") {
      p.magnetUntil = this.time + POWER_DURATION.magnet;
      p._magnetEnded = false;
    }
  }

  getActivePowerUps() {
    const p = this.player;
    const powers = [];
    for (const [kind, field] of POWER_FIELDS) {
      if (p[field] > this.time) {
        powers.push({ kind, label: POWER_LABELS[kind], color: POWER_COLORS[kind], remaining: Math.max(0, p[field] - this.time), duration: POWER_DURATION[kind] });
      }
    }
    return powers;
  }

  _endRun() {
    this.audio.gameOver();
    const best = Number(localStorage.getItem("coinRunnerBest") || 0);
    const isNew = this.score > best;
    if (isNew) localStorage.setItem("coinRunnerBest", String(this.score));
    this.lastResult = { score: this.score, best: Math.max(best, this.score), isNew };
    this.setState("gameover");
  }

  /** 3D path (default; ?render=2d falls back to render()). */
  render3d(s) {
    this.scene3d = s;
    s.sync(this);
  }

  /** 2D fallback (?render=2d): plain shapes, no 3D. */
  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    const shakeMag = this._currentShakeMagnitude();
    if (shakeMag > 0) ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    ctx.fillStyle = "#070a1c";
    ctx.fillRect(0, 0, w, h);
    if (this.state === "playing" || this.state === "paused" || this.state === "countdown" || this.state === "gameover") {
      this._drawEntities(ctx);
    }
    ctx.restore();
  }

  _drawEntities(ctx) {
    ctx.fillStyle = "#f4c542";
    for (const c of this.coins) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pu of this.powerUps) {
      ctx.fillStyle = POWER_COLORS[pu.kind];
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of this.ships) {
      ctx.fillStyle = "#0b0b10";
      ctx.strokeStyle = "#ff3a2a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = s.rot + (i * Math.PI) / 4;
        ctx.lineTo(s.x + Math.cos(a) * s.radius, s.y + Math.sin(a) * s.radius);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffb02e";
    ctx.lineWidth = 3;
    for (const b of this.bullets) {
      if (!b.active) continue;
      bulletPoint(b, TRAIL_SPAN, TRAIL_END);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(TRAIL_END.x, TRAIL_END.y);
      ctx.stroke();
    }
    const p = this.player;
    ctx.fillStyle = "#cfd6e4";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.radius, p.radius * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const part of this.particles) {
      ctx.globalAlpha = Math.max(0, part.life / part.maxLife);
      ctx.fillStyle = part.color;
      ctx.beginPath();
      ctx.arc(part.x, part.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const TRAIL_MID = { x: 0, y: 0 };
const TRAIL_END = { x: 0, y: 0 };

/** Distance from point (px,py) to the segment (ax,ay)-(bx,by). */
function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
