// Every feel and rule constant for the shooter lives here and nowhere else.
// Units: pixels of the logical play field, seconds, radians unless a name says otherwise.
const SHOOTER_CONFIG = Object.freeze({
  seed: 1979,
  fixedDt: 1 / 60,

  // Play field (logical units; the renderer scales it to the screen).
  fieldW: 1024,
  fieldH: 768,

  // Ship feel: rotate and thrust at fixed rates, inertia, drag only (no brake).
  turnRate: 4.4,
  thrustAccel: 240,
  drag: 0.35,
  maxSpeed: 400,
  shipRadius: 12,
  respawnDelay: 0.65,
  respawnClearRadius: 18,
  invulnerableTime: 2.5,
  lives: 3,
  extraShipEvery: 10000,
  hyperspaceDeathChance: 0.12,

  // Bullets. Travel = bulletSpeed * bulletLife = 0.75 of the field width.
  bulletSpeed: 520,
  bulletLife: 1.48,
  bulletRadius: 2,
  maxBullets: 4,

  // Rocks: index 0 large, 1 medium, 2 small.
  sizeNames: ["large", "medium", "small"],
  rockRadii: [46, 24, 12],
  rockSpeedMin: [24, 40, 60],
  rockSpeedMax: [60, 100, 150],
  splitSpeeds: [70, 110, 0],
  rockVerts: 11,
  rockJag: 0.35,
  rockSpin: 1,
  rockSpawnClearRadius: 140,
  // Level-start safety: clear radius is at least shipRadius + largest rock radius + this margin,
  // checked against the first step's swept relative motion. No step ever integrates more than maxStepDt.
  rockSpawnMargin: 40,
  rockSpawnTries: 48,
  rockSpawnRetryDelay: 0.25,
  maxStepDt: 5 / 60,

  // Waves.
  waveStart: 4,
  waveStep: 2,
  waveCap: 11,
  waveDelay: 1.5,

  scores: { large: 20, medium: 50, small: 100, saucerLarge: 200, saucerSmall: 1000 },

  // Saucers.
  saucerFirstDelay: 9,
  saucerIntervalMin: 8,
  saucerIntervalMax: 16,
  saucerRadiusLarge: 20,
  saucerRadiusSmall: 12,
  saucerSpeed: 110,
  saucerTurnEvery: 1.2,
  saucerFireEvery: 1.1,
  saucerBulletSpeed: 300,
  saucerBulletLife: 1.8,
  smallSaucerScoreStart: 3000,
  smallSaucerScoreFull: 40000,
  smallSaucerMaxChance: 1,
  smallAimErrorDeg: 8,
  largeAimErrorDeg: 180,

  // Heartbeat: the interval shrinks as rocks are cleared.
  heartbeatMaxInterval: 1.0,
  heartbeatMinInterval: 0.25,
  heartbeatRockRef: 20,

  // Phone pads (input_mobile.js, style.css, main.js gameConfig): pad height, gap, portrait turn factor, tap step.
  padH: 121, padGap: 8, mobileTurnFactor: 0.55, tapTurnStep: 0.12, tapMaxMs: 150,

  // Portrait field for phones (D-032). Bullet travel stays 0.75 of the field width.
  portraitFieldW: 432,
  portraitFieldH: 768,
  portraitBulletLife: 0.623,
  portraitControlsH: 190,

  // Render-only constants (S2). No sim rule reads these.
  look: Object.freeze({
    flowRise: 0.08,
    flowDecay: 0.94,
    burstDecay: 0.9,
    chromaPerWave: 0.12,
    chromaPerScore: 0.00002,
    cameraFov: 38,
    cameraFovPortrait: 52,
    background: 0x05070d,
    shipColor: 0xffffff,
    rockColor: 0xd8e6ff,
    saucerColor: 0xff9a5a,
    bulletColor: 0xfff2a8,
    rockDepth: 0.55,
    bgDim: 0.8,
    ambient: 0.9,
    sun: 2.1,
    rim: 0.9,
    rockEmissive: 0.06,
    envIntensity: 0.55,
    fill: 1.25,
    starDrift: 48,
    starTwinkle: 1.0,
    starGain: 2.45,
  }),
});
