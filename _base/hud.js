// Shared HUD bar. D-040: desktop text scales with viewport via clamp()
// in menu.css (.gk-hud-value / .gk-hud-label). Plain ES module, no deps.

/**
 * mountHud({ fields: [{key, label, slot}], actions: [{key, ariaLabel, html}], onVisibility })
 *   -> { update(values), show, hide, destroy, el, buttons: {key: el} }
 * fields/actions are opt-in: calls without `slot` on any field and without
 * `actions` behave exactly as before (fields appended to the bar in order).
 */
export function mountHud({ fields, actions, onVisibility } = {}) {
  const bar = document.createElement("div");
  bar.className = "gk-hud gk-hidden";
  const valueEls = {};
  const useSlots = (fields || []).some((f) => f.slot) || !!actions;
  let slots = null;
  if (useSlots) {
    slots = { left: null, centre: null, right: null };
    ["left", "centre", "right"].forEach((name) => {
      const slot = document.createElement("div");
      slot.className = `gk-hud-slot gk-hud-${name}`;
      bar.appendChild(slot);
      slots[name] = slot;
    });
  }
  (fields || []).forEach(({ key, label, slot }) => {
    const field = document.createElement("div");
    field.className = "gk-hud-field";
    field.dataset.key = key;
    const labelEl = document.createElement("span");
    labelEl.className = "gk-hud-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "gk-hud-value";
    valueEl.textContent = "0";
    field.appendChild(labelEl);
    field.appendChild(valueEl);
    (useSlots ? slots[slot || "left"] : bar).appendChild(field);
    valueEls[key] = valueEl;
  });
  const buttons = {};
  (actions || []).forEach(({ key, ariaLabel, html }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gk-hud-btn";
    btn.dataset.key = key;
    btn.setAttribute("aria-label", ariaLabel);
    btn.innerHTML = html;
    btn.tabIndex = -1;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    slots.right.appendChild(btn);
    buttons[key] = btn;
  });
  document.body.appendChild(bar);

  let visible = false;
  function update(values) {
    Object.keys(values || {}).forEach((k) => {
      if (valueEls[k]) valueEls[k].textContent = values[k];
    });
  }
  function show() {
    if (visible) return;
    visible = true;
    bar.classList.remove("gk-hidden");
    document.body.classList.add("gk-hud-on");
    onVisibility?.(true);
  }
  function hide() {
    if (!visible) return;
    visible = false;
    bar.classList.add("gk-hidden");
    document.body.classList.remove("gk-hud-on");
    onVisibility?.(false);
  }
  function destroy() {
    document.body.classList.remove("gk-hud-on");
    bar.remove();
  }

  return { update, show, hide, destroy, el: bar, buttons };
}
