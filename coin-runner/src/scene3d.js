// Three.js mesh layer for Coin Runner, built on the shared Games/_base kit
// (render.js createScene). Game logic and the 2D canvas path are untouched;
// this module only creates and positions meshes from the game's existing
// state each frame (D-032/D-034: no camera math here beyond the local fit).
//
// CR8: procedural multi-part UFO player, round soft-glow parallax starfield,
// one evil Octagon ship, pooled 4-arm spiral bullets with yellow->orange->red
// trails, and four distinct power-up pickups. Everything is built at init or
// on spawn; per-frame code only writes numbers into preallocated buffers.

import { createScene, setSkyGradient } from "/_base/render.js";
import { MAX_BULLETS } from "./entities.js";
import { bulletPoint, bulletFade, TRAIL_SPAN, FIRE_WARN } from "./difficulty.js";

const SPARK_POOL_MAX = 10;
const SPARK_COUNT = 24;
const BURST_COLORS = { coin: 0xffd54a, hit: 0xff9d2e, health: 0xb28cff, shield: 0x8fd0ff, slow: 0x35b8c8, speed: 0xffb02e, magnet: 0xff7ad9 };
// P8 boss ruling: coin collect burst is a dedicated pooled system (14 particles,
// radial, speed 2-4 units/s, gravity 6, fade+shrink to 0 over 0.45s).
const COIN_BURST = { count: 14, speedMin: 2, speedMax: 4, gravity: 6, life: 0.45, size: 6 };
const COIN_BURST_POOL_SIZE = 8;
// P8: hit flash + camera shake, level-up flash (fixed values, no deviation).
const HIT_FLASH_COLOR = "rgba(255,40,40,0.35)";
const HIT_FLASH_MS = 150;
const HIT_SHAKE_AMPLITUDE = 0.18;
const HIT_SHAKE_MS = 250;
const LEVELUP_FLASH_COLOR = "rgba(255,236,160,0.45)";
const LEVELUP_FLASH_MS = 400;
const SPARK_LIFE = 0.55;

// Star parallax: layer shift = -player offset * factor (far 0.2, mid 0.5, near 1.0).
const STAR_PARALLAX = { far: 0.2, mid: 0.5, near: 1.0 };
const STAR_PALETTE = [0xffffff, 0xcfe0ff, 0xaec8ff, 0xffe9b8];
const STAR_SIZES = { far: 2.9, mid: 4.3, near: 6.2 }; // CSS px sprite boxes; the visible disc is ~70% of it (about 2 / 3 / 4-5 px)
const STAR_GLINTS = 4; // only the brightest few near stars carry a 4-point glint
const STAR_HALO = 1.7; // CR15a: glow-halo sprite scale over STAR_SIZES (core stays about the CR13 disc size)
const STAR_TWINKLE = { minPeriod: 0.35, maxPeriod: 1.6, minBright: 0.15 }; // per-star cycle (s) and brightness floor
const SHOOT_EVERY = [6, 12]; // s between shooting stars
const SHOOT_TAIL_S = 0.6; // phone: tail covers the last 0.6 s of travel
const SHOOT_TAIL_S_DESKTOP = 0.3; // CR16 desktop: shorter tail (about 1/6 of a 1920 field)
const NUGGET_VARIANTS = 7;
const NUGGET_BASE_COLOR = 0xe0a818;
const TRAIL_SEGMENTS = 10;
const SHIELD_FADE_SECONDS = 2;
const SHIELD_OPACITY = 0.3;

/** createScene3D({canvas, composition}) -> the _base createScene() result,
 * extended with .sync(game), .spawnCoinBurst(x,y) and .rebuildGround(W,H). */
