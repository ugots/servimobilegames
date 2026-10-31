// Sound: vendored Kenney CC0 samples (Games/_base/assets/sfx) with Web Audio synth fallback.

const SFX_BASE = "/_base/assets/sfx/";
const SAMPLES = {
  coin: SFX_BASE + "casino-audio/chips-collide-1.ogg",
  hitSoft: SFX_BASE + "impact-sounds/impactSoft_medium_000.ogg",
  hitPunch: SFX_BASE + "impact-sounds/impactPunch_medium_000.ogg",
  shield: SFX_BASE + "digital-audio/powerUp1.ogg",
  magnet: SFX_BASE + "digital-audio/powerUp2.ogg",
  slow: SFX_BASE + "digital-audio/powerUp3.ogg",
  levelUp: SFX_BASE + "digital-audio/phaseJump1.ogg",
  gameOver: SFX_BASE + "digital-audio/lowDown.ogg",
  click: SFX_BASE + "interface-sounds/click_001.ogg",
  confirm: SFX_BASE + "interface-sounds/confirmation_001.ogg",
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.buffers = {};
    this._loading = false;
    this.ambientNodes = null;
    this.ambientGain = null;
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._buildSynth();
    this._loadSamples();
  }

  _loadSamples() {
    if (this._loading) return;
    this._loading = true;
    for (const [key, url] of Object.entries(SAMPLES)) {
      fetch(url)
        .then((r) => {
          if (!r.ok) throw 0;
          return r.arrayBuffer();
        })
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => {
          this.buffers[key] = buf;
        })
        .catch(() => {});
    }
  }

  sample(key, { gain = 0.8, rate = 1 } = {}) {
    if (!this.enabled) return false;
    this.ensureContext();
    const buf = this.buffers[key];
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start(this.ctx.currentTime);
    return true;
  }

  resume() {
    this.ensureContext();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
    if (!on) this.ambientStop();
  }

  tone(freq, { duration = 0.12, type = "sine", gain = 0.25, sweepTo = null, delay = 0 } = {}) {
    if (!this.enabled) return;
    this.ensureContext();
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  noiseBurst({ duration = 0.18, gain = 0.3, delay = 0, filterFreq = 1200 } = {}) {
    if (!this.enabled) return;
    this.ensureContext();
    const t0 = this.ctx.currentTime + delay;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  /** step: consecutive-quick-pickup count (0-based), raises the pitch; resets
   * by the caller after a gap (see game.js COMBO_GAP). */
  coin(step = 0) {
    this.sample("coin", { gain: 0.6 });
    const base = 880 + Math.min(step, 8) * 55;
    this.tone(base, { duration: 0.09, type: "square", gain: 0.18 });
    this.tone(base * 1.5, { duration: 0.12, type: "square", gain: 0.14, delay: 0.05 });
  }

  hit(kind = "punch") {
    const key = kind === "soft" ? "hitSoft" : "hitPunch";
    if (this.sample(key, { gain: 0.9 })) return;
    this.noiseBurst({ duration: 0.22, gain: 0.4, filterFreq: 700 });
    this.tone(140, { duration: 0.22, type: "sawtooth", gain: 0.22, sweepTo: 60 });
  }

  /** Shared noise buffers, built once when the context is created. */
  _buildSynth() {
    const sr = this.ctx.sampleRate;
    const mk = (seconds, shape) => {
      const n = Math.floor(sr * seconds);
      const buf = this.ctx.createBuffer(1, n, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * shape(i / n);
      return buf;
    };
    this.synth = {
      blast: mk(0.9, (x) => Math.pow(1 - x, 2)),
      crackle: mk(0.5, (x) => (Math.random() < 0.08 ? 1 : 0.05) * (1 - x)),
    };
  }

  /** Filtered noise from a shared synth buffer; no buffers are created here. */
  _noise(key, { gain = 0.3, delay = 0, filterFreq = 1200, type = "lowpass", rate = 1, duration = null } = {}) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.synth) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.synth[key];
    src.playbackRate.value = rate;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    if (duration) src.stop(t0 + duration);
  }

  explosionBig() {
    this.tone(120, { duration: 0.5, type: "sine", gain: 0.5, sweepTo: 35 });
    this._noise("blast", { gain: 0.55, filterFreq: 900 });
    this._noise("crackle", { gain: 0.25, delay: 0.3, filterFreq: 3000, type: "highpass" });
  }

  explosionSmall() {
    this.tone(220, { duration: 0.25, type: "sine", gain: 0.25, sweepTo: 70 });
    this._noise("blast", { gain: 0.27, filterFreq: 1800, rate: 1.8, duration: 0.45 });
    this._noise("crackle", { gain: 0.1, delay: 0.15, filterFreq: 3500, type: "highpass", duration: 0.25 });
  }

  crackle() {
    this._noise("crackle", { gain: 0.1, filterFreq: 3000, type: "highpass", duration: 0.25 });
  }

  deflect() {
    this.tone(1400, { duration: 0.12, type: "triangle", gain: 0.16, sweepTo: 500 });
    this.tone(2200, { duration: 0.06, type: "sine", gain: 0.1 });
  }

  /** One sound for every power-up: the coin chips louder and higher, plus a rising sparkle. */
  superCoin() {
    this.sample("coin", { gain: 0.9, rate: 1.4 });
    [784, 988, 1175, 1568].forEach((f, i) => {
      this.tone(f, { duration: 0.12, type: i % 2 ? "sine" : "triangle", gain: 0.2, delay: i * 0.08 });
    });
  }

  powerUp() {
    this.superCoin();
  }

  powerUpEnd() {
    this.tone(660, { duration: 0.2, type: "sine", gain: 0.1, sweepTo: 500 });
    this.tone(520, { duration: 0.24, type: "sine", gain: 0.08, delay: 0.1, sweepTo: 440 });
  }

  levelUp() {
    if (this.sample("levelUp", { gain: 0.7 })) return;
    this.tone(523, { duration: 0.1, type: "square", gain: 0.18 });
    this.tone(659, { duration: 0.1, type: "square", gain: 0.18, delay: 0.09 });
    this.tone(784, { duration: 0.2, type: "square", gain: 0.2, delay: 0.18 });
  }

  /** Level cleared: rising brass-like fanfare ending on a held chord, with firework thumps and crackles. */
  victory() {
    if (!this.enabled) return;
    this.ensureContext();
    const brass = (f, delay, duration) => {
      this.tone(f, { duration, type: "sawtooth", gain: 0.12, delay });
      this.tone(f * 1.003, { duration, type: "square", gain: 0.07, delay });
    };
    brass(262, 0, 0.22);
    brass(330, 0.22, 0.22);
    brass(392, 0.44, 0.22);
    [523, 659, 784].forEach((f) => brass(f, 0.7, 1.6));
    [0.1, 0.5, 0.9, 1.3, 1.7].forEach((d, i) => {
      this.tone(90, { duration: 0.25, type: "sine", gain: 0.3, sweepTo: 40, delay: d });
      this._noise("crackle", { gain: 0.14, delay: d + 0.15, filterFreq: 3500 + i * 300, type: "highpass", duration: 0.4 });
    });
  }

  /** Near-miss tick. */
  tick() {
    this.tone(1900, { duration: 0.04, type: "square", gain: 0.06 });
  }

  gameOver() {
    if (this.sample("gameOver", { gain: 0.9 })) return;
    this.tone(300, { duration: 0.3, type: "sawtooth", gain: 0.22, sweepTo: 90 });
    this.noiseBurst({ duration: 0.3, gain: 0.25, delay: 0.05, filterFreq: 400 });
  }

  menuClick() {
    if (this.sample("click", { gain: 0.6 })) return;
    this.tone(600, { duration: 0.05, type: "square", gain: 0.14 });
  }

  menuConfirm() {
    if (this.sample("confirm", { gain: 0.7 })) return;
    this.menuClick();
  }

  countdownBeep(isFinal) {
    this.tone(isFinal ? 880 : 550, { duration: isFinal ? 0.28 : 0.12, type: "sine", gain: 0.22 });
  }

  /** Procedural ambient bed: filtered wind noise + a slow two-note pad, looping
   * forever at ~-20dB under the sfx. Call only after a user gesture. */
  ambientStart() {
    if (!this.enabled || this.ambientNodes) return;
    this.ensureContext();
    const AMBIENT_TARGET = 0.05; // ~-20dB under typical sfx gain (0.14-0.9)
    const FADE = 2; // seconds
    const t0 = this.ctx.currentTime;

    const ambientGain = this.ctx.createGain();
    ambientGain.gain.setValueAtTime(0.0001, t0);
    ambientGain.gain.linearRampToValueAtTime(AMBIENT_TARGET, t0 + FADE);
    ambientGain.connect(this.master);

    // Wind bed: looping filtered noise.
    const bufferSize = Math.floor(this.ctx.sampleRate * 4);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.7;
    noise.connect(filter);
    filter.connect(windGain);
    windGain.connect(ambientGain);
    noise.start(t0);

    // Pad: two slow, low sine tones (a fifth apart).
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.3;
    padGain.connect(ambientGain);
    const pad1 = this.ctx.createOscillator();
    pad1.type = "sine";
    pad1.frequency.value = 110;
    const pad2 = this.ctx.createOscillator();
    pad2.type = "sine";
    pad2.frequency.value = 165;
    pad1.connect(padGain);
    pad2.connect(padGain);
    pad1.start(t0);
    pad2.start(t0);

    this.ambientGain = ambientGain;
    this.ambientNodes = { noise, pad1, pad2 };
  }

  ambientStop() {
    if (!this.ambientNodes || !this.ambientGain) return;
    const { noise, pad1, pad2 } = this.ambientNodes;
    const t0 = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(t0);
    this.ambientGain.gain.setValueAtTime(0, t0);
    noise.stop(t0);
    pad1.stop(t0);
    pad2.stop(t0);
    this.ambientNodes = null;
    this.ambientGain = null;
  }
}
