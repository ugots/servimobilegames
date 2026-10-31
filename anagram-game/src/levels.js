// Anagram Adventure rules: level lengths, the accept rule, scramble and target picking.
// Plain script; sets window.AnagramRules (also exported for node tests).
var AnagramRules = (function () {
  var WORDS_PER_LEVEL = 3;
  var LIVES = 3;
  var LADDER = [3, 4, 5, 6, 7, 8, 9];

  function lengthForLevel(n) {
    return Math.min(n + 2, 9);
  }

  // Any valid anagram counts, not only the target: same length, same letters, a real word.
  function accepts(trayWord, target, dict) {
    if (trayWord.length !== target.length) return false;
    if (trayWord.split("").sort().join("") !== target.split("").sort().join("")) return false;
    return dict.has(trayWord);
  }

  // Fisher-Yates until the result differs from the word and is not itself a word.
  function scramble(word, dict, rand) {
    var r = rand || Math.random;
    for (var t = 0; t < 200; t++) {
      var a = word.split("");
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(r() * (i + 1));
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
      }
      var res = a.join("");
      if (res !== word && !dict.has(res)) return res;
    }
    return null;
  }

  // Unused words in list order (common first); the first 2 levels at a length use the first half where possible.
  function pickTarget(level, wordIndex, used, targets, dict, rand) {
    var r = rand || Math.random;
    var pool = targets[lengthForLevel(level)] || [];
    var usedSet = used instanceof Set ? used : new Set(used || []);
    var half = pool.slice(0, Math.floor(pool.length / 2));
    var cand = half.filter(function (w) { return !usedSet.has(w); });
    if (!cand.length) cand = pool.filter(function (w) { return !usedSet.has(w); });
    while (cand.length) {
      var k = Math.floor(r() * cand.length);
      var w = cand.splice(k, 1)[0];
      var s = scramble(w, dict, r);
      if (s !== null) return { target: w, scramble: s };
    }
    return null;
  }

  return {
    WORDS_PER_LEVEL: WORDS_PER_LEVEL,
    LIVES: LIVES,
    LADDER: LADDER,
    lengthForLevel: lengthForLevel,
    accepts: accepts,
    scramble: scramble,
    pickTarget: pickTarget
  };
})();
window.AnagramRules = AnagramRules;
if (typeof module !== "undefined") module.exports = AnagramRules;
