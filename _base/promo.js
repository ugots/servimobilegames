// Cross-promo strip ("More games by ServiMobileGames"). Plain ES module, no deps.
// Never throws and never blocks the game: any failure renders nothing.

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// Portal builds: window.GK_PORTAL (or ?portal=) names the host. NO_PROMO hosts ban store/external links.
export const NO_PROMO = ["crazygames", "poki"];
export function portalName() {
  try {
    const q = new URLSearchParams(location.search).get("portal");
    return String(q || window.GK_PORTAL || "").toLowerCase();
  } catch (e) { return ""; }
}

export function mountPromo({ current, parent } = {}) {
  const portal = portalName();
  const root = el("div", "gk-promo gk-hidden");
  if (NO_PROMO.includes(portal)) return { el: root, refresh() {} };
  let data = null;
  const inApp = /wv/.test(navigator.userAgent || "") || !!window.ServiAndroid;

  function link(href, cls, external) {
    const a = el("a", cls);
    a.href = href;
    if (external) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  function render() {
    root.textContent = "";
    if (!data || !Array.isArray(data.games)) { root.classList.add("gk-hidden"); return; }
    const segs = location.pathname.split("/").filter(Boolean);
    const self = (data.games.find((g) => segs.includes(g.slug)) || {}).slug || current;
    const games = data.games.filter((g) => g.slug !== self);
    if (!games.length) { root.classList.add("gk-hidden"); return; }
    const head = el("div", "gk-promo-head");
    head.appendChild(el("span", "gk-promo-h", "More games by " + (data.studio || "ServiMobileGames")));
    const row = el("div", "gk-promo-row");
    games.forEach((g) => {
      const card = el("div", "gk-promo-card");
      const a = link(inApp && !portal ? g.play : g.web, "gk-promo-link", !inApp);
      const img = el("img", "gk-promo-icon");
      img.src = new URL("../" + g.icon, import.meta.url).href;
      img.alt = "";
      img.loading = "lazy";
      a.appendChild(img);
      a.appendChild(el("span", "gk-promo-title", g.title));
      if (g.tagline) a.appendChild(el("span", "gk-promo-tag", g.tagline));
      card.appendChild(a);
      if (!inApp && !portal) {
        const p = link(g.play, "gk-promo-play", true);
        p.textContent = "Google Play";
        card.appendChild(p);
      }
      row.appendChild(card);
    });
    const all = link(data.hub, "gk-promo-all", !inApp);
    all.textContent = "All games";
    head.appendChild(all);
    root.appendChild(head);
    root.appendChild(row);
    root.classList.remove("gk-hidden");
  }

  async function refresh() {
    try {
      if (!data) {
        const r = await fetch(new URL("./games.json", import.meta.url));
        if (!r.ok) return;
        data = await r.json();
      }
      render();
    } catch (e) { /* render nothing */ }
  }

  if (parent) parent.appendChild(root);
  refresh();
  return { el: root, refresh };
}

if (typeof window !== "undefined") window.gkPromo = { mount: mountPromo };
