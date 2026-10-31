// 3D renderer: a fixed camera looking down at the play field, a procedural shader background and
// lit meshes for ship, rocks, saucers and bullets. Reads state, never writes it.
// view = { scale, ox, oy, w, h } : w/h are the canvas pixel size, scale/ox/oy place the field.
// World units are canvas pixels (y flipped), so the z = 0 plane maps 1:1 onto the screen.
// Presentation effects (explode) are fed by main.js from simulation-step observations; the renderer
// keeps them in sim coordinates in bounded pools and never touches simulation state.
import * as THREE from "/_base/vendor/three.module.js";
import { RoomEnvironment } from "/_base/vendor/addons/environments/RoomEnvironment.js";

const VERT = `
varying vec2 vP;
void main() {
  vP = (modelMatrix * vec4(position, 1.0)).xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform float uTime;
uniform float uChroma;
uniform float uFlow;
uniform vec2 uPointer;
uniform float uBurst;
uniform vec2 uRes;
uniform float uDim;
varying vec2 vP;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

void main() {
  vec2 p = vP / 600.0;
  vec2 drift = vec2(uTime * 0.045, uTime * 0.028);
  float n = fbm(p * 1.2 + drift + uPointer * 0.05);
  float m = fbm(p * 2.2 - drift * 1.5 + 4.0);
  float hue = fract(0.62 + uChroma * 0.05 + n * 0.12 + m * 0.05);
  float nebula = smoothstep(0.43, 0.64, fbm(p * 0.75 + drift * 1.4 + 8.0));
  float val = (0.055 + 0.12 * n * m * 2.0 + 0.035 * uBurst + 0.02 * uFlow) * uDim;
  vec3 col = hsv(hue, 0.38, clamp(val, 0.0, 0.16));
  col += vec3(0.13, 0.085, 0.19) * nebula * 0.23;
  float teal = smoothstep(0.5, 0.74, fbm(p * 0.9 - drift * 1.1 + 21.0));
  col += vec3(0.02, 0.085, 0.095) * teal * 0.45;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Stars: position wraps inside a field far larger than the view, so the wrap is never on screen.
// Drift offset and twinkle clock are computed in JS doubles (wrapped), so float32 never loses precision.
const STAR_VERT = `
attribute vec3 aCol;
attribute float aSize;
attribute float aPhase;
attribute float aRate;
attribute float aAmp;
attribute float aHarm;
uniform vec2 uOffset;
uniform float uTwTime;
uniform float uField;
uniform float uTwinkle;
varying vec3 vCol;
void main() {
  vec3 p = position;
  p.xy = mod(p.xy + uOffset + uField * 0.5, uField) - uField * 0.5;
  float s = sin(uTwTime * aRate + aPhase * 6.2831853);
  float s2 = sin(uTwTime * aRate * aHarm + aPhase * 17.0);
  float tw = 0.55 + 0.65 * min(uTwinkle, 1.0) * aAmp * (0.5 + 0.5 * (0.8 * s + 0.2 * s2));
  vCol = aCol * tw;
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const STAR_FRAG = `
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a * (1.6 - 0.6 * a);
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// Edge vignette far behind the play plane, placed in screen space every frame; it never reacts to gameplay.
const VIGNETTE_Z = -250;
const VIGNETTE_FRAG = `
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float v = smoothstep(0.42, 1.05, length(q) / max(1.0, uAspect * 0.62));
  gl_FragColor = vec4(0.0, 0.0, 0.015, 0.62 * v);
}
`;

const STAR_COUNT = 1800;
const STAR_FIELD = 3200;
const STAR_DEPTH = [-290, -280, -270];
const STAR_SPEED = [0.65, 1.5, 3.1];

const BULLET_POOL = 32;
const SPARK_POOL = 320;
const DEBRIS_POOL = 40;
const FX_POOL = 10;
const SMOKE_PUFFS = 3;

// kind -> core flash, ring size, sparks, debris chunks, spark speed, life (s), screen shake; sim units, scaled by
// view.scale and by the target's size. Ship deaths and saucer kills are the big blasts and shake the screen.
const FX = {
  player: { flash: 120, ring: 180, sparks: 40, debris: 6, speed: 280, life: 1.1, shake: 4, tint: 0x8fe6ff },
  attacker: { flash: 105, ring: 150, sparks: 36, debris: 5, speed: 250, life: 1.0, shake: 3, tint: 0x6dffa8 },
  rock: { flash: 74, ring: 100, sparks: 30, debris: 4, speed: 165, life: 0.75, shake: 0, tint: 0 },
};
const ROCK_FX_SIZE = [1, 0.66, 0.42];
const ROCK_FX_SPARKS = [30, 25, 20];

function hash1(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function createRenderer(canvas, config) {
  const look = config.look;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(look.background, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(look.cameraFov, 1, 10, 20000);

  // Environment: built once from the vendored RoomEnvironment, reused by every material.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  if ("environmentIntensity" in scene) scene.environmentIntensity = look.envIntensity;
  pmrem.dispose();
  roomEnv.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });

  // Key (sun), fill and rim lights keep every asteroid side readable.
  scene.add(new THREE.AmbientLight(0xffffff, look.ambient));
  const sun = new THREE.DirectionalLight(0xffffff, look.sun);
  sun.position.set(-300, 500, 900);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb8ff, look.fill);
  fill.position.set(450, -350, 600);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffa870, look.rim);
  rim.position.set(500, -300, -200);
  scene.add(rim);

  const bgMaterial = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uChroma: { value: 0 },
      uFlow: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uBurst: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDim: { value: look.bgDim },
    },
    depthWrite: false,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMaterial);
  bg.position.z = -300;
  scene.add(bg);

  // ---- PLAYER: top-down arrowhead fighter sized to its hitbox. Dark navy wings and a gunmetal fuselage carry
  // white leading edges and cyan lines, a dark tinted canopy with a bright cyan glint, twin short guns built
  // into the wing roots (muzzle flash per shot) and engine nacelles; thrust adds twin blue-white flames.
  // Local units, nose +y; SHIP_SCALE matches the original ship's on-screen size (about 64 sim units wingtip to wingtip). ----
  const SHIP_SCALE = 2.45;
  const GUN_X = 3.3;
  const MUZZLE_Y = 8;
  // pts run nose to tail down the right side, first and last on the centre line.
  const mirror = (pts) => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  const shapeOf = (pts) => {
    const sh = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    sh.closePath();
    return sh;
  };
  const HULL_PTS = [[0, 11], [1.6, 7.5], [2.8, 3], [11.6, -7.2], [12, -9.8], [9.4, -9.6], [5.4, -7], [4.6, -10], [1.4, -10], [0, -7.5]];
  const shipGeo = new THREE.ExtrudeGeometry(shapeOf(mirror(HULL_PTS)), { depth: 0.4, bevelEnabled: true, bevelSize: 0.9, bevelThickness: 0.8, bevelSegments: 4 });
  const bodyGeo = new THREE.LatheGeometry([[0, -10.2], [2.0, -10], [2.6, -7.5], [2.8, -2.5], [2.5, 2.5], [1.9, 6.5], [1.1, 10], [0.35, 13], [0, 13.6]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
  // White leading-edge strip and cyan wingtip fin, right wing; the left wing uses the mirrored mesh.
  const stripeGeo = new THREE.ExtrudeGeometry(shapeOf([[3.5, 1.5], [11.3, -7.0], [11.6, -8.3], [10.5, -8.1], [3.3, -0.4]]), { depth: 0.3, bevelEnabled: false });
  const tipGeo = new THREE.ExtrudeGeometry(shapeOf([[10.6, -5.6], [12.6, -10.2], [10, -9.9]]), { depth: 1.1, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 1 });
  const panelGeo = new THREE.ExtrudeGeometry(shapeOf([[4.4, -2.2], [9.6, -6.6], [9.4, -7.2], [4.2, -2.9]]), { depth: 0.2, bevelEnabled: false });
  const spineGeo = new THREE.BoxGeometry(0.5, 6.5, 0.3);
  const shipMat = new THREE.MeshStandardMaterial({ color: 0x3e5684, emissive: 0x101e3a, emissiveIntensity: 0.7, roughness: 0.34, metalness: 0.5 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5e6a82, emissive: 0x141a26, emissiveIntensity: 0.6, roughness: 0.26, metalness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, emissive: 0x06080e, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.85 });
  // Accents skip tone mapping so white and cyan stay crisp against the dark hull.
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf2f8ff, toneMapped: false });
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x00c4ff, toneMapped: false, side: THREE.DoubleSide });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x050c14, emissive: 0x003040, emissiveIntensity: 0.6, roughness: 0.06, metalness: 0.4, envMapIntensity: 1.6 });
  const nozzleMat = new THREE.MeshBasicMaterial({ color: 0xc8f6ff });
  const canopyGeo = new THREE.SphereGeometry(1, 20, 12);
  const nacelleGeo = new THREE.CylinderGeometry(1.25, 1.55, 6, 16);
  const nozzleGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.5, 14);
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.5, 4.6, 10);
  const muzzleGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.7, 10);
  const mountGeo = new THREE.BoxGeometry(1.5, 3.4, 1.1);
  const ship = new THREE.Group();
  const hull = new THREE.Mesh(shipGeo, shipMat);
  hull.position.z = -0.8;
  ship.add(hull);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.z = 0.8;
  body.position.z = 0.5;
  ship.add(body);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.scale.set(1.15, 3.1, 1.0);
  canopy.position.set(0, 4.4, 2.2);
  ship.add(canopy);
  const spine = new THREE.Mesh(spineGeo, trimMat);
  spine.position.set(0, -4.2, 2.72);
  ship.add(spine);
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(stripeGeo, whiteMat);
    stripe.scale.x = sx;
    stripe.position.z = 0.45;
    ship.add(stripe);
    const panel = new THREE.Mesh(panelGeo, trimMat);
    panel.scale.x = sx;
    panel.position.z = 0.42;
    ship.add(panel);
    const fin = new THREE.Mesh(tipGeo, trimMat);
    fin.scale.x = sx;
    fin.position.z = 0.3;
    ship.add(fin);
    const nacelle = new THREE.Mesh(nacelleGeo, darkMat);
    nacelle.position.set(sx * 3.3, -7.2, 0.4);
    ship.add(nacelle);
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.position.set(sx * 3.3, -10.3, 0.4);
    ship.add(nozzle);
    // Guns: a blister fairing in the wing root with a short barrel poking out ahead of the leading edge.
    const mount = new THREE.Mesh(mountGeo, darkMat);
    mount.position.set(sx * GUN_X, 3.2, 0.5);
    ship.add(mount);
    const barrel = new THREE.Mesh(barrelGeo, bodyMat);
    barrel.position.set(sx * GUN_X, 5.4, 0.55);
    ship.add(barrel);
    const tip = new THREE.Mesh(muzzleGeo, darkMat);
    tip.position.set(sx * GUN_X, MUZZLE_Y - 0.35, 0.55);
    ship.add(tip);
  }
  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = haloCanvas.height = 64;
  const hctx = haloCanvas.getContext("2d");
  const hgrad = hctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  hgrad.addColorStop(0, "rgba(255,255,255,1)");
  hgrad.addColorStop(0.5, "rgba(255,255,255,0.55)");
  hgrad.addColorStop(1, "rgba(255,255,255,0)");
  hctx.fillStyle = hgrad;
  hctx.fillRect(0, 0, 64, 64);
  const haloTex = new THREE.CanvasTexture(haloCanvas);
  // Tight glow texture (sharp core, fast falloff) for engines, lights, glints and explosion cores.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const gctx = glowCanvas.getContext("2d");
  const ggrad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  ggrad.addColorStop(0, "rgba(255,255,255,1)");
  ggrad.addColorStop(0.18, "rgba(255,255,255,0.85)");
  ggrad.addColorStop(0.45, "rgba(255,255,255,0.22)");
  ggrad.addColorStop(1, "rgba(255,255,255,0)");
  gctx.fillStyle = ggrad;
  gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const additive = (color, opacity = 1, map = glowTex) => new THREE.SpriteMaterial({ map, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity });
  // Soft dark backing keeps the white hull crisp over bright rocks and nebula.
  const shadowMat = new THREE.SpriteMaterial({ map: haloTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  const shadow = new THREE.Sprite(shadowMat);
  shadow.scale.set(30, 30, 1);
  shadow.position.set(0, -1, -8);
  ship.add(shadow);
  const haloMat = additive(0x2aa8ff, 0.3, haloTex);
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(32, 32, 1);
  halo.position.set(0, -2, -7);
  ship.add(halo);
  const engineMat = additive(0x5ad8ff);
  const engineCoreMat = additive(0xffffff);
  const engineGlows = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Sprite(engineMat);
    g.position.set(sx * 3.3, -10.9, 3);
    ship.add(g);
    const c = new THREE.Sprite(engineCoreMat);
    c.position.set(sx * 3.3, -10.6, 3.5);
    ship.add(c);
    engineGlows.push(g, c);
  }
  const glintMat = additive(0x8ff4ff, 1);
  glintMat.toneMapped = false;
  const glint = new THREE.Sprite(glintMat);
  glint.scale.set(1.5, 2.8, 1);
  glint.position.set(-0.42, 5.4, 4);
  ship.add(glint);
  const tipLightMat = additive(0x7cecff, 1);
  const tipLights = [];
  for (const sx of [-1, 1]) {
    const t = new THREE.Sprite(tipLightMat);
    t.position.set(sx * 12.2, -10, 3);
    ship.add(t);
    tipLights.push(t);
  }
  // Muzzle flash: a hot round burst plus a forward spike at the cannon tips, shown briefly per shot.
  const muzzleMat = additive(0xd8fcff, 1);
  muzzleMat.toneMapped = false;
  const muzzle = new THREE.Group();
  for (const sx of [-1, 1]) {
    const burst = new THREE.Sprite(muzzleMat);
    burst.scale.set(6, 6, 1);
    burst.position.x = sx * GUN_X;
    muzzle.add(burst);
    const spike = new THREE.Sprite(muzzleMat);
    spike.scale.set(2, 10, 1);
    spike.position.set(sx * GUN_X, 3.4, 0);
    muzzle.add(spike);
  }
  muzzle.position.set(0, MUZZLE_Y + 0.6, 3);
  muzzle.visible = false;
  ship.add(muzzle);
  let muzzleAge = 1;
  const shipKey = new THREE.PointLight(0xdff2ff, 1.4, 200, 1.4);
  shipKey.position.set(-12, 16, 26);
  ship.add(shipKey);
  // Thrust: twin blue-white flames (outer additive cone + hot core) behind each engine.
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  const trailMat = new THREE.MeshBasicMaterial({ color: 0xd8f8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(1.5, 11, 10);
  const trailGeo = new THREE.ConeGeometry(0.75, 6.5, 8);
  flameGeo.rotateZ(Math.PI);
  flameGeo.translate(0, -5.5, 0);
  trailGeo.rotateZ(Math.PI);
  trailGeo.translate(0, -3.25, 0);
  const flame = new THREE.Group();
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(sx * 3.3, -10.5, 0.4);
    flame.add(f);
    const c = new THREE.Mesh(trailGeo, trailMat);
    c.position.set(sx * 3.3, -10.5, 0.6);
    flame.add(c);
  }
  ship.add(flame);
  const shimmerMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.2, depthWrite: false });
  const shimmer = new THREE.Mesh(new THREE.SphereGeometry(14.5, 16, 10), shimmerMat);
  shimmer.visible = false;
  ship.add(shimmer);
  scene.add(ship);

  // ---- Stars: seeded, three depth layers, slow continuous drift, per-star twinkle phase. ----
  const STAR_VEL = [0, 1, 2].map((i) => [look.starDrift * STAR_SPEED[i], look.starDrift * STAR_SPEED[i] * 0.35]);
  // Renderer-relative star clock (seconds); setStarClock pins it for shot mode, null returns to live.
  const starT0 = performance.now();
  let starPin = null;
  function setStarClock(sec) {
    starPin = sec === null || sec === undefined ? null : Number(sec);
  }
  const starData = ShooterStars.generate(1979, STAR_COUNT, STAR_FIELD, STAR_FIELD);
  const starLayers = [0, 1, 2].map((layer) => {
    const list = starData.filter((st) => st.layer === layer);
    const pos = new Float32Array(list.length * 3);
    const col = new Float32Array(list.length * 3);
    const size = new Float32Array(list.length);
    const phase = new Float32Array(list.length);
    const rate = new Float32Array(list.length);
    const amp = new Float32Array(list.length);
    const harm = new Float32Array(list.length);
    list.forEach((st, i) => {
      pos.set([st.x - STAR_FIELD / 2, st.y - STAR_FIELD / 2, 0], i * 3);
      const b = st.bright * look.starGain;
      col.set([b * 0.85, b * 0.92, b], i * 3);
      size[i] = Math.max(2.4, st.size * 1.9);
      phase[i] = st.phase;
      rate[i] = (Math.PI * 2) / st.period;
      amp[i] = st.amp;
      harm[i] = st.harm;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.setAttribute("aRate", new THREE.BufferAttribute(rate, 1));
    g.setAttribute("aAmp", new THREE.BufferAttribute(amp, 1));
    g.setAttribute("aHarm", new THREE.BufferAttribute(harm, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uOffset: { value: new THREE.Vector2() },
        uTwTime: { value: 0 },
        uField: { value: STAR_FIELD },
        uTwinkle: { value: look.starTwinkle },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  });

  const vignetteMat = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}",
    fragmentShader: VIGNETTE_FRAG,
    uniforms: { uAspect: { value: 1 } },
    transparent: true,
    depthWrite: false,
  });
  const vignette = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), vignetteMat);
  vignette.frustumCulled = false;
  scene.add(vignette);

  // ---- Asteroids: smooth subdivided icosphere, continuous-noise body, summed C1 crater field, per-pixel regolith grain. ----
  // Shaded per pixel by one hard grazing sun (matte Lambert, no specular, no rim, no stepped ramps).
  // Crater table (seeded, rotates with the rock): [x, y, z, r], r a chord radius in unit-sphere units.
  // Profile (d = chord / r): crater(d) = smooth-min(bowl d*d-1, rim 1.6*(d-1.4)^2), zero with zero slope at d = 1.4.
  // Craters the mesh can resolve displace vertices; smaller ones perturb the normal per pixel from the same profile.
  const ROCK_MAX_CRATERS = 174;
  const CRATER_DEPTH = 0.35;
  const CRATER_TIERS = [
    [4, 0.15, 0.3, 10],
    [20, 0.05, 0.15, 30],
    [150, 0.015, 0.05, 60],
  ];
  const ROCK_DETAIL = [8, 14, 24];
  const ROCK_VERT = `
