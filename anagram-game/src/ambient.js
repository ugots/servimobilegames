// Evolving ambient bed: slow-swept pad, drifting room tone, sparse chimes and
// wooden ticks, plus a rising tone on level clear. Peak stays near -18 dBFS:
// (0.06 pad + 0.026 noise + 0.05 chime + 0.04 tick-or-rise) x 0.7 master.
const CHIME_PITCHES = [392, 440, 523.25, 587.33, 659.25];

export function createAmbient() {
  let ctx = null;
  let master = null;
  let nodes = [];
  let chimeTimer = 0;
  let tickTimer = 0;

  function stop() {
    clearTimeout(chimeTimer);
    clearTimeout(tickTimer);
    if (!ctx) return;
    for (const node of nodes) {
      try { node.stop(); } catch (_) {}
    }
    nodes = [];
    const old = ctx;
    ctx = null;
    master = null;
    old.close().catch(() => {});
  }

  function start() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    ctx = c;
    const t0 = c.currentTime;
    const add = (node) => { nodes.push(node); return node; };

    // 1. Master: 0 to 0.7 over 2 s.
    master = add(c.createGain());
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.7, t0 + 2);
    master.connect(c.destination);

    // 2. Pad: detuned saw 110 Hz and triangle 165 Hz through a lowpass.
    const padFilter = add(c.createBiquadFilter());
    padFilter.type = "lowpass";
    padFilter.frequency.value = 650;
    padFilter.Q.value = 0.8;
    const padGain = add(c.createGain());
    padGain.gain.value = 0.06;
    padFilter.connect(padGain);
    padGain.connect(master);
    [["sawtooth", 110, -8], ["triangle", 165, 6]].forEach(([type, frequency, detune]) => {
      const osc = add(c.createOscillator());
      const voice = add(c.createGain());
      osc.type = type;
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      voice.gain.value = 0.5;
      osc.connect(voice);
      voice.connect(padFilter);
      osc.start();
    });

    // 3. Sweep: 30 s LFO moves the cutoff 400-900 Hz.
    const sweepLfo = add(c.createOscillator());
    const sweepDepth = add(c.createGain());
    sweepLfo.frequency.value = 1 / 30;
    sweepDepth.gain.value = 250;
    sweepLfo.connect(sweepDepth);
    sweepDepth.connect(padFilter.frequency);
    sweepLfo.start();

    // 4. Noise bed: looped 2 s noise through a 450 Hz bandpass.
    const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = add(c.createBufferSource());
    noise.buffer = buffer;
    noise.loop = true;
    const noiseBand = add(c.createBiquadFilter());
    noiseBand.type = "bandpass";
    noiseBand.frequency.value = 450;
    noiseBand.Q.value = 0.7;
    const noiseGain = add(c.createGain());
    noiseGain.gain.value = 0.02;
    noise.connect(noiseBand);
    noiseBand.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    // 5. Drift: 47 s LFO breathes the noise level 0.014-0.026.
    const driftLfo = add(c.createOscillator());
    const driftDepth = add(c.createGain());
    driftLfo.frequency.value = 1 / 47;
    driftDepth.gain.value = 0.006;
    driftLfo.connect(driftDepth);
    driftDepth.connect(noiseGain.gain);
    driftLfo.start();

    // 6. Chimes: one soft bell every 6-14 s (transient nodes self-stop).
    function scheduleChime() {
      chimeTimer = setTimeout(() => {
        if (ctx !== c) return;
        const t = c.currentTime;
        const f = CHIME_PITCHES[Math.floor(Math.random() * CHIME_PITCHES.length)];
        const saw = c.createOscillator();
        const sine = c.createOscillator();
        const sineGain = c.createGain();
        const tone = c.createBiquadFilter();
        const env = c.createGain();
        saw.type = "sawtooth";
        saw.frequency.value = f;
        sine.type = "sine";
        sine.frequency.value = f * 2;
        sineGain.gain.value = 0.4;
        tone.type = "lowpass";
        tone.frequency.value = 2400;
        tone.Q.value = 1;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.05, t + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0005, t + 1.2);
        saw.connect(tone);
        sine.connect(sineGain);
        sineGain.connect(tone);
        tone.connect(env);
        env.connect(master);
        saw.start(t);
        sine.start(t);
        saw.stop(t + 1.3);
        sine.stop(t + 1.3);
        scheduleChime();
      }, 6000 + Math.random() * 8000);
    }
    scheduleChime();

    // 7. Wooden ticks: a 40 ms bandpassed noise click at 1.2-2 kHz, one every 4-9 s.
    function scheduleTick() {
      tickTimer = setTimeout(() => {
        if (ctx !== c) return;
        const click = c.createBufferSource();
        click.buffer = buffer;
        const band = c.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1200 + Math.random() * 800;
        band.Q.value = 6;
        const env = c.createGain();
        const t = c.currentTime;
        env.gain.setValueAtTime(0.04, t);
        env.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
        click.connect(band);
        band.connect(env);
        env.connect(master);
        click.start(t, Math.random(), 0.04);
        scheduleTick();
      }, 4000 + Math.random() * 5000);
    }
    scheduleTick();

    c.resume().catch(() => { if (ctx === c) stop(); });
  }

  // Level clear: a short rising triangle tone over the bed.
  function rise() {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 1.2);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.04, t + 0.3);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    osc.connect(env);
    env.connect(master);
    osc.start(t);
    osc.stop(t + 1.7);
  }

  return {
    start,
    stop,
    rise,
    running: () => !!ctx && ctx.state === "running",
    nodeCount: () => (ctx ? nodes.length : 0),
  };
}
