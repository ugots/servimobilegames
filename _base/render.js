// Shared three.js render base (THREE_BASE (b): renderer, lighting preset,
// render loop, placeholder check). Plain ES module, no build step, no deps
// beyond the vendored three.module.js.
// P1: needs the page's import map (three / three/addons/) for RoomEnvironment
// and the postprocessing addons below to resolve.

import * as THREE from "./vendor/three.module.js";
import { createDesktopRig, createMobileRig } from "./rigs.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * addLightingPreset(scene, composition)
 * Adds "light_hemi" (HemisphereLight) and "light_sun" (DirectionalLight,
 * shadow-casting) to scene. composition: "desktop" | "mobile".
 */
export function addLightingPreset(scene, composition) {
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a2e44, 1.0);
  hemi.name = "light_hemi";
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.name = "light_sun";
  sun.position.set(30, 60, 20);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); // P17: capped at 1024 (was 2048 desktop)
  sun.shadow.camera.left = -1600;
  sun.shadow.camera.right = 1600;
  sun.shadow.camera.top = 1600;
  sun.shadow.camera.bottom = -1600;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(0x404060, 0.3);
  ambient.name = "light_ambient";
  scene.add(ambient);

  return { hemi, sun, ambient };
}

/**
 * setSkyGradient(scene, { top, horizon }) -> CanvasTexture
 * Builds a 2x256 vertical-gradient canvas (top colour at y=0, horizon colour
 * at y=256), sets it as scene.background and returns the texture.
 */
export function setSkyGradient(scene, { top = "#04050c", horizon = "#241a4a" } = {}) {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, horizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  return tex;
}

/**
 * createScene({ canvas, composition }) -> {
 *   THREE, renderer, scene, camera, rig, resize, onRender, start, stop,
 *   assertNoPlaceholders
 * }
 * composition: "desktop" | "mobile".
 */
