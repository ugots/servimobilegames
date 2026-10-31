// Original Number Fun ambience: a quiet, repeating pentatonic music-box phrase.
// All tones are generated here with Web Audio; no external audio asset is used.
export function createAmbient() {
  let context = null;
  let output = null;
  let clock = null;
  let nextNote = 0;
  let step = 0;
  let muted = false;
  const notes = [261.63, 329.63, 392, 523.25, 440, 392, 329.63, 293.66,
                 261.63, 329.63, 392, 587.33, 523.25, 392, 329.63, 293.66];

  function tone(frequency, when, duration, volume) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(volume, when + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(envelope).connect(output);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  function schedule() {
    while (nextNote < context.currentTime + 0.15) {
      tone(notes[step], nextNote, 0.36, 0.25);
      if (step % 4 === 0) tone(step < 8 ? 130.81 : 146.83, nextNote, 1.35, 0.075);
      step = (step + 1) % notes.length;
      nextNote += 0.4;
    }
  }

  function allowed() { return !muted && !document.hidden && document.hasFocus(); }
  function pause() {
    if (clock) { clearInterval(clock); clock = null; }
    if (context?.state === "running") context.suspend();
  }
  async function resume() {
    if (!allowed()) { pause(); return; }
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      context = new AudioContextClass();
      output = context.createGain();
      output.gain.value = 0.75;
      output.connect(context.destination);
    }
    await context.resume();
    if (!allowed() || clock) { if (!allowed()) pause(); return; }
    nextNote = context.currentTime + 0.03;
    schedule();
    clock = setInterval(schedule, 80);
  }
  return {
    resume,
    pause,
    setMuted(value) { muted = value; if (muted) pause(); else if (context) resume(); },
  };
}