export function createScene3D({ canvas, composition }) {
  const base = createScene({ canvas, composition, tiltDeg: 62 });
  const { THREE, scene } = base;
  setSkyGradient(scene, { top: "#02030a", horizon: "#070a1c" });

  const additive = (name, color, opacity, extra = {}) =>
    new THREE.MeshBasicMaterial({ name, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, ...extra });

  // ---------- materials ----------
  const mats = {
    shadowCatcher: new THREE.ShadowMaterial({ name: "mat_shadow_catcher", opacity: 0.35 }),
    // UFO: chrome, deep violet, gold, ice-white. No green, no red.
    chrome: new THREE.MeshStandardMaterial({ name: "mat_ufo_chrome", color: 0xc4cad8, metalness: 0.92, roughness: 0.24, envMapIntensity: 1.1, side: THREE.DoubleSide }),
    violet: new THREE.MeshStandardMaterial({ name: "mat_ufo_violet", color: 0x3a1f8a, emissive: 0x2a1270, emissiveIntensity: 0.7, metalness: 0.5, roughness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ name: "mat_ufo_gold", color: 0xe8b84a, emissive: 0x4a3008, emissiveIntensity: 0.4, metalness: 0.9, roughness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ name: "mat_ufo_glass", color: 0x7a68e8, emissive: 0x1c1050, emissiveIntensity: 0.6, transparent: true, opacity: 0.42, metalness: 0.2, roughness: 0.04, envMapIntensity: 1.6, depthWrite: false }),
    core: new THREE.MeshBasicMaterial({ name: "mat_ufo_core", color: 0xfff1cc, toneMapped: false }),
    pilot: new THREE.MeshStandardMaterial({ name: "mat_ufo_pilot", color: 0x1c1440, emissive: 0x100a28, emissiveIntensity: 0.8, roughness: 0.5 }),
    iceLight: new THREE.MeshBasicMaterial({ name: "mat_ufo_rimlight", color: 0xf2f8ff, toneMapped: false }),
    underRim: additive("mat_ufo_underrim", 0xa9c4ff, 0.55, { side: THREE.DoubleSide }),
    tractor: additive("mat_ufo_tractor", 0x7a5cff, 0.42, { side: THREE.DoubleSide }),
    shimmer: additive("mat_ufo_shimmer", 0xbfd8ff, 0.1, { side: THREE.DoubleSide }),
    rimGlow: new THREE.SpriteMaterial({ name: "mat_ufo_rimglow", color: 0xdfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
    domeGlint: new THREE.SpriteMaterial({ name: "mat_ufo_glint", color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
    // Energy shield: a thin fresnel shell with a crisp outer edge line, fine hex field lines, a shimmer
    // band sweeping across the cells and a slow pulse. The interior stays clear so the UFO reads through it.
    shield: new THREE.ShaderMaterial({
      name: "mat_shield",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color(0x38b8ff) } },
      vertexShader: [
        "varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;",
        "void main(){",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  vN = normalize(normalMatrix * normal);",
        "  vV = projectionMatrix[3][3] > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz); // orthographic fit: parallel view rays",
        "  vP = normalize(position); vUv = uv;",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform float uTime; uniform float uFade; uniform vec3 uColor;",
        "varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;",
        "float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }",
        "vec2 hexCell(vec2 uv){ vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5; vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h; return dot(a, a) < dot(b, b) ? a : b; }",
        "void main(){",
        "  float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));",
        "  float rim = pow(fr, 4.0);",
        "  float edge = smoothstep(0.84, 0.97, fr);",
        "  float line = smoothstep(0.41, 0.47, hexDist(hexCell(vec2(vUv.x * 20.0, vUv.y * 10.0 * 1.732))));",
        "  float band = pow(0.5 + 0.5 * sin(vP.y * 5.0 + vP.x * 2.0 - uTime * 2.2), 6.0);",
        "  float pulse = 0.88 + 0.12 * sin(uTime * 3.0);",
        "  float a = (rim * 0.75 + edge * 0.7 + line * (0.1 + 0.6 * rim + 0.45 * band)) * pulse * uFade;",
        "  vec3 col = mix(uColor, vec3(0.86, 0.96, 1.0), clamp(edge * 0.7 + line * band * 0.5, 0.0, 1.0));",
        "  gl_FragColor = vec4(col, a);",
        "}",
      ].join("\n"),
    }),
    shieldRing: additive("mat_shield_ring", 0x6fd2ff, 0.25, { side: THREE.DoubleSide }),
    // Gold nuggets: soft additive halo sprite (shared); the nugget materials are built with the variants below.
    nuggetHalo: new THREE.SpriteMaterial({ name: "mat_nugget_halo", color: 0xffc233, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
    nuggetSparkle: new THREE.SpriteMaterial({ name: "mat_nugget_sparkle", color: 0xfff2b8, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false }),
    // Octagon ship (CR13 premium finish): clear-coated gunmetal hull, graphite ceramic top plate and
    // panels, polished chrome trim, thin dim seams, a recessed core under smoked glass, dim engine vents.
    // Clear-coat roughness kept above ~0.25 so a flat facet never mirrors a studio softbox into a
    // white square that bloom then blows out.
    shipHull: new THREE.MeshPhysicalMaterial({ name: "mat_octagon_hull", color: 0x353a48, metalness: 0.85, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.26, envMapIntensity: 1.2, flatShading: true }),
    shipPlate: new THREE.MeshPhysicalMaterial({ name: "mat_octagon_plate", color: 0x22252e, metalness: 0.15, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.28, envMapIntensity: 1.0, flatShading: true }),
    shipPanel: new THREE.MeshPhysicalMaterial({ name: "mat_octagon_panel", color: 0x5a606e, metalness: 0.2, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.7, flatShading: true }),
    shipTrim: new THREE.MeshStandardMaterial({ name: "mat_octagon_trim", color: 0xc8ccd8, metalness: 1.0, roughness: 0.2, envMapIntensity: 1.4 }),
    shipSeam: new THREE.MeshBasicMaterial({ name: "mat_octagon_seam", color: 0xa8180c, toneMapped: false }),
    chaserSeam: new THREE.MeshBasicMaterial({ name: "mat_chaser_seam", color: 0xb0600e, toneMapped: false }),
    shipVent: new THREE.MeshBasicMaterial({ name: "mat_octagon_vent", color: 0x8a2410, toneMapped: false }),
    chaserVent: new THREE.MeshBasicMaterial({ name: "mat_chaser_vent", color: 0x8a5410, toneMapped: false }),
    shipLens: new THREE.MeshPhysicalMaterial({ name: "mat_octagon_lens", color: 0x1a0c0c, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.5, envMapIntensity: 2.2, depthWrite: false }),
    shipCore: new THREE.MeshBasicMaterial({ name: "mat_octagon_core", color: 0xff1608, toneMapped: false }),
    shipHalo: additive("mat_octagon_halo", 0xff1a0a, 0.3, { side: THREE.DoubleSide }),
    chaserHalo: additive("mat_chaser_halo", 0xff7a14, 0.3, { side: THREE.DoubleSide }),
    wallEdge: additive("mat_wall_edge", 0x49d8ff, 0.9),
  };

  // Power-up pickups: a flat symbol in the kind's HUD timer colour (POWER_COLORS in game.js; none green).
  // CR12: emissive and halo at about half of CR11 (emissive 0.7 -> 0.35, halo 0.55 -> 0.28).
  const puPalette = {
    health: 0xb28cff,
    shield: 0x8fd0ff,
    slow: 0x35b8c8,
    speed: 0xffb02e,
    magnet: 0xff7ad9,
  };
  const PU_HALO_OPACITY = 0.28;
  const puMats = {};
  for (const kind of Object.keys(puPalette)) {
    const c = puPalette[kind];
    puMats[kind] = {
      body: new THREE.MeshStandardMaterial({ name: `mat_pu_${kind}`, color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }),
      halo: new THREE.MeshBasicMaterial({ name: `mat_pu_halo_${kind}`, color: c, transparent: true, opacity: PU_HALO_OPACITY, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  const VIS = composition === "mobile" ? 1 : 1.5; // desktop visual size factor (P5)
  const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- shared soft sprite texture ----------
  function buildSoftTexture(size, stops) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  // CR15a: small bright core inside a soft glow halo (the sprite is drawn STAR_HALO x larger so the core keeps its size).
  const starTex = buildSoftTexture(64, [[0, 1], [0.2, 0.95], [0.34, 0.5], [0.55, 0.16], [0.8, 0.04], [1, 0]]);
  // Tiny 4-point glint (two thin crossed streaks) for the brightest few near stars.
  const glintTex = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    for (const horizontal of [true, false]) {
      const g = horizontal ? ctx.createLinearGradient(0, 0, 64, 0) : ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      if (horizontal) ctx.fillRect(0, 31, 64, 2);
      else ctx.fillRect(31, 0, 2, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const sparkTexture = buildSoftTexture(32, [[0, 1], [1, 0]]);
  // Nugget halo: smooth radial falloff reaching exactly 0 by 85% of the radius, so no edge is ever clipped.
  const nuggetHaloTex = buildSoftTexture(64, [[0, 1], [0.3, 0.72], [0.55, 0.28], [0.75, 0.06], [0.85, 0], [1, 0]]);
  mats.nuggetHalo.map = nuggetHaloTex;
  mats.nuggetHalo.depthTest = true; // the nugget still hides the halo's back half; no plane writes depth (below)
  // The shadow-catcher plane must not write depth, or it cuts the halo with a straight edge at the floor.
  mats.shadowCatcher.depthWrite = false;
  // Nugget sparkle: shared sprite, a bright core with a tight falloff, built once.
  mats.nuggetSparkle.map = buildSoftTexture(32, [[0, 1], [0.18, 0.9], [0.45, 0.2], [1, 0]]);
  mats.shipHalo.map = sparkTexture;
  mats.chaserHalo.map = sparkTexture;
  mats.tractor.map = sparkTexture;
  mats.shimmer.map = sparkTexture;
  mats.rimGlow.map = sparkTexture;
  mats.domeGlint.map = sparkTexture;

  // UFO chrome: its own dark-space studio reflection (bright strips over deep violet) so the
  // polished hull shows banded highlights instead of reflecting a flat white room.
  let studioEnv = null;
  {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#1a1430");
    g.addColorStop(0.18, "#f4f6ff");
    g.addColorStop(0.24, "#3a3360");
    g.addColorStop(0.4, "#141026");
    g.addColorStop(0.47, "#8a78d8");
    g.addColorStop(0.52, "#1a1430");
    g.addColorStop(0.7, "#07060f");
    g.addColorStop(1, "#000000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
    // two softbox panels so the reflections break up around the saucer
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(60, 70, 70, 26);
    ctx.fillRect(330, 62, 90, 20);
    ctx.fillStyle = "rgba(255,214,140,0.55)";
    ctx.fillRect(210, 118, 60, 10);
    const env = new THREE.CanvasTexture(c);
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.colorSpace = THREE.SRGBColorSpace;
    mats.chrome.envMap = env;
    mats.glass.envMap = env;
    mats.gold.envMap = env;
    for (const k of ["shipHull", "shipPlate", "shipPanel", "shipTrim", "shipLens"]) mats[k].envMap = env;
    studioEnv = env;

    // Brushed hull: fine concentric brushing (along v) and 16 radial panel seams (along u).
    const b = document.createElement("canvas");
    b.width = 512;
    b.height = 128;
    const bx = b.getContext("2d");
    bx.fillStyle = "#d8dce6";
    bx.fillRect(0, 0, 512, 128);
    for (let y = 0; y < 128; y++) {
      const v = 200 + Math.floor(Math.random() * 40);
      bx.fillStyle = `rgba(${v},${v},${v + 8},0.55)`;
      bx.fillRect(0, y, 512, 1);
    }
    // canvas rows 0-57 are the upper hull (lathe v 1..0.55, flipY)
    bx.fillStyle = "rgba(40,36,70,0.85)";
    for (let i = 0; i < 16; i++) bx.fillRect(Math.round((i * 512) / 16), 0, 3, 57);
    bx.fillStyle = "rgba(40,36,70,0.7)";
    bx.fillRect(0, 28, 512, 2);
    bx.fillRect(0, 50, 512, 2);
    const brushed = new THREE.CanvasTexture(b);
    brushed.colorSpace = THREE.SRGBColorSpace;
    brushed.wrapS = THREE.RepeatWrapping;
    mats.chrome.map = brushed;
  }
  // Soft halo ring that peeks out under the saucer rim (transparent centre, peak near the edge).
  const underRimTex = (() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.78, "rgba(255,255,255,0)");
    g.addColorStop(0.84, "rgba(255,255,255,1)");
    g.addColorStop(0.92, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  mats.underRim.map = underRimTex;

  // ---------- ground / backdrop ----------
  let groundMesh = null;
  let planeW = 0;
  let planeH = 0;
  let apronMesh = null;
  let walls = null;
  let stars = null;
  const starLayers = [];
  const starTime = { value: 0 };

  function buildApronTex() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, "#241a4a");
    grad.addColorStop(0.125, "#241a4a");
    grad.addColorStop(0.35, "#0b0d1c");
    grad.addColorStop(1.0, "#04050c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    // nebula wash: blue and violet clouds with one warm accent
    const clouds = [
      [200, 210, 70, "rgba(40,110,240,0.55)"],
      [315, 205, 80, "rgba(140,60,220,0.55)"],
      [256, 300, 60, "rgba(70,50,200,0.45)"],
      [330, 290, 40, "rgba(255,140,80,0.38)"],
      [175, 300, 45, "rgba(90,70,230,0.40)"],
    ];
    for (const [cx, cy, r, col] of clouds) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const nebulaMat = new THREE.MeshBasicMaterial({ name: "mat_nebula", map: buildApronTex(), transparent: true, opacity: 0.2,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });

  function buildWallFadeTex() {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 64;
    const ctx = c.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "#2f9bc0");
    grad.addColorStop(0.35, "#17566d");
    grad.addColorStop(1, "#000000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const wallFadeMat = new THREE.MeshBasicMaterial({ name: "mat_wall_fade", map: buildWallFadeTex(), transparent: true, opacity: 0.8,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

  // CR15a nebula: one canvas texture built once here, two soft clouds (deep blue + violet, a touch of teal),
  // lying behind the far star layer and moving with the far parallax factor. Many overlapping puffs give a
  // soft irregular edge. Pixels are summed in float here (canvas gradients carry a per-texel dither that the
  // ~8x magnification turns into a visible lattice); the material adds a screen-space dither against banding.
  function buildNebulaTex() {
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d");
    const rand = seededRandom(15015);
    // [cx, cy, spread, puffs, colour]; the field sits in the middle half of the texture
    const clouds = [
      [0.37, 0.38, 0.13, 9, [34, 52, 170]],
      [0.42, 0.35, 0.08, 5, [96, 44, 176]],
      [0.64, 0.63, 0.12, 9, [104, 40, 168]],
      [0.6, 0.67, 0.07, 4, [22, 120, 132]],
    ];
    const puffs = [];
    for (const [cx, cy, spread, n, col] of clouds) {
      for (let i = 0; i < n; i++) {
        const px = (cx + (rand() - 0.5) * spread * 1.6) * S;
        const py = (cy + (rand() - 0.5) * spread * 1.2) * S;
        const sigma = (0.4 + 0.35 * rand()) * spread * S;
        puffs.push([px, py, 1 / (2 * sigma * sigma), col]);
      }
    }
    const acc = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = (y * S + x) * 3;
        for (const [px, py, inv, col] of puffs) {
          const w = 0.09 * Math.exp(-((x - px) * (x - px) + (y - py) * (y - py)) * inv);
          acc[k] += col[0] * w;
          acc[k + 1] += col[1] * w;
          acc[k + 2] += col[2] * w;
        }
      }
    }
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      img.data[i * 4] = Math.min(255, Math.round(acc[i * 3]));
      img.data[i * 4 + 1] = Math.min(255, Math.round(acc[i * 3 + 1]));
      img.data[i * 4 + 2] = Math.min(255, Math.round(acc[i * 3 + 2]));
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const nebulaSkyMat = new THREE.MeshBasicMaterial({ name: "mat_nebula_sky", map: buildNebulaTex(), transparent: true, opacity: composition === "mobile" ? 0.8 : 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }); // depth-tested: ships and coins occlude it
  // Screen-space dither (+-1 level) so the faint, magnified gradient never bands.
  nebulaSkyMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      "#include <dithering_fragment>\n  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0 * gl_FragColor.a;"
    );
  };
  const nebulaGeo = new THREE.PlaneGeometry(1, 1); // unit plane, scaled to the field in buildStars
  nebulaGeo.rotateX(-Math.PI / 2);
  const nebulaSky = new THREE.Mesh(nebulaGeo, nebulaSkyMat);
  nebulaSky.name = "nebula_sky";
  nebulaSky.position.y = -115; // behind the far star layer (y -100)
  nebulaSky.renderOrder = -3;
  nebulaSky.frustumCulled = false;
  nebulaSky.userData.parallax = STAR_PARALLAX.far;
  scene.add(nebulaSky);
  const nebulaWashes = [nebulaSky];

  // CR15a shooting stars: a pool of 2 streaks built once here. Texture: a thin line whose alpha rises from the
  // tail to a small bright head. Each streak is a unit plane (head at local x=0, tail toward -x) scaled per frame.
  function buildStreakTex() {
    const W = 256;
    const H = 32;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y + 0.5 - H / 2;
      const line = Math.exp(-(v * v) / (2 * 1.6 * 1.6));
      const glow = Math.exp(-(v * v) / (2 * 4.5 * 4.5));
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const hx = (W - 12 - x) / 5;
        const head = Math.exp(-(hx * hx) / 2) * glow;
        const a = Math.min(1, Math.pow(u, 2.2) * line * (x < W - 12 ? 1 : Math.max(0, 1 - (x - (W - 12)) / 6)) + head);
        const k = (y * W + x) * 4;
        img.data[k] = 225;
        img.data[k + 1] = 236;
        img.data[k + 2] = 255;
        img.data[k + 3] = Math.round(255 * a);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const streakTex = buildStreakTex();
  const streakGeo = new THREE.PlaneGeometry(1, 1);
  streakGeo.rotateX(-Math.PI / 2);
  streakGeo.translate(-0.5 + 12 / 256, 0, 0); // the head sits at the local origin
  const shootHeadTex = buildSoftTexture(32, [[0, 1], [0.18, 0.85], [0.4, 0.25], [1, 0]]);
  const shootHeadGeo = new THREE.PlaneGeometry(1, 1);
  shootHeadGeo.rotateX(-Math.PI / 2);
  const shootPool = [];
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshBasicMaterial({ name: "mat_shooting_star", map: streakTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(streakGeo, mat);
    mesh.name = `shooting_star_${i}`;
    mesh.position.y = -98; // on the far layer
    mesh.renderOrder = -2;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    // small round glow on the head, so it reads as a bright point leading the tail
    const headMat = new THREE.MeshBasicMaterial({ name: "mat_shooting_head", map: shootHeadTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const head =new THREE.Mesh(shootHeadGeo, headMat);
    head.renderOrder = -2;
    mesh.add(head);
    shootPool.push({ mesh, head, active: false, t0: 0, life: 1, x0: 0, z0: 0, vx: 0, vz: 0, hold: -1 });
  }
  let nextShootAt = -1;
  let lastSkyT = 0;
  function armShootingStar(slot, t, opts = {}) {
    const m = Math.max(planeW, planeH, 1);
    const ang = opts.angleDeg != null ? (opts.angleDeg * Math.PI) / 180 : Math.random() * Math.PI * 2;
    const speed = (composition === "mobile" ? 0.55 : 0.45) * m;
    slot.life = composition === "mobile" ? 0.6 : 0.7; // CR17a: shorter flight, same pace
    slot.vx = Math.cos(ang) * speed;
    slot.vz = Math.sin(ang) * speed;
    // start so the flight passes through the field: mid-path point inside the middle 70% of the field
    const mx = opts.x != null ? opts.x - planeW / 2 : (Math.random() - 0.5) * 0.7 * planeW;
    const mz = opts.y != null ? opts.y - planeH / 2 : (Math.random() - 0.5) * 0.7 * planeH;
    slot.x0 = mx - slot.vx * slot.life * 0.5;
    slot.z0 = mz - slot.vz * slot.life * 0.5;
    slot.t0 = t - (opts.age || 0);
    slot.hold = opts.hold ? opts.age || 0 : -1;
    slot.active = true;
  }
  function updateShootingStars(t, farX, farZ) {
    if (t < lastSkyT - 0.5) nextShootAt = -1; // game clock restarted (new run)
    lastSkyT = t;
    if (nextShootAt < 0) nextShootAt = t + SHOOT_EVERY[0] + Math.random() * (SHOOT_EVERY[1] - SHOOT_EVERY[0]);
    if (!REDUCED_MOTION && t >= nextShootAt) {
      const free = shootPool.find((s) => !s.active);
      if (free) armShootingStar(free, t);
      nextShootAt = t + SHOOT_EVERY[0] + Math.random() * (SHOOT_EVERY[1] - SHOOT_EVERY[0]);
    }
    const thick = composition === "mobile" ? 9 : 12;
    const headSize = composition === "mobile" ? 12 : 16;
    for (let i = 0; i < shootPool.length; i++) {
      const s = shootPool[i];
      const age = s.hold >= 0 ? s.hold : t - s.t0;
      if (!s.active || age < 0 || age > s.life) {
        if (s.active && age > s.life) s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const speed = Math.hypot(s.vx, s.vz);
      s.mesh.visible = true;
      s.mesh.position.x = farX + s.x0 + s.vx * age;
      s.mesh.position.z = farZ + s.z0 + s.vz * age;
      s.mesh.rotation.y = Math.atan2(-s.vz, s.vx);
      const len = Math.max(1, speed * Math.min(age, composition === "mobile" ? SHOOT_TAIL_S : SHOOT_TAIL_S_DESKTOP));
      s.mesh.scale.set(len, 1, thick);
      s.head.scale.set(headSize / len, 1, headSize / thick); // undo the streak's stretch: a round head
      const fadeIn = Math.min(1, age / 0.15);
      const fadeOut = Math.min(1, (s.life - age) / 0.35);
      s.mesh.material.opacity = 0.62 * fadeIn * fadeOut;
      s.head.material.opacity = 0.95 * fadeIn * fadeOut;
    }
  }

  function buildStars() {
    if (stars) {
      scene.remove(stars);
      for (const layer of starLayers) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      starLayers.length = 0;
    }
    const mobile = composition === "mobile";
    const m = Math.max(planeW, planeH);
    // Three depth layers of round soft-glow sprites. `visible` is the on-screen count;
    // each layer is spread over the field plus its own parallax travel so it never runs dry.
    // Sizes are CSS px (orthographic camera, three scales by the device pixel ratio), so they stay sharp on mobile too.
    const defs = [
      { name: "far", visible: mobile ? 110 : 300, size: STAR_SIZES.far, opacity: 0.85, y: -100, phase: 0 },
      { name: "mid", visible: mobile ? 34 : 90, size: STAR_SIZES.mid, opacity: 0.95, y: -55, phase: 2.1 },
      { name: "near", visible: mobile ? 24 : 60, size: STAR_SIZES.near, opacity: 1, y: -20, phase: 4.2 },
    ];
    stars = new THREE.Group();
    stars.name = "starfield";
    const tint = new THREE.Color();
    for (const d of defs) {
      const k = STAR_PARALLAX[d.name];
      const extra = d.name === "near" ? 1.15 : 1; // near layer shifts a full player offset: cover it with margin
      const halfX = (planeW / 2 + (k * planeW) / 2 + 160) * extra;
      const halfZ = (planeH / 2 + (k * planeH) / 2 + 260) * extra;
      // Near layer: jittered grid built here at init (one star per cell, cell area = field area / visible count).
      let cell = 0;
      let gridCols = 0;
      let gridRows = 0;
      let count = Math.round((d.visible * (4 * halfX * halfZ)) / Math.max(1, planeW * planeH));
      if (d.name === "near") {
        cell = Math.sqrt((planeW * planeH) / d.visible);
        gridCols = Math.max(1, Math.ceil((2 * halfX) / cell));
        gridRows = Math.max(1, Math.ceil((2 * halfZ) / cell));
        count = gridCols * gridRows;
      }
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const phases = new Float32Array(count);
      const rates = new Float32Array(count);
      const scales = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        if (d.name === "near") {
          const gx = i % gridCols;
          const gz = Math.floor(i / gridCols);
          positions[i * 3] = -halfX + (gx + 0.15 + 0.7 * Math.random()) * ((2 * halfX) / gridCols);
          positions[i * 3 + 2] = -halfZ + (gz + 0.15 + 0.7 * Math.random()) * ((2 * halfZ) / gridRows);
        } else {
          positions[i * 3] = (Math.random() * 2 - 1) * halfX;
          positions[i * 3 + 2] = (Math.random() * 2 - 1) * halfZ;
        }
        positions[i * 3 + 1] = d.y + (Math.random() - 0.5) * 20;
        const roll = Math.random();
        tint.setHex(roll < 0.45 ? STAR_PALETTE[0] : roll < 0.75 ? STAR_PALETTE[1] : roll < 0.9 ? STAR_PALETTE[2] : STAR_PALETTE[3]);
        const dim = 0.7 + 0.3 * Math.random();
        colors[i * 3] = tint.r * dim;
        colors[i * 3 + 1] = tint.g * dim;
        colors[i * 3 + 2] = tint.b * dim;
        phases[i] = Math.random() * Math.PI * 2; // per-star twinkle phase
        const period = STAR_TWINKLE.minPeriod + Math.random() * (STAR_TWINKLE.maxPeriod - STAR_TWINKLE.minPeriod);
        rates[i] = (Math.PI * 2) / period; // per-star twinkle rate (rad/s)
        scales[i] = 0.85 + 0.3 * Math.random(); // small spread keeps every star within its size band
      }
      const makePoints = (name, geo, map, size, opacity, halo = STAR_HALO) => {
        const mat = new THREE.PointsMaterial({
          name: "mat_stars",
          color: 0xffffff,
          map,
          vertexColors: true,
          size,
          sizeAttenuation: true,
          transparent: true,
          alphaTest: 0,
          opacity,
          blending: THREE.AdditiveBlending,
          fog: false,
          depthWrite: false,
          depthTest: false, // stars are backdrop: never clipped by depth or the far plane
          toneMapped: false,
        });
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = starTime;
          shader.vertexShader = shader.vertexShader
            .replace(
              "void main() {",
              // CR15a twinkle: each star runs its own phase and rate on the one shared uTime;
              // CR16: brightness 15-100 percent, sprite size follows by about +-20 percent (same mean size).
              `attribute float aPhase;\nattribute float aRate;\nattribute float aScale;\nuniform float uTime;\nvarying float vTw;\nvoid main() {\n  float tw = 0.5 + 0.5 * sin(uTime * aRate + aPhase);\n  vTw = ${STAR_TWINKLE.minBright.toFixed(2)} + ${(1 - STAR_TWINKLE.minBright).toFixed(2)} * tw;`
            )
            .replace("gl_PointSize = size;", `gl_PointSize = size * aScale * ${halo.toFixed(2)} * (0.7 + 0.35 * tw);`);
          shader.fragmentShader = shader.fragmentShader
            .replace("void main() {", "varying float vTw;\nvoid main() {")
            .replace("#include <map_particle_fragment>", "#include <map_particle_fragment>\n  diffuseColor.a *= vTw;");
        };
        const pts = new THREE.Points(geo, mat);
        pts.name = name;
        pts.frustumCulled = false;
        pts.userData.parallax = STAR_PARALLAX[d.name];
        starLayers.push(pts);
        stars.add(pts);
      };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
      geo.setAttribute("aRate", new THREE.BufferAttribute(rates, 1));
      geo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
      makePoints(`stars_${d.name}`, geo, starTex, d.size, d.opacity);
      if (d.name === "near") {
        // The brightest few near stars (largest scale) also carry a tiny 4-point glint.
        const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => scales[b] - scales[a]).slice(0, Math.min(STAR_GLINTS, count));
        const gp = new Float32Array(order.length * 3);
        const gc = new Float32Array(order.length * 3);
        const gph = new Float32Array(order.length);
        const grt = new Float32Array(order.length);
        const gs = new Float32Array(order.length).fill(1);
        order.forEach((src, k) => {
          for (let a = 0; a < 3; a++) {
            gp[k * 3 + a] = positions[src * 3 + a];
            gc[k * 3 + a] = colors[src * 3 + a];
          }
          gph[k] = phases[src];
          grt[k] = rates[src]; // the glint twinkles with its star
        });
        const ggeo = new THREE.BufferGeometry();
        ggeo.setAttribute("position", new THREE.BufferAttribute(gp, 3));
        ggeo.setAttribute("color", new THREE.BufferAttribute(gc, 3));
        ggeo.setAttribute("aPhase", new THREE.BufferAttribute(gph, 1));
        ggeo.setAttribute("aRate", new THREE.BufferAttribute(grt, 1));
        ggeo.setAttribute("aScale", new THREE.BufferAttribute(gs, 1));
        makePoints("stars_nearglint", ggeo, glintTex, mobile ? 11 : 14, 0.55, 1);
      }
    }
    // The one nebula plane (built at init) covers the field plus its far-layer parallax travel.
    nebulaSky.scale.set(2 * m, 1, 2 * m);
    scene.add(stars);
  }

  // Layer offsets in world units (== px at the fitted camera), readable by the capture step.
  const layerOffsets = { far: 0, mid: 0, near: 0, washA: 0 };
  function updateStars(t, wx, wz) {
    if (!stars) return;
    starTime.value = REDUCED_MOTION ? 0 : t;
    for (let i = 0; i < starLayers.length; i++) {
      const l = starLayers[i];
      const k = l.userData.parallax;
      l.position.x = -wx * k;
      l.position.z = -wz * k;
    }
    layerOffsets.far = -wx * STAR_PARALLAX.far;
    layerOffsets.mid = -wx * STAR_PARALLAX.mid;
    layerOffsets.near = -wx * STAR_PARALLAX.near;
    nebulaSky.position.x = -wx * STAR_PARALLAX.far;
    nebulaSky.position.z = -wz * STAR_PARALLAX.far;
    layerOffsets.washA = nebulaSky.position.x;
    updateShootingStars(t, -wx * STAR_PARALLAX.far, -wz * STAR_PARALLAX.far);
    if (apronMesh) {
      apronMesh.position.x = -wx * 0.05;
      apronMesh.position.z = -wz * 0.05;
    }
    // gentle pulse on the arena energy edges
    const pulse = REDUCED_MOTION ? 0.85 : 0.75 + 0.15 * Math.sin(t * 1.6);
    mats.wallEdge.opacity = pulse;
    wallFadeMat.opacity = 0.55 + 0.35 * pulse;
  }

  function rebuildGround(W, H) {
    planeW = W;
    planeH = H;
    if (groundMesh) {
      scene.remove(groundMesh);
      groundMesh.geometry.dispose();
    }
    const geo = new THREE.PlaneGeometry(W, H);
    geo.rotateX(-Math.PI / 2);
    // Invisible shadow-catcher: no board, ships and coins still cast soft shadows.
    groundMesh = new THREE.Mesh(geo, mats.shadowCatcher);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    base.fitShadowToPlane(W, H, Math.max(70, 0.28 * Math.min(W, H)));

    if (apronMesh) {
      scene.remove(apronMesh);
      apronMesh.geometry.dispose();
    }
    const m = Math.max(W, H);
    const apronGeo = new THREE.PlaneGeometry(6 * m, 6 * m);
    apronGeo.rotateX(-Math.PI / 2);
    apronMesh = new THREE.Mesh(apronGeo, nebulaMat);
    apronMesh.position.y = -90;
    apronMesh.renderOrder = -2;
    scene.add(apronMesh);

    if (walls) {
      walls.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose(); // materials are shared, never disposed here
      });
      scene.remove(walls);
    }
    walls = new THREE.Group();
    walls.name = "energy_edge";
    // Soft additive glow lying on the play plane at the field bounds: no solid walls.
    const GLOW = Math.max(40, Math.min(90, 0.07 * Math.min(W, H)));
    const LINE = 2.5;
    const edgeDefs = [
      { len: W, ox: 0, oz: -H / 2, dx: 0, dz: 1, ry: 0 },
      { len: W, ox: 0, oz: H / 2, dx: 0, dz: -1, ry: Math.PI },
      { len: H, ox: -W / 2, oz: 0, dx: 1, dz: 0, ry: Math.PI / 2 },
      { len: H, ox: W / 2, oz: 0, dx: -1, dz: 0, ry: -Math.PI / 2 },
    ];
    for (const def of edgeDefs) {
      const glowGeo = new THREE.PlaneGeometry(def.len, GLOW);
      glowGeo.rotateX(-Math.PI / 2);
      const glow = new THREE.Mesh(glowGeo, wallFadeMat);
      glow.position.set(def.ox + def.dx * GLOW / 2, 0.5, def.oz + def.dz * GLOW / 2);
      glow.rotation.y = def.ry;
      glow.castShadow = false;
      glow.renderOrder = -1;
      walls.add(glow);
      const lineGeo = new THREE.PlaneGeometry(def.len, LINE);
      lineGeo.rotateX(-Math.PI / 2);
      const line = new THREE.Mesh(lineGeo, mats.wallEdge);
      line.position.set(def.ox + def.dx * LINE / 2, 0.6, def.oz + def.dz * LINE / 2);
      line.rotation.y = def.ry;
      line.castShadow = false;
      walls.add(line);
    }
    scene.add(walls);

    buildStars();
  }

  function updateFog() {
    if (composition === "mobile") return;
    const m = Math.max(planeW, planeH);
    const d = base.camera.position.length();
    scene.fog = new THREE.Fog(0x241a4a, d + 0.6 * m, d + 3 * m);
  }

  // ---------- local full-screen camera (overrides the _base rig; _base/rigs.js untouched) ----------
  // The projection is a tilted orthographic fit: the field's ground rectangle maps onto the
  // viewport rectangle, while lit 3D objects still show their sides at the tilt angle.
  const FIT_TILT = 48 * Math.PI / 180;
  const fitRest = new THREE.Vector3();
  const fitBox = { hw: 0, top: 0, near: 1, far: 20000 };
  let fitReady = false;
  let camFx = 0;
  let camFz = 0;
  {
    const cam = base.camera;
    const rigUpdate = cam.updateProjectionMatrix.bind(cam);
    cam.updateProjectionMatrix = () => {
      if (!fitReady) return rigUpdate();
      cam.projectionMatrix.makeOrthographic(-fitBox.hw, fitBox.hw, fitBox.top, -fitBox.top, fitBox.near, fitBox.far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    };
  }

  function fitCamera(viewW, viewH, pw, ph) {
    const s = Math.sin(FIT_TILT), c = Math.cos(FIT_TILT);
    const dist = 2 * Math.max(pw, ph) + 400;
    fitBox.hw = pw / 2;
    fitBox.top = (ph / 2) * s;
    fitBox.near = 1;
    fitBox.far = 2 * dist + 2000;
    fitRest.set(0, dist * s, dist * c);
    fitReady = true;
    base.camera.updateProjectionMatrix();
    applyFitCamera();
  }

  function applyFitCamera() {
    if (!fitReady) return;
    const cam = base.camera;
    cam.position.set(fitRest.x + camFx, fitRest.y, fitRest.z + camFz);
    cam.lookAt(camFx, 0, camFz);
  }

  function toWorld(x, y, h = 0) {
    return { x: x - planeW / 2, y: h, z: y - planeH / 2 };
  }

  // ---------- player: the UFO ----------
  const PLAYER_BUILD_RADIUS = 23; // Player.radius default; build size only, see sync()
  const SAUCER_EDGE = 1.42; // saucer outer radius in build radii
  const player = buildPlayer();
  scene.add(player.group);

  function buildPlayer() {
    const group = new THREE.Group();
    group.name = "player";
    const tilt = new THREE.Group(); // banks into turns
    tilt.position.y = 0.55 * PLAYER_BUILD_RADIUS;
    group.add(tilt);
    const r = PLAYER_BUILD_RADIUS;
    const add = (mesh, parent = tilt) => { parent.add(mesh); return mesh; };

    // Brushed-chrome saucer hull (lathe profile: underside -> rim -> upper hull up to the dome).
    const profile = [[0, -0.26], [0.45, -0.27], [0.85, -0.2], [1.18, -0.08], [1.4, 0], [SAUCER_EDGE, 0.05], [1.28, 0.11], [1.02, 0.2], [0.78, 0.27], [0.6, 0.31]]
      .map(([x, y]) => new THREE.Vector2(x * r, y * r));
    const hull = add(new THREE.Mesh(new THREE.LatheGeometry(profile, 64), mats.chrome));
    hull.castShadow = true;
    // Deep-violet deck under the dome.
    const deck = add(new THREE.Mesh(new THREE.CircleGeometry(0.62 * r, 32), mats.violet));
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 0.305 * r;

    // Gold equator band and deep-violet inner band.
    const band = (radius, tube, y, mat) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(radius * r, tube * r, 10, 64), mat);
      t.rotation.x = Math.PI / 2;
      t.position.y = y * r;
      return add(t);
    };
    band(1.42, 0.045, 0.03, mats.gold);
    band(0.64, 0.05, 0.31, mats.gold);
    band(0.9, 0.035, 0.245, mats.violet);

    // Lit under-rim: a soft ice-white halo ring that glows out from under the saucer edge.
    const underRim = add(new THREE.Mesh(new THREE.CircleGeometry(1.75 * r, 48), mats.underRim));
    underRim.rotation.x = -Math.PI / 2;
    underRim.position.y = -0.1 * r;

    // Glass dome (violet-tinted, reflective) with a glowing gold core and a pilot silhouette.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62 * r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass);
    dome.scale.y = 0.9;
    dome.position.y = 0.3 * r;
    dome.renderOrder = 2;
    add(dome);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.17 * r, 16, 12), mats.core);
    core.position.set(0, 0.46 * r, -0.2 * r);
    add(core);
    const pilotBody = new THREE.Mesh(new THREE.ConeGeometry(0.17 * r, 0.3 * r, 12), mats.pilot);
    pilotBody.position.set(0, 0.46 * r, 0.12 * r);
    add(pilotBody);
    const pilotHead = new THREE.Mesh(new THREE.SphereGeometry(0.11 * r, 12, 10), mats.pilot);
    pilotHead.position.set(0, 0.66 * r, 0.12 * r);
    add(pilotHead);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03 * r, 8, 6), mats.iceLight);
      eye.position.set(side * 0.045 * r, 0.69 * r, 0.21 * r);
      add(eye);
    }
    const glint = new THREE.Sprite(mats.domeGlint);
    glint.scale.setScalar(0.42 * r);
    glint.position.set(-0.22 * r, 0.72 * r, -0.12 * r);
    add(glint);

    // Eight rotating ice-white rim lights: bright beads with a soft glow, on the saucer edge.
    const rimLights = new THREE.Group();
    rimLights.position.y = 0.06 * r;
    const lightGeo = new THREE.SphereGeometry(0.1 * r, 12, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = new THREE.Mesh(lightGeo, mats.iceLight);
      l.position.set(Math.cos(a) * 1.34 * r, 0.04 * r, Math.sin(a) * 1.34 * r);
      rimLights.add(l);
      const glow = new THREE.Sprite(mats.rimGlow);
      glow.scale.setScalar(0.4 * r);
      glow.position.copy(l.position);
      rimLights.add(glow);
    }
    add(rimLights);

    // Soft violet tractor glow under the saucer.
    const tractor = new THREE.Mesh(new THREE.CircleGeometry(1.35 * r, 40), mats.tractor);
    tractor.rotation.x = -Math.PI / 2;
    tractor.position.y = -0.4 * r;
    add(tractor);

    // Thruster shimmer: bright under-disc, stronger when moving, gold flare during speed.
    const shimmerMat = mats.shimmer.clone();
    const shimmer = new THREE.Mesh(new THREE.CircleGeometry(1.45 * r, 36), shimmerMat);
    shimmer.rotation.x = -Math.PI / 2;
    shimmer.position.y = -0.38 * r;
    add(shimmer);

    // Shield bubble, re-skinned violet/ice.
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.7 * r, 28, 18), mats.shield);
    shield.position.y = 0.55 * r;
    shield.visible = false;
    group.add(shield);
    const shieldRing = new THREE.Mesh(new THREE.TorusGeometry(1.7 * r, 0.035 * r, 6, 48), mats.shieldRing);
    shieldRing.rotation.x = Math.PI / 2;
    shieldRing.position.y = 0.55 * r;
    shieldRing.visible = false;
    group.add(shieldRing);

    const playerLight = new THREE.PointLight(0xc4b5ff, 5, 260, 2);
    playerLight.position.set(-30, 50, -20);
    group.add(playerLight);

    return { group, tilt, rimLights, core, shimmer, shimmerMat, shield, shieldRing, bankX: 0, bankZ: 0 };
  }

  // ---------- disposal helper ----------
  function disposeVisual(node) {
    if (node.userData.coreMat && node.userData.coreMat !== mats.shipCore) coreMatPool.push(node.userData.coreMat);
    node.traverse((o) => {
      if (o.isMesh && !o.userData.shared) o.geometry.dispose();
    });
  }

  // ---------- coins: gold nuggets (variants, geometry and materials built once at init) ----------
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Tileable 3D value noise on a 16^3 lattice, seeded.
  function makeNoise3(rand) {
    const N = 16;
    const grid = new Float32Array(N * N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
    const at = (x, y, z) => grid[((z & 15) * N + (y & 15)) * N + (x & 15)];
    const sm = (t) => t * t * (3 - 2 * t);
    const lerp = (a, b, t) => a + (b - a) * t;
    return (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
      const z0 = lerp(lerp(at(xi, yi, zi), at(xi + 1, yi, zi), fx), lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), fx), fy);
      const z1 = lerp(lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), fx), lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), fx), fy);
      return lerp(z0, z1, fz);
    };
  }
  // Displaced icosahedron: rounded lumps, small pits, flat worn facets, darkened vertex-colour crevices.
  function buildNuggetGeometry(seed) {
    const rand = seededRandom(seed * 7919 + 13);
    const noise = makeNoise3(rand);
    const geo = new THREE.IcosahedronGeometry(1, 4);
    const pos = geo.attributes.position;
    const sx = 0.8 + 0.3 * rand();
    const sy = 0.62 + 0.3 * rand();
    const sz = 0.85 + 0.3 * rand();
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // smooth, low-frequency displacement only: no pits, no hard cuts
      const d = 0.3 * noise(x * 1.2, y * 1.2, z * 1.2) + 0.1 * noise(x * 2.2 + 5, y * 2.2 + 5, z * 2.2 + 5);
      const r = 1 + d;
      pos.setXYZ(i, x * r * sx, y * r * sy, z * r * sz);
      // vertex-colour grain: darker crevices plus fine mottling
      const grain = 0.06 * noise(x * 5 + 11, y * 5 + 11, z * 5 + 11);
      const shade = Math.max(0.3, Math.min(1, 0.7 + d * 1.5 + grain));
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade * 0.96;
      colors[i * 3 + 2] = shade * 0.88;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // The icosahedron is non-indexed, so average normals across coincident vertices for smooth shading.
    const nrm = geo.attributes.normal;
    const sums = new Map();
    const keyOf = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    for (let i = 0; i < pos.count; i++) {
      const k = keyOf(i);
      const s = sums.get(k) || [0, 0, 0];
      s[0] += nrm.getX(i);
      s[1] += nrm.getY(i);
      s[2] += nrm.getZ(i);
      sums.set(k, s);
    }
    for (let i = 0; i < pos.count; i++) {
      const s = sums.get(keyOf(i));
      const len = Math.hypot(s[0], s[1], s[2]) || 1;
      nrm.setXYZ(i, s[0] / len, s[1] / len, s[2] / len);
    }
    return geo;
  }
  const nuggetMats = [0.18, 0.28, 0.4].map(
    (roughness, i) =>
      new THREE.MeshStandardMaterial({
        name: `mat_nugget_${i}`,
        color: NUGGET_BASE_COLOR,
        vertexColors: true,
        emissive: 0xb87808,
        emissiveIntensity: 0.9,
        metalness: 0.92,
        roughness,
        envMap: studioEnv,
        envMapIntensity: 1.1,
        flatShading: false,
      })
  );
  const nuggetVariants = Array.from({ length: NUGGET_VARIANTS }, (_, i) => ({ geo: buildNuggetGeometry(i + 1), mat: nuggetMats[i % nuggetMats.length] }));

  function makeCoinMesh(c) {
    const group = new THREE.Group();
    const variant = nuggetVariants[Math.floor(Math.random() * nuggetVariants.length)];
    const r = 1.25 * c.radius * VIS * (0.85 + 0.3 * Math.random());
    const tilt = new THREE.Group(); // fixed random tilt: the nugget tumbles about this tilted axis
    tilt.rotation.set((Math.random() - 0.5) * Math.PI, Math.random() * Math.PI * 2, (Math.random() - 0.5) * Math.PI);
    group.add(tilt);
    const nugget = new THREE.Mesh(variant.geo, variant.mat);
    nugget.scale.setScalar(r);
    nugget.castShadow = true;
    nugget.userData.shared = true; // geometry belongs to the variant, never disposed per coin
    tilt.add(nugget);
    const halo = new THREE.Sprite(mats.nuggetHalo);
    halo.scale.setScalar(r * 4.0);
    halo.renderOrder = 3; // after the floor and edge glow planes
    group.add(halo);
    // 3-5 sparkles ride the nugget surface (children of the tumbling mesh); shared material.
    const sparkles = [];
    const nSpark = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nSpark; i++) {
      const sp = new THREE.Sprite(mats.nuggetSparkle);
      nugget.add(sp);
      sparkles.push({ sp, theta: Math.random() * Math.PI * 2, phi: 0.35 + Math.random() * 2.4, dTheta: (Math.random() < 0.5 ? -1 : 1) * (0.9 + 0.6 * Math.random()), dPhi: 0.5 + 0.3 * Math.random(), ph: Math.random() * Math.PI * 2, rate: 5 + 3 * Math.random() });
    }
    group.userData.sparkles = sparkles;
    group.userData.nugget = nugget;
    group.userData.rate = 0.5 + 0.3 * Math.random(); // rad/s
    group.userData.phase = Math.random() * Math.PI * 2;
    return group;
  }

  // ---------- power-ups: five flat symbols, geometry built once at init ----------
  // Unit-radius outlines; makePowerUpMesh only scales shared geometry.
  function shieldPath(path, s) {
    // heater shield: flat top, straight upper sides, curved lower sides, pointed base
    path.moveTo(-0.85 * s, 0.9 * s);
    path.lineTo(0.85 * s, 0.9 * s);
    path.lineTo(0.85 * s, 0.2 * s);
    path.quadraticCurveTo(0.8 * s, -0.55 * s, 0, -1 * s);
    path.quadraticCurveTo(-0.8 * s, -0.55 * s, -0.85 * s, 0.2 * s);
    path.lineTo(-0.85 * s, 0.9 * s);
    return path;
  }
  const polyShape = (pts) => {
    const shape = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    return shape;
  };
  const puIconGeo = (() => {
    const shield = shieldPath(new THREE.Shape(), 1);
    shield.holes.push(shieldPath(new THREE.Path(), 0.66));
    const chevron = (dx) => polyShape([[-0.9 + dx, 0.8], [-0.35 + dx, 0.8], [0.25 + dx, 0], [-0.35 + dx, -0.8], [-0.9 + dx, -0.8], [-0.3 + dx, 0]]);
    const clockRing = new THREE.Shape();
    clockRing.absarc(0, 0, 1, 0, Math.PI * 2, false);
    const clockHole = new THREE.Path();
    clockHole.absarc(0, 0, 0.8, 0, Math.PI * 2, true);
    clockRing.holes.push(clockHole);
    const a = 0.34; // cross arm half-width
    const cross = polyShape([[-a, 1], [a, 1], [a, a], [1, a], [1, -a], [a, -a], [a, -1], [-a, -1], [-a, -a], [-1, -a], [-1, a], [-a, a]]);
    const magnet = new THREE.Shape();
    magnet.moveTo(-0.95, -0.9);
    magnet.lineTo(-0.95, 0.1);
    magnet.absarc(0, 0.1, 0.95, Math.PI, 0, true);
    magnet.lineTo(0.95, -0.9);
    magnet.lineTo(0.5, -0.9);
    magnet.lineTo(0.5, 0.1);
    magnet.absarc(0, 0.1, 0.5, 0, Math.PI, false);
    magnet.lineTo(-0.5, -0.9);
    magnet.closePath();
    const make = (...shapes) => shapes.map((s) => new THREE.ShapeGeometry(s, 12));
    // contrasting magnet tips over the ends of the two arms
    const magnetTips = make(
      polyShape([[-0.95, -0.9], [-0.5, -0.9], [-0.5, -0.45], [-0.95, -0.45]]),
      polyShape([[0.5, -0.9], [0.95, -0.9], [0.95, -0.45], [0.5, -0.45]]),
    );
    return {
      magnetTips,
      health: make(cross),
      shield: make(shield),
      slow: make(clockRing, polyShape([[-0.06, 0], [0.06, 0], [0.06, 0.58], [-0.06, 0.58]]), polyShape([[0, -0.06], [0.44, -0.06], [0.44, 0.06], [0, 0.06]])),
      speed: make(chevron(0), chevron(0.65)),
      magnet: make(magnet),
    };
  })();
  const puTipMat = new THREE.MeshBasicMaterial({ name: "mat_pu_magnet_tip", color: 0xffffff, side: THREE.DoubleSide });
  const PU_FACE_TILT = -(Math.PI / 2 - FIT_TILT); // symbol stands to face the tilted camera
  function makePowerUpMesh(pu) {
    const group = new THREE.Group();
    const pr = pu.radius * VIS;
    const pm = puMats[pu.kind];
    const face = new THREE.Group(); // tilted toward the camera, scaled once
    face.position.y = pr * 1.1;
    face.rotation.x = PU_FACE_TILT;
    face.scale.setScalar(pr * 1.1);
    const glow = new THREE.Group(); // soft glow: a slightly larger copy of the symbol, behind it
    glow.position.z = -0.02;
    glow.scale.setScalar(1.18);
    for (const geo of puIconGeo[pu.kind]) {
      const g = new THREE.Mesh(geo, pm.halo);
      g.userData.shared = true;
      glow.add(g);
      const m = new THREE.Mesh(geo, pm.body);
      m.userData.shared = true;
      face.add(m);
    }
    face.add(glow);
    if (pu.kind === "magnet") {
      for (const geo of puIconGeo.magnetTips) {
        const t = new THREE.Mesh(geo, puTipMat);
        t.userData.shared = true;
        t.position.z = 0.01;
        face.add(t);
      }
    }
    group.add(face);
    group.userData.face = face;
    return group;
  }

  // ---------- Octagon ship (shared geometry, built once) ----------
  // CR12: a symmetrical regular octagon from above, no nose and no front. Lathe profiles with 8
  // radial segments give the octagon plan; the profile is rounded (a bevel from the top plate into
  // the hull and a second bevel down to the under-halo), so the sides carry no vertical square faces.
  const SHIP_SEGMENTS = 8;
  const lathe = (profile) => new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), SHIP_SEGMENTS);
  const HULL_PROFILE = [[0, -0.2], [0.55, -0.22], [0.82, -0.17], [0.96, -0.09], [1.0, 0], [0.97, 0.09], [0.86, 0.17], [0.66, 0.22], [0.5, 0.235], [0, 0.235]];
  const PLATE_PROFILE = [[0, 0.2], [0.44, 0.2], [0.5, 0.235], [0.46, 0.3], [0.38, 0.34], [0, 0.34]];
  const SEAM_RINGS = [[0.66, 0.22]]; // [radius, height]: one thin seam loop along the top-bevel octagon edges
  const shipGeo = {
    hull: lathe(HULL_PROFILE),
    plate: lathe(PLATE_PROFILE),
    seam: new THREE.BoxGeometry(1, 0.022, 0.022),
    core: new THREE.SphereGeometry(0.22, 20, 14),
    lens: new THREE.SphereGeometry(0.27, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    halo: new THREE.CircleGeometry(1.15, 24),
    trim: new THREE.TorusGeometry(0.99, 0.03, 8, SHIP_SEGMENTS),
    trimInner: new THREE.TorusGeometry(0.5, 0.02, 8, SHIP_SEGMENTS),
    panel: new THREE.BoxGeometry(0.3, 0.025, 0.14),
    vent: new THREE.BoxGeometry(0.16, 0.05, 0.03),
  };
  // One core material per possible ship (6 roamers + 2 chasers + 1 boss), built at init and handed out on spawn.
  const coreMatPool = Array.from({ length: 10 }, () => mats.shipCore.clone());
  function makeShipMesh(ship) {
    const chaser = ship && ship.kind === "chaser";
    const seamMat = chaser ? mats.chaserSeam : mats.shipSeam;
    const root = new THREE.Group();
    const visual = new THREE.Group();
    root.add(visual);
    root.userData.visual = visual;
    const part = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.shared = true;
      visual.add(m);
      return m;
    };
    part(shipGeo.hull, mats.shipHull);
    part(shipGeo.plate, mats.shipPlate);
    // thin dim seam strips along the top-bevel octagon edges (red; orange on chasers)
    const half = Math.PI / SHIP_SEGMENTS; // half an edge, in plan angle
    for (const [r, y] of SEAM_RINGS) {
      const len = 2 * r * Math.sin(half);
      const apothem = r * Math.cos(half) + 0.02;
      for (let i = 0; i < SHIP_SEGMENTS; i++) {
        const phi = (i + 0.5) * half * 2; // mid-edge angle; lathe vertices sit at i * 2 * half
        const seam = part(shipGeo.seam, seamMat, Math.sin(phi) * apothem, y, Math.cos(phi) * apothem);
        seam.scale.x = len;
        seam.rotation.y = phi;
        seam.castShadow = false;
      }
    }
    // premium finish: polished chrome rim rings (corners on the hull corners, so the edge stays a clean
    // octagon), inset ceramic panels on the bevel faces and four dim engine vents on the rim faces
    const trim = part(shipGeo.trim, mats.shipTrim, 0, 0.0, 0);
    trim.rotation.x = Math.PI / 2;
    trim.castShadow = false;
    const trimIn = part(shipGeo.trimInner, mats.shipTrim, 0, 0.24, 0);
    trimIn.rotation.x = Math.PI / 2;
    trimIn.castShadow = false;
    for (let i = 0; i < SHIP_SEGMENTS; i++) {
      const phi = (i + 0.5) * half * 2;
      const pn = part(shipGeo.panel, mats.shipPanel, Math.sin(phi) * 0.78, 0.185, Math.cos(phi) * 0.78);
      pn.rotation.y = phi;
      pn.rotation.x = -0.28;
      pn.castShadow = false;
      if (i % 2 === 0) {
        const vent = part(shipGeo.vent, chaser ? mats.chaserVent : mats.shipVent, Math.sin(phi) * 0.955, -0.04, Math.cos(phi) * 0.955);
        vent.rotation.y = phi;
        vent.castShadow = false;
      }
    }
    const coreMat = coreMatPool.pop() || mats.shipCore; // own pooled material: it brightens before each volley
    const core = part(shipGeo.core, coreMat, 0, 0.33, 0);
    core.castShadow = false;
    root.userData.coreMat = coreMat;
    const lens = part(shipGeo.lens, mats.shipLens, 0, 0.33, 0); // smoked glass over the core: a specular glint, not a flat disc
    lens.castShadow = false;
    lens.renderOrder = 2;
    const halo = part(shipGeo.halo, chaser ? mats.chaserHalo : mats.shipHalo, 0, -0.18, 0); // under-halo
    halo.rotation.x = -Math.PI / 2;
    halo.castShadow = false;
    root.userData.core = core;
    return root;
  }

  // ---------- pooled spark bullets
  // (CR13 spark-spray: one Points buffer, built at init)
  // CR17b: each bullet is a jewel-bright core pinned on the simulated point (lag 0, inside the hit radius),
  // a soft glow, a smooth tapered ribbon along bulletPoint at increasing lag (white-gold -> orange -> crimson)
  // with a wide dim bloom under it, and seeded ember dust that peels off the ribbon, slows and fades.
  // Dust is closed-form in the bullet's age and a per-slot seed, so it never flickers frame to frame.
  // A separate small Points buffer carries the 4-point head glint. Path, life, hit radius and damage are unchanged.
  const CORE_SPARKS = 2; // jewel core + soft glow
  const RIBBON_SPARKS = 40; // heavily overlapping points, so the ribbon reads as one continuous stroke
  const BLOOM_SPARKS = 6; // wide, dim points under the ribbon
  const DUST_SPARKS = 6;
  // ribbon slot -> lag fraction: denser toward the thin tail so the taper never breaks into beads
  const ribbonT = (j) => 1 - Math.pow(1 - (j - CORE_SPARKS + 1) / RIBBON_SPARKS, 0.7);
  const BULLET_SPARKS = CORE_SPARKS + RIBBON_SPARKS + BLOOM_SPARKS + DUST_SPARKS;
  const RIBBON_SPAN = 0.5; // fraction of TRAIL_SPAN the ribbon covers
  const DUST_SPAN = 0.6;
  const bulletHash = (s) => { const v = Math.sin(s * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const sparkPositions = new Float32Array(MAX_BULLETS * BULLET_SPARKS * 3);
  const sparkColors = new Float32Array(MAX_BULLETS * BULLET_SPARKS * 3);
  const sparkShrink = new Float32Array(MAX_BULLETS * BULLET_SPARKS);
  const sparkBase = new Float32Array(BULLET_SPARKS * 3); // per-slot colour; fade scales it into sparkColors each frame
  {
    // Stops are sRGB hex converted to linear, so the screen shows true yellow/orange/red.
    const stops = [new THREE.Color(0xfff0a0), new THREE.Color(0xffb020), new THREE.Color(0xff5208), new THREE.Color(0xd80c04)];
    const mix = new THREE.Color();
    for (let j = 0; j < BULLET_SPARKS; j++) {
      if (j === 0) mix.setRGB(1, 1, 0.92); // white-hot core
      else if (j === 1) mix.copy(stops[2]).multiplyScalar(0.55); // hot glow around it
      else if (j < CORE_SPARKS + RIBBON_SPARKS) {
        const t = ribbonT(j); // ribbon runs white-gold -> orange -> crimson
        mix.copy(stops[0]).lerp(stops[1], Math.min(1, t * 2.2)).lerp(stops[2], Math.max(0, Math.min(1, t * 2 - 0.6))).lerp(stops[3], Math.max(0, t - 0.6));
        mix.multiplyScalar(1 - 0.4 * t);
      } else if (j < CORE_SPARKS + RIBBON_SPARKS + BLOOM_SPARKS) {
        const t = (j - CORE_SPARKS - RIBBON_SPARKS + 0.5) / BLOOM_SPARKS;
        mix.copy(stops[1]).lerp(stops[3], t).multiplyScalar(0.3); // bloom: dim orange fading to crimson
      } else mix.copy(stops[j % 2]).lerp(stops[1], 0.5).multiplyScalar(0.7); // dust: soft gold and amber embers
      sparkBase[j * 3] = mix.r;
      sparkBase[j * 3 + 1] = mix.g;
      sparkBase[j * 3 + 2] = mix.b;
    }
  }
  // Tight spark sprite: hard bright centre, quick falloff, so small points read as sparks, not blobs.
  const bulletSparkTex = buildSoftTexture(32, [[0, 1], [0.18, 0.95], [0.4, 0.35], [0.65, 0.06], [1, 0]]);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3));
  sparkGeo.setAttribute("aShrink", new THREE.BufferAttribute(sparkShrink, 1));
  sparkGeo.setDrawRange(0, 0);
  const sparkMat = new THREE.PointsMaterial({ name: "mat_bullet_sparks", color: 0xffffff, map: bulletSparkTex, size: 10, sizeAttenuation: true, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  sparkMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float aShrink;\nvoid main() {")
      .replace("gl_PointSize = size;", "gl_PointSize = size * aShrink;");
  };
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  sparkPoints.renderOrder = 6;
  scene.add(sparkPoints);
  // Head glint: one 4-point star sprite per bullet, slow pulse, built once.
  const bulletGlintTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.12, "rgba(255,240,180,0.7)");
    grad.addColorStop(1, "rgba(255,200,80,0)");
    g.fillStyle = grad;
    for (const [w, h] of [[64, 4], [4, 64]]) { // the two bars of the cross, tapered by the gradient
      g.save();
      g.beginPath();
      g.rect(32 - w / 2, 32 - h / 2, w, h);
      g.clip();
      g.fillRect(0, 0, 64, 64);
      g.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const glintPositions = new Float32Array(MAX_BULLETS * 3);
  const glintColors = new Float32Array(MAX_BULLETS * 3);
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute("position", new THREE.BufferAttribute(glintPositions, 3));
  glintGeo.setAttribute("color", new THREE.BufferAttribute(glintColors, 3));
  glintGeo.setDrawRange(0, 0);
  const glintMat = new THREE.PointsMaterial({ name: "mat_bullet_glint", color: 0xffffff, map: bulletGlintTex, size: 3.2, sizeAttenuation: true, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const glintPoints = new THREE.Points(glintGeo, glintMat);
  glintPoints.frustumCulled = false;
  glintPoints.renderOrder = 7;
  scene.add(glintPoints);

  const BULLET_Y = 8;
  const bulletTmp = { x: 0, y: 0 };
  function syncBullets(game) {
    fwGame = game; // the victory explosion reads its clock and the UFO position from here
    const pool = game.bullets;
    const es = game.entityScale;
    const head = game.headRadius * es;
    const alpha = game.fadeAlpha;
    const halfPW = planeW / 2;
    const halfPH = planeH / 2;
    let n = 0;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (!b.active) continue;
      const fade = bulletFade(b.age, b.life) * alpha;
      const shrink = (0.5 + 0.5 * fade) * alpha; // shrinks slightly while fading
      const base = n * BULLET_SPARKS;
      // local travel direction (head minus a point just behind it) and its perpendicular, for the dust
      bulletPoint(b, TRAIL_SPAN * 0.06, bulletTmp);
      let dx = b.x - bulletTmp.x;
      let dy = b.y - bulletTmp.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      for (let j = 0; j < BULLET_SPARKS; j++) {
        let cx = b.x;
        let cy = b.y;
        let size;
        let bright = 1;
        if (j === 0) {
          size = 0.95; // white-hot core stays exactly on the simulated position, inside the hit radius
        } else if (j === 1) {
          size = 2.0; // dim hot glow behind the core
        } else if (j < CORE_SPARKS + RIBBON_SPARKS) {
          const t = ribbonT(j);
          bulletPoint(b, TRAIL_SPAN * RIBBON_SPAN * t, bulletTmp);
          cx = bulletTmp.x;
          cy = bulletTmp.y;
          const tip = Math.min(1, (1 - t) * 3.5);
          size = 0.8 * Math.pow(1 - t, 0.6) + 0.1 * tip; // gentle taper; slots crowd the tail so it stays one stroke
          bright = (0.45 + 0.55 * (1 - t)) * tip * tip; // tail dims out instead of ending on a dot
        } else if (j < CORE_SPARKS + RIBBON_SPARKS + BLOOM_SPARKS) {
          const t = (j - CORE_SPARKS - RIBBON_SPARKS + 0.5) / BLOOM_SPARKS;
          bulletPoint(b, TRAIL_SPAN * RIBBON_SPAN * t, bulletTmp);
          cx = bulletTmp.x;
          cy = bulletTmp.y;
          size = 2.4 * (1 - 0.7 * t); // soft bloom: wide and dim, past the hit radius by design
        } else {
          // seeded ember: peels off the ribbon, slows (ease-out) and fades; same picture on any frame step
          const d = j - CORE_SPARKS - RIBBON_SPARKS - BLOOM_SPARKS;
          const seed = i * 31.7 + d * 7.31;
          const ph = (bulletHash(seed) + b.age * (0.5 + 0.5 * bulletHash(seed + 1))) % 1;
          const e = 1 - (1 - ph) * (1 - ph);
          bulletPoint(b, TRAIL_SPAN * DUST_SPAN * (0.08 + 0.92 * e * 0.5 + 0.04 * d / DUST_SPARKS), bulletTmp);
          const side = (bulletHash(seed + 2) * 2 - 1) * head * (0.15 + 0.9 * e);
          cx = bulletTmp.x - dy * side;
          cy = bulletTmp.y + dx * side;
          size = (0.4 - 0.22 * ph) * (0.7 + 0.5 * bulletHash(seed + 3));
          bright = (1 - ph) * (1 - ph) * 0.55;
        }
        const v = (base + j) * 3;
        sparkPositions[v] = cx - halfPW;
        sparkPositions[v + 1] = BULLET_Y;
        sparkPositions[v + 2] = cy - halfPH;
        sparkColors[v] = sparkBase[j * 3] * fade * bright;
        sparkColors[v + 1] = sparkBase[j * 3 + 1] * fade * bright;
        sparkColors[v + 2] = sparkBase[j * 3 + 2] * fade * bright;
        sparkShrink[base + j] = size * shrink;
      }
      const gv = n * 3; // head glint: slow pulse in bullet age, on the simulated point
      const pulse = REDUCED_MOTION ? 0.8 : 0.7 + 0.3 * Math.sin(b.age * 5 + i);
      glintPositions[gv] = b.x - halfPW;
      glintPositions[gv + 1] = BULLET_Y;
      glintPositions[gv + 2] = b.y - halfPH;
      glintColors[gv] = glintColors[gv + 1] = glintColors[gv + 2] = 0.6 * pulse * fade * shrink;
      n++;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.aShrink.needsUpdate = true;
    sparkGeo.setDrawRange(0, n * BULLET_SPARKS);
    sparkMat.size = 10 * es;
    glintGeo.attributes.position.needsUpdate = true;
    glintGeo.attributes.color.needsUpdate = true;
    glintGeo.setDrawRange(0, n);
    glintMat.size = 2.4 * 10 * es;
  }

  // ---------- generic per-kind mesh pools keyed by entity.id ----------
  const coinMeshes = new Map();
  const puMeshes = new Map();
  const shipMeshes = new Map();
  let syncFrame = 0;

  function syncPool(map, list, makeMesh, positionMesh) {
    for (const ent of list) {
      let mesh = map.get(ent.id);
      if (!mesh) {
        mesh = makeMesh(ent);
        scene.add(mesh);
        map.set(ent.id, mesh);
      }
      mesh.userData.stamp = syncFrame;
      positionMesh(mesh, ent);
    }
    for (const [id, mesh] of map) {
      if (mesh.userData.stamp !== syncFrame) {
        scene.remove(mesh);
        disposeVisual(mesh);
        map.delete(id);
      }
    }
  }

  // ---------- coin pickup sparks (GPU particles) ----------
  const sparkBursts = [];
  function spawnBurst3D(x, y, kind = "coin", count = SPARK_COUNT) {
    if (sparkBursts.length >= SPARK_POOL_MAX) {
      const old = sparkBursts.shift();
      old.points.parent && scene.remove(old.points);
      old.points.geometry.dispose();
      old.points.material.dispose();
    }
    const p = toWorld(x, y, 6);
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 90;
      velocities.push({ vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, vy: 120 + Math.random() * 80 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      name: "mat_spark_points",
      color: BURST_COLORS[kind] ?? BURST_COLORS.coin,
      size: 6,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: sparkTexture,
    });
    const points = new THREE.Points(geo, mat);
    points.position.set(p.x, p.y, p.z);
    scene.add(points);
    sparkBursts.push({ points, velocities, t: 0 });
  }

  // ---------- coin collect burst (P8: dedicated pool, zero per-frame alloc) ----------
  function buildCoinBurstSlot() {
    const positions = new Float32Array(COIN_BURST.count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      name: "mat_coin_burst",
      color: BURST_COLORS.coin,
      size: COIN_BURST.size,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: sparkTexture,
    });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    scene.add(points);
    return {
      points,
      velocities: Array.from({ length: COIN_BURST.count }, () => ({ vx: 0, vy: 0, vz: 0 })),
      active: false,
      t: 0,
    };
  }
  const coinBurstPool = Array.from({ length: COIN_BURST_POOL_SIZE }, buildCoinBurstSlot);
  let coinPoolCursor = 0;

  function spawnCoinBurst(x, y) {
    const b = coinBurstPool[coinPoolCursor];
    coinPoolCursor = (coinPoolCursor + 1) % coinBurstPool.length;
    const p = toWorld(x, y, 6);
    b.points.position.set(p.x, p.y, p.z);
    b.points.visible = true;
    b.points.material.opacity = 1;
    b.points.material.size = COIN_BURST.size;
    b.t = 0;
    b.active = true;
    const pos = b.points.geometry.attributes.position;
    for (let i = 0; i < COIN_BURST.count; i++) {
      pos.setXYZ(i, 0, 0, 0);
      const a = Math.random() * Math.PI * 2;
      const speed = COIN_BURST.speedMin + Math.random() * (COIN_BURST.speedMax - COIN_BURST.speedMin);
      const vy = COIN_BURST.speedMin + Math.random() * (COIN_BURST.speedMax - COIN_BURST.speedMin);
      const v = b.velocities[i];
      v.vx = Math.cos(a) * speed;
      v.vz = Math.sin(a) * speed;
      v.vy = vy;
    }
    pos.needsUpdate = true;
  }

  function updateCoinBursts(dt) {
    for (const b of coinBurstPool) {
      if (!b.active) continue;
      b.t += dt;
      const pos = b.points.geometry.attributes.position;
      for (let i = 0; i < COIN_BURST.count; i++) {
        const v = b.velocities[i];
        v.vy -= COIN_BURST.gravity * dt;
        pos.setXYZ(i, pos.getX(i) + v.vx * dt, Math.max(0, pos.getY(i) + v.vy * dt), pos.getZ(i) + v.vz * dt);
      }
      pos.needsUpdate = true;
      const remain = Math.max(0, 1 - b.t / COIN_BURST.life);
      b.points.material.opacity = remain;
      b.points.material.size = COIN_BURST.size * remain; // fade and shrink to 0
      if (b.t >= COIN_BURST.life) {
        b.active = false;
        b.points.visible = false;
      }
    }
  }

  // ---------- near-miss sparks (pooled, built at init) ----------
  const NEAR_MISS = { count: 3, speedMin: 50, speedMax: 120, life: 0.25, size: 7, drag: 3, poolSize: 6 };
  function buildPuffSlot(count, color, size) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({ name: "mat_puff", color, size, sizeAttenuation: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: sparkTexture, toneMapped: false, fog: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 7;
    scene.add(points);
    return { points, velocities: Array.from({ length: count }, () => ({ vx: 0, vz: 0 })), active: false, t: 0, size, life: 1, drag: 1 };
  }
  function armPuff(slot, cfg, x, y) {
    const p = toWorld(x, y, 12);
    slot.points.position.set(p.x, p.y, p.z);
    slot.points.visible = true;
    slot.points.material.opacity = 1;
    slot.points.material.size = cfg.size;
    slot.t = 0;
    slot.life = cfg.life;
    slot.drag = cfg.drag;
    slot.active = true;
    const pos = slot.points.geometry.attributes.position;
    for (let i = 0; i < slot.velocities.length; i++) {
      pos.setXYZ(i, 0, 0, 0);
      const a = Math.random() * Math.PI * 2;
      const sp = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
      slot.velocities[i].vx = Math.cos(a) * sp;
      slot.velocities[i].vz = Math.sin(a) * sp;
    }
    pos.needsUpdate = true;
  }
  function updatePuff(slot, dt) {
    if (!slot.active) return;
    slot.t += dt;
    const k = Math.max(0, 1 - slot.drag * dt);
    const pos = slot.points.geometry.attributes.position;
    for (let i = 0; i < slot.velocities.length; i++) {
      const v = slot.velocities[i];
      v.vx *= k;
      v.vz *= k;
      pos.setXYZ(i, pos.getX(i) + v.vx * dt, 0, pos.getZ(i) + v.vz * dt);
    }
    pos.needsUpdate = true;
    const remain = Math.max(0, 1 - slot.t / slot.life);
    slot.points.material.opacity = remain;
    slot.points.material.size = slot.size * (0.4 + 0.6 * remain);
    if (slot.t >= slot.life) {
      slot.active = false;
      slot.points.visible = false;
    }
  }
  const nearMissPool = Array.from({ length: NEAR_MISS.poolSize }, () => buildPuffSlot(NEAR_MISS.count, 0xffffff, NEAR_MISS.size));
  let nearMissCursor = 0;

  // ---------- victory explosion (CR17b): one celebratory explosion made for this game, centred on the UFO ----------
  // In order: a white-gold flash, an expanding ring shockwave that thins and fades, coin-gold glints flung along the
  // game's own 4-arm spiral, fine ember dust that drifts and fades, and three smaller secondary pops echoing the first.
  // Coin gold, white and the UFO accent; additive. One pooled buffer built once here; every point is closed-form in the
  // explosion's age, so any frame step lands on the same picture. Everything is done inside VICTORY_SECONDS (2.5).
  const FW = {
    arms: 4, glints: 36, trail: 4, ring: 300, dust: 170, pops: 3, popRing: 44, popSparks: 24,
    popAt: [0.42, 0.78, 1.12], // s after spawnVictory
    glintLife: 2.0, dustLife: [1.4, 2.1], ringLife: 1.55, flashLife: 0.35, glowLife: 1.5, popLife: 0.95,
    lite: 0.6, // phone share of the glint and dust counts, for frame rate (the ring keeps its count so it stays a band)
  };
  const FW_COLORS = { gold: new THREE.Color(BURST_COLORS.coin), white: new THREE.Color(0xfff6e8), accent: new THREE.Color(0x8fd8ff),
    ember: new THREE.Color(0xffa23a) };
  const fwPerPop = 1 + FW.popRing + FW.popSparks;
  // 3 core points (flash, gold glow, accent halo) + ring (bright edge + soft accent band) + streaked glints + dust + pops
  const fwCount = 3 + 2 * FW.ring + FW.arms * FW.glints * FW.trail + FW.dust + FW.pops * fwPerPop;
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fwCount * 3), 3));
  fwGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(fwCount * 3), 3));
  fwGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(fwCount), 1));
  const fwMat = new THREE.ShaderMaterial({
    name: "mat_fireworks",
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    uniforms: { uPx: { value: 1 } },
    vertexShader: [
      "attribute vec3 aColor; attribute float aSize; uniform float uPx; varying vec3 vC;",
      "void main(){ vC = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
      "  gl_PointSize = aSize * uPx; if (aSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }",
    ].join("\n"),
    fragmentShader: [
      "varying vec3 vC;",
      "void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;",
      "  float core = exp(-d * d * 9.0); float glow = exp(-d * d * 2.6) * 0.45;",
      "  gl_FragColor = vec4(vC * (core + glow) + vec3(core * core * 0.35) * max(vC.r, max(vC.g, vC.b)), 1.0); }",
    ].join("\n"),
  });
  const fwPoints = new THREE.Points(fwGeo, fwMat);
  fwPoints.name = "victory_fireworks";
  fwPoints.frustumCulled = false;
  fwPoints.visible = false;
  fwPoints.renderOrder = 9;
  scene.add(fwPoints);
  // Per-explosion state, rewritten in place on each spawnVictory (no allocation after init). Seeds are drawn once per spawn.
  const fwState = {
    cx: 0, cy: 0, spin: 1, lite: 1, salt: 0,
    pops: Array.from({ length: FW.pops }, () => ({ x: 0, y: 0, rot: 0, col: null })),
  };
  let fwT = 0;
  let fwActive = false;
  let fwUnit = 1; // field px per "design px": burst radius, gravity and sprite size follow the viewport
  const fwRand = (s) => { const v = Math.sin(s * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  // The explosion's clock and centre come from the game itself (syncBullets keeps fwGame): age = victory time elapsed,
  // so a stepped or skipped frame lands on the same picture, and the centre is the UFO even before its mesh has synced.
  let fwGame = null;
  let fwPhase0 = -1;

  function spawnVictory() {
    const W = planeW, H = planeH;
    const portrait = H > W;
    fwUnit = Math.max(0.55, Math.min(W, H * 1.4) / 1100);
    fwState.lite = portrait ? FW.lite : 1;
    fwState.spin = Math.random() < 0.5 ? 1 : -1;
    fwState.salt = Math.random() * 1000;
    // centred on the UFO: the game's player position, or its world position back to field coordinates
    const up = player.group.position;
    const gp = fwGame && fwGame.player;
    fwState.cx = gp ? gp.x : up.x + W / 2;
    fwState.cy = gp ? gp.y : up.z + H / 2;
    fwPhase0 = fwGame && fwGame.phase === "victory" ? fwGame.phaseT : -1;
    // pops fan out above the UFO (towards the open field), always inside the field
    const popR = portrait ? 0.3 * W : 0.14 * W;
    for (let p = 0; p < FW.pops; p++) {
      const pop = fwState.pops[p];
      const a = -Math.PI / 2 + (p - 1) * 1.05 * fwState.spin + (fwRand(fwState.salt + p) - 0.5) * 0.5;
      const d = popR * (0.85 + 0.35 * fwRand(fwState.salt + p + 9));
      pop.x = Math.min(W * 0.92, Math.max(W * 0.08, fwState.cx + Math.cos(a) * d));
      pop.y = Math.min(H * 0.9, Math.max(H * 0.1, fwState.cy + Math.sin(a) * d));
      pop.rot = a;
      pop.col = p === 1 ? FW_COLORS.accent : FW_COLORS.gold;
    }
    fwT = 0;
    fwActive = true;
    fwPoints.visible = true;
    updateFireworks(0);
  }

  let fwN = 0;
  function fwPut(x, y, c, b, sz) {
    const pos = fwGeo.attributes.position.array, col = fwGeo.attributes.aColor.array, i = fwN * 3;
    pos[i] = x - planeW / 2; pos[i + 1] = 0; pos[i + 2] = y - planeH / 2; // toWorld(x, y, 0) without the object
    col[i] = c.r * b; col[i + 1] = c.g * b; col[i + 2] = c.b * b;
    fwGeo.attributes.aSize.array[fwN] = b > 0.003 ? sz : 0;
    fwN++;
  }

  function updateFireworks(dt) {
    if (!fwActive) return;
    // age from the game's victory clock while it runs (closed-form), then by frame time for the last embers
    fwT = fwGame && fwPhase0 >= 0 && fwGame.phase === "victory" ? Math.max(0, fwPhase0 - fwGame.phaseT) : fwT + dt;
    fwMat.uniforms.uPx.value = base.renderer.getPixelRatio();
    const u = fwUnit;
    const put = fwPut;
    const t = fwT;
    const { cx, cy, spin, lite, salt } = fwState;
    const portrait = planeH > planeW;
    const Rm = portrait ? 0.44 * planeW : 0.2 * planeW; // main glint reach
    const TAU = Math.PI * 2;
    const gold = FW_COLORS.gold, white = FW_COLORS.white, accent = FW_COLORS.accent, ember = FW_COLORS.ember;
    fwN = 0;
    // 1. white-gold flash at the UFO, a warm gold glow that lingers, and a UFO-blue halo that swells and fades
    const fl = t < FW.flashLife ? 1 - t / FW.flashLife : 0;
    const gl = t < FW.glowLife ? Math.pow(1 - t / FW.glowLife, 2) : 0;
    put(cx, cy, white, 1.1 * fl * fl, 120 * u * (0.45 + 0.55 * fl));
    put(cx, cy, gold, 0.6 * gl, 230 * u * (0.55 + 0.45 * gl));
    put(cx, cy, accent, 0.4 * Math.exp(-2.6 * t) * Math.min(1, t * 12), 300 * u * (0.5 + 0.6 * (1 - Math.exp(-4 * t))));
    // 2. ring shockwave: a bright white-gold edge over a soft UFO-blue band; expands fast, thins and fades.
    // Seeded radial jitter and size so it reads as a wave of light, not a string of even beads.
    const rf = t / FW.ringLife;
    const rr = Rm * 1.3 * (1 - Math.exp(-3.2 * t));
    const rfade = rf < 1 ? (1 - rf) * (1 - rf) : 0;
    for (let i = 0; i < FW.ring; i++) {
      if (rf >= 1) { put(cx, cy, gold, 0, 0); continue; }
      const a = ((i + fwRand(salt + i) * 0.6) / FW.ring) * TAU;
      const r = rr * (1 + (fwRand(salt + i + 0.5) - 0.5) * 0.05 * (1 + 2 * rf));
      put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, i % 3 === 0 ? white : gold, 0.75 * rfade, (4 + 10 * (1 - rf)) * u * (0.8 + 0.4 * fwRand(salt + i + 0.7)));
    }
    for (let i = 0; i < FW.ring; i++) {
      if (rf >= 1) { put(cx, cy, accent, 0, 0); continue; }
      const a = ((i + 0.5) / FW.ring) * TAU;
      const r = rr * (0.93 - 0.05 * rf);
      put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, accent, 0.22 * rfade, (14 + 18 * (1 - rf)) * u);
    }
    // 3. coin-gold glints flung along the game's 4-arm spiral; each glint is a short streak (head + fading trail)
    const gN = Math.round(FW.glints * lite);
    for (let arm = 0; arm < FW.arms; arm++) {
      for (let i = 0; i < FW.glints; i++) {
        const gs = salt + arm * 50 + i;
        const k = (i + fwRand(gs + 0.3)) / gN; // seeded spacing along the arm: a spiral of glints, not a dotted line
        const ta = t - (0.02 + k * 0.14);
        const lf = ta / FW.glintLife;
        const jr = 1 + (fwRand(gs + 0.6) - 0.5) * 0.12;
        const ja = (fwRand(gs + 0.9) - 0.5) * 0.16;
        const tw = 0.75 + 0.25 * Math.sin(ta * 13 + fwRand(gs) * TAU); // seeded twinkle
        for (let q = 0; q < FW.trail; q++) {
          if (i >= gN || ta < 0 || ta > FW.glintLife) { put(cx, cy, gold, 0, 0); continue; }
          // short streak behind each glint, back along its spiral path (shorter as it slows)
          const back = q * 0.045 * Math.exp(-1.6 * ta);
          const r = Rm * (0.12 + 0.95 * k) * jr * (1 - Math.exp(-3 * ta)) * (1 - back);
          const a = (arm * TAU) / FW.arms + salt + ja + spin * (2.4 * k + 1.4 * (r / Rm));
          const b = (lf < 0.06 ? 1.6 : 1) * Math.pow(1 - lf, 1.2) * tw * (1 - 0.22 * q);
          put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, q === 0 && i % 4 === 0 ? white : gold, b, (10 - 1.8 * q) * (1 - 0.45 * lf) * u);
        }
      }
    }
    // 4. ember dust: seeded per point, drifts out slowly, settles and fades
    const dN = Math.round(FW.dust * lite);
    for (let i = 0; i < FW.dust; i++) {
      const s = salt + i * 3.7;
      const ta = t - (0.05 + fwRand(s) * 0.3);
      const life = FW.dustLife[0] + fwRand(s + 1) * (FW.dustLife[1] - FW.dustLife[0]);
      if (i >= dN || ta < 0 || ta > life) { put(cx, cy, gold, 0, 0); continue; }
      const a = fwRand(s + 2) * TAU;
      const r = Rm * (0.15 + 1.0 * fwRand(s + 3)) * (1 - Math.exp(-1.8 * ta));
      const lf = ta / life;
      const c = i % 5 === 0 ? white : i % 3 === 0 ? ember : gold;
      put(cx + Math.cos(a) * r, cy + Math.sin(a) * r + 10 * u * ta * ta, c, 0.55 * Math.pow(1 - lf, 1.4), (2.6 + 3.2 * fwRand(s + 4)) * u);
    }
    // 5. secondary pops echo the first: small flash, ring and spiral sparks
    const pRingN = FW.popRing;
    const pSparkN = Math.round(FW.popSparks * lite);
    for (let p = 0; p < FW.pops; p++) {
      const pop = fwState.pops[p];
      const tp = t - FW.popAt[p];
      const on = tp >= 0 && tp < FW.popLife;
      const pf = on ? tp / FW.popLife : 1;
      const pfl = on && tp < 0.18 ? 1 - tp / 0.18 : 0;
      put(pop.x, pop.y, white, 0.9 * pfl * pfl, 64 * u * (0.5 + 0.5 * pfl));
      const Rp = Rm * 0.4;
      for (let i = 0; i < FW.popRing; i++) {
        if (!on || i >= pRingN) { put(pop.x, pop.y, gold, 0, 0); continue; }
        const ps = salt + p * 97 + i;
        const a = ((i + fwRand(ps) * 0.8) / pRingN) * TAU;
        const r = Rp * 0.8 * (1 - Math.exp(-5.5 * tp)) * (1 + (fwRand(ps + 0.4) - 0.5) * 0.14);
        put(pop.x + Math.cos(a) * r, pop.y + Math.sin(a) * r, pop.col, 0.45 * (1 - pf) * (1 - pf), (5 + 9 * (1 - pf)) * u * (0.7 + 0.6 * fwRand(ps + 0.8)));
      }
      for (let i = 0; i < FW.popSparks; i++) {
        if (!on || i >= pSparkN) { put(pop.x, pop.y, gold, 0, 0); continue; }
        const k = (i + 0.5) / pSparkN;
        const r = Rp * (0.35 + 0.65 * k) * (1 - Math.exp(-3.6 * tp));
        const a = pop.rot + (i * TAU) / 4 + spin * (1.8 * k + 1.1 * (r / Rp));
        put(pop.x + Math.cos(a) * r, pop.y + Math.sin(a) * r, i % 3 === 0 ? white : pop.col, 1.1 * Math.pow(1 - pf, 1.3), 5.5 * (1 - 0.5 * pf) * u);
      }
    }
    const alive = t < 2.5; // everything above has faded out by VICTORY_SECONDS
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.aColor.needsUpdate = true;
    fwGeo.attributes.aSize.needsUpdate = true;
    if (!alive) {
      fwActive = false;
      fwPoints.visible = false;
    }
  }
  function spawnNearMiss(x, y) {
    const slot = nearMissPool[nearMissCursor];
    nearMissCursor = (nearMissCursor + 1) % nearMissPool.length;
    armPuff(slot, NEAR_MISS, x, y);
  }

  // ---------- full-screen flash overlay + camera shake (P8) ----------
  const flashEl = typeof document !== "undefined" ? document.createElement("div") : null;
  if (flashEl) {
    flashEl.style.cssText = "position:absolute;inset:0;pointer-events:none;opacity:0;z-index:5;";
    const mount = canvas.parentElement || document.body;
    mount.appendChild(flashEl);
  }
  function flashOverlay(color, ms) {
    if (!flashEl) return;
    const peak = REDUCED_MOTION ? 0.5 : 1;
    flashEl.style.transition = "none";
    flashEl.style.backgroundColor = color;
    flashEl.style.opacity = String(peak);
    void flashEl.offsetHeight; // force reflow so the transition below re-triggers
    flashEl.style.transition = `opacity ${ms}ms linear`;
    flashEl.style.opacity = "0";
  }

  let shakeAmp = 0, shakeElapsed = 0, shakeDur = 0;
  function shakeCamera(ms = HIT_SHAKE_MS) {
    if (REDUCED_MOTION) return;
    shakeAmp = HIT_SHAKE_AMPLITUDE;
    shakeDur = ms / 1000;
    shakeElapsed = 0;
  }
  function updateCameraShake(dt) {
    if (shakeElapsed >= shakeDur || shakeDur <= 0) return;
    const mag = shakeAmp * (1 - shakeElapsed / shakeDur);
    shakeElapsed += dt;
    base.camera.position.x += (Math.random() - 0.5) * 2 * mag;
    base.camera.position.y += (Math.random() - 0.5) * 2 * mag;
  }

  function flashHit() {
    flashOverlay(HIT_FLASH_COLOR, HIT_FLASH_MS);
  }
  function flashLevelUp() {
    flashOverlay(LEVELUP_FLASH_COLOR, LEVELUP_FLASH_MS);
  }

  function updateSparkBursts(dt) {
    for (let i = sparkBursts.length - 1; i >= 0; i--) {
      const b = sparkBursts[i];
      b.t += dt;
      const pos = b.points.geometry.attributes.position;
      for (let j = 0; j < b.velocities.length; j++) {
        const v = b.velocities[j];
        v.vy -= 500 * dt;
        let y = pos.getY(j) + v.vy * dt;
        if (y < 1) y = 1;
        pos.setXYZ(j, pos.getX(j) + v.vx * dt, y, pos.getZ(j) + v.vz * dt);
      }
      pos.needsUpdate = true;
      b.points.material.opacity = Math.max(0, 1 - b.t / SPARK_LIFE);
      if (b.t >= SPARK_LIFE) {
        scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        sparkBursts.splice(i, 1);
      }
    }
  }

  // ---------- per-frame sync from game state ----------
  let lastDt = 1 / 60;
  let lastTime = null;

  function syncPlayer(game, now) {
    const p = game.player;
    const wp = toWorld(p.x, p.y, 0);
    player.group.position.set(wp.x, wp.y, wp.z);
    // Visual only, collision radius unchanged; shrunk on phone landscape so the UFO clears the joystick ring.
    const landscapeK = window.innerWidth > window.innerHeight && window.innerHeight < 560 ? 0.55 : 1;
    player.group.scale.setScalar(1.2 * landscapeK * p.radius / (SAUCER_EDGE * PLAYER_BUILD_RADIUS));

    // Bank into turns: lean toward the direction of travel, eased.
    const ref = game.controlMode === "desktop" ? Math.max(300, game.width / 1.9) : p.speed;
    const k = Math.min(1, 8 * lastDt);
    const tx = Math.max(-1, Math.min(1, p.vy / ref)) * 0.38;
    const tz = -Math.max(-1, Math.min(1, p.vx / ref)) * 0.38;
    player.bankX += (tx - player.bankX) * k;
    player.bankZ += (tz - player.bankZ) * k;
    player.tilt.rotation.x = player.bankX;
    player.tilt.rotation.z = player.bankZ;

    player.rimLights.rotation.y = REDUCED_MOTION ? 0 : now * 1.6;
    const moving = Math.abs(p.vx) + Math.abs(p.vy) > 20;
    const flaring = now < p.speedUntil;
    const flick = REDUCED_MOTION ? 1 : 0.85 + 0.15 * Math.sin(now * 38);
    player.shimmerMat.opacity = (flaring ? 0.65 : moving ? 0.38 : 0.1) * flick;
    player.shimmerMat.color.setHex(flaring ? 0xffc84a : 0xbfd8ff);
    player.shimmer.scale.setScalar(flaring ? 1.6 : moving ? 1.15 : 0.9);
    player.core.scale.setScalar(1 + 0.08 * Math.sin(now * 3));

    // Shield bubble: violet/ice, fades over its last 2 s.
    const shieldLeft = p.shieldUntil - now;
    const shieldOn = shieldLeft > 0;
    player.shield.visible = shieldOn;
    player.shieldRing.visible = shieldOn;
    if (shieldOn) {
      const fade = Math.min(1, shieldLeft / SHIELD_FADE_SECONDS);
      mats.shield.uniforms.uFade.value = fade;
      mats.shield.uniforms.uTime.value = now;
      mats.shieldRing.opacity = 0.25 * fade;
    }

    // UFO flickers briefly after damage.
    const flicker = now < p.flickerUntil && Math.floor(now * 16) % 2 === 0;
    player.group.visible = !flicker;

    // Camera follows the UFO gently and eases; the field edges stay essentially pinned.
    const ease = Math.min(1, 4 * lastDt);
    camFx += (wp.x * 0.02 - camFx) * ease;
    camFz += (wp.z * 0.02 - camFz) * ease;
    applyFitCamera();
    updateCameraShake(lastDt);
    return wp;
  }

  function sync(game) {
    const now = game.time;
    lastDt = lastTime == null ? 1 / 60 : Math.max(0, now - lastTime);
    lastTime = now;
    syncFrame++;

    const wp = syncPlayer(game, now);
    updateStars(now, wp.x, wp.z);

    // slow 1.5 s emissive pulse, 0.75-1.05, shared by the nugget materials
    const nuggetPulse = REDUCED_MOTION ? 0.9 : 0.9 + 0.15 * Math.sin((now * 2 * Math.PI) / 1.5);
    for (let i = 0; i < nuggetMats.length; i++) nuggetMats[i].emissiveIntensity = nuggetPulse;

    syncPool(coinMeshes, game.coins, makeCoinMesh, (mesh, c) => {
      const w = toWorld(c.x, c.y, (1.25 * c.radius + 3 + 2 * Math.sin(c.bob)) * VIS);
      mesh.position.set(w.x, w.y, w.z);
      mesh.scale.setScalar(Math.max(0.001, game.fadeAlpha)); // level-end fade
      mesh.userData.nugget.rotation.y = mesh.userData.phase + now * mesh.userData.rate;
      const sparkles = mesh.userData.sparkles;
      for (let i = 0; i < sparkles.length; i++) {
        const k = sparkles[i];
        const th = k.theta + (REDUCED_MOTION ? 0 : k.dTheta * now);
        const ph = 1.57 + (k.phi - 1.57) * Math.cos(k.dPhi * now + k.ph);
        const sp = Math.sin(ph);
        k.sp.position.set(Math.cos(th) * sp * 0.95, Math.cos(ph) * 0.8, Math.sin(th) * sp * 0.95);
        const flash = REDUCED_MOTION ? 0.5 : Math.max(0, Math.sin(now * k.rate + k.ph));
        k.sp.scale.setScalar(0.14 + 0.6 * flash * flash);
      }
    });

    syncPool(puMeshes, game.powerUps, makePowerUpMesh, (mesh, pu) => {
      const bobY = (pu.radius + Math.sin(now * 2.5) * pu.radius * 0.3) * VIS;
      const w = toWorld(pu.x, pu.y, bobY);
      mesh.position.set(w.x, w.y, w.z);
      mesh.scale.setScalar(Math.max(0.001, game.fadeAlpha));
      mesh.rotation.y = REDUCED_MOTION ? 0 : 0.3 * Math.sin(now * 1.5); // the flat symbol sways, never turns edge-on
      const halo = mesh.userData.halo;
      if (halo) {
        const base = mesh.userData.haloBase;
        if (REDUCED_MOTION) {
          halo.scale.setScalar(base);
          halo.material.opacity = PU_HALO_OPACITY;
        } else {
          const k = 0.5 + 0.5 * Math.sin(now * 2 * Math.PI / 2.4);
          halo.scale.setScalar(base * (1 + 0.12 * k));
          halo.material.opacity = PU_HALO_OPACITY * (0.65 + 0.7 * k); // CR11 pulsed 0.35-0.70; about half of that
        }
      }
    });

    syncPool(shipMeshes, game.ships, makeShipMesh, (mesh, s) => {
      const w = toWorld(s.x, s.y, 0);
      mesh.position.set(w.x, w.y, w.z);
      mesh.scale.setScalar(Math.max(0.001, game.fadeAlpha));
      const size = s.radius * 1.2; // octagon circumradius: just over the hit radius
      const visual = mesh.userData.visual;
      visual.scale.setScalar(size);
      visual.position.y = 0.3 * size;
      visual.rotation.y = s.rot; // slow spin; the octagon top stays in view
      // Core heats up for FIRE_WARN seconds before each volley: red -> saturated amber on roamers and boss,
      // orange -> hot yellow on chasers. Blue stays low so the core never washes out to a flat cream disc.
      const warn = s.fireTimer < FIRE_WARN ? 1 - Math.max(0, s.fireTimer) / FIRE_WARN : 0;
      mesh.userData.core.scale.setScalar(1 + (REDUCED_MOTION ? 0 : 0.15 * Math.sin(now * 5 + s.id)) + 0.35 * warn);
      if (s.kind === "chaser") mesh.userData.coreMat.color.setRGB(1, 0.3 + 0.5 * warn, 0.04 + 0.12 * warn);
      else mesh.userData.coreMat.color.setRGB(1, 0.086 + 0.5 * warn, 0.03 + 0.07 * warn);
    });

    syncBullets(game);
    updateSparkBursts(lastDt);
    updateCoinBursts(lastDt);
    updateFireworks(lastDt);
    for (const slot of nearMissPool) updatePuff(slot, lastDt);
  }

  if (typeof window !== "undefined") {
    window.__cr3d = {
      get scene() { return scene; },
      get shipCount() { return shipMeshes.size; },
      get starLayerOffsets() { return layerOffsets; },
      // Capture-time probe (never called per frame): on-screen px of each star layer's origin and the UFO.
      layerScreen() {
        const v = new THREE.Vector3();
        const w = base.renderer.domElement.clientWidth;
        const h = base.renderer.domElement.clientHeight;
        const at = (obj) => {
          v.set(0, 0, 0);
          obj.localToWorld(v);
          v.project(base.camera);
          return { x: Math.round(((v.x + 1) / 2) * w * 10) / 10, y: Math.round(((1 - v.y) / 2) * h * 10) / 10 };
        };
        const out = { ufo: at(player.group) };
        for (const l of starLayers) if (!l.name.includes("glint")) out[l.name.replace("stars_", "")] = at(l);
        nebulaWashes.forEach((n, i) => { out[i ? "nebulaB" : "nebulaA"] = at(n); });
        return out;
      },
      // Debug/capture hook: force a shooting star. opts: { age (s into flight), x, y (field px of mid-path),
      // angleDeg, hold (pin it at `age`) }. Reuses pool slot 0; never called by the game.
      forceShootingStar(opts = {}) {
        armShootingStar(shootPool[0], lastSkyT, opts);
        return { life: shootPool[0].life, age: opts.age || 0 };
      },
      get shootingStars() { return shootPool.map((s) => ({ active: s.active, visible: s.mesh.visible })); },
      assertNoPlaceholders: base.assertNoPlaceholders,
    };
  }

  return {
    ...base,
    // main.js calls scene3d.renderer.render(...): route through the bloom
    // composer instead of a bare renderer.render, or bloom would be skipped.
    renderer: {
      render() {
        base.renderFrame();
      },
      domElement: base.renderer.domElement,
      raw: base.renderer,
    },
    rebuildGround,
    sync,
    spawnCoinBurst,
    spawnBurst3D,
    spawnVictory,
    spawnNearMiss,
    flashHit,
    flashLevelUp,
    shakeCamera,
    resize(viewW, viewH, planeWArg, planeHArg) {
      if (planeWArg !== planeW || planeHArg !== planeH) rebuildGround(planeWArg, planeHArg);
      base.resize(viewW, viewH, planeWArg, planeHArg);
      fitCamera(viewW, viewH, planeWArg, planeHArg);
      updateFog();
    },
  };
}
