// Render uniforms derived from sim state. Pure: reads state, returns a new object.
const ShooterUniforms = (() => {
  const BURST_EVENTS = ["explodeLarge", "explodeMedium", "explodeSmall", "shipExplode"];

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function next(prev, state, t, pointer, look) {
    const p = prev || { uFlow: 0, uBurst: 0 };
    const events = state.events || [];
    const burst = events.some((e) => BURST_EVENTS.includes(e));
    const thrusting = !!(state.ship && state.ship.thrusting);
    return {
      uTime: t,
      uChroma: (state.wave || 0) * look.chromaPerWave + (state.score || 0) * look.chromaPerScore,
      uFlow: thrusting ? clamp01(p.uFlow + look.flowRise) : p.uFlow * look.flowDecay,
      uPointer: pointer ? [pointer[0], pointer[1]] : [0, 0],
      uBurst: burst ? 1 : p.uBurst * look.burstDecay,
    };
  }

  return { next };
})();

if (typeof window !== "undefined") window.ShooterUniforms = ShooterUniforms;
