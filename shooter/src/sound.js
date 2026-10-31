// Sound glue: maps state.events and the heartbeat onto WebAudio (D-037, S4 realism pass).
// The sim never plays anything; it only names events. Graph (all shooter audio ends at one master gain):
//   fire       osc(square 880->440, 0.09 s) -> gain 0.08 ---------------------------> effects(0.9) -> master
//   heartbeat  osc(triangle 55/45 Hz, 0.1 s) -> gain 0.12 ---------------------------> effects -> master
//   explosion  noise -> lowpass(sweep down) -> gain env  +  osc(sine, descending) -> gain env -> effects
//     shipExplode  noise 0.9 s lp 2400->180 g0.5, sine 300->45 0.8 s g0.3, crackle noise hp 1800 0.18 s g0.18
//     attackerExplode noise 0.6 s lp 3000->260 g0.4, sine 420->90 0.5 s g0.22
//     explodeLarge/Medium/Small noise 0.30/0.22/0.14 s lp 1800->300 g0.22/0.16/0.12, sine 200->90 g0.10
//   saucerLarge  osc(triangle 420->520, 0.18 s) -> gain 0.08 -> effects
//   ambience   sine 220 Hz g0.5 + sine 330 Hz g0.35 -> amb gain (0.035, LFO 0.07 Hz depth 0.012) -> ambience(0.35) -> master
//   thrust     looping noise -> bandpass 420 Hz Q0.7 -> lowpass 1400 Hz -> gain (0 / 0.5, tc 0.06 s) -> thrustBus(0.4) -> master
// Mute sets master to 0 (silences loops and tails at once); the shared kit is guarded by the same flag.
const ShooterSound = (() => {
  const TONES = {
    fire: { freq: 880, end: 440, dur: 0.09, type: "square", gain: 0.08 },
    saucerLarge: { freq: 420, end: 520, dur: 0.18, type: "triangle", gain: 0.08 },
  };
  // Noise + descending-tone explosions: [noise dur, lp start, lp end, noise gain, tone start, tone end, tone dur, tone gain]
  const BOOMS = {
    shipExplode: [0.9, 2400, 180, 0.5, 300, 45, 0.8, 0.3],
    attackerExplode: [0.6, 3000, 260, 0.4, 420, 90, 0.5, 0.22],
    explodeLarge: [0.3, 1800, 300, 0.22, 200, 90, 0.2, 0.1],
    explodeMedium: [0.22, 1800, 300, 0.16, 200, 90, 0.15, 0.08],
    explodeSmall: [0.14, 1800, 300, 0.12, 200, 90, 0.1, 0.06],
  };
  const ALIAS = { saucerSmall: "saucerLarge", saucerFire: "fire" };
  const BEAT_FREQ = [55, 45];
  const AMBIENT_GAIN = 0.035;
  const THRUST_GAIN = 0.5;

  function create() {
    let ac = null;
    let extras = null;
    let nodes = null;
    let nextBeat = 0;
    let beatIndex = 0;
    let muted = false;
    let running = false;
    let thrusting = false;
    let blips = 0;
    try {
      muted = localStorage.getItem("shooter.muted") === "1";
    } catch (e) {}

    import("../../_base/audio.js").then((m) => (extras = m.createAudio())).catch(() => {});

    function ctx() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        build();
      }
      if (ac.state === "suspended") ac.resume().catch(() => {});
      return ac;
    }

    function noiseBuffer(secs) {
      const n = Math.max(1, Math.floor(ac.sampleRate * secs));
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      let a = 12345;
      for (let i = 0; i < n; i++) {
        a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
        d[i] = (a / 4294967296) * 2 - 1;
      }
      return buf;
    }

    // Persistent buses plus the two loops. Built once; loops are only ever gain-switched, so rapid
    // mute/pause/restart can never stack duplicates.
    function build() {
      const t = ac.currentTime;
      const master = ac.createGain();
      master.gain.setValueAtTime(muted ? 0 : 1, t);
      master.connect(ac.destination);
      const effects = ac.createGain();
      effects.gain.setValueAtTime(0.9, t);
      effects.connect(master);
      const ambience = ac.createGain();
      ambience.gain.setValueAtTime(0.35, t);
      ambience.connect(master);
      const thrustBus = ac.createGain();
      thrustBus.gain.setValueAtTime(0.4, t);
      thrustBus.connect(master);
      nodes = { master, effects, ambience, thrustBus, ambGain: null, thrustGain: null, boom: noiseBuffer(1) };
    }

    // The two loops are created on the first start() only (a permitted interaction).
    function buildLoops() {
      const t = ac.currentTime;
      const { ambience, thrustBus } = nodes;
      const ambGain = ac.createGain();
      ambGain.gain.setValueAtTime(0, t);
      ambGain.connect(ambience);
      for (const [f, g] of [[220, 0.5], [330, 0.35]]) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f, t);
        const vg = ac.createGain();
        vg.gain.setValueAtTime(g, t);
        o.connect(vg);
        vg.connect(ambGain);
        o.start();
      }
      const lfo = ac.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.07, t);
      const lfoGain = ac.createGain();
      lfoGain.gain.setValueAtTime(0.012, t);
      lfo.connect(lfoGain);
      lfoGain.connect(ambGain.gain);
      lfo.start();

      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(2);
      src.loop = true;
      const band = ac.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(420, t);
      band.Q.setValueAtTime(0.7, t);
      const low = ac.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(1400, t);
      const thrustGain = ac.createGain();
      thrustGain.gain.setValueAtTime(0, t);
      src.connect(band);
      band.connect(low);
      low.connect(thrustGain);
      thrustGain.connect(thrustBus);
      src.start();

      nodes.ambGain = ambGain;
      nodes.thrustGain = thrustGain;
    }

    function applyLoops() {
      if (!ac || !nodes || !nodes.ambGain) return;
      const t = ac.currentTime;
      nodes.ambGain.gain.setTargetAtTime(running ? AMBIENT_GAIN : 0, t, 0.15);
      nodes.thrustGain.gain.setTargetAtTime(running && thrusting ? THRUST_GAIN : 0, t, 0.06);
    }

    function setMuted(v) {
      muted = !!v;
      try {
        localStorage.setItem("shooter.muted", muted ? "1" : "0");
      } catch (e) {}
      if (ac && nodes) nodes.master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.01);
    }

    // Start/resume needs a permitted interaction (Play, Resume, restart): main calls it from those.
    function start() {
      running = true;
      if (!ctx()) return;
      if (!nodes.ambGain) buildLoops();
      applyLoops();
    }

    // Pause, exit, Game Over, blur, hidden: loops fade to zero and the context suspends.
    function stop(keepContext) {
      running = false;
      thrusting = false;
      if (!ac || !nodes) return;
      applyLoops();
      // Game Over keeps the context so the death explosion's tail can finish.
      if (!keepContext) ac.suspend().catch(() => {});
    }

    function setThrust(on) {
      if (thrusting === !!on) return;
      thrusting = !!on;
      applyLoops();
    }

    function blip(t) {
      if (muted) return;
      const c = ctx();
      if (!c) return;
      blips += 1;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = t.type;
      osc.frequency.setValueAtTime(t.freq, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(t.end, c.currentTime + t.dur);
      gain.gain.setValueAtTime(t.gain, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t.dur);
      osc.connect(gain);
      gain.connect(nodes.effects);
      osc.start();
      osc.stop(c.currentTime + t.dur);
    }

    function boom(spec) {
      if (muted) return;
      const c = ctx();
      if (!c) return;
      blips += 1;
      const [nd, lp0, lp1, ng, f0, f1, td, tg] = spec;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = nodes.boom;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(lp0, t);
      lp.frequency.exponentialRampToValueAtTime(lp1, t + nd);
      const g = c.createGain();
      g.gain.setValueAtTime(ng, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + nd);
      src.connect(lp);
      lp.connect(g);
      g.connect(nodes.effects);
      src.start(t);
      src.stop(t + nd);
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + td);
      const og = c.createGain();
      og.gain.setValueAtTime(tg, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + td);
      o.connect(og);
      og.connect(nodes.effects);
      o.start(t);
      o.stop(t + td);
      if (spec === BOOMS.shipExplode) {
        // Crackle transient: a short bright burst on top of the body.
        const cs = c.createBufferSource();
        cs.buffer = nodes.boom;
        const hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.setValueAtTime(1800, t);
        const cg = c.createGain();
        cg.gain.setValueAtTime(0.18, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        cs.connect(hp);
        hp.connect(cg);
        cg.connect(nodes.effects);
        cs.start(t);
        cs.stop(t + 0.18);
      }
    }

    function play(events) {
      if (muted) return;
      for (const name of events) {
        const key = ALIAS[name] || name;
        if (key === "thrust") continue; // thrust is a sustained loop driven by setThrust
        if (TONES[key]) blip(TONES[key]);
        else if (BOOMS[key]) boom(BOOMS[key]);
        else if (extras && name === "extraShip") extras.play("levelup");
        else if (extras && name === "gameover") extras.play("gameover");
        else if (extras && name === "wave") extras.play("score");
      }
    }

    // Two alternating low notes; the interval comes from the sim and shrinks as rocks clear.
    function heartbeat(state, nowMs) {
      if (muted || state.mode !== "play" || !state.ship.alive) return;
      const now = nowMs / 1000;
      if (now < nextBeat) return;
      const gap = ShooterSim.heartbeatInterval(state);
      nextBeat = now + gap;
      blip({ freq: BEAT_FREQ[beatIndex], end: BEAT_FREQ[beatIndex] * 0.9, dur: 0.1, type: "triangle", gain: 0.12 });
      beatIndex = 1 - beatIndex;
    }

    return {
      play,
      heartbeat,
      setMuted,
      isMuted: () => muted,
      start,
      stop,
      setThrust,
      stats: () => ({ blips, running, thrusting, master: muted ? 0 : 1 }),
    };
  }
  return { create, TONES, BOOMS };
})();

if (typeof window !== "undefined") window.ShooterSound = ShooterSound;
