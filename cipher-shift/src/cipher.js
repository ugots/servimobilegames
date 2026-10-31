// Cipher Shift rules: pure functions, no DOM. Sets window.CipherRules.
// Offset direction: shown = shift(target, s); a turn d moves every letter by d
// (A + 1 = B, Z + 1 = A). The correct first turn is d = -s.
(function (root) {
  const OFFSETS = [-2, -1, 1, 2];

  function shiftLetter(c, d) {
    const n = c.charCodeAt(0) - 97;
    return String.fromCharCode(97 + ((((n + d) % 26) + 26) % 26));
  }

  function shiftWord(w, d) {
    let out = "";
    for (const c of w) out += shiftLetter(c, d);
    return out;
  }

  // Word number n (from 1) gets n + 2 letters, capped at 9.
  function lengthForWord(n) {
    return Math.min(n + 2, 9);
  }

  // Exactly one of the four turns lands on a dictionary word, and it is the target.
  function isUnique(target, s, dict) {
    const shown = shiftWord(target, s);
    const hits = OFFSETS.filter((d) => dict.has(shiftWord(shown, d)));
    return hits.length === 1 && hits[0] === -s;
  }

  function pickWord(n, used, targets, dict, rand) {
    const rnd = rand || Math.random;
    const pool = (targets[lengthForWord(n)] || []).filter((w) => !used.has(w));
    const order = pool.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const target of order) {
      const start = Math.floor(rnd() * OFFSETS.length);
      for (let i = 0; i < OFFSETS.length; i++) {
        const s = OFFSETS[(start + i) % OFFSETS.length];
        if (isUnique(target, s, dict)) {
          return { target, s, shown: shiftWord(target, s) };
        }
      }
    }
    return null;
  }

  // New offset after a turn, normalised to -12..13.
  function applyTurn(k, d) {
    let m = (((k + d) % 26) + 26) % 26;
    if (m > 13) m -= 26;
    return m;
  }

  function isSolved(k) {
    return k === 0;
  }

  const CipherRules = {
    OFFSETS, shiftLetter, shiftWord, lengthForWord, isUnique, pickWord, applyTurn, isSolved,
  };
  root.CipherRules = CipherRules;
  if (typeof module !== "undefined") module.exports = CipherRules;
})(typeof window !== "undefined" ? window : globalThis);
