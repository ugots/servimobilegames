// N35 Hop: bronto catch game. DOM + CSS only; positions driven by one rAF loop.
const KEY = "numgame_hop_v1";
const SVG = "assets/svg/";
const FLOWERS = ["sunflower", "daisy", "tulip", "rose", "bluebell"].map((n) => `hop-flower-${n}.svg`);
const BUTTERFLIES = ["monarch", "morpho", "swallowtail", "fairy", "emerald"].map((n) => `hop-butterfly-${n}.svg`);
const NOTES = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];
const HOP_MS = 1000, SQUASH_MS = 150;
// N36 adaptive difficulty: level L (integer >= 1) sets speed, spawn gap and catch buffer; 90% hit rate raises it, under 75% lowers it.
const crossMs = (L) => Math.max(1500, 4000 * 0.88 ** L);
const spawnMin = (L) => Math.max(420, 900 * 0.92 ** L);
const spawnSpan = (L) => 200 * spawnMin(L) / 900;
const buffer = (L) => Math.max(0.14, 0.34 * 0.9 ** (L - 1));
const WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

let ctx = null, el = {}, running = false, raf = 0, timers = new Set(), actx = null;
let roundMs = 60000, roundStart = 0, phase = "stopped"; // play | ending | card | stopped
let hopStart = -1, items = [], nextSpawn = 0, count = 0, caught = 0, lastTier = null, lastScore = 0;
let passed = 0, flying = 0, bound = false, autoSpawn = true, level = 1;

const phoneMQ = () => matchMedia("(max-width: 649px) and (orientation: portrait)").matches;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const nameKey = () => (ctx.getName() || "Player");

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} }

// Hop's own speech path (Joe 2026-10-06): not gated by app.js VOICE_ENABLED, but muted by the sound toggle.
function say(text) {
  if (ctx.isMuted() || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
}
function word(n) {
  if (n < 20) return WORDS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + WORDS[n % 10] : "");
  return String(n);
}
function chime(n) {
  if (ctx.isMuted()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = actx || new AC();
    if (actx.state === "suspended") actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = "sine";
    o.frequency.value = NOTES[Math.min(7, Math.floor((n - 1) / 5))];
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + 0.26);
  } catch {}
}

function geom() {
  const H = innerHeight, W = innerWidth, phone = phoneMQ();
  const brontoH = el.img.offsetHeight || (phone ? H * 0.18 : Math.min(H * 0.26, W * 0.22));
  return { H, W, brontoH, peak: H * (phone ? 0.22 : 0.30), item: H * (phone ? 0.12 : 0.15), ground: H * 0.88 };
}

function hopPose(now) {
  if (hopStart < 0) return { lift: 0, sy: 1, sx: 1 };
  const e = now - hopStart;
  if (e < HOP_MS) {
    const u = e / HOP_MS;
    const k = u < 0.5 ? 1 - Math.pow(1 - u * 2, 2) : 1 - Math.pow((u - 0.5) * 2, 2);
    return { lift: geom().peak * k, sy: 1, sx: 1 };
  }
  if (e < HOP_MS + SQUASH_MS) return { lift: 0, sy: 0.88, sx: 1.12 };
  hopStart = -1;
  return { lift: 0, sy: 1, sx: 1 };
}
const airborne = (now) => hopStart >= 0 && now - hopStart < HOP_MS;

function tryHop() {
  if (phase !== "play" && phase !== "ending") return;
  const now = performance.now();
  if (hopStart >= 0 && now - hopStart < HOP_MS + SQUASH_MS) return;
  hopStart = now;
}

function spawn(kind) {
  const g = geom();
  const d = document.createElement("div");
  d.className = "hop-item " + kind;
  const img = document.createElement("img");
  img.alt = "";
  const pool = kind === "butterfly" ? BUTTERFLIES : FLOWERS;
  img.src = SVG + pool[Math.floor(Math.random() * pool.length)];
  img.style.animationDelay = `${-Math.random() * 2.4}s`; // desync the idle glow
  d.appendChild(img);
  el.pickups.appendChild(d);
  const y = kind === "butterfly" ? g.ground - g.brontoH / 2 - g.peak - g.item / 2 : g.ground - g.item + g.H * 0.012;
  const t = performance.now();
  items.push({ el: d, kind, x: g.W, y, last: t, t0: t, dy: 0, phase: Math.random() * 6.28, trail: t });
  d.style.transform = `translate(${g.W}px, ${y}px)`;
}

