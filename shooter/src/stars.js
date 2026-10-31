// Seeded star field. Pure: no three, no DOM, no Math.random. Jittered dart-throwing keeps stars
// apart (no lattice, no aligned rows); each star carries a depth layer for slow parallax.
const ShooterStars = (() => {
  const MIN_DIST = 8;
  const TWINKLE_WRAP = 3600;
  const SIZES = [1.2, 1.7, 2.3, 3.1];
  const BRIGHTS = [0.5, 0.65, 0.82, 1.0];

  function rng(seed) {
    let a = (seed | 0) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate(seed, count, w, h) {
    const rand = rng(seed);
    const cell = MIN_DIST;
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    const grid = new Map();
    const stars = [];
    let tries = 0;
    while (stars.length < count && tries < count * 60) {
      tries++;
      const x = rand() * w;
      const y = rand() * h;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let ok = true;
      for (let j = Math.max(0, cy - 1); j <= Math.min(rows - 1, cy + 1) && ok; j++) {
        for (let i = Math.max(0, cx - 1); i <= Math.min(cols - 1, cx + 1); i++) {
          const o = grid.get(j * cols + i);
          if (o && Math.hypot(o.x - x, o.y - y) < MIN_DIST) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      const layer = stars.length % 3;
      const star = {
        x,
        y,
        size: SIZES[Math.floor(rand() * SIZES.length)] * (0.8 + layer * 0.25),
        bright: BRIGHTS[Math.floor(rand() * BRIGHTS.length)],
        layer,
        // Twinkle phase in [0, 1): a pure function of position, so it never touches the seeded sequence.
        phase: (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 < 0 ? 1 + ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) : (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1,
      };
      // Independent twinkle period (s) and amplitude per star, drawn after the placement values.
      // Period is an integer count of cycles per TWINKLE_WRAP, so the wrapped clock never jumps.
      const r = 2.0 + rand() * 3.5;
      star.period = TWINKLE_WRAP / Math.round(TWINKLE_WRAP / r);
      star.amp = 0.45 + rand() * 0.55;
      star.harm = star.phase < 0.5 ? 2 : 3;
      grid.set(cy * cols + cx, star);
      stars.push(star);
    }
    return stars;
  }

  return { generate, TWINKLE_WRAP };
})();

if (typeof window !== "undefined") window.ShooterStars = ShooterStars;
