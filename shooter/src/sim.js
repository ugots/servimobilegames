// Pure game simulation. No DOM, no audio, no drawing: it emits event names into
// state.events and the glue plays them. Heading 0 points up; direction = (sin a, -cos a).
const ShooterSim = (() => {
  const TAU = 2 * Math.PI;

  function nextRand(state) {
    // mulberry32, seeded from the config seed.
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
    let t = state.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(state, lo, hi) {
    return lo + (hi - lo) * nextRand(state);
  }

  function wrap(v, max) {
    const r = v % max;
    return r < 0 ? r + max : r;
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function hit(a, ra, b, rb) {
    const r = ra + rb;
    return dist2(a, b) <= r * r;
  }

  function emit(state, name) {
    state.events.push(name);
  }

  function addScore(state, points) {
    state.score += points;
    while (state.score >= state.nextExtra) {
      state.lives += 1;
      state.nextExtra += state.cfg.extraShipEvery;
      emit(state, "extraShip");
    }
  }

  function makeShip(cfg) {
    return {
      x: cfg.fieldW * 0.5,
      y: cfg.fieldH * 0.5,
      vx: 0,
      vy: 0,
      a: 0,
      alive: true,
      thrusting: false,
      invulnerable: 0,
    };
  }

  function makeRock(state, size, x, y, speed) {
    const cfg = state.cfg;
    const dir = range(state, 0, TAU);
    const shape = [];
    for (let i = 0; i < cfg.rockVerts; i++) {
      shape.push(1 + cfg.rockJag * (nextRand(state) - 0.5) * 2);
    }
    return {
      x,
      y,
      vx: Math.sin(dir) * speed,
      vy: -Math.cos(dir) * speed,
      size,
      rot: 0,
      spin: range(state, -cfg.rockSpin, cfg.rockSpin),
      shape,
    };
  }

  function waveRockCount(cfg, wave) {
    return Math.min(cfg.waveStart + cfg.waveStep * (wave - 1), cfg.waveCap);
  }

  // Shortest signed offset on a wrapped axis, in [-max/2, max/2).
  function wrapDelta(d, max) {
    return wrap(d + max / 2, max) - max / 2;
  }

  // Position the player will occupy at a level transition: the live ship, else the respawn point.
  function protectedPoint(state) {
    const cfg = state.cfg;
    const ship = state.ship;
    if (ship.alive) return { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy };
    return { x: cfg.fieldW * 0.5, y: cfg.fieldH * 0.5, vx: 0, vy: 0 };
  }

  function spawnClearRadius(cfg) {
    return Math.max(cfg.rockSpawnClearRadius, cfg.shipRadius + cfg.rockRadii[0] + cfg.rockSpawnMargin);
  }

  // True when a rock at (x, y) with velocity (vx, vy) keeps the clear radius from the protected point for
  // the whole of one maximum-length step, on the torus (all nine wrapped images of the offset are tested).
  // The player may also accelerate during that step, so the radius grows by the worst-case thrust displacement.
  function spawnIsSafe(state, p, x, y, vx, vy) {
    const cfg = state.cfg;
    const T = cfg.maxStepDt;
    const pad = 0.5 * cfg.thrustAccel * T * T + 1;
    const R = spawnClearRadius(cfg) + pad;
    const wx = vx - p.vx;
    const wy = vy - p.vy;
    const ww = wx * wx + wy * wy;
    const dx0 = wrapDelta(x - p.x, cfg.fieldW);
    const dy0 = wrapDelta(y - p.y, cfg.fieldH);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const dx = dx0 + i * cfg.fieldW;
        const dy = dy0 + j * cfg.fieldH;
        let t = ww > 0 ? -(dx * wx + dy * wy) / ww : 0;
        t = Math.max(0, Math.min(T, t));
        const cx = dx + wx * t;
        const cy = dy + wy * t;
        if (cx * cx + cy * cy < R * R) return false;
      }
    }
    return true;
  }

  // Bounded random sampling, then a deterministic scan starting opposite the player. Returns a rock or null.
  function placeRock(state) {
    const cfg = state.cfg;
    const p = protectedPoint(state);
    const speed = () => range(state, cfg.rockSpeedMin[0], cfg.rockSpeedMax[0]);
    for (let k = 0; k < cfg.rockSpawnTries; k++) {
      const x = range(state, 0, cfg.fieldW);
      const y = range(state, 0, cfg.fieldH);
      const rock = makeRock(state, 0, x, y, speed());
      if (spawnIsSafe(state, p, x, y, rock.vx, rock.vy)) return rock;
    }
    const cols = 16;
    const rows = 12;
    for (let k = 0; k < cols * rows; k++) {
      const x = wrap(p.x + cfg.fieldW / 2 + (k % cols) * (cfg.fieldW / cols), cfg.fieldW);
      const y = wrap(p.y + cfg.fieldH / 2 + Math.floor(k / cols) * (cfg.fieldH / rows), cfg.fieldH);
      const rock = makeRock(state, 0, x, y, speed());
      if (spawnIsSafe(state, p, x, y, rock.vx, rock.vy)) return rock;
    }
    return null;
  }

  function startWave(state) {
    const cfg = state.cfg;
    state.wave += 1;
    state.waveTimer = 0;
    state.pendingRocks = 0;
    const n = waveRockCount(cfg, state.wave);
    for (let i = 0; i < n; i++) {
      const rock = placeRock(state);
      if (rock) state.rocks.push(rock);
      else state.pendingRocks += 1;
    }
    state.spawnRetry = cfg.rockSpawnRetryDelay;
    emit(state, "wave");
  }

  // Deferred rocks retry later, never with relaxed clearance.
  function retryPending(state, dt) {
    if (!state.pendingRocks) return;
    state.spawnRetry -= dt;
    if (state.spawnRetry > 0) return;
    state.spawnRetry = state.cfg.rockSpawnRetryDelay;
    const rock = placeRock(state);
    if (rock) {
      state.rocks.push(rock);
      state.pendingRocks -= 1;
    }
  }

  function create(config, seed) {
    const state = {
      cfg: config,
      rngState: (seed === undefined ? config.seed : seed) >>> 0,
      events: [],
      mode: "play",
      time: 0,
      score: 0,
      lives: config.lives,
      nextExtra: config.extraShipEvery,
      wave: 0,
      waveTimer: 0,
      ship: makeShip(config),
      respawnTimer: 0,
      rocks: [],
      pendingRocks: 0,
      spawnRetry: 0,
      bullets: [],
      saucers: [],
      saucerTimer: config.saucerFirstDelay,
      prevFire: false,
      prevHyper: false,
    };
    startWave(state);
    return state;
  }

  function heartbeatInterval(state) {
    const cfg = state.cfg;
    const frac = Math.min(state.rocks.length, cfg.heartbeatRockRef) / cfg.heartbeatRockRef;
    return cfg.heartbeatMinInterval + (cfg.heartbeatMaxInterval - cfg.heartbeatMinInterval) * frac;
  }

  function smallSaucerChance(state) {
    const cfg = state.cfg;
    const span = cfg.smallSaucerScoreFull - cfg.smallSaucerScoreStart;
    const f = (state.score - cfg.smallSaucerScoreStart) / span;
    return Math.max(0, Math.min(cfg.smallSaucerMaxChance, f));
  }

  function spawnSaucer(state) {
    const cfg = state.cfg;
    const small = nextRand(state) < smallSaucerChance(state);
    const fromLeft = nextRand(state) < 0.5;
    const saucer = {
      x: fromLeft ? 0 : cfg.fieldW,
      y: range(state, 0, cfg.fieldH),
      vx: fromLeft ? cfg.saucerSpeed : -cfg.saucerSpeed,
      vy: 0,
      small,
      r: small ? cfg.saucerRadiusSmall : cfg.saucerRadiusLarge,
      turnTimer: cfg.saucerTurnEvery,
      fireTimer: cfg.saucerFireEvery,
    };
    state.saucers.push(saucer);
    emit(state, small ? "saucerSmall" : "saucerLarge");
    return saucer;
  }

  function killShip(state) {
    const ship = state.ship;
    ship.alive = false;
    ship.thrusting = false;
    state.lives -= 1;
    state.respawnTimer = state.cfg.respawnDelay;
    emit(state, "shipExplode");
  }

  function playerBulletCount(state) {
    let n = 0;
    for (const b of state.bullets) if (b.own === "player") n += 1;
    return n;
  }

  function fireBullet(state, own, x, y, dirx, diry, speed, life) {
    state.bullets.push({ x, y, vx: dirx * speed, vy: diry * speed, life, own });
  }

  function splitRock(state, rock) {
    const cfg = state.cfg;
    addScore(state, cfg.scores[cfg.sizeNames[rock.size]]);
    emit(state, rock.size === 0 ? "explodeLarge" : rock.size === 1 ? "explodeMedium" : "explodeSmall");
    if (rock.size + 1 < cfg.rockRadii.length) {
      for (let i = 0; i < 2; i++) {
        state.rocks.push(makeRock(state, rock.size + 1, rock.x, rock.y, cfg.splitSpeeds[rock.size]));
      }
    }
  }

  function stepShip(state, input, dt) {
    const cfg = state.cfg;
    const ship = state.ship;
    ship.thrusting = false;
    if (ship.invulnerable > 0) ship.invulnerable -= dt;
    if (input.left) ship.a -= cfg.turnRate * dt;
    if (input.right) ship.a += cfg.turnRate * dt;
    if (input.thrust) {
      ship.vx += Math.sin(ship.a) * cfg.thrustAccel * dt;
      ship.vy -= Math.cos(ship.a) * cfg.thrustAccel * dt;
      ship.thrusting = true;
      emit(state, "thrust");
    }
    const keep = Math.max(0, 1 - cfg.drag * dt);
    ship.vx *= keep;
    ship.vy *= keep;
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > cfg.maxSpeed) {
      ship.vx = (ship.vx / sp) * cfg.maxSpeed;
      ship.vy = (ship.vy / sp) * cfg.maxSpeed;
    }
    ship.x = wrap(ship.x + ship.vx * dt, cfg.fieldW);
    ship.y = wrap(ship.y + ship.vy * dt, cfg.fieldH);

    if (input.fire && !state.prevFire && playerBulletCount(state) < cfg.maxBullets) {
      const dx = Math.sin(ship.a);
      const dy = -Math.cos(ship.a);
      fireBullet(state, "player", ship.x + dx * cfg.shipRadius, ship.y + dy * cfg.shipRadius, dx, dy, cfg.bulletSpeed, cfg.bulletLife);
      emit(state, "fire");
    }
    if (input.hyper && !state.prevHyper) {
      emit(state, "hyper");
      ship.x = range(state, 0, cfg.fieldW);
      ship.y = range(state, 0, cfg.fieldH);
      ship.vx = 0;
      ship.vy = 0;
      if (nextRand(state) < cfg.hyperspaceDeathChance) killShip(state);
    }
  }

  function stepRespawn(state, dt) {
    const cfg = state.cfg;
    state.respawnTimer -= dt;
    if (state.respawnTimer > 0) return;
    if (state.lives <= 0) {
      state.mode = "over";
      emit(state, "gameover");
      return;
    }
    const centre = { x: cfg.fieldW * 0.5, y: cfg.fieldH * 0.5 };
    const r = cfg.respawnClearRadius;
    for (const rock of state.rocks) if (hit(rock, cfg.rockRadii[rock.size], centre, r)) return;
    for (const s of state.saucers) if (hit(s, s.r, centre, r)) return;
    for (const b of state.bullets) if (b.own === "saucer" && hit(b, cfg.bulletRadius, centre, r)) return;
    state.ship = makeShip(cfg);
    state.ship.invulnerable = cfg.invulnerableTime;
  }

  function stepSaucers(state, dt) {
    const cfg = state.cfg;
    if (state.saucers.length === 0 && state.rocks.length > 0) {
      state.saucerTimer -= dt;
      if (state.saucerTimer <= 0) {
        spawnSaucer(state);
        state.saucerTimer = range(state, cfg.saucerIntervalMin, cfg.saucerIntervalMax);
      }
    }
    const keep = [];
    for (const s of state.saucers) {
      s.turnTimer -= dt;
      if (s.turnTimer <= 0) {
        s.turnTimer = cfg.saucerTurnEvery;
        const pick = Math.floor(nextRand(state) * 3) - 1;
        s.vy = pick * cfg.saucerSpeed;
      }
      s.x += s.vx * dt;
      s.y = wrap(s.y + s.vy * dt, cfg.fieldH);
      s.fireTimer -= dt;
      if (s.fireTimer <= 0) {
        s.fireTimer = cfg.saucerFireEvery;
        let ang;
        if (s.small && state.ship.alive) {
          const err = (cfg.smallAimErrorDeg * Math.PI) / 180;
          ang = Math.atan2(state.ship.x - s.x, -(state.ship.y - s.y)) + range(state, -err, err);
        } else {
          ang = range(state, 0, TAU);
        }
        fireBullet(state, "saucer", s.x, s.y, Math.sin(ang), -Math.cos(ang), cfg.saucerBulletSpeed, cfg.saucerBulletLife);
        emit(state, "saucerFire");
      }
      if (s.x < 0 || s.x > cfg.fieldW) continue;
      keep.push(s);
    }
    state.saucers = keep;
  }

  function stepCollisions(state) {
    const cfg = state.cfg;
    const ship = state.ship;
    const liveBullets = [];
    for (const b of state.bullets) {
      let used = false;
      if (b.own === "player") {
        for (let i = 0; i < state.rocks.length && !used; i++) {
          const rock = state.rocks[i];
          if (hit(b, cfg.bulletRadius, rock, cfg.rockRadii[rock.size])) {
            state.rocks.splice(i, 1);
            splitRock(state, rock);
            used = true;
          }
        }
        for (let i = 0; i < state.saucers.length && !used; i++) {
          const s = state.saucers[i];
          if (hit(b, cfg.bulletRadius, s, s.r)) {
            state.saucers.splice(i, 1);
            addScore(state, s.small ? cfg.scores.saucerSmall : cfg.scores.saucerLarge);
            emit(state, "explodeMedium");
            used = true;
          }
        }
      } else if (ship.alive && ship.invulnerable <= 0 && hit(b, cfg.bulletRadius, ship, cfg.shipRadius)) {
        killShip(state);
        used = true;
      }
      if (!used) liveBullets.push(b);
    }
    state.bullets = liveBullets;

    if (ship.alive && ship.invulnerable <= 0) {
      for (let i = 0; i < state.rocks.length; i++) {
        const rock = state.rocks[i];
        if (hit(ship, cfg.shipRadius, rock, cfg.rockRadii[rock.size])) {
          state.rocks.splice(i, 1);
          splitRock(state, rock);
          killShip(state);
          return;
        }
      }
      for (let i = 0; i < state.saucers.length; i++) {
        const s = state.saucers[i];
        if (hit(ship, cfg.shipRadius, s, s.r)) {
          state.saucers.splice(i, 1);
          addScore(state, s.small ? cfg.scores.saucerSmall : cfg.scores.saucerLarge);
          killShip(state);
          return;
        }
      }
    }
  }

  function step(state, input, dt) {
    const cfg = state.cfg;
    state.events.length = 0;
    if (state.mode !== "play") return;
    // Stale elapsed time (tab stall, long frame) must never become one oversized update.
    dt = Math.max(0, Math.min(dt, cfg.maxStepDt));
    state.time += dt;

    if (state.ship.alive) stepShip(state, input, dt);
    else stepRespawn(state, dt);
    state.prevFire = !!input.fire;
    state.prevHyper = !!input.hyper;

    for (const rock of state.rocks) {
      rock.x = wrap(rock.x + rock.vx * dt, cfg.fieldW);
      rock.y = wrap(rock.y + rock.vy * dt, cfg.fieldH);
      rock.rot += rock.spin * dt;
    }
    const alive = [];
    for (const b of state.bullets) {
      b.x = wrap(b.x + b.vx * dt, cfg.fieldW);
      b.y = wrap(b.y + b.vy * dt, cfg.fieldH);
      b.life -= dt;
      if (b.life > 0) alive.push(b);
    }
    state.bullets = alive;

    stepSaucers(state, dt);
    stepCollisions(state);

    retryPending(state, dt);
    if (state.rocks.length === 0 && state.saucers.length === 0 && state.pendingRocks === 0 && state.mode === "play") {
      state.waveTimer += dt;
      if (state.waveTimer >= cfg.waveDelay) startWave(state);
    }
  }

  return { create, step, startWave, heartbeatInterval, spawnSaucer, smallSaucerChance, waveRockCount, spawnIsSafe, placeRock, protectedPoint, spawnClearRadius };
})();
