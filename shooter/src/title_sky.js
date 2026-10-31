// Title-only 2D sky behind the menu: nebula, three star depths, three drifting rocks. No WebGL.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mountTitleSky(screenEl) {
  const canvas = document.createElement("canvas");
  canvas.className = "shooter-sky";
  canvas.setAttribute("aria-hidden", "true");
  screenEl.insertBefore(canvas, screenEl.firstChild);
  screenEl.classList.add("shooter-has-sky");
  const ctx = canvas.getContext("2d");
  const rnd = mulberry32(9);
  const COLORS = ["#ffffff", "#cfe0ff", "#ffe9c4"];
  const LAYERS = [
    { r: 0.6, a: 0.45, v: 3, n: 120 },
    { r: 1.0, a: 0.7, v: 7, n: 80 },
    { r: 1.6, a: 0.95, v: 14, n: 40 },
  ];
  const stars = [];
  LAYERS.forEach((L) => {
    for (let i = 0; i < L.n; i++) stars.push({ L, x: rnd(), y: rnd(), c: COLORS[Math.floor(rnd() * 3)] });
  });
  // Normalised start positions: at 412 wide x<=0.25 and 0.8 show two rocks; none sits on the centre column.
  const rocks = [
    { rad: 60, v: 5, spin: 0.03, x: 0.12, y: 0.2 },
    { rad: 95, v: 9, spin: 0.02, x: 0.86, y: 0.8 },
    { rad: 140, v: 16, spin: 0.05, x: 0.92, y: 0.3 },
  ].map((r) => ({ ...r, ang: rnd() * 6.28, pts: Array.from({ length: 9 }, () => 0.7 + rnd() * 0.5) }));

  let w = 0, h = 0, dpr = 1, t0 = 0;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = canvas.width = Math.max(1, Math.round(innerWidth * dpr));
    h = canvas.height = Math.max(1, Math.round(innerHeight * dpr));
  }
  const wrap = (v, m) => ((v % m) + m) % m;

  function nebula(cx, cy, rad, rgba) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, rgba);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function draw(s) {
    ctx.fillStyle = "#03050b";
    ctx.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    nebula(0.28 * w, 0.32 * h, 0.6 * m, "rgba(40,70,150,0.30)");
    nebula(0.78 * w, 0.7 * h, 0.5 * m, "rgba(110,40,130,0.22)");
    ctx.globalAlpha = 1;
    for (const st of stars) {
      ctx.globalAlpha = st.L.a;
      ctx.fillStyle = st.c;
      const x = wrap(st.x * w - st.L.v * dpr * s, w);
      ctx.beginPath();
      ctx.arc(x, st.y * h, st.L.r * dpr, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b121c";
    ctx.strokeStyle = "#24364b";
    ctx.lineWidth = 2;
    for (const r of rocks) {
      const R = r.rad * dpr;
      const cx = wrap(r.x * w - r.v * dpr * s + R, w + 2 * R) - R;
      const cy = r.y * h;
      const a0 = r.ang + r.spin * s;
      ctx.beginPath();
      r.pts.forEach((k, i) => {
        const a = a0 + (i / 9) * 6.2832;
        const px = cx + Math.cos(a) * R * k, py = cy + Math.sin(a) * R * k;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (screenEl.classList.contains("gk-hidden")) { t0 = 0; return; }
    if (!t0) t0 = now;
    draw((now - t0) / 1000);
  }

  resize();
  draw(0);
  addEventListener("resize", () => { resize(); draw(0); });
  if (!reduced) requestAnimationFrame(loop);
  if (new URLSearchParams(location.search).get("shot") === "1") {
    window.__shooterSky = { setClock: (s) => draw(s) };
  }
}
