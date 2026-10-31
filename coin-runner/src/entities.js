// Gameplay entities: player, coins, Octagon ships, pooled spiral bullets, power-ups, particles.

let idCounter = 1;
const nextId = () => idCounter++;

export class Player {
  constructor(x, y) {
    this.id = nextId();
    this.x = x;
    this.y = y;
    // WP17/CR.6: bumped from 16 -> 23 (>=1.4x) so the player reads clearly on
    // both mobile (unscaled) and desktop (further scaled in game.js).
    this.radius = 23;
    this.speed = 260; // px/sec
    this.shieldUntil = 0; // timed shield: blocks all damage until this time
    this.slowUntil = 0; // slow-enemy power-up: ships, bullets, spin, trails 0.4x
    this.speedUntil = 0; // speed power-up: 1.5x UFO speed
    this.magnetUntil = 0; // magnet power-up: coins within range drift to the UFO
    this.shipImmuneUntil = 0; // 1 s of no further ship damage after a ship hit
    this.flickerUntil = 0; // UFO flicker after damage
    this.knockVx = 0;
    this.knockVy = 0;
    this.facing = 0; // radians, for a small directional flourish
    this.vx = 0;
    this.vy = 0;
  }
}

export class Coin {
  constructor(x, y) {
    this.id = nextId();
    this.x = x;
    this.y = y;
    this.radius = 9;
    this.spin = Math.random() * Math.PI * 2;
    this.bob = Math.random() * Math.PI * 2;
  }
}

/** The one enemy: an evil eight-sided Octagon ship. */
export class Ship {
  constructor(x, y) {
    this.id = nextId();
    this.x = x;
    this.y = y;
    this.radius = 26;
    this.speed = 34; // px/s drift, overwritten per level in game.js
    this.rot = Math.random() * Math.PI * 2; // visual rotation
    this.emitAngle = Math.random() * Math.PI * 2;
    this.fireTimer = 0.6 + Math.random() * 0.6; // random start offset, re-rolled per level in game.js
    this.heading = Math.random() * Math.PI * 2; // wander heading, own per ship
    this.turnRate = 0; // signed rad/s, re-rolled by game.js
    this.turnTimer = 0; // seconds until the next re-roll
    this.kind = "roamer"; // roamer | chaser | boss, set by game.js
    this.spin = ((Math.PI * 2) / (8 + Math.random() * 4)) * (Math.random() < 0.5 ? -1 : 1); // rad/s, one turn per 8-12 s
  }
}

export const MAX_BULLETS = 900;

/** Fixed pool of spiral bullets, allocated once at init. */
export function createBulletPool(size = MAX_BULLETS) {
  const pool = new Array(size);
  // Each bullet orbits its ship: ship centre (sx, sy), start angle a0, hull radius, max reach, age in seconds.
  for (let i = 0; i < size; i++) pool[i] = { active: false, x: 0, y: 0, age: 0, a0: 0, sx: 0, sy: 0, hull: 0, reach: 0, life: 2.2, ship: null };
  return pool;
}

export const POWER_KINDS = ["health", "shield", "slow", "speed", "magnet"];

export class PowerUp {
  constructor(kind, x, y) {
    this.id = nextId();
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.radius = 12;
    this.bob = Math.random() * Math.PI * 2;
  }
}

export function randomPowerKind() {
  return POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)];
}

export class Particle {
  constructor(x, y, vx, vy, color, life) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = life;
    this.maxLife = life;
  }
}

export function spawnBurst(particles, x, y, color, count = 14, { minLife = 0.35, maxLife = 0.6 } = {}) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 140;
    const life = minLife + Math.random() * (maxLife - minLife);
    particles.push(new Particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, color, life));
  }
}
