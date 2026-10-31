// Cipher Shift cryptex: a brass cylinder lying on its side, SVG only.
// createDial(svgEl) -> { setLetters(arr), turn(d) -> Promise, lockGlow(), shake() }
const NS = "http://www.w3.org/2000/svg";
const ASSET = "assets/";
const STEP_MS = 220;
const MIN_RING = 44;      // wanted ring width (px) at phone size
const OVERLAP = 6;        // ring faces tuck 3 px under each groove side (bbox = pitch + 6)
const CAP_MIN = 20;

function mk(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function shiftChar(c, d) {
  return String.fromCharCode(97 + ((((c.charCodeAt(0) - 97 + d) % 26) + 26) % 26));
}

function reduced() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function emit(kind) {
  document.dispatchEvent(new CustomEvent("cs:sound", { detail: { kind } }));
}

export function createDial(svgEl) {
  let letters = [];
  let rings = [];
  let lay = null;
  let glow = null;
  let busy = false;

  function size() {
    const r = svgEl.getBoundingClientRect();
    return { W: Math.max(240, Math.round(r.width) || 412), H: Math.max(100, Math.round(r.height) || 220) };
  }

  function build() {
    const { W, H } = size();
    const n = Math.max(1, letters.length || 3);
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    rings = [];

    // Caps keep full size when they can; they shrink (down to CAP_MIN) so every ring stays wide.
    const pitchMax = W < 700 ? 96 : 190;
    const capIdeal = Math.max(CAP_MIN, Math.min(96, W * 0.085));
    let capW = capIdeal;
    let pitch = (W - 2 * capW) / n;
    if (pitch < MIN_RING - OVERLAP) {
      capW = Math.max(CAP_MIN, (W - n * (MIN_RING - OVERLAP)) / 2);
      pitch = (W - 2 * capW) / n;
    }
    pitch = Math.min(pitch, pitchMax);
    const ringsW = pitch * n;
    const x0 = (W - ringsW) / 2;
    const ringH = Math.min(H * 0.78, pitch * 2.4);
    const barrelH = Math.min(H * 0.96, ringH * 1.2);
    const top = (H - barrelH) / 2;
    const ringTop = (H - ringH) / 2;
    const slot = ringH / 3;
    const font = Math.max(18, Math.min(pitch * 0.5, slot * 0.78, 78));
    lay = { W, H, n, capW, pitch, x0, ringH, ringTop, slot, font, cy: H / 2 };

    const defs = mk("defs", {}, svgEl);
    const brass = mk("linearGradient", { id: "cdBrass", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    [["0", "#6b4a1c"], ["0.5", "#e2b867"], ["1", "#8a6224"]]
      .forEach(([o, c]) => mk("stop", { offset: o, "stop-color": c }, brass));
    const ivory = mk("linearGradient", { id: "cdIvory", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    [["0", "#b9a272"], ["0.22", "#efe3c4"], ["0.5", "#f6ecd2"], ["0.78", "#efe3c4"], ["1", "#c9b48a"]]
      .forEach(([o, c]) => mk("stop", { offset: o, "stop-color": c }, ivory));
    const vig = mk("radialGradient", { id: "cdVig", cx: 0.5, cy: 0.5, r: 0.62 }, defs);
    mk("stop", { offset: 0, "stop-color": "#ffd890", "stop-opacity": 0.2 }, vig);
    mk("stop", { offset: 0.6, "stop-color": "#7a4f1c", "stop-opacity": 0.08 }, vig);
    mk("stop", { offset: 1, "stop-color": "#000", "stop-opacity": 0 }, vig);
    const gl = mk("radialGradient", { id: "cdGlow", cx: 0.5, cy: 0.5, r: 0.6 }, defs);
    mk("stop", { offset: 0, "stop-color": "#ffe9a8", "stop-opacity": 0.85 }, gl);
    mk("stop", { offset: 1, "stop-color": "#ffcf5a", "stop-opacity": 0 }, gl);
    const blur = mk("filter", { id: "cdBlur", x: "-10%", y: "-80%", width: "120%", height: "260%" }, defs);
    mk("feGaussianBlur", { stdDeviation: Math.max(1.5, barrelH * 0.035) }, blur);
    const shadowBlur = mk("filter", { id: "cdShadow", x: "-10%", y: "-60%", width: "120%", height: "260%" }, defs);
    mk("feGaussianBlur", { stdDeviation: Math.max(3, barrelH * 0.07) }, shadowBlur);

    mk("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#cdVig)" }, svgEl);
    mk("ellipse", { cx: W / 2, cy: top + barrelH + barrelH * 0.1, rx: ringsW / 2 + capW * 0.6, ry: barrelH * 0.1, fill: "#000", opacity: 0.38, filter: "url(#cdShadow)" }, svgEl);

    // Barrel is only as long as its rings; the caps butt against the first and last ring.
    const bx = x0 - 1;
    const bw = ringsW + 2;
    mk("rect", { x: bx, y: top, width: bw, height: barrelH, fill: "url(#cdBrass)" }, svgEl);
    // shaded centre groove line along the barrel
    mk("rect", { x: bx, y: H / 2 - 0.75, width: bw, height: 1.5, fill: "#2a1d0e", opacity: 0.35 }, svgEl);

    const ringLayer = mk("g", { class: "cs-rings" }, svgEl);
    for (let i = 0; i < n; i++) {
      const rx = x0 + i * pitch - OVERLAP / 2;
      const rw = pitch + OVERLAP;
      const g = mk("g", { class: "cs-ring", "data-i": i }, ringLayer);
      const clip = mk("clipPath", { id: "cdClip" + i }, g);
      mk("rect", { x: rx, y: ringTop, width: rw, height: ringH, rx: 2 }, clip);
      mk("rect", { class: "cs-ring-face", x: rx, y: ringTop, width: rw, height: ringH, rx: 2, fill: "url(#cdIvory)" }, g);
      mk("image", { href: ASSET + "ring-face.svg", x: rx, y: ringTop, width: rw, height: ringH, preserveAspectRatio: "none" }, g);
      const lg = mk("g", { "clip-path": `url(#cdClip${i})` }, g);
      const texts = [];
      for (let j = -2; j <= 2; j++) {
        const t = mk("text", {
          class: j === 0 ? "cs-letter cs-center" : "cs-letter",
          "text-anchor": "middle", "dominant-baseline": "central",
          "font-family": "Georgia, 'Times New Roman', serif", "font-weight": "700",
          "font-size": font, fill: "#1e140a",
        }, lg);
        texts.push(t);
      }
      // window brackets around the centre slot
      mk("rect", { x: rx + 2, y: H / 2 - slot / 2, width: rw - 4, height: 1, fill: "#3a2810", opacity: 0.22, "pointer-events": "none" }, g);
      mk("rect", { x: rx + 2, y: H / 2 + slot / 2, width: rw - 4, height: 1, fill: "#3a2810", opacity: 0.22, "pointer-events": "none" }, g);
      rings.push({ cx: rx + rw / 2, texts });
    }
    // dark grooves between rings and at both ends, each with a thin lit lip
    for (let i = 0; i <= n; i++) {
      const gx = x0 + i * pitch;
      mk("rect", { x: gx - 1.5, y: ringTop - 1, width: 3, height: ringH + 2, fill: "#2a1d0e" }, svgEl);
      mk("rect", { x: gx + 1.5, y: ringTop, width: 0.8, height: ringH, fill: "#f0d28a", opacity: 0.35 }, svgEl);
    }
    // warm specular highlight along the top
    const specClip = mk("clipPath", { id: "cdSpecClip" }, defs);
    mk("rect", { x: bx, y: top, width: bw, height: barrelH }, specClip);
    const specG = mk("g", { "clip-path": "url(#cdSpecClip)", "pointer-events": "none" }, svgEl);
    mk("rect", { x: bx + 4, y: top + barrelH * 0.05, width: bw - 8, height: barrelH * 0.13, rx: barrelH * 0.06, fill: "#fff", opacity: 0.35, filter: "url(#cdBlur)" }, specG);
    // end caps: conical tips point outward
    mk("image", { href: ASSET + "end-cap.svg", x: x0 - capW, y: top, width: capW, height: barrelH, preserveAspectRatio: "none" }, svgEl);
    const rg = mk("g", { transform: `translate(${2 * x0 + ringsW} 0) scale(-1 1)` }, svgEl);
    mk("image", { href: ASSET + "end-cap.svg", x: x0 - capW, y: top, width: capW, height: barrelH, preserveAspectRatio: "none" }, rg);
    glow = mk("rect", { x: x0, y: top, width: ringsW, height: barrelH, fill: "url(#cdGlow)", opacity: 0, "pointer-events": "none", class: "cs-glow" }, svgEl);
    render(0);
  }

  // shift: how many slots the letters have travelled (+1 = moved up by one letter).
  function render(shift) {
    if (!lay) return;
    const { slot, cy } = lay;
    const k = slot / Math.sin(0.75);
    rings.forEach((r, i) => {
      const c = letters[i] || "a";
      for (let j = -2; j <= 2; j++) {
        const pos = j - shift;
        const ang = pos * 0.75;
        const a = Math.abs(pos);
        let op = a <= 1 ? 1 - 0.6 * a : 0.4 * (1 - (a - 1) / 0.8);
        if (op < 0) op = 0;
        const t = r.texts[j + 2];
        t.textContent = shiftChar(c, j).toUpperCase();
        t.setAttribute("transform", `translate(${r.cx} ${cy + k * Math.sin(ang)}) scale(1 ${Math.max(0.2, Math.cos(ang)).toFixed(3)})`);
        t.setAttribute("opacity", op.toFixed(3));
      }
    });
  }

  function step(dir) {
    return new Promise((resolve) => {
      if (reduced()) { resolve(); return; }
      const t0 = performance.now();
      let done = false;
      const end = () => { if (!done) { done = true; resolve(); } };
      const frame = (now) => {
        if (done) return;
        const t = Math.min(1, (now - t0) / STEP_MS);
        render(dir * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(frame); else end();
      };
      requestAnimationFrame(frame);
      setTimeout(end, STEP_MS + 80);
    });
  }

  async function turn(d) {
    const dir = d > 0 ? 1 : -1;
    busy = true;
    try {
      for (let s = 0; s < Math.abs(d); s++) {
        emit("click");
        await step(dir);
        letters = letters.map((c) => shiftChar(c, dir));
        render(0);
      }
    } finally {
      busy = false;
    }
  }

  function setLetters(arr) {
    const next = Array.from(arr, (c) => String(c).toLowerCase());
    const rebuild = next.length !== letters.length || !lay;
    letters = next;
    if (rebuild) build(); else render(0);
  }

  function lockGlow() {
    if (!glow) return;
    svgEl.classList.add("cs-glowing");
    if (glow.animate) {
      glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 600, easing: "ease-out" });
    }
    setTimeout(() => svgEl.classList.remove("cs-glowing"), 600);
  }

  function shake() {
    if (reduced() || !svgEl.animate) return;
    svgEl.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-9px)" }, { transform: "translateX(8px)" },
        { transform: "translateX(-5px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
      { duration: 300, easing: "ease-out" });
  }

  let rt = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (letters.length && !busy) build(); }, 80);
  });

  return { setLetters, turn, lockGlow, shake };
}