export function createScene({ canvas, composition, tiltDeg }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // P17: desktop capped at 1.5 (was 1.75 for both); mobile untouched.
  const dprCap = composition === "mobile" ? 1.75 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const rig = composition === "mobile" ? createMobileRig() : createDesktopRig({ tiltDeg });
  const camera = rig.camera;

  const { sun } = addLightingPreset(scene, composition);

  function fitShadowToPlane(W, H, maxHeight) {
    const m = Math.max(W, H);
    const margin = Math.max(24, 0.75 * maxHeight);
    sun.position.set(0.55 * m, 1.4 * m, 0.75 * m);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    const shadow = sun.shadow;
    shadow.camera.position.copy(sun.position);
    shadow.camera.lookAt(sun.target.position);
    shadow.camera.updateMatrixWorld();
    const inverse = shadow.camera.matrixWorld.clone().invert();
    const halfW = W / 2 + margin, halfH = H / 2 + margin;
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (const x of [-halfW, halfW]) for (const z of [-halfH, halfH]) {
      for (const y of [0, maxHeight]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(inverse);
        left = Math.min(left, point.x); right = Math.max(right, point.x);
        bottom = Math.min(bottom, point.y); top = Math.max(top, point.y);
      }
    }
    Object.assign(shadow.camera, { left: left - 16, right: right + 16,
      bottom: bottom - 16, top: top + 16, near: 1, far: 3 * m });
    shadow.camera.updateProjectionMatrix();
    shadow.needsUpdate = true;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    composition === "mobile" ? 0.27 : 0.33,
    composition === "mobile" ? 0.35 : 0.4,
    0.88
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  function renderFrame() {
    composer.render();
  }

  // Eased camera (desktop only): resize() sets rest to the rig's fitted
  // position; easeCamera() lerps an offset toward the player's world x/z.
  let camRest = camera.position.clone();
  let camOffset = new THREE.Vector3(0, 0, 0);
  function easeCamera(focusX, focusZ, dt) {
    if (composition === "mobile") return;
    const target = new THREE.Vector3(focusX * 0.025, 0, focusZ * 0.025);
    camOffset.addScaledVector(target.clone().sub(camOffset), 1 - Math.exp(-3 * dt));
    camera.position.copy(camRest).add(camOffset);
    camera.lookAt(0, 0, 0);
  }

  let lastViewW = 0, lastViewH = 0;
  let lastPlaneW = 0, lastPlaneH = 0;
  let quality = "full";
  function resize(viewW, viewH, planeW, planeH) {
    lastViewW = viewW;
    lastViewH = viewH;
    lastPlaneW = planeW;
    lastPlaneH = planeH;
    renderer.setSize(viewW, viewH, true);
    rig.fit(planeW, planeH, viewW, viewH);
    camRest = camera.position.clone();
    camOffset.set(0, 0, 0);
    composer.setSize(viewW, viewH);
    // P17: bloom pass at half resolution on desktop too (was full res, only
    // mobile halved). Also fixes the VALIDATE_STATUS console errors: the old
    // code only mutated bloomPass.resolution (a uniform) after composer.setSize
    // had already sized the pass's mip render targets to the FULL viewW/viewH,
    // leaving the RTs mismatched with the (halved, for mobile) resolution
    // uniform. bloomPass.setSize() rebuilds the actual render targets to match,
    // and — since resize() only runs once per window resize/orientation event,
    // never per animation frame — the render targets are now (re)built exactly
    // once per resize, matching the fix Boss asked for.
    const bloomW = Math.max(1, Math.round(viewW / 2));
    const bloomH = Math.max(1, Math.round(viewH / 2));
    bloomPass.setSize(bloomW, bloomH);
  }

  // While a menu/overlay is up, render cheaply: bloom off, shadow map frozen,
  // pixel ratio 1. Restored on countdown/playing. shadowMap.enabled itself is
  // left alone so materials never recompile on the Play click.
  function setQuality(mode) {
    if (mode === quality) return;
    quality = mode;
    if (mode === "menu") {
      bloomPass.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setPixelRatio(1);
      composer.setPixelRatio(1);
    } else {
      bloomPass.enabled = true;
      renderer.shadowMap.autoUpdate = true;
      const ratio = Math.min(window.devicePixelRatio || 1, dprCap);
      renderer.setPixelRatio(ratio);
      composer.setPixelRatio(ratio);
    }
    if (lastViewW > 0) resize(lastViewW, lastViewH, lastPlaneW, lastPlaneH);
  }

  const renderCallbacks = [];
  function onRender(fn) {
    renderCallbacks.push(fn);
  }

  let rafId = null;
  let lastTime = null;
  function frame(now) {
    const seconds = now / 1000;
    const dt = lastTime === null ? 0 : Math.min(0.05, seconds - lastTime);
    lastTime = seconds;
    for (const fn of renderCallbacks) fn(dt);
    renderFrame();
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId !== null) return;
    lastTime = null;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function assertNoPlaceholders() {
    let count = 0;
    scene.traverse((obj) => {
      if (!(obj.isMesh || obj.isPoints || obj.isInstancedMesh)) return;
      count += 1;
      const mat = obj.material;
      const label = obj.name || obj.uuid;
      if (!mat) throw new Error(`placeholder: ${label}`);
      if (!mat.name) throw new Error(`placeholder: ${label}`);
      if (
        mat.isMeshBasicMaterial &&
        mat.color &&
        mat.color.getHexString() === "ffffff" &&
        !mat.vertexColors &&
        !mat.map
      ) {
        throw new Error(`placeholder: ${label}`);
      }
    });
    return count;
  }

  return {
    THREE,
    renderer,
    composer,
    bloomPass,
    renderFrame,
    easeCamera,
    scene,
    camera,
    rig,
    resize,
    fitShadowToPlane,
    onRender,
    start,
    stop,
    assertNoPlaceholders,
    setQuality,
    getQuality: () => quality,
  };
}
