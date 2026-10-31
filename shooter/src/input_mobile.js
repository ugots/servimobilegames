// Phone controls: four pads in a strip under the field (turn left, turn right, THRUST, FIRE); hyperspace is desktop-only.
// The pads only set left/right/thrust/fire at the fixed rates; they never set heading or position.
const ShooterInputMobile = (() => {
  // Pure mapping: held pads -> the five input keys (hyper is never set on a phone).
  function fromPads(p) {
    return { left: !!p.left, right: !!p.right, thrust: !!p.thrust, fire: !!p.fire, hyper: false };
  }
  const SVG = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" ';
  const STROKE = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">';
  const ICON_L = SVG + STROKE + '<path d="M13 5l-7 7 7 7 M20 5l-7 7 7 7"/></svg>';
  const ICON_R = SVG + STROKE + '<path d="M4 5l7 7-7 7 M11 5l7 7-7 7"/></svg>';
  const ICON_THRUST = SVG + 'fill="currentColor"><path d="M12 2c3 4 6 7 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3 0-5 1-8z"/></svg>';
  const ICON_FIRE = SVG + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5 M12 18v5 M1 12h5 M18 12h5"/></svg>';
  const pad = (cls, label, aria, icon) =>
    '<button type="button" class="sm-pad ' + cls + '" aria-label="' + aria + '">' + icon + '<span class="sm-label">' + label + "</span></button>";

  function create(isActive) {
    const cfg = SHOOTER_CONFIG;
    const touchy = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    const root = document.createElement("div");
    root.className = "sm-controls";
    root.hidden = true;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Ship controls");
    root.style.setProperty("--sm-band", cfg.portraitControlsH + "px");
    root.innerHTML =
      '<div class="sm-zone sm-zone-turn">' +
      pad("sm-left", "LEFT", "Turn left", ICON_L) +
      pad("sm-right", "RIGHT", "Turn right", ICON_R) +
      "</div>" +
      '<div class="sm-zone sm-zone-thrust">' + pad("sm-thrust", "THRUST", "Thrust", ICON_THRUST) + "</div>" +
      '<div class="sm-zone sm-zone-fire">' + pad("sm-fire", "FIRE", "Fire", ICON_FIRE) + "</div>";
    document.body.appendChild(root);
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    root.addEventListener("selectstart", (e) => e.preventDefault());
    const state = { left: false, right: false, thrust: false, fire: false };
    // Turn pads: a tap queues a fixed number of sim steps (pulse); a hold past tapMaxMs turns steadily.
    const held = { left: false, right: false };
    const downAt = { left: 0, right: 0 };
    const pulse = { left: 0, right: 0 };
    const tapSteps = Math.round(cfg.tapTurnStep / (cfg.turnRate * cfg.mobileTurnFactor * cfg.fixedDt));

    function hold(btn, key) {
      const turn = key === "left" || key === "right";
      const on = (e) => {
        if (turn) {
          held[key] = true;
          downAt[key] = performance.now();
          pulse[key] = tapSteps;
        } else state[key] = true;
        btn.classList.add("sm-down");
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      };
      const off = () => {
        if (turn) held[key] = false;
        else state[key] = false;
        btn.classList.remove("sm-down");
      };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointercancel", off);
      btn.addEventListener("lostpointercapture", off);
    }
    hold(root.querySelector(".sm-left"), "left");
    hold(root.querySelector(".sm-right"), "right");
    hold(root.querySelector(".sm-thrust"), "thrust");
    hold(root.querySelector(".sm-fire"), "fire");

    return {
      touch: touchy,
      show(on) {
        root.hidden = !(on && touchy);
        if (!on) {
          for (const k in state) state[k] = false;
          for (const k in held) { held[k] = false; pulse[k] = 0; }
          root.querySelectorAll(".sm-down").forEach((b) => b.classList.remove("sm-down"));
        }
      },
      read() {
        if (!isActive()) return null;
        const now = performance.now();
        for (const k of ["left", "right"]) {
          state[k] = pulse[k] > 0 || (held[k] && now - downAt[k] >= cfg.tapMaxMs);
          if (pulse[k] > 0) pulse[k] -= 1;
        }
        return fromPads(state);
      },
    };
  }
  return { create, fromPads };
})();

if (typeof window !== "undefined") window.ShooterInputMobile = ShooterInputMobile;
