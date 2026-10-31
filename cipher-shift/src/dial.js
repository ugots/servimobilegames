// Cipher Shift cryptex: a brass cylinder lying on its side, SVG only.
// createDial(svgEl, { onTurn(d), canTurn() }) ->
//   { setLetters(arr), turn(d) -> Promise, lockGlow(), shake(), visibleRows(), turnZones() }
// One visible letter per ring; four brass plates (Up 1/2, Down 1/2) and a vertical drag turn it.
const NS = "http://www.w3.org/2000/svg";
const ASSET = "assets/";
const STEP_MS = 220;
const CANCEL_MS = 120;
const COMMIT_SLOTS = 0.5; // drag shorter than this many slots cancels
const MAX_DRAG = 2.4;
const MIN_RING = 44;      // wanted ring width (px) at phone size
const OVERLAP = 6;        // ring faces tuck 3 px under each groove side (bbox = pitch + 6)
const CAP_MIN = 20;

function mk(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export const UP_ALPHA = -1; // alphabet steps per Up step (Up = earlier letter)

function shiftChar(c, d) {
  return String.fromCharCode(97 + ((((c.charCodeAt(0) - 97 + d) % 26) + 26) % 26));
}

function reduced() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function emit(kind) {
  document.dispatchEvent(new CustomEvent("cs:sound", { detail: { kind } }));
}

export function createDial(svgEl, opts = {}) {
  let letters = [];
  let rings = [];
  let lay = null;
  let glow = null;
  let busy = false;
  let residual = 0;   // slots a committed drag left on the rings; turn() eases on from here
  let plates = {};
  let ringLayer = null;
  const canTurn = () => (opts.canTurn ? !!opts.canTurn() : true);

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
    const PW = W < 700 ? 48 : 88; // flank plate width
    const PG = W < 700 ? 6 : 8; // plate-to-cap gap
    const inner = W - 2 * (PW + PG);
    const capIdeal = Math.max(CAP_MIN, Math.min(96, inner * 0.085));
    let capW = capIdeal;
    let pitch = (inner - 2 * capW) / n;
    if (pitch < MIN_RING - OVERLAP) {
      capW = Math.max(CAP_MIN, (inner - n * (MIN_RING - OVERLAP)) / 2);
      pitch = (inner - 2 * capW) / n;
    }
    pitch = Math.min(pitch, pitchMax);
    const ringsW = pitch * n;
    const x0 = (W - ringsW) / 2;
    // Plates flank the barrel left (Up) and right (Down); the barrel is centred vertically.
    const cy = H / 2;
    const ringH = Math.min(H * 0.78, Math.max(pitch * 2.4, W < 700 ? 150 : 220));
    const barrelH = Math.min(H * 0.96, ringH * 1.2);
    const top = cy - barrelH / 2;
    const ringTop = cy - ringH / 2;
    const slot = ringH / 3;
    const font = Math.max(18, Math.min(pitch * 0.5, slot * 0.78, 78));
    lay = { W, H, n, capW, pitch, x0, ringH, ringTop, slot, font, cy, PW };

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
    mk("rect", { x: bx, y: cy - 0.75, width: bw, height: 1.5, fill: "#2a1d0e", opacity: 0.35 }, svgEl);

    ringLayer = mk("g", { class: "cs-rings" }, svgEl);
    for (let i = 0; i < n; i++) {
      const rx = x0 + i * pitch - OVERLAP / 2;
      const rw = pitch + OVERLAP;
      const g = mk("g", { class: "cs-ring", "data-i": i }, ringLayer);
      const clip = mk("clipPath", { id: "cdClip" + i }, g);
      mk("rect", { x: rx, y: cy - slot / 2, width: rw, height: slot }, clip);
      mk("rect", { class: "cs-ring-face", x: rx, y: ringTop, width: rw, height: ringH, rx: 2, fill: "url(#cdIvory)" }, g);
      mk("image", { href: ASSET + "ring-face.svg", x: rx, y: ringTop, width: rw, height: ringH, preserveAspectRatio: "none" }, g);
      const lg = mk("g", { "clip-path": `url(#cdClip${i})` }, g);
      const texts = [];
      for (let j = -1; j <= 1; j++) {
        const t = mk("text", {
          class: j === 0 ? "cs-letter cs-center" : "cs-letter",
          "text-anchor": "middle", "dominant-baseline": "central",
          "font-family": "Georgia, 'Times New Roman', serif", "font-weight": "700",
          "font-size": font, fill: "#1e140a",
        }, lg);
        texts.push(t);
      }
      // window brackets around the centre slot
      mk("rect", { x: rx + 2, y: cy - slot / 2, width: rw - 4, height: 1, fill: "#3a2810", opacity: 0.22, "pointer-events": "none" }, g);
      mk("rect", { x: rx + 2, y: cy + slot / 2, width: rw - 4, height: 1, fill: "#3a2810", opacity: 0.22, "pointer-events": "none" }, g);
      rings.push({ cx: rx + rw / 2, texts });
    }
    // dark grooves between rings and at both ends, each with a thin lit lip
    for (let i = 0; i <= n; i++) {
      const gx = x0 + i * pitch;
      mk("rect", { x: gx - 1.5, y: ringTop - 1, width: 3, height: ringH + 2, fill: "#2a1d0e", "pointer-events": "none" }, svgEl);
      mk("rect", { x: gx + 1.5, y: ringTop, width: 0.8, height: ringH, fill: "#f0d28a", opacity: 0.35, "pointer-events": "none" }, svgEl);
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
    buildPlates(x0 - capW - PG - PW, x0 + ringsW + capW + PG, top, PW, barrelH);
    attachDrag();
    render(0);
  }

  // Four etched brass plates on the flanks: left Up 2 / Up 1, right Down 1 / Down 2 (2-step halves outermost).
  function buildPlates(xL, xR, y0p, PW, PH) {
    const defs = svgEl.querySelector("defs");
    const lit = mk("linearGradient", { id: "cdBrassLit", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    [["0", "#8a6224"], ["0.5", "#ffe3a0"], ["1", "#a67a30"]]
      .forEach(([o, c]) => mk("stop", { offset: o, "stop-color": c }, lit));
    plates = {};
    const defsList = [[2, "Up 2", 0, 0, 1, 2], [1, "Up 1", 0, 1, 1, 1], [-1, "Down 1", 1, 0, -1, 1], [-2, "Down 2", 1, 1, -1, 2]];
    defsList.forEach(([d, label, side, half, dir, cnt]) => {
      const hw = PW;
      const hh = PH / 2;
      const x = side ? xR : xL;
      const y = y0p + half * hh;
      const g = mk("g", { class: "cs-plate", "data-d": d, role: "button", "aria-label": label, tabindex: -1, style: "cursor:pointer" }, svgEl);
      const face = mk("rect", { class: "cs-plate-face", x, y, width: hw, height: hh, rx: 8, fill: "url(#cdBrass)", stroke: "#3a2810", "stroke-width": 1.5 }, g);
      mk("rect", { x: x + 6, y: y + 3, width: hw - 12, height: 1, fill: "#f6dc9c", opacity: 0.7, "pointer-events": "none" }, g);
      mk("rect", { x: x + 6, y: y + hh - 4, width: hw - 12, height: 2, fill: "#2a1d0e", opacity: 0.45, "pointer-events": "none" }, g);
      const glowR = mk("rect", { x, y, width: hw, height: hh, rx: 8, fill: "none", stroke: "#ffcf5a", "stroke-width": 3, opacity: 0, "pointer-events": "none" }, g);
      // etched chevrons: a light copy 1 px lower under the dark stroke
      const s = Math.min(PW * 0.22, 14);
      const ccx = x + hw / 2;
      const ccy = y + hh / 2;
      const gap = s * 1.1;
      for (let c = 0; c < cnt; c++) {
        const cyy = ccy + (cnt > 1 ? (c - 0.5) * gap : 0);
        const pth = (yy) => `M ${ccx - s * 1.3} ${yy + dir * s * 0.5} L ${ccx} ${yy - dir * s * 0.5} L ${ccx + s * 1.3} ${yy + dir * s * 0.5}`;
        mk("path", { d: pth(cyy + 1), fill: "none", stroke: "#f0d28a", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none" }, g);
        mk("path", { d: pth(cyy), fill: "none", stroke: "#2a1d0e", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none" }, g);
      }
      if (half === 0) mk("rect", { x: x + 4, y: y + hh - 0.5, width: hw - 8, height: 1, fill: "#2a1d0e", opacity: 0.7, "pointer-events": "none" }, g);
      let litT = 0;
      g.addEventListener("pointerdown", () => {
        face.setAttribute("fill", "url(#cdBrassLit)");
        glowR.setAttribute("opacity", 0.5);
        g.classList.add("cs-lit");
        clearTimeout(litT);
        litT = setTimeout(() => {
          face.setAttribute("fill", "url(#cdBrass)");
          glowR.setAttribute("opacity", 0);
          g.classList.remove("cs-lit");
        }, 160);
      });
      g.addEventListener("click", () => { if (canTurn() && opts.onTurn) opts.onTurn(d); });
      plates[d] = face;
    });
  }

  // Vertical drag on the ring layer: rings follow the finger, release snaps to 1 or 2 slots.
  function attachDrag() {
    let drag = null;
    const scale = () => { const r = svgEl.getBoundingClientRect(); return r.height ? lay.H / r.height : 1; };
    ringLayer.addEventListener("pointerdown", (e) => {
      if (busy || drag || !canTurn()) return;
      drag = { id: e.pointerId, y: e.clientY, shift: 0 };
      try { ringLayer.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    });
    ringLayer.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = (e.clientY - drag.y) * scale();
      drag.shift = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, -dy / lay.slot));
      render(drag.shift);
    });
    const finish = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { shift } = drag;
      drag = null;
      const m = Math.abs(shift);
      if (m < COMMIT_SLOTS) { easeBack(shift); return; }
      const d = (shift > 0 ? 1 : -1) * Math.min(2, Math.max(1, Math.round(m)));
      residual = shift;
      if (opts.onTurn) opts.onTurn(d);
      if (!busy) { residual = 0; render(0); }
    };
    ringLayer.addEventListener("pointerup", finish);
    ringLayer.addEventListener("pointercancel", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const s = drag.shift; drag = null; easeBack(s);
    });
  }

  function easeBack(from) {
    if (reduced()) { render(0); return; }
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / CANCEL_MS);
      render(from * (1 - t));
      if (t < 1) requestAnimationFrame(frame); else render(0);
    };
    requestAnimationFrame(frame);
    setTimeout(() => render(0), CANCEL_MS + 80);
  }

  // shift: how many slots the letters have travelled (+1 = moved up by one letter).
  // Three texts roll through the slot; whole slots are folded into the letter shown.
  function render(shift) {
    if (!lay) return;
    const { slot, cy } = lay;
    const whole = Math.trunc(shift); // fold only whole slots, so the centre text really travels
    const frac = shift - whole;
    rings.forEach((r, i) => {
      const c = letters[i] || "a";
      for (let j = -1; j <= 1; j++) {
        const pos = j - frac;
        const op = Math.max(0, 1 - Math.abs(pos));
        const t = r.texts[j + 1];
        t.textContent = shiftChar(c, UP_ALPHA * (j + whole)).toUpperCase();
        t.setAttribute("transform", `translate(${r.cx} ${cy + pos * slot}) scale(1 ${Math.max(0.2, Math.cos(pos * 0.75)).toFixed(3)})`);
        t.setAttribute("opacity", op > 0 ? op.toFixed(3) : "0");
      }
    });
  }

  function visibleRows() {
    let best = 0;
    rings.forEach((r) => {
      const n = r.texts.filter((t) => parseFloat(t.getAttribute("opacity")) > 0).length;
      if (n > best) best = n;
    });
    return best;
  }

  function box(el) {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  function turnZones() {
    const r = svgEl.getBoundingClientRect();
    const k = lay && lay.H ? r.height / lay.H : 1;
    return {
      up1: box(plates[1]), up2: box(plates[2]), down1: box(plates[-1]), down2: box(plates[-2]),
      rings: box(ringLayer), slot: lay.slot * k,
    };
  }

  function step(dir, from = 0) {
    return new Promise((resolve) => {
      if (reduced()) { resolve(); return; }
      const t0 = performance.now();
      let done = false;
      const end = () => { if (!done) { done = true; resolve(); } };
      const frame = (now) => {
        if (done) return;
        const t = Math.min(1, (now - t0) / STEP_MS);
        render(from + (dir - from) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(frame); else end();
      };
      requestAnimationFrame(frame);
      setTimeout(end, STEP_MS + 80);
    });
  }

  async function turn(d) {
    const dir = d > 0 ? 1 : -1;
    busy = true;
    let r = residual * dir > 0 ? residual : 0;
    residual = 0;
    try {
      for (let s = 0; s < Math.abs(d); s++) {
        emit("click");
        await step(dir, r);
        r = 0;
        letters = letters.map((c) => shiftChar(c, UP_ALPHA * dir));
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

  return { setLetters, turn, lockGlow, shake, visibleRows, turnZones };
}
