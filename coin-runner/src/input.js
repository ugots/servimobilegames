// Unified input: keyboard + mouse for desktop, drag joystick for mobile.
// Produces a normalized vector {x, y} in [-1, 1] each, magnitude <= 1.

export class InputManager {
  constructor({ joystickEl, joystickKnobEl, canvas }) {
    this.joystickEl = joystickEl;
    this.joystickKnobEl = joystickKnobEl;
    this.canvas = canvas;

    this.keys = new Set();
    this.mouse = { active: false, x: 0, y: 0 };
    this.joystick = { active: false, x: 0, y: 0, pointerId: null };
    this.mode = "desktop"; // "desktop" | "mobile", set externally

    this._bindKeyboard();
    this._bindMouse();
    this._bindJoystick();
  }

  _bindKeyboard() {
    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
  }

  _bindMouse() {
    this.canvas.addEventListener("mousemove", (e) => {
      if (this.mode !== "desktop") return;
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.active = true;
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.mouse.active = false;
    });
  }

  _bindJoystick() {
    const base = this.joystickEl;
    const knob = this.joystickKnobEl;
    const maxRadius = 52;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const resetKnob = () => setKnob(0, 0);

    const handleMove = (clientX, clientY) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      setKnob(dx, dy);
      const deadZone = 14;
      const mag = Math.hypot(dx, dy);
      if (mag < deadZone) {
        this.joystick.x = 0;
        this.joystick.y = 0;
      } else {
        this.joystick.x = dx / maxRadius;
        this.joystick.y = dy / maxRadius;
      }
    };

    base.addEventListener("pointerdown", (e) => {
      this.joystick.active = true;
      this.joystick.pointerId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      handleMove(e.clientX, e.clientY);
    });
    base.addEventListener("pointermove", (e) => {
      if (!this.joystick.active || e.pointerId !== this.joystick.pointerId) return;
      handleMove(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (e.pointerId !== this.joystick.pointerId) return;
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.x = 0;
      this.joystick.y = 0;
      resetKnob();
    };
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
  }

  /** Returns { x, y } each in [-1, 1], combined magnitude <= 1. */
  getVector(playerX, playerY) {
    if (this.mode === "mobile") {
      return { x: this.joystick.x, y: this.joystick.y };
    }

    // Desktop: keys take priority when pressed, otherwise steer toward the mouse.
    let x = 0;
    let y = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) x -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) x += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) y -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) y += 1;

    if (x !== 0 || y !== 0) {
      const mag = Math.hypot(x, y) || 1;
      return { x: x / mag, y: y / mag };
    }

    if (this.mouse.active && playerX !== undefined) {
      const dx = this.mouse.x - playerX;
      const dy = this.mouse.y - playerY;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) return { x: 0, y: 0 };
      const speedScale = Math.min(1, dist / 60);
      return { x: (dx / dist) * speedScale, y: (dy / dist) * speedScale };
    }

    return { x: 0, y: 0 };
  }

  isPausePressed() {
    return this.keys.has("Escape") || this.keys.has("KeyP");
  }
}

/** Detects whether the device looks like a touch/mobile device. */
export function detectMobile() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 620;
  const touch = navigator.maxTouchPoints > 0;
  return (coarse && touch) || (touch && narrow);
}
