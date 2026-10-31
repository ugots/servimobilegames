// Level table and pure damage rules for Coin Runner (CR8).
//
// A level is a coin set. Level N: coins = min(30 + 5(N-1), 60), ships =
// min(N, 6); fire rate, bullet speed and spin rise ~8% per level. Everything
// here is pure so the rules can be unit tested without a DOM.
//
// Damage order must hold: trail (per 0.1 s tick) < bullet head < ship contact.

export const HEALTH_MAX = 100;
export const MAX_SHIPS = 6;
export const MAX_LEVEL_COINS = 60;
export const LEVEL_GROWTH = 1.08;
// CR9 volleys: each of the 4 bullets orbits its ship's current centre, spiralling out from the
// hull to a short maximum reach, then fades and deactivates.
export const VOLLEY_INTERVAL_L1 = 3; // seconds between volleys at level 1
export const VOLLEY_INTERVAL_MIN = 1.8;
export const VOLLEY_SHORTEN = 0.94; // about 6% shorter per level
export const BULLET_LIFE = 2.2; // seconds until the bullet deactivates
export const BULLET_FADE = 0.6; // head and trail fade/shrink over the last 0.6 s
export const BULLET_TURNS = 1.25; // spiral turns over the lifetime
export const TRAIL_TURNS = 1 / 3; // trail length, in turns of the spiral
export const REACH_RADII = 5; // reach at level 1, in ship radii
export const REACH_PER_LEVEL = 0.4; // extra radii of reach per level
export const REACH_RADII_MAX = 8; // reach cap in ship radii
export const REACH_FIELD_FRAC = 0.3; // and at most this fraction of the field's shorter side
export const FIRE_WARN = 0.4; // ship core brightens this long before each volley

export const DAMAGE = {
  trail: 1, // per TRAIL_TICK seconds of contact
  head: 8, // bullet head, bullet is consumed
  ship: 30, // ship contact
};
export const TRAIL_TICK = 0.1;
export const SHIP_IMMUNITY = 1; // seconds of no further ship damage after a ship hit
export const HEALTH_PICKUP = 30;

// Desktop-only pace boosts (mobile values stay untouched, see game.js).
export const DESKTOP_ENEMY_PACE = 1.5; // CR12: was 1.25; ship drift speeds up by the same ratio
export const DESKTOP_COIN_GAP = 1 / 1.4;
// CR12: one desktop object scale applied to the UFO, ships, coins, power-ups and bullet heads with their hit radii.
export const DESKTOP_OBJECT_SCALE = 0.7;

// CR12 timed levels: a level ends this long after its last coin spawns (or when every coin is collected).
export const LEVEL_END_DELAY = 7;
export const FADE_SECONDS = 0.5; // remaining coins, ships, bullets and pickups fade
export const VICTORY_SECONDS = 2.5; // victory explosion before the next LEVEL banner

// CR12 combo: x1, x2 at 3 quick pickups, x3 at 6, capped at x4.
export const COMBO_STEP = 3;
export const COMBO_MAX = 4;

// CR12 chaser, boss, magnet.
export const CHASER_SCALE = 0.8; // hull radius relative to a roamer
export const CHASER_SPEED = 0.6; // of the roamer drift speed
export const CHASER_KEEP = 3; // ship radii kept from every other ship
export const BOSS_SCALE = 3;
export const BOSS_SPEED = 0.5;
export const BOSS_RING = 12;
export const BOSS_EVERY = 5;
export const BOSS_REACH_FRAC = 0.5; // boss ring reach, of the shorter field side
export const MAGNET_RANGE = 10; // UFO radii
export const MAGNET_PULL = 650; // px/s on desktop
export const NEAR_MISS_RADII = 1.5; // head radii beyond the head-hit reach
export const NEAR_MISS_GAP = 0.25; // seconds between near-miss sparks

/** Score multiplier for a chain of quick coin pickups (the pickup itself counts). */
export function comboMultiplier(chain) {
  return Math.min(COMBO_MAX, 1 + Math.floor(Math.max(0, chain) / COMBO_STEP));
}

/** Every 5th level is a boss level. */
export function isBossLevel(level) {
  const n = Math.floor(level);
  return n >= BOSS_EVERY && n % BOSS_EVERY === 0;
}

/** Chasers join the roamers: one from level 3, two from level 6. */
export function chaserCount(level) {
  const n = Math.floor(level);
  return n >= 6 ? 2 : n >= 3 ? 1 : 0;
}

