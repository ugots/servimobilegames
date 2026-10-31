if (!document.querySelector('link[href="celebrate.css"]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "celebrate.css";
  document.head.appendChild(link);
}

const PIECE_SRCS = ["assets/svg/star.svg", "assets/svg/heart.svg", "assets/svg/sparkle.svg"];
const CONFETTI_COLORS = ["#FF6B6B", "#FFA94D", "#FFD93D", "#6BCB77", "#4D96FF", "#b58cff"];

let glowTimeout = null;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function getLayer() {
  return document.getElementById("fx-layer");
}

function getGeometry() {
  const layer = getLayer();
  const fr = layer.getBoundingClientRect();
  const s = layer.clientWidth / fr.width;
  const W = layer.clientWidth;
  const H = layer.clientHeight;
  return { layer, fr, s, W, H };
}

function makeNode(tag, className) {
  const el = document.createElement(tag);
  el.classList.add("cb-node", className);
  el.style.position = "absolute";
  return el;
}

function placeAt(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function animateAndRemove(el, keyframes, options) {
  const anim = el.animate(keyframes, options);
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();
}

function isMobile() {
  return !window.matchMedia("(min-width: 900px) and (orientation: landscape)").matches;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rainbowGlow() {
  document.body.classList.add("cb-rainbow-glow");
  if (glowTimeout) clearTimeout(glowTimeout);
  glowTimeout = setTimeout(() => {
    document.body.classList.remove("cb-rainbow-glow");
    glowTimeout = null;
  }, 900);
}

function arcSparkles(geo, mobile) {
  const bg = document.querySelector("#bg-layer .bg-rainbow");
  if (!bg) return;
  const { layer, fr, s, W, H } = geo;
  const rr = bg.getBoundingClientRect();
  const left = (rr.left - fr.left) * s;
  const top = (rr.top - fr.top) * s;
  const width = rr.width * s;
  const height = rr.height * s;
  const size = (mobile ? 0.07 * W : 0.035 * Math.min(W, H));
  const angles = [20, 40, 60, 80, 100, 120, 140, 160];
  angles.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const x = left + width * (0.5 - (368 / 1024) * Math.cos(a));
    const y = top + height * (1 - (368 / 512) * Math.sin(a));
    if (x < 0 || x > W || y < 0 || y > H) return;
    const el = makeNode("img", "cb-arc");
    el.src = "assets/svg/sparkle.svg";
    el.style.width = `${size}px`;
    placeAt(el, x, y);
    layer.appendChild(el);
    animateAndRemove(
      el,
      [
        { transform: "translate(-50%,-50%) scale(0) rotate(0deg)" },
        { transform: "translate(-50%,-50%) scale(1.5) rotate(90deg)", offset: 0.5 },
        { transform: "translate(-50%,-50%) scale(0) rotate(180deg)" },
      ],
      { duration: 700, delay: i * 50, easing: "ease-out" }
    );
  });
}

function flash(geo, ox, oy) {
  const { layer, W, H } = geo;
  const el = makeNode("div", "cb-flash");
  el.style.width = "40px";
  el.style.height = "40px";
  el.style.borderRadius = "50%";
  el.style.background = "radial-gradient(circle, #fff 0%, rgba(255,236,140,.9) 40%, transparent 70%)";
  placeAt(el, ox, oy);
  layer.appendChild(el);
  const scale = (Math.max(W, H) / 40) * 1.2;
  animateAndRemove(
    el,
    [
      { transform: "translate(-50%,-50%) scale(0)", opacity: 0.95 },
      { transform: `translate(-50%,-50%) scale(${scale})`, opacity: 0 },
    ],
    { duration: 450, easing: "ease-out" }
  );
}

function shockwaveRings(geo, ox, oy) {
  const { layer, W, H } = geo;
  const scale = (Math.hypot(W, H) / 40) * 1.1;
  const colors = ["#FFD93D", "#ff9ccc"];
  colors.forEach((color, i) => {
    const el = makeNode("div", "cb-ring");
    el.style.width = "40px";
    el.style.height = "40px";
    el.style.borderRadius = "50%";
    el.style.border = `6px solid ${color}`;
    el.style.background = "transparent";
    placeAt(el, ox, oy);
    layer.appendChild(el);
    animateAndRemove(
      el,
      [
        { transform: "translate(-50%,-50%) scale(0)", opacity: 1 },
        { transform: `translate(-50%,-50%) scale(${scale})`, opacity: 0 },
      ],
      { duration: 700, delay: i * 120, easing: "ease-out" }
    );
  });
}

function burstPieces(geo, ox, oy, mobile, countOverride) {
  const { layer, W, H } = geo;
  const count = countOverride || (mobile ? 36 : 44);
  for (let i = 0; i < count; i++) {
    const el = makeNode("img", "cb-piece");
    el.src = PIECE_SRCS[i % PIECE_SRCS.length];
    const size = mobile ? rand(0.14, 0.22) * W : rand(0.08, 0.13) * Math.min(W, H);
    el.style.width = `${size}px`;
    el.style.height = "auto";
    placeAt(el, ox, oy);
    layer.appendChild(el);
    const angle = i * ((2 * Math.PI) / count) + rand(-0.15, 0.15);
    const dist = rand(0.35, 0.70) * Math.hypot(W, H);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const rot = rand(-540, 540);
    animateAndRemove(
      el,
      [
        { transform: "translate(-50%,-50%) translate(0,0) scale(.3) rotate(0deg)", opacity: 1 },
        { transform: "translate(-50%,-50%) translate(0,0) scale(1.3) rotate(0deg)", opacity: 1, offset: 0.15 },
        { transform: `translate(-50%,-50%) translate(${dx * 0.7}px, ${dy * 0.7}px) scale(.9) rotate(${rot * 0.7}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(.9) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1700, easing: "cubic-bezier(.25,.55,.45,1)" }
    );
  }
}

function confetti(geo, ox, oy, mobile) {
  const { layer, W, H } = geo;
  const count = mobile ? 24 : 28;
  for (let i = 0; i < count; i++) {
    const el = makeNode("div", "cb-confetti");
    el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const w = mobile ? 0.045 * W : 0.03 * Math.min(W, H);
    const h = w / 2;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.borderRadius = "2px";
    placeAt(el, ox, oy);
    layer.appendChild(el);
    const angle = rand(0, Math.PI * 2);
    const dist = rand(0.3, 0.6) * Math.hypot(W, H);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const rot = rand(360, 900);
    const endDx = dx + rand(-40, 40);
    const endDy = dy + 0.35 * H;
    animateAndRemove(
      el,
      [
        { transform: "translate(-50%,-50%) translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) rotate(${rot * 0.55}deg)`, opacity: 1, offset: 0.75 },
        { transform: `translate(-50%,-50%) translate(${endDx}px, ${endDy}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1400, easing: "ease-out" }
    );
  }
}

export function clearCelebration() {
  getLayer().querySelectorAll(".cb-node").forEach((n) => n.remove());
  document.body.classList.remove("cb-rainbow-glow");
  if (glowTimeout) {
    clearTimeout(glowTimeout);
    glowTimeout = null;
  }
}

function fireWave(originEl, mobile, big) {
  const geo = getGeometry();
  const { fr, s } = geo;
  const r = originEl.getBoundingClientRect();
  const ox = (r.left + r.width / 2 - fr.left) * s;
  const oy = (r.top + r.height / 2 - fr.top) * s;
  flash(geo, ox, oy);
  shockwaveRings(geo, ox, oy);
  burstPieces(geo, ox, oy, mobile, big ? 60 : undefined);
  confetti(geo, ox, oy, mobile);
  rainbowGlow();
  arcSparkles(geo, mobile);
}

export function celebrate(originEl, opts = {}) {
  getLayer().querySelectorAll(".cb-node").forEach((n) => n.remove());
  const mobile = isMobile();
  if (reducedMotion()) {
    rainbowGlow();
    return;
  }
  fireWave(originEl, mobile, opts.big);
  if (opts.big) {
    setTimeout(() => fireWave(originEl, mobile, true), 350);
  } else if (originEl && originEl.id !== "pr-num") {
    originEl.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.25)", offset: 0.35 },
        { transform: "scale(.95)", offset: 0.7 },
        { transform: "scale(1)" },
      ],
      { duration: 450, composite: "add" }
    );
  }
}