function overlap(a, b) {
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, w = (b.right - b.left) * buffer(level), h = (b.bottom - b.top) * buffer(level);
  return a.left < cx + w && a.right > cx - w && a.top < cy + h && a.bottom > cy - h;
}

function flyToBasket(it) {
  const r = it.el.getBoundingClientRect(), b = el.basket.getBoundingClientRect();
  const c = it.el.cloneNode(true);
  c.classList.add("hop-fly");
  c.style.position = "fixed"; c.style.zIndex = "7"; c.style.transform = `translate(${r.left}px, ${r.top}px)`;
  el.screen.appendChild(c);
  flying++;
  const dx = b.left + b.width / 2 - r.width / 2, dy = b.top + b.height / 2 - r.height / 2;
  c.animate([{ transform: `translate(${r.left}px, ${r.top}px) scale(1)` }, { transform: `translate(${dx}px, ${dy}px) scale(.5)` }], { duration: 500, easing: "ease-in", fill: "forwards" });
  later(() => {
    c.remove(); flying--;
    if (running) el.basket.animate([{ transform: "scale(1)" }, { transform: "scale(1.16)" }, { transform: "scale(1)" }], { duration: 240 });
  }, 500);
}

// small per-catch pop: a handful of stars/sparkles at the item (never the screen-filling celebration)
function pop(it) {
  const r = it.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const size = innerHeight * 0.035, n = 8;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("img");
    p.className = "hop-pop"; p.alt = "";
    p.src = SVG + (i % 2 ? "sparkle.svg" : "star.svg");
    p.style.cssText = `position:fixed;left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;pointer-events:none;z-index:7`;
    el.screen.appendChild(p);
    const a = (i / n) * 6.283 + Math.random() * 0.5, d = innerHeight * (0.08 + Math.random() * 0.05);
    const an = p.animate([{ transform: "translate(0,0) scale(.3) rotate(0deg)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(1) rotate(${i % 2 ? 90 : -90}deg)`, opacity: 0 }],
      { duration: reduced() ? 250 : 550, easing: "ease-out", fill: "forwards" });
    an.onfinish = () => p.remove();
  }
}

function trail(it, now) {
  if (reduced() || now - it.trail < 110 || el.pickups.querySelectorAll(".hop-trail").length > 36) return;
  it.trail = now;
  const g = geom(), s = g.item * 0.2, d = document.createElement("img");
  d.className = "hop-trail"; d.alt = ""; d.src = SVG + "sparkle.svg";
  d.style.cssText = `position:absolute;left:0;top:0;width:${s}px;height:${s}px;transform:translate(${it.x + g.item / 2 - s / 2 + (Math.random() - 0.5) * s}px, ${it.y + it.dy + g.item / 2 - s / 2 + (Math.random() - 0.5) * s}px)`;
  d.addEventListener("animationend", () => d.remove());
  el.pickups.appendChild(d);
}

function showCount() { el.count.textContent = `${caught} / ${passed}`; }

function catchItem(it) {
  caught++;
  count++;
  passed++;
  showCount();
  say(word(count));
  chime(caught);
  pop(it);
  flyToBasket(it);
  it.el.remove();
  it.gone = true;
}

function frame(now) {
  raf = 0;
  if (!running) return;
  const g = geom();
  const h = hopPose(now);
  el.bronto.style.transform = `translateX(-50%) translateY(${-h.lift}px) scale(${h.sx}, ${h.sy})`;
  if (phase === "play") {
    const elapsed = Math.max(0, now - roundStart);
    el.sun.style.left = (4 + 92 * Math.min(1, elapsed / roundMs)) + "%";
    const left = Math.max(0, Math.ceil((roundMs - elapsed) / 1000));
    if (el.timer.textContent !== String(left)) el.timer.textContent = String(left);
    if (elapsed >= roundMs) endRound();
    else if (autoSpawn && now >= nextSpawn) {
      spawn(Math.random() < 0.6 ? "flower" : "butterfly");
      nextSpawn = now + spawnMin(level) + Math.random() * spawnSpan(level);
    }
    const speed = (g.W + g.item) / crossMs(level);
    const br = el.bronto.getBoundingClientRect();
    for (const it of items) {
      const dt = now - it.last; it.last = now;
      it.x -= speed * dt;
      it.dy = it.kind === "butterfly" ? Math.sin((now - it.t0) / 380 + it.phase) * g.item * 0.25 : 0; // sine bob
      it.el.style.transform = `translate(${it.x}px, ${it.y + it.dy}px)`;
      if (it.kind === "butterfly") trail(it, now);
      if (phase === "play" && overlap(br, it.el.getBoundingClientRect())) catchItem(it);
      else if (it.x < -g.item * 1.5) { it.el.remove(); it.gone = true; passed++; showCount(); }
    }
    items = items.filter((i) => !i.gone);
  }
  raf = requestAnimationFrame(frame);
}

function endRound() {
  phase = "ending";
  for (const it of items) it.el.remove();
  items = [];
  later(showCard, flying ? 560 : 0);
}

function showCard() {
  const key = nameKey(), all = load(), t = today();
  let rec = all[key];
  const old = rec || {};
  if (!rec || rec.day !== t) rec = { day: t, today: 0, ever: rec ? rec.ever || 0 : 0 };
  const score = count;
  let tier = "a";
  if (score > 0 && score > rec.ever) tier = "c";
  else if (score > 0 && score > rec.today) tier = "b";
  // N36: adapt level from this round's hit rate (passed = caught + missed)
  const oldLevel = level;
  const rate = passed > 0 ? caught / passed : null;
  if (rate !== null) level = rate > 0.90 ? level + 1 : rate < 0.75 ? Math.max(1, level - 1) : level;
  const newRec = { day: t, today: Math.max(rec.today, score), ever: Math.max(rec.ever, score), level,
    lastRate: rate !== null ? Math.round(rate * 10000) / 10000 : (old.lastRate ?? null),
    bestLevel: Math.max(old.bestLevel || 1, level) };
  all[key] = newRec; save(all);
  lastTier = tier; lastScore = score;
  el.levelLine.replaceChildren();
  const l1 = document.createElement("div"), l2 = document.createElement("div");
  l1.className = "hop-level-main"; l1.textContent = `Level ${level}`;
  if (level !== oldLevel) {
    const a = document.createElement("span");
    a.className = level > oldLevel ? "hop-arrow up" : "hop-arrow down";
    a.textContent = level > oldLevel ? " ▲" : " ▼";
    l1.appendChild(a);
  }
  l2.className = "hop-level-caught";
  l2.textContent = rate === null ? "Caught 0 of 0" : `Caught ${caught} of ${passed} (${Math.round(100 * rate)}%)`;
  el.levelLine.append(l1, l2);
  updateBadge();
  document.getElementById("hop-today").textContent = String(score);
  document.getElementById("hop-passed").textContent = `${score} of ${passed} caught`;
  document.getElementById("hop-best-today").textContent = String(newRec.today);
  document.getElementById("hop-best-ever").textContent = String(newRec.ever);
  el.card.hidden = false;
  phase = "card";
  if (tier === "c") {
    el.screen.classList.add("hop-mega");
    if (!reduced()) el.screen.querySelectorAll(".hop-origin").forEach((o) => { try { ctx.celebrate(o, { big: true }); } catch {} });
    else { try { ctx.celebrate(el.cheer); } catch {} }
    say("new all-time high score");
  } else if (tier === "b") {
    try { ctx.celebrate(el.cheer, { big: true }); } catch {}
    later(() => { if (phase === "card") { try { ctx.celebrate(el.cheer, { big: true }); } catch {} } }, 1200);
    say("new high score");
  } else {
    try { ctx.celebrate(el.cheer); } catch {}
    ctx.playSound("levelup");
  }
}

function resetRound() {
  for (const it of items) it.el.remove();
  items = [];
  el.screen.querySelectorAll(".hop-fly, .hop-pop, .hop-trail").forEach((n) => n.remove());
  timers.forEach(clearTimeout); timers.clear();
  try { ctx.clearCelebration(); } catch {}
  el.screen.classList.remove("hop-mega");
  el.card.hidden = true;
  count = 0; caught = 0; passed = 0; flying = 0; hopStart = -1; autoSpawn = true;
  el.count.textContent = "0 / 0";
  el.timer.textContent = String(Math.ceil(roundMs / 1000));
  el.sun.style.left = "4%";
  el.bronto.style.transform = "translateX(-50%)";
}

function updateBadge() { if (el.level) el.level.textContent = `Level ${level}`; }

function begin() {
  const rec = load()[nameKey()];
  level = Math.max(1, (rec && rec.level | 0) || 1);
  updateBadge();
  resetRound();
  phase = "play";
  roundStart = performance.now();
  nextSpawn = roundStart + 1000;
  if (!raf) raf = requestAnimationFrame(frame);
}

function onKey(e) {
  if (!running || e.repeat || e.key === "Escape") return;
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "Fn"].includes(e.key)) return;
  if (phase === "card") {
    if (e.key === " " || e.code === "Space") { e.preventDefault(); begin(); }
    return;
  }
  if (e.key === " ") e.preventDefault();
  tryHop();
}
function onPointer(e) {
  if (!running || phase === "card") return;
  if (e.target.closest(".home-btn, .hop-again")) return;
  tryHop();
}