uniform vec3 uLight;
attribute vec3 aDir;
attribute float aAlb;
varying vec3 vDir;
varying vec3 vN;
varying vec3 vL;
varying float vAlb;
void main() {
  vDir = aDir;
  vN = normal;
  vAlb = aAlb;
  vL = normalize(uLight * mat3(modelMatrix));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
  const ROCK_FRAG = `
precision highp float;
uniform vec4 uCr[${ROCK_MAX_CRATERS}];
uniform int uCount;
uniform float uGrain;
varying vec3 vDir;
varying vec3 vN;
varying vec3 vL;
varying float vAlb;
float h3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
vec3 ngrad(vec3 p) {
  const float e = 0.4;
  return vec3(
    vnoise(p + vec3(e, 0.0, 0.0)) - vnoise(p - vec3(e, 0.0, 0.0)),
    vnoise(p + vec3(0.0, e, 0.0)) - vnoise(p - vec3(0.0, e, 0.0)),
    vnoise(p + vec3(0.0, 0.0, e)) - vnoise(p - vec3(0.0, 0.0, e))) / (2.0 * e);
}
float smn(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float crater(float d) {
  if (d >= 1.4) return 0.0;
  return smn(d * d - 1.0, 1.6 * (d - 1.4) * (d - 1.4), 0.15);
}
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(vL);
  vec3 dir = normalize(vDir);
  vec3 grad = vec3(0.0);
  float shadow = 1.0;
  for (int i = 0; i < ${ROCK_MAX_CRATERS}; i++) {
    if (i >= uCount) break;
    vec4 c = uCr[i];
    float r = c.w;
    vec3 o = dir - c.xyz;
    float d = length(o) / r;
    if (d >= 1.4) continue;
    vec3 ot = o - N * dot(o, N);
    float len = length(ot);
    if (len < 1e-5) continue;
    float e = 0.02;
    float slope = ${CRATER_DEPTH.toFixed(2)} * (crater(d + e) - crater(d - e)) / (2.0 * e);
    grad += slope * (ot / len);
    shadow *= 1.0 - 0.3 * smoothstep(-0.05, 0.3, dot(ot, L) / r) * smoothstep(1.0, 0.75, d);
  }
  float rpx = max(uGrain, 8.0);
  vec3 gp = dir * min(rpx / 3.0, 500.0);
  vec3 gr = ngrad(gp) * 0.15 + ngrad(dir * min(rpx / 12.0, 125.0) + 17.0) * 0.05;
  gr -= N * dot(gr, N);
  vec3 Np = normalize(N - grad - gr);
  float diff = max(dot(Np, L), 0.0);
  // Keep the unlit hemisphere legible while preserving the grazing-light relief.
  float lit = vAlb * (1.35 * diff * shadow + 0.48);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  lit += (ign - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(vec3(clamp(lit, 0.0, 1.0)), 1.0);
}
`;
  // Low grazing sun from the upper left (world y is up).
  const SUN_DIR = new THREE.Vector3(-0.75, 0.55, 0.35).normalize();
  const rockMeshes = new Map();

  function smoothMin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  // Same C1 profile as the fragment shader; d = chord distance / crater radius.
  function craterProfile(d) {
    if (d >= 1.4) return 0;
    return smoothMin(d * d - 1, 1.6 * (d - 1.4) * (d - 1.4), 0.15);
  }

  function lattice(ix, iy, iz, s) {
    return hash1(ix * 17.13 + iy * 31.71 + iz * 47.37 + s * 5.31);
  }

  function valueNoise3(x, y, z, s) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const lerp = (a, b, t) => a + (b - a) * t;
    const plane = (dz) =>
      lerp(
        lerp(lattice(ix, iy, iz + dz, s), lattice(ix + 1, iy, iz + dz, s), ux),
        lerp(lattice(ix, iy + 1, iz + dz, s), lattice(ix + 1, iy + 1, iz + dz, s), ux),
        uy
      );
    return lerp(plane(0), plane(1), uz);
  }

  // 4 octaves, gain 0.5, centred on zero (about +-0.9 at most).
  function fbm3(x, y, z, s) {
    let v = 0;
    let a = 0.5;
    let f = 1;
    for (let o = 0; o < 4; o++) {
      v += a * (valueNoise3(x * f, y * f, z * f, s + o * 3.7) * 2 - 1);
      f *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  function sphereSpot(seed, k, salt) {
    const u = hash1(seed * 11.7 + k * 3.9 + salt) * 2 - 1;
    const th = hash1(seed * 7.3 + k * 5.3 + salt * 1.7) * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    return [rr * Math.cos(th), rr * Math.sin(th), u];
  }

  // Power-law crater field: few large, more medium, many small; centres uniform on the sphere, overlap allowed.
  function rockCraters(seed) {
    const list = [];
    for (const [count, lo, hi, salt] of CRATER_TIERS) {
      for (let k = 0; k < count; k++) {
        const u = hash1(seed * 2.1 + k * 9.1 + salt);
        list.push([...sphereSpot(seed, k, salt), lo + (hi - lo) * u * u]);
      }
    }
    return list;
  }

  function rockMaterial(shaderCraters) {
    const cr = [];
    for (let i = 0; i < ROCK_MAX_CRATERS; i++) {
      const c = shaderCraters[i];
      cr.push(c ? new THREE.Vector4(c[0], c[1], c[2], c[3]) : new THREE.Vector4(0, 0, 1, 1));
    }
    return new THREE.ShaderMaterial({
      vertexShader: ROCK_VERT,
      fragmentShader: ROCK_FRAG,
      uniforms: { uCr: { value: cr }, uCount: { value: shaderCraters.length }, uLight: { value: SUN_DIR }, uGrain: { value: 100 } },
    });
  }

  function rockGeometry(rock, radius, tier) {
    const detail = ROCK_DETAIL[tier];
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position;
    const seed = rock.shape[0] * 10 + rock.shape[1] * 7;
    const vkey = [];
    // Per-rock stable traits, all derived from the seed: elongation axis, craters, albedo.
    const elong = 0.72 + 0.28 * hash1(seed * 3.3);
    const tilt = hash1(seed * 5.1) * Math.PI;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const craters = rockCraters(seed);
    // Vertex relief only from craters this mesh can resolve (~2.5 vertex spacings); smaller ones are shaded per pixel.
    const minMeshR = 2.5 / (detail + 1);
    const meshCraters = craters.filter((c) => c[3] >= minMeshR);
    const shaderCraters = craters.filter((c) => c[3] < minMeshR);
    const dirs = new Float32Array(pos.count * 3);
    const alb = new Float32Array(pos.count);
    const baseAlbedo = 0.35 + 0.15 * hash1(seed * 6.7);
    const sx = seed * 0.37;
    let rmax = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      dirs.set([x, y, z], i * 3);
      vkey.push(`${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`);
      // Continuous lumpy body; the crater sum adds on top in float (no quantizing, no boolean cuts).
      let rr = 1 + 0.28 * fbm3(x * 1.2 + sx, y * 1.2, z * 1.2, seed);
      for (const c of meshCraters) {
        const d = Math.hypot(x - c[0], y - c[1], z - c[2]) / c[3];
        if (d < 1.4) rr += CRATER_DEPTH * c[3] * craterProfile(d);
      }
      alb[i] = baseAlbedo * (1 + 0.08 * fbm3(x * 1.4 + 5, y * 1.4, z * 1.4, seed + 9));
      // Elongate along a per-rock axis, then flatten in depth.
      let px = x * rr;
      let py = y * rr;
      const pz = z * look.rockDepth * rr;
      const rx = px * ct + py * st;
      const ry = (-px * st + py * ct) * elong;
      px = rx * ct - ry * st;
      py = rx * st + ry * ct;
      pos.setXYZ(i, px, py, pz);
      rmax = Math.max(rmax, Math.hypot(px, py, pz));
    }
    // Scale so the silhouette is enclosed by the collision radius (conservative bound); radius is in sim units.
    const fit = radius / Math.max(rmax, 1e-6);
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * fit, pos.getY(i) * fit, pos.getZ(i) * fit);
    // Smooth normals from the displaced geometry: area-weighted face normals summed over vertices sharing a
    // position (the sphere is non-indexed). Never per-face.
    const acc = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      const fn = e1.subVectors(b, a).cross(e2.subVectors(c, a));
      for (let k = 0; k < 3; k++) {
        const key = vkey[i + k];
        let cur = acc.get(key);
        if (!cur) {
          cur = new THREE.Vector3();
          acc.set(key, cur);
        }
        cur.add(fn);
      }
    }
    for (const v of acc.values()) v.normalize();
    const nor = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const nv = acc.get(vkey[i]);
      nor.set([nv.x, nv.y, nv.z], i * 3);
    }
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3));
    g.setAttribute("aAlb", new THREE.BufferAttribute(alb, 1));
    g.userData.craters = shaderCraters;
    g.userData.meshCraterCount = meshCraters.length;
    g.userData.tier = tier;
    return g;
  }

  // ---- ATTACKERS: classic saucer seen straight from above; it reads as a saucer through its design: a dark
  // gunmetal outer rim, a mid deck and a light inner deck (value steps that make it look domed), concentric
  // ring lines and radial panel seams, a glossy dome with a fixed specular highlight, chasing rim lights on the
  // edge, a coloured underglow and a soft drop shadow offset toward the bottom right. The hull slowly spins. ----
  const SAUCER_LIGHTS = 14;
  const SAUCER_SEAMS = 12;
  const SAUCER_TYPES = {
    large: { dome: 0x14ff6e, domeBase: 0x06401c, glow: 0x2cff88, chase: 0xffe27a, idle: 0x6a5226 },
    small: { dome: 0xff4a10, domeBase: 0x401004, glow: 0xff5a1e, chase: 0xffd070, idle: 0x6a3a22 },
  };
  const saucerOwnMats = [];
  const saucerRimMat = new THREE.MeshStandardMaterial({ color: 0x343a46, emissive: 0x0a0d12, emissiveIntensity: 0.6, roughness: 0.34, metalness: 0.8 });
  const saucerDeckMat = new THREE.MeshStandardMaterial({ color: 0x7c8698, emissive: 0x1a1f28, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.78 });
  const saucerTopMat = new THREE.MeshStandardMaterial({ color: 0xd2d9e4, emissive: 0x3a4250, emissiveIntensity: 0.45, roughness: 0.24, metalness: 0.75 });
  const saucerDarkMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.4, metalness: 0.7 });
  const saucerTrimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9aa6b8, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.9 });
  // Lathe bands (y up = toward the camera): outer rim, mid deck, inner deck.
  const band = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 56);
  const saucerRimGeo = band([[1.0, -0.02], [1.0, 0.03], [0.93, 0.08], [0.86, 0.1]]);
  const saucerHullGeo = band([[0.86, 0.1], [0.74, 0.15], [0.62, 0.18]]);
  const saucerUnderGeo = band([[0.62, 0.18], [0.5, 0.205], [0.44, 0.21]]);
  const saucerCanopyGeo = band([[0.43, 0.2], [0.42, 0.27], [0.37, 0.37], [0.27, 0.46], [0.14, 0.515], [0, 0.53]]);
  const saucerCollarGeo = new THREE.TorusGeometry(0.44, 0.03, 6, 40);
  const saucerRidgeGeo = new THREE.TorusGeometry(1, 0.012, 4, 64);
  const saucerSeamGeo = new THREE.BoxGeometry(0.26, 0.02, 0.02);
  const saucerLightGeo = new THREE.IcosahedronGeometry(0.065, 1);
  const saucerGlintMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false });
  const saucerShadowMat = new THREE.SpriteMaterial({ map: haloTex, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
  const saucerMeshes = [];

  function buildSaucer() {
    const grp = new THREE.Group();
    const shadow = new THREE.Sprite(saucerShadowMat);
    shadow.position.set(0.16, -0.2, -0.6);
    shadow.scale.set(2.5, 2.5, 1);
    grp.add(shadow);
    const underMat = additive(0x3dff9a, 0.6, haloTex);
    underMat.toneMapped = false;
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x0b3a22, emissive: 0x24ff8a, emissiveIntensity: 0.8, roughness: 0.08, metalness: 0.1, envMapIntensity: 1.2, toneMapped: false });
    const domeGlowMat = additive(0x3dff9a, 0.6);
    saucerOwnMats.push(domeMat, domeGlowMat, underMat);
    const under = new THREE.Sprite(underMat);
    under.position.set(0.04, -0.06, -0.4);
    under.scale.set(2.7, 2.7, 1);
    grp.add(under);
    const top = new THREE.Group();
    top.rotation.x = Math.PI / 2;
    grp.add(top);
    const spin = new THREE.Group();
    top.add(spin);
    spin.add(new THREE.Mesh(saucerRimGeo, saucerRimMat));
    spin.add(new THREE.Mesh(saucerHullGeo, saucerDeckMat));
    spin.add(new THREE.Mesh(saucerUnderGeo, saucerTopMat));
    for (const [r, y] of [[0.86, 0.104], [0.62, 0.184]]) {
      const ring = new THREE.Mesh(saucerRidgeGeo, saucerDarkMat);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(r);
      ring.position.y = y;
      spin.add(ring);
    }
    for (let i = 0; i < SAUCER_SEAMS; i++) {
      const a = (i / SAUCER_SEAMS) * Math.PI * 2;
      const seam = new THREE.Mesh(saucerSeamGeo, saucerDarkMat);
      seam.position.set(Math.cos(a) * 0.74, 0.15, -Math.sin(a) * 0.74);
      seam.rotation.set(0, a, -0.38);
      spin.add(seam);
      if (i % 2 === 0) {
        const s2 = new THREE.Mesh(saucerSeamGeo, saucerDarkMat);
        s2.scale.x = 0.5;
        s2.position.set(Math.cos(a + 0.26) * 0.93, 0.07, -Math.sin(a + 0.26) * 0.93);
        s2.rotation.set(0, a + 0.26, -0.6);
        spin.add(s2);
      }
    }
    const collar = new THREE.Mesh(saucerCollarGeo, saucerTrimMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.205;
    spin.add(collar);
    top.add(new THREE.Mesh(saucerCanopyGeo, domeMat));
    const domeGlow = new THREE.Sprite(domeGlowMat);
    domeGlow.position.set(0, 0.6, 0);
    domeGlow.scale.set(0.7, 0.7, 1);
    top.add(domeGlow);
    // Fixed highlight on the sun side of the dome, plus a faint secondary bounce.
    const glint = new THREE.Sprite(saucerGlintMat);
    glint.position.set(-0.15, 0.62, -0.15);
    glint.scale.set(0.24, 0.24, 1);
    top.add(glint);
    const glint2 = new THREE.Sprite(saucerGlintMat);
    glint2.position.set(0.17, 0.62, 0.17);
    glint2.scale.set(0.09, 0.09, 1);
    top.add(glint2);
    const lights = [];
    for (let i = 0; i < SAUCER_LIGHTS; i++) {
      const a = (i / SAUCER_LIGHTS) * Math.PI * 2;
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
      const haloM = additive(0xffffff, 0);
      haloM.depthTest = false;
      saucerOwnMats.push(bulbMat, haloM);
      const bulb = new THREE.Mesh(saucerLightGeo, bulbMat);
      bulb.position.set(Math.cos(a) * 0.965, 0.07, -Math.sin(a) * 0.965);
      spin.add(bulb);
      const h = new THREE.Sprite(haloM);
      h.position.copy(bulb.position);
      h.position.y += 0.05;
      h.scale.setScalar(0.36);
      h.renderOrder = 2;
      spin.add(h);
      lights.push({ bulbMat, haloM });
    }
    grp.userData = { lights, spin, domeMat, domeGlowMat, underMat, small: null, r: 20, sx: 0, sy: 0 };
    return grp;
  }

  // Bolts: a hot core plus an additive glow, cyan for the player and red-orange for saucers.
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xeafcff, toneMapped: false });
  const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xffe6d0, toneMapped: false });
  const bulletGeo = new THREE.SphereGeometry(1, 8, 6);
  const bulletGlowMat = additive(0x26b8ff, 0.9);
  const enemyGlowMat = additive(0xff4422, 0.9);

  // ---- Explosions: per slot a white-hot core that cools to orange in ~80 ms, a soft bloom, an additive
  // shockwave ring and a faint dark smoke puff (~0.5 s); shared pools of velocity-stretched sparks and
  // tumbling chunks (asteroid-shader rock for rocks, hull material for the ship and saucers). ----
  const streakCanvas = document.createElement("canvas");
  streakCanvas.width = 64;
  streakCanvas.height = 16;
  const sctx = streakCanvas.getContext("2d");
  const sgrad = sctx.createLinearGradient(0, 0, 64, 0);
  sgrad.addColorStop(0, "rgba(255,255,255,0)");
  sgrad.addColorStop(0.75, "rgba(255,255,255,0.75)");
  sgrad.addColorStop(1, "rgba(255,255,255,1)");
  sctx.fillStyle = sgrad;
  sctx.beginPath();
  sctx.moveTo(0, 8);
  sctx.lineTo(56, 2);
  sctx.quadraticCurveTo(64, 8, 56, 14);
  sctx.closePath();
  sctx.fill();
  const streakTex = new THREE.CanvasTexture(streakCanvas);
  const sparkGeo = new THREE.PlaneGeometry(1, 1);
  sparkGeo.translate(-0.5, 0, 0);
  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i++) {
    const sp = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ map: streakTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, depthTest: false }));
    sp.renderOrder = 6;
    sp.visible = false;
    sp.userData = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, tint: 0 };
    scene.add(sp);
    sparks.push(sp);
  }
  // Debris: small faceted embers, dark warm cores with glowing rims; never asteroid-coloured, gone within ~0.4 s.
  const emberMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.3);
  gl_FragColor = vec4(mix(vec3(0.34, 0.11, 0.03), vec3(1.0, 0.62, 0.2), f), 1.0);
}`,
    depthTest: false,
  });
  const chunkGeos = [0, 1, 2].map((v) => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = 0.62 + 0.5 * hash1(Math.round(x * 97) * 3.1 + Math.round(y * 97) * 7.7 + Math.round(z * 97) * 1.3 + v * 19);
      pos.setXYZ(i, x * r, y * r * 0.8, z * r * 0.7);
    }
    g.computeVertexNormals();
    return g;
  });
  const hullChunkGeo = new THREE.TetrahedronGeometry(1, 0);
  const debris = [];
  for (let i = 0; i < DEBRIS_POOL; i++) {
    const d = new THREE.Mesh(chunkGeos[i % 3], emberMat);
    d.renderOrder = 5;
    d.visible = false;
    d.userData = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, sx: 0, sy: 0, sz: 0, size: 1 };
    scene.add(d);
    debris.push(d);
  }
  const shockGeo = new THREE.RingGeometry(0.95, 1, 64);
  const slots = [];
  for (let i = 0; i < FX_POOL; i++) {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false }));
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffe0b0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    const shock = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: 0xffd8a8, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
    const smoke = [];
    for (let k = 0; k < SMOKE_PUFFS; k++) {
      const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0x2e2824, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }));
      p.renderOrder = 3;
      p.visible = false;
      scene.add(p);
      smoke.push(p);
    }
    shock.renderOrder = 4;
    flash.renderOrder = 5;
    core.renderOrder = 7;
    core.visible = flash.visible = shock.visible = false;
    scene.add(flash);
    scene.add(shock);
    scene.add(core);
    slots.push({ core, flash, shock, smoke, active: false, x: 0, y: 0, age: 0, kind: FX.rock, sc: 1, seed: 0 });
  }
  let slotCursor = 0;
  let sparkCursor = 0;
  let debrisCursor = 0;
  let seq = 0;
  let lastT = 0;
  let shakeAmp = 0;
  let shakeAge = 1;
  const hot = new THREE.Color();
  const HOT_WHITE = new THREE.Color(0xffffff);
  const HOT_ORANGE = new THREE.Color(0xff8a2a);
  const HOT_RED = new THREE.Color(0x9a2406);
  const SPARK_YELLOW = new THREE.Color(0xffd27a);

  // White-hot -> orange in the first 80 ms, then -> deep red.
  function heat(t, out) {
    if (t < 0.08) return out.copy(HOT_WHITE).lerp(HOT_ORANGE, t / 0.08);
    return out.copy(HOT_ORANGE).lerp(HOT_RED, Math.min(1, (t - 0.08) / 0.3));
  }

  // Presentation trigger: kind is "player" | "attacker" | "rock"; x/y are sim coordinates.
  function explode(kind, x, y, size) {
    const k = FX[kind] || FX.rock;
    let sc = 1;
    let nSparks = k.sparks;
    if (kind === "rock") {
      sc = ROCK_FX_SIZE[size || 0] || 1;
      nSparks = ROCK_FX_SPARKS[size || 0] || 20;
    } else if (kind === "attacker") {
      // Size from the saucer the renderer last drew nearest this point.
      let best = null;
      let bd = Infinity;
      for (const m of saucerMeshes) {
        const d = Math.hypot(m.userData.sx - x, m.userData.sy - y);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      sc = best ? Math.max(0.65, Math.min(1, best.userData.r / 20)) : 1;
      nSparks = Math.round(k.sparks * (0.7 + 0.3 * sc));
    }
    const slot = slots[slotCursor++ % slots.length];
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    slot.kind = k;
    slot.sc = sc;
    slot.seed = seq;
    slot.shock.material.color.setHex(kind === "player" ? 0x6cd8ff : kind === "attacker" ? 0x7dffb0 : 0xffb070);
    if (k.shake) {
      shakeAmp = Math.max(shakeAmp * Math.max(0, 1 - shakeAge / 0.35), k.shake * sc);
      shakeAge = 0;
    }
    for (let i = 0; i < nSparks; i++) {
      const sp = sparks[sparkCursor++ % sparks.length];
      const u = sp.userData;
      seq += 1;
      const a = hash1(seq * 1.7 + x) * Math.PI * 2;
      const v = k.speed * (0.55 + 0.45 * sc) * (0.3 + 0.9 * hash1(seq * 3.1 + y));
      u.x = x + Math.cos(a) * 3 * sc;
      u.y = y + Math.sin(a) * 3 * sc;
      u.vx = Math.cos(a) * v;
      u.vy = Math.sin(a) * v;
      u.max = u.life = k.life * (0.35 + 0.5 * hash1(seq * 5.3));
      u.tint = k.tint && i % 3 === 0 ? k.tint : 0;
      sp.visible = true;
    }
    for (let i = 0; i < Math.round(k.debris * (kind === "rock" ? 0.6 + 0.4 * sc : 1)); i++) {
      const d = debris[debrisCursor++ % debris.length];
      const u = d.userData;
      seq += 1;
      const a = hash1(seq * 2.9 + y) * Math.PI * 2;
      const v = k.speed * 0.42 * (0.6 + 0.4 * sc) * (0.35 + hash1(seq * 4.3));
      u.x = x;
      u.y = y;
      u.vx = Math.cos(a) * v;
      u.vy = Math.sin(a) * v;
      u.max = u.life = 0.28 + 0.14 * hash1(seq * 6.1);
      u.sx = (hash1(seq * 7.7) - 0.5) * 12;
      u.sy = (hash1(seq * 8.3) - 0.5) * 12;
      u.sz = (hash1(seq * 9.1) - 0.5) * 8;
      u.size = (kind === "rock" ? 3.6 * sc + 1.2 : 3) * (0.7 + 0.6 * hash1(seq * 8.9));
      d.geometry = kind === "rock" ? chunkGeos[i % 3] : hullChunkGeo;
      d.visible = true;
    }
  }

  function clearEffects() {
    for (const sl of slots) {
      sl.active = false;
      sl.core.visible = sl.flash.visible = sl.shock.visible = false;
      for (const p of sl.smoke) p.visible = false;
    }
    for (const sp of sparks) sp.visible = false;
    for (const d of debris) d.visible = false;
    shakeAmp = 0;
    muzzle.visible = false;
  }

  function stepEffects(dt, view) {
    const s = view.scale;
    for (const sl of slots) {
      if (!sl.active) continue;
      sl.age += dt;
      const t = sl.age;
      const size = sl.sc * s;
      if (t >= Math.max(sl.kind.life, 0.6)) {
        sl.active = false;
        sl.core.visible = sl.flash.visible = sl.shock.visible = false;
        for (const p of sl.smoke) p.visible = false;
        continue;
      }
      const px = view.ox + sl.x * s;
      const py = -(view.oy + sl.y * s);
      // Core: snaps to full size, white-hot for ~80 ms, cools to orange and fades by ~0.32 s.
      const coreA = t < 0.08 ? 1 : Math.max(0, 1 - (t - 0.08) / 0.24);
      sl.core.visible = coreA > 0;
      sl.core.position.set(px, py, 8);
      sl.core.scale.setScalar(sl.kind.flash * size * (0.42 + 0.2 * Math.min(1, t / 0.05) + 0.3 * t));
      heat(t, sl.core.material.color);
      sl.core.material.opacity = coreA;
      // Bloom: a brief wide light burst that lifts the surroundings.
      const flA = Math.max(0, 1 - t / 0.14) ** 1.5;
      sl.flash.visible = flA > 0;
      sl.flash.position.set(px, py, 7);
      sl.flash.scale.setScalar(sl.kind.flash * size * 1.2);
      heat(t * 0.7, sl.flash.material.color);
      sl.flash.material.opacity = 0.45 * flA;
      // Shockwave: fast ease-out ring.
      const e = Math.min(1, t / 0.45);
      sl.shock.visible = e < 1;
      sl.shock.position.set(px, py, 6);
      sl.shock.scale.setScalar(Math.max(0.001, sl.kind.ring * size * 0.5 * (0.12 + 0.88 * (1 - (1 - e) ** 3))));
      sl.shock.material.opacity = Math.min(1, t / 0.03) * 0.9 * (1 - e) ** 1.6;
      // Smoke: faint dark puffs that swell and thin out over ~0.5 s.
      sl.smoke.forEach((p, k) => {
        const u = (t - 0.03 - k * 0.03) / 0.5;
        p.visible = u > 0 && u < 1;
        if (!p.visible) return;
        const a = hash1(sl.seed * 3.7 + k * 11.3) * Math.PI * 2;
        const off = sl.kind.flash * 0.16 * (0.4 + u) * size;
        p.position.set(px + Math.cos(a) * off, py + Math.sin(a) * off, 3);
        p.scale.setScalar(sl.kind.flash * size * (0.55 + 0.75 * u));
        p.material.opacity = 0.55 * Math.min(1, u * 5) * (1 - u) ** 1.3;
      });
    }
    const drag = Math.exp(-2.6 * dt);
    for (const sp of sparks) {
      if (!sp.visible) continue;
      const u = sp.userData;
      u.life -= dt;
      if (u.life <= 0) {
        sp.visible = false;
        continue;
      }
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      u.vx *= drag;
      u.vy *= drag;
      const age = 1 - u.life / u.max;
      const speed = Math.hypot(u.vx, u.vy);
      sp.position.set(view.ox + u.x * s, -(view.oy + u.y * s), 5);
      sp.rotation.z = -Math.atan2(u.vy, u.vx);
      // Velocity-stretched: length follows the current speed, so streaks shorten as they slow.
      sp.scale.set((3 + speed * 0.075) * s, 2.3 * s, 1);
      const c = sp.material.color;
      if (u.tint) c.setHex(u.tint).lerp(HOT_WHITE, Math.max(0, 0.6 - age * 2));
      else if (age < 0.15) c.copy(HOT_WHITE).lerp(SPARK_YELLOW, age / 0.15);
      else c.copy(SPARK_YELLOW).lerp(HOT_ORANGE, Math.min(1, (age - 0.15) / 0.5));
      sp.material.opacity = (1 - age) ** 0.8;
    }
    for (const d of debris) {
      if (!d.visible) continue;
      const u = d.userData;
      u.life -= dt;
      if (u.life <= 0) {
        d.visible = false;
        continue;
      }
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      u.vx *= 0.985;
      u.vy *= 0.985;
      d.position.set(view.ox + u.x * s, -(view.oy + u.y * s), 4);
      d.rotation.x += u.sx * dt;
      d.rotation.y += u.sy * dt;
      d.rotation.z += u.sz * dt;
      d.scale.setScalar(u.size * s * (0.25 + 0.75 * (u.life / u.max)));
    }
  }

  const bulletMeshes = [];
  const bulletGlows = [];
  for (let i = 0; i < BULLET_POOL; i++) {
    const b = new THREE.Mesh(bulletGeo, bulletMat);
    b.visible = false;
    scene.add(b);
    bulletMeshes.push(b);
    const g = new THREE.Sprite(bulletGlowMat);
    g.visible = false;
    scene.add(g);
    bulletGlows.push(g);
  }
  const seenBullets = new WeakSet();

  function place(mesh, x, y, view) {
    mesh.position.set(view.ox + x * view.scale, -(view.oy + y * view.scale), 0);
  }

  function frameCamera(view) {
    const w = view.w;
    const h = view.h;
    const portrait = h > w;
    // Portrait is its own camera: wider lens and the vanishing point on the field, above the controls.
    const fov = portrait ? look.cameraFovPortrait : look.cameraFov;
    const fieldCx = w / 2;
    const fieldCy = view.oy + (view.fieldH * view.scale) / 2;
    camera.fov = fov;
    camera.aspect = w / h;
    const dist = h / 2 / Math.tan((fov * Math.PI) / 360);
    camera.position.set(fieldCx, -fieldCy, dist);
    camera.lookAt(fieldCx, -fieldCy, 0);
    camera.setViewOffset(w, h, w / 2 - fieldCx, h / 2 - fieldCy, w, h);
    camera.updateProjectionMatrix();
    bg.position.set(fieldCx, -fieldCy, -300);
    bg.scale.set(w * 2, h * 2, 1);
  }

  function draw(state, view, uniforms) {
    const cfg = state.cfg;
    frameCamera({ ...view, fieldH: cfg.fieldH });
    const bu = bgMaterial.uniforms;
    bu.uTime.value = uniforms.uTime;
    bu.uChroma.value = uniforms.uChroma;
    bu.uFlow.value = uniforms.uFlow;
    bu.uPointer.value.set(uniforms.uPointer[0], uniforms.uPointer[1]);
    bu.uBurst.value = uniforms.uBurst;
    bu.uRes.value.set(view.w, view.h);

    const s = view.scale;
    // Background depth: the vignette is pinned to the screen, scaled for its distance behind the field.
    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const kv = (camZ - VIGNETTE_Z) / camZ;
    vignette.position.set(camX + (view.w / 2 - camX) * kv, camY + (-view.h / 2 - camY) * kv, VIGNETTE_Z);
    vignette.scale.set(view.w * kv, view.h * kv, 1);
    vignetteMat.uniforms.uAspect.value = view.w / view.h;
    const dt = Math.max(0, Math.min(0.1, uniforms.uTime - lastT));
    lastT = uniforms.uTime;
    // Tiny decaying screen shake after a ship death or saucer kill (camera only; HUD and play field untouched).
    shakeAge += dt;
    if (shakeAmp > 0 && shakeAge < 0.35) {
      const a = shakeAmp * s * (1 - shakeAge / 0.35) ** 2;
      camera.position.x += a * Math.sin(shakeAge * 97);
      camera.position.y += a * Math.cos(shakeAge * 73);
    }

    // Stars: drift and twinkle from elapsed render time only; never from thrust or simulation.
    const tS = starPin !== null ? starPin : (performance.now() - starT0) / 1000;
    const WRAP = ShooterStars.TWINKLE_WRAP;
    starLayers.forEach((pts, i) => {
      const u = pts.material.uniforms;
      const ox = ((STAR_VEL[i][0] * tS) % STAR_FIELD + STAR_FIELD) % STAR_FIELD;
      const oy = ((STAR_VEL[i][1] * tS) % STAR_FIELD + STAR_FIELD) % STAR_FIELD;
      u.uOffset.value.set(ox, oy);
      u.uTwTime.value = ((tS % WRAP) + WRAP) % WRAP;
      pts.position.set(view.w / 2, -(view.oy + (cfg.fieldH * s) / 2), STAR_DEPTH[i]);
    });

    // Ship.
    const invul = state.ship.invulnerable > 0;
    const blink = invul && Math.floor(state.time * 10) % 2 === 0;
    ship.visible = state.ship.alive && !blink;
    if (ship.visible) {
      place(ship, state.ship.x, state.ship.y, view);
      ship.rotation.z = -state.ship.a;
      ship.scale.setScalar(s * SHIP_SCALE);
      const thrusting = !!state.ship.thrusting;
      const t = uniforms.uTime;
      flame.visible = thrusting;
      const f = 0.85 + 0.25 * Math.sin(t * 61) + 0.12 * Math.sin(t * 23);
      if (thrusting) {
        flame.children.forEach((m, i) => m.scale.set(1, (i % 2 ? 1.1 : 1) * f, 1));
        flameMat.opacity = 0.55 + 0.25 * f;
      }
      // Idle engines breathe slowly; thrust pushes them hot and flickering.
      const pulse = thrusting ? 1.35 + 0.25 * f : 0.85 + 0.2 * Math.sin(t * 5);
      engineGlows.forEach((g, i) => g.scale.setScalar(i % 2 ? 4 * pulse : 10 * pulse));
      engineMat.opacity = thrusting ? 1 : 0.75 + 0.2 * Math.sin(t * 5);
      const blinkTip = 0.5 + 0.5 * Math.sin(t * 3.2);
      tipLights.forEach((tl) => tl.scale.setScalar(3 + 2.5 * blinkTip));
      tipLightMat.opacity = 0.55 + 0.45 * blinkTip;
      muzzleAge += dt;
      muzzle.visible = muzzleAge < 0.07;
      if (muzzle.visible) {
        const m = 1 - muzzleAge / 0.07;
        muzzle.scale.setScalar(0.6 + 0.6 * m);
        muzzleMat.opacity = m;
      }
      shimmer.visible = invul;
      if (invul) shimmerMat.opacity = 0.12 + 0.1 * Math.sin(state.time * 14);
    }

    // Rocks.
    const seen = new Set();
    for (const rock of state.rocks) {
      const rpx = cfg.rockRadii[rock.size] * s;
      const tier = rpx >= 100 ? 2 : rpx >= 40 ? 1 : 0;
      let m = rockMeshes.get(rock);
      if (m && m.geometry.userData.tier !== tier) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        rockMeshes.delete(rock);
        m = null;
      }
      if (!m) {
        const geo = rockGeometry(rock, cfg.rockRadii[rock.size], tier);
        m = new THREE.Mesh(geo, rockMaterial(geo.userData.craters));
        scene.add(m);
        rockMeshes.set(rock, m);
      }
      seen.add(rock);
      place(m, rock.x, rock.y, view);
      m.material.uniforms.uGrain.value = rpx;
      m.rotation.z = -rock.rot;
      m.scale.set(s, s, s);
      m.visible = !view.bgOnly;
    }
    for (const [rock, m] of rockMeshes) {
      if (!seen.has(rock)) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        rockMeshes.delete(rock);
      }
    }

    // Saucers.
    while (saucerMeshes.length < state.saucers.length) {
      const m = buildSaucer();
      scene.add(m);
      saucerMeshes.push(m);
    }
    saucerMeshes.forEach((m, i) => {
      const sc = state.saucers[i];
      if (!sc) {
        m.visible = false;
        return;
      }
      m.visible = !view.bgOnly;
      place(m, sc.x, sc.y, view);
      m.scale.setScalar(sc.r * s * 1.16);
      const ud = m.userData;
      ud.r = sc.r;
      ud.sx = sc.x;
      ud.sy = sc.y;
      const t = uniforms.uTime;
      if (ud.small !== !!sc.small) {
        ud.small = !!sc.small;
        ud.type = SAUCER_TYPES[ud.small ? "small" : "large"];
        ud.domeMat.emissive.setHex(ud.type.dome);
        ud.domeMat.color.setHex(ud.type.domeBase);
        ud.domeGlowMat.color.setHex(ud.type.glow);
        ud.underMat.color.setHex(ud.type.glow);
      }
      // Rim lights chase around the hull: a white head, a coloured tail, the rest dim.
      const chase = (t * 14) % SAUCER_LIGHTS;
      for (let k = 0; k < SAUCER_LIGHTS; k++) {
        const d = (chase - k + SAUCER_LIGHTS) % SAUCER_LIGHTS;
        const lit = d < 1 ? 1 : d < 4 ? 1 - (d - 1) / 4 : 0.3;
        const L = ud.lights[k];
        L.bulbMat.color.setHex(d < 1 ? 0xffffff : d < 4 ? ud.type.chase : ud.type.idle);
        L.haloM.opacity = lit;
        L.haloM.color.setHex(d < 1 ? 0xffffff : ud.type.chase);
      }
      const throb = 0.5 + 0.5 * Math.sin(t * 4.2);
      ud.spin.rotation.y = t * 0.6 * (ud.small ? -1.4 : 1);
      ud.underMat.opacity = 0.4 + 0.2 * throb;
      ud.domeGlowMat.opacity = 0.45 + 0.25 * throb;
      ud.domeMat.emissiveIntensity = 0.65 + 0.25 * throb;
    });

    // Bullets: hot bolts stretched along their travel. A new player bolt fires the muzzle flash, and stays hidden
    // until it clears the cannon tips so it visibly leaves the guns (render only; the sim position is untouched).
    const sh = state.ship;
    const muzzleDist = MUZZLE_Y * SHIP_SCALE;
    bulletMeshes.forEach((m, i) => {
      const b = state.bullets[i];
      const g = bulletGlows[i];
      m.visible = g.visible = !!b;
      if (!b) return;
      const mine = b.own === "player";
      if (mine && !seenBullets.has(b)) {
        seenBullets.add(b);
        if (cfg.bulletLife - b.life < 0.05) muzzleAge = 0;
      }
      if (mine && sh.alive && cfg.bulletLife - b.life < 0.25) {
        const ahead = (b.x - sh.x) * Math.sin(sh.a) - (b.y - sh.y) * Math.cos(sh.a);
        if (ahead < muzzleDist) {
          m.visible = g.visible = false;
          return;
        }
      }
      place(m, b.x, b.y, view);
      m.position.z = 6;
      m.material = mine ? bulletMat : enemyBulletMat;
      const r = cfg.bulletRadius * 1.3 * s;
      m.rotation.z = -Math.atan2(b.vy, b.vx);
      m.scale.set(r * 2.6, r, r);
      g.material = mine ? bulletGlowMat : enemyGlowMat;
      g.position.set(m.position.x, m.position.y, 5);
      g.scale.setScalar(r * 7);
    });

    stepEffects(dt, view);
    renderer.render(scene, camera);
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
  }

  function dispose() {
    for (const m of rockMeshes.values()) {
      m.geometry.dispose();
      m.material.dispose();
    }
    rockMeshes.clear();
    shimmer.geometry.dispose();
    for (const g of [vignette.geometry, shipGeo, bodyGeo, stripeGeo, tipGeo, panelGeo, spineGeo, canopyGeo, nacelleGeo, nozzleGeo, barrelGeo, muzzleGeo, mountGeo, flameGeo, trailGeo, saucerHullGeo, saucerUnderGeo, saucerRimGeo, saucerCanopyGeo, saucerCollarGeo, saucerRidgeGeo, saucerSeamGeo, saucerLightGeo, sparkGeo, hullChunkGeo, ...chunkGeos, shockGeo]) g.dispose();
    for (const pts of starLayers) {
      pts.geometry.dispose();
      pts.material.dispose();
    }
    for (const sp of sparks) sp.material.dispose();
    for (const sl of slots) {
      sl.core.material.dispose();
      sl.flash.material.dispose();
      sl.shock.material.dispose();
      for (const p of sl.smoke) p.material.dispose();
    }
    for (const mt of [vignetteMat, shipMat, bodyMat, darkMat, whiteMat, trimMat, canopyMat, nozzleMat, shadowMat, haloMat, engineMat, engineCoreMat, glintMat, tipLightMat, muzzleMat, flameMat, trailMat, shimmerMat, saucerRimMat, saucerDeckMat, saucerTopMat, saucerDarkMat, saucerTrimMat, saucerGlintMat, saucerShadowMat, emberMat, bulletMat, enemyBulletMat, bulletGlowMat, enemyGlowMat, ...saucerOwnMats]) mt.dispose();
    bulletGeo.dispose();
    bg.geometry.dispose();
    bgMaterial.dispose();
    haloTex.dispose();
    glowTex.dispose();
    streakTex.dispose();
    envRT.dispose();
    renderer.dispose();
  }

  return { draw, resize, dispose, explode, clearEffects, setStarClock };
}
