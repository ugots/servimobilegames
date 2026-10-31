// Shared audio hook kit (D-037: every key moment has a sound). WebAudio
// synthesised tones by default (60-150ms oscillator blips), so no asset
// files are required; pass a URL per name to use a file instead.

const DEFAULT_TONES = {
  score: { freq: 880, duration: 0.08, type: "sine" },
  hit: { freq: 160, duration: 0.12, type: "square" },
  powerup: { freq: 660, duration: 0.15, type: "triangle" },
  levelup: { freq: 990, duration: 0.15, type: "triangle" },
  gameover: { freq: 220, duration: 0.15, type: "sawtooth" },
  menu: { freq: 520, duration: 0.06, type: "sine" },
};

/**
 * createAudio(map?) -> { play(name) }
 * map: optional { name: url } to use a file instead of a synthesised tone.
 * Missing/unknown sound names log once and never throw.
 */
export function createAudio(map = {}) {
  let ctx = null;
  const warned = new Set();
  const bufferCache = {};

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  }

  function playTone(name) {
    const tone = DEFAULT_TONES[name];
    const audioCtx = getCtx();
    if (!tone || !audioCtx) return false;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = tone.type;
    osc.frequency.value = tone.freq;
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + tone.duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + tone.duration);
    return true;
  }

  function playFile(name) {
    const url = map[name];
    if (!url) return false;
    try {
      let audio = bufferCache[name];
      if (!audio) {
        audio = new Audio(url);
        bufferCache[name] = audio;
      }
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  function play(name) {
    try {
      if (map[name] && playFile(name)) return;
      if (playTone(name)) return;
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`[audio] no sound for "${name}"`);
      }
    } catch (e) {
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`[audio] play failed for "${name}"`, e);
      }
    }
  }

  return { play };
}