export function init(c) {
  ctx = c;
  const s = c.screenEl;
  el = { screen: s, img: s.querySelector("#hop-bronto img"), bronto: s.querySelector("#hop-bronto"), pickups: s.querySelector("#hop-pickups"),
    sun: s.querySelector("#hop-sun"), basket: s.querySelector("#hop-basket"), count: s.querySelector("#hop-count"), timer: s.querySelector("#hop-timer"),
    card: s.querySelector("#hop-card"), cheer: s.querySelector("#hop-cheer") };
  el.level = document.createElement("div");
  el.level.id = "hop-level"; el.level.className = "hop-level"; el.level.textContent = "Level 1";
  s.querySelector(".hop-hud").prepend(el.level);
  el.levelLine = document.createElement("div");
  el.levelLine.id = "hop-level-line"; el.levelLine.className = "hop-level-line";
  el.card.insertBefore(el.levelLine, s.querySelector(".hop-stats"));
  s.querySelector("#hop-again").addEventListener("click", () => { ctx.playSound("menu"); begin(); });
  if (new URLSearchParams(location.search).get("test") === "1") {
    window.__hop = {
      spawn: (k) => spawn(k),
      setRoundMs: (ms) => { roundMs = ms; roundStart = performance.now(); },
      auto: (b) => { autoSpawn = !!b; },
      count: () => count,
      setLevel: (n) => { level = Math.max(1, n | 0); updateBadge(); },
      difficulty: () => ({ level, crossMs: crossMs(level), spawnMin: spawnMin(level), spawnSpan: spawnSpan(level), buffer: buffer(level) }),
      setTally: (c, p) => { caught = count = c; passed = p; },
      level: () => level,
      passed: () => passed,
      tier: () => lastTier,
      state: () => ({ phase, stopped: !running && !raf && timers.size === 0, raf: !!raf, timers: timers.size, items: items.length, airborne: airborne(performance.now()), score: lastScore }),
    };
  }
}

export function start() {
  ctx.show("hop");
  if (!bound) {
    document.addEventListener("keydown", onKey);
    el.screen.addEventListener("pointerdown", onPointer);
    bound = true;
  }
  running = true;
  begin();
}

export function stop() {
  if (!ctx) return;
  running = false;
  phase = "stopped";
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  resetRound();
  roundMs = 60000;
  if (bound) {
    document.removeEventListener("keydown", onKey);
    el.screen.removeEventListener("pointerdown", onPointer);
    bound = false;
  }
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch {}
}
