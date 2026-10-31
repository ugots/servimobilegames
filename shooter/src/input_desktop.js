// Desktop keys -> the shared input object {left, right, thrust, fire, hyper}.
// Arrows rotate/thrust, Space fires, Shift is hyperspace. Esc/P pause via the menu kit.
const ShooterInputDesktop = (() => {
  function create(isActive) {
    const down = new Set();
    const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "ShiftLeft", "ShiftRight"];

    function onKey(e, pressed) {
      if (!GAME_KEYS.includes(e.code)) return;
      if (!isActive()) return;
      e.preventDefault();
      // Space fires here: stop the menu kit's Space-to-pause listener from seeing it.
      if (e.code === "Space") e.stopImmediatePropagation();
      if (pressed) down.add(e.code);
      else down.delete(e.code);
    }

    window.addEventListener("keydown", (e) => onKey(e, true), true);
    window.addEventListener("keyup", (e) => onKey(e, false), true);
    window.addEventListener("blur", () => down.clear());

    return {
      read() {
        return {
          left: down.has("ArrowLeft"),
          right: down.has("ArrowRight"),
          thrust: down.has("ArrowUp"),
          fire: down.has("Space"),
          hyper: down.has("ShiftLeft") || down.has("ShiftRight"),
        };
      },
      clear() {
        down.clear();
      },
    };
  }
  return { create };
})();

if (typeof window !== "undefined") window.ShooterInputDesktop = ShooterInputDesktop;
