// Camera rigs for the shared three.js base (D-032, D-034, THREE_BASE (b)3
// option B: two separate constructors, no shared camera math). Plain ES
// module, no deps. Play plane lies on XZ, centred at origin, +Y up; world
// units = game pixels.

import * as THREE from "./vendor/three.module.js";

const DEG2RAD = Math.PI / 180;

/**
 * createDesktopRig() -> { camera, fit(planeW, planeH, viewW, viewH) }
 * Perspective camera tilted tiltDeg (default 58) degrees above the horizontal,
 * viewed from the +Z side (screen-bottom of the field nearest the viewer).
 * fit() frames the whole plane with a 4% margin on the limiting axis.
 */
export function createDesktopRig({ tiltDeg = 58 } = {}) {
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  const tiltRad = tiltDeg * DEG2RAD;

  function fit(planeW, planeH, viewW, viewH) {
    camera.aspect = viewW / viewH;
    const vFov = (camera.fov * DEG2RAD) / 2;
    const hFov = Math.atan(Math.tan(vFov) * camera.aspect);

    const halfW = (planeW / 2) * 1.04;
    const halfH = (planeH / 2) * 1.04;

    // Distance required so each half-extent fits inside its half-fov.
    const distForW = halfW / Math.sin(hFov);
    const distForH = halfH / Math.sin(vFov);
    let dist = Math.max(distForW, distForH);
    if (tiltDeg < 58) {
      // At shallower tilts, the near arena corners can clip the frustum;
      // also require the near-edge distance to clear each half-fov.
      const distNearW = halfW / Math.tan(hFov) + halfH * Math.cos(tiltRad);
      const distNearH = (halfH * Math.sin(tiltRad)) / Math.tan(vFov) + halfH * Math.cos(tiltRad);
      dist = Math.max(dist, distNearW, distNearH);
    }

    const height = dist * Math.sin(tiltRad);
    const depth = dist * Math.cos(tiltRad);

    camera.position.set(0, height, depth);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  return { camera, fit };
}

/**
 * createMobileRig() -> { camera, fit(planeW, planeH, viewW, viewH) }
 * Perspective camera tilted 68 degrees above the horizontal, viewed from
 * the +Z side. fit() fits the plane width with a 3% margin.
 */
export function createMobileRig() {
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
  const tiltRad = 68 * DEG2RAD;

  function fit(planeW, planeH, viewW, viewH) {
    camera.aspect = viewW / viewH;
    const vFov = (camera.fov * DEG2RAD) / 2;
    const hFov = Math.atan(Math.tan(vFov) * camera.aspect);

    const halfW = (planeW / 2) * 1.03;
    const dist = halfW / Math.sin(hFov);

    const height = dist * Math.sin(tiltRad);
    const depth = dist * Math.cos(tiltRad);

    camera.position.set(0, height, depth);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  return { camera, fit };
}