/** Seconds between boss rings; shortens with each boss level, never below 1.5 s. */
export function bossInterval(level) {
  return Math.max(1.5, 2.5 - 0.1 * (Math.floor(level / BOSS_EVERY) - 1));
}

/** Per-level numbers. Base rates are in px/s and seconds at motionScale 1. */
export function levelParams(level) {
  const n = Math.max(1, Math.floor(level));
  const rise = Math.pow(LEVEL_GROWTH, n - 1);
  return {
    level: n,
    coins: Math.min(30 + 5 * (n - 1), MAX_LEVEL_COINS),
    ships: Math.min(n, MAX_SHIPS),
    fireInterval: Math.max(VOLLEY_INTERVAL_MIN, VOLLEY_INTERVAL_L1 * Math.pow(VOLLEY_SHORTEN, n - 1)), // seconds between volleys
    spin: 1.1 * rise, // emit-angle rad/s
    shipSpeed: 34 + 2 * (n - 1), // px/s drift toward the UFO
    coinInterval: Math.max(0.35, 1.1 / Math.pow(n, 0.4)),
    liveCoinCap: Math.min(18, 8 + 2 * n),
  };
}

/** Four bullet angles, 90 degrees apart, around the current emit angle. */
export function spiralAngles(emitAngle) {
  return [emitAngle, emitAngle + Math.PI / 2, emitAngle + Math.PI, emitAngle + (3 * Math.PI) / 2];
}

/** Maximum reach of a bullet from its ship's centre. */
export function maxReach(shipRadius, fieldW, fieldH, level = 1) {
  const n = Math.max(1, Math.floor(level));
  const radii = Math.min(REACH_RADII + REACH_PER_LEVEL * (n - 1), REACH_RADII_MAX);
  return Math.min(radii * shipRadius, REACH_FIELD_FRAC * Math.min(fieldW, fieldH));
}

/** Bullet lifetime in seconds: the 2.2 s base scaled by reach over the level-1 reach in ship radii. */
export function bulletLife(reach, shipRadius) {
  return BULLET_LIFE * (reach / (REACH_RADII * shipRadius));
}

/** Head/trail fade factor 1 -> 0 over the last BULLET_FADE seconds of the bullet's life. */
export function bulletFade(age, life = BULLET_LIFE) {
  return age <= life - BULLET_FADE ? 1 : Math.max(0, (life - age) / BULLET_FADE);
}

/** Position of a bullet `lag` seconds back along its spiral, relative to its ship's current centre; written into `out`. */
export function bulletPoint(b, lag, out) {
  const t = Math.max(0, b.age - lag) / (b.life || BULLET_LIFE);
  const r = b.hull + (b.reach - b.hull) * t;
  const a = b.a0 + BULLET_TURNS * Math.PI * 2 * t;
  out.x = b.sx + Math.cos(a) * r;
  out.y = b.sy + Math.sin(a) * r;
  return out;
}

/** Trail length in seconds of spiral lifetime (about a third of a turn). */
export const TRAIL_SPAN = (TRAIL_TURNS / BULLET_TURNS) * BULLET_LIFE;

/** Damage for one event. `kind` is "trail" (one 0.1 s tick), "head" or "ship". A live shield blocks all of it. */
export function computeDamage(kind, shielded) {
  if (shielded) return 0;
  return DAMAGE[kind] || 0;
}

/** Health after damage, clamped to 0..HEALTH_MAX. */
export function applyDamage(health, amount) {
  return Math.max(0, Math.min(HEALTH_MAX, health - amount));
}

/** Health after a heal, clamped to HEALTH_MAX. */
export function applyHeal(health, amount = HEALTH_PICKUP) {
  return Math.max(0, Math.min(HEALTH_MAX, health + amount));
}

/** True while a timed effect (an `...Until` timestamp) is running. */
export function timedActive(until, now) {
  return now < until;
}

export class DifficultyManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.level = 1;
  }

  get displayLevel() {
    return this.level;
  }

  get params() {
    return levelParams(this.level);
  }

  /** Desktop paces faster than mobile; reads the mode-desktop/mode-mobile
   * body class main.js's applyControlMode() toggles. */
  get isDesktopPace() {
    if (typeof document === "undefined" || !document.body) return true;
    return !document.body.classList.contains("mode-mobile");
  }

  get spawnIntervalCoin() {
    const v = this.params.coinInterval;
    return this.isDesktopPace ? v * DESKTOP_COIN_GAP : v;
  }

  get enemySpeedMul() {
    return this.isDesktopPace ? DESKTOP_ENEMY_PACE : 1;
  }
}
