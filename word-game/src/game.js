// Letter Pot - calm word game. No timer, no physical-skill pairing (D-035
// exception for word games). One pot of 9 letters; find words made only from
// those letters (each letter usable as many times as it appears in the pot).
// A pot is cleared by finding every word in it; the player chooses when
// to start a New Pot. "New to you" tally persists across
// sessions (localStorage only - no names, no server, per D-043).

(function () {
  "use strict";

  // Curated list drives which pots are generated (kept internal - never
  // shown to the player as hints or suggestions, per D-044/WG.4).
  var DICT = window.LETTER_POT_WORDS.filter(function (w) {
    return w.length >= 3 && w.length <= 9;
  });

  // Full standard dictionary validates guesses and determines every possible
  // word in the pot, per D-044 ("too" must never be rejected).
  // Source: ENABLE word list (public domain) - see README for license.
  var VALID_SET = new Set(window.ENABLE_WORDS);

  // Rough English letter frequency, biased toward vowels so pots are workable.
  var LETTER_BAG = (
    "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIIOOOOOOOOO" +
    "NNNNNNRRRRRRTTTTTTLLLLSSSSUUUU" +
    "DDDGGBBCCMMPPFFHHVVWWYYKJXQZ"
  ).split("");

  var POT_SIZE = 9;
  var SEEN_KEY = "letterPot.seenWords";
  var STATS_KEY = "letterPot.stats";
  var BEST_KEY = "letterPot.best";
  var POINTS = { 3: 10, 4: 20, 5: 40, 6: 70, 7: 110, 8: 160, 9: 250 };
  function pointsFor(word) { return POINTS[Math.min(word.length, 9)] || 0; }

  var state = {
    pot: [],          // array of {id, letter, inTray}
    potCounts: {},
    possible: [],
    found: [],
    roundNewCount: 0,
    tray: [],          // array of tile ids, in build order
    score: 0,
    bestAtStart: 0,
    bestCelebrated: false,
    cleared: false,
  };
  var nextTileId = 1;
  var lastPlacedId = null;

  function loadSeen() {
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
    } catch (e) {
      return new Set();
    }
  }
  function saveSeen(set) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }
  function loadStats() {
    try {
      return Object.assign(
        { totalNew: 0, pots: 0 },
        JSON.parse(localStorage.getItem(STATS_KEY) || "{}")
      );
    } catch (e) {
      return { totalNew: 0, pots: 0 };
    }
  }
  function saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {}
  }
  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(n) {
    try {
      localStorage.setItem(BEST_KEY, String(n));
    } catch (e) {}
  }

  var seenWords = loadSeen();
  var stats = loadStats();
  var bestScore = loadBest();

  function countLetters(word) {
    var counts = {};
    for (var i = 0; i < word.length; i++) {
      var c = word[i].toUpperCase();
      counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }

  function fitsPot(word, potCounts) {
    var counts = countLetters(word);
    for (var c in counts) {
      if (!potCounts[c] || potCounts[c] < counts[c]) return false;
    }
    return true;
  }

  function randomPot() {
    var letters = [];
    for (var i = 0; i < POT_SIZE; i++) {
      letters.push(LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)]);
    }
    return letters;
  }

  function generatePot() {
    var POT_MIN = 18, POT_MAX = 30;
    var best = null;
    var bestDist = Infinity;
    for (var attempt = 0; attempt < 300; attempt++) {
      var letters = randomPot();
      var counts = countLetters(letters.join(""));
      var curated = DICT.filter(function (w) {
        return fitsPot(w, counts);
      });
      var n = curated.length;
      var dist = (n >= POT_MIN && n <= POT_MAX) ? 0 : (n < POT_MIN ? POT_MIN - n : n - POT_MAX);
      if (dist < bestDist) {
        best = { letters: letters, counts: counts };
        bestDist = dist;
      }
      if (dist === 0) break;
    }
    return best;
  }

  function sound(kind) {
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: kind } }));
  }

  function startNewPot(userTriggered) {
    var gen = generatePot();
    state.pot = gen.letters.map(function (letter) {
      return { id: nextTileId++, letter: letter, inTray: false };
    });
    state.potCounts = gen.counts;
    state.possible = Array.from(VALID_SET).filter(function (w) {
      return w.length >= 3 && w.length <= POT_SIZE && fitsPot(w, gen.counts);
    });
    state.found = [];
    state.roundNewCount = 0;
    state.tray = [];
    state.score = 0;
    state.bestAtStart = bestScore;
    state.bestCelebrated = false;
    state.cleared = false;
    stats.pots += 1;
    saveStats(stats);
    render();
    document.dispatchEvent(new CustomEvent("lp:potstart"));
    if (userTriggered) sound("newpot");
  }

  function shufflePot() {
    var before = state.pot.filter(function (t) { return !t.inTray; }).map(function (t) { return t.letter; }).join("");
    var tries = 0;
    do {
      for (var i = state.pot.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = state.pot[i];
        state.pot[i] = state.pot[j];
        state.pot[j] = tmp;
      }
      tries++;
    } while (
      tries < 5 &&
      state.pot.filter(function (t) { return !t.inTray; }).map(function (t) { return t.letter; }).join("") === before
    );
    render();
    var potEl = document.getElementById("pot");
    potEl.classList.remove("lp-pot-jostle");
    void potEl.offsetWidth;
    potEl.classList.add("lp-pot-jostle");
    var tiles = potEl.querySelectorAll(".tile");
    tiles.forEach(function (tile, i) {
      tile.style.animationDelay = i * 30 + "ms";
      tile.classList.add("tile-shuffle-in");
    });
    sound("menu");
  }

  function tileById(id) {
    for (var i = 0; i < state.pot.length; i++) {
      if (state.pot[i].id === id) return state.pot[i];
    }
    return null;
  }

  // Move a pot tile into the build tray (drag drop or tap-to-place).
  function moveToTray(id) {
    var tile = tileById(id);
    if (!tile || tile.inTray) return;
    tile.inTray = true;
    state.tray.push(id);
    lastPlacedId = id;
    render();
    sound("drop");
  }

  // Move a tray tile back to the pot (drag drop or tap-to-remove).
  function moveToPot(id) {
    var tile = tileById(id);
    if (!tile || !tile.inTray) return;
    tile.inTray = false;
    state.tray = state.tray.filter(function (t) { return t !== id; });
    render();
    sound("drop");
  }

  function clearTray() {
    state.tray.forEach(function (id) {
      var tile = tileById(id);
      if (tile) tile.inTray = false;
    });
    state.tray = [];
    render();
  }

  function currentWord() {
    return state.tray
      .map(function (id) {
        var tile = tileById(id);
        return tile ? tile.letter : "";
      })
      .join("")
      .toLowerCase();
  }

  function submitWord() {
    var w = currentWord();
    if (!w) return;
    judgeWord(w);
  }

  function judgeWord(word) {
    var msg = document.getElementById("message");
    if (word.length < 3) {
      msg.textContent = "Too short";
      document.dispatchEvent(new CustomEvent("lp:miss", { detail: { reason: "short", word: word } }));
      sound("reject");
      return;
    }
    if (!fitsPot(word, state.potCounts)) {
      msg.textContent = "Not in the pot";
      document.dispatchEvent(new CustomEvent("lp:miss", { detail: { reason: "pot", word: word } }));
      sound("reject");
      return;
    }
    if (!VALID_SET.has(word)) {
      msg.textContent = "Not a word";
      document.dispatchEvent(new CustomEvent("lp:miss", { detail: { reason: "word", word: word } }));
      sound("reject");
      return;
    }
    if (state.found.indexOf(word) !== -1) {
      msg.textContent = "Already found";
      document.dispatchEvent(new CustomEvent("lp:miss", { detail: { reason: "found", word: word } }));
      sound("reject");
      clearTray();
      return;
    }
    state.found.push(word);
    var pts = pointsFor(word);
    addPoints(pts, word);
    var isNew = !seenWords.has(word);
    if (isNew) {
      seenWords.add(word);
      saveSeen(seenWords);
      stats.totalNew += 1;
      saveStats(stats);
      state.roundNewCount += 1;
    }
    msg.textContent = "";
    document.dispatchEvent(new CustomEvent("lp:found", { detail: { word: word, points: pts, len: word.length, isNew: isNew } }));
    clearTray();
    sound(word.length >= 7 ? "found_big" : word.length >= 5 ? "found_mid" : "accept");
    var hit = state.found.length;
    var total = state.possible.length;
    if (!state.cleared && hit === total) {
      state.cleared = true;
      var bonus = 25 * total;
      addPoints(bonus, null);
      render();
      document.dispatchEvent(new CustomEvent("lp:clear", { detail: { total: total, bonus: bonus, score: state.score } }));
    }
  }

  function addPoints(n, word) {
    state.score += n;
    var newBest = false;
    if (state.score > bestScore) {
      bestScore = state.score;
      saveBest(bestScore);
      newBest = true;
      if (!state.bestCelebrated && state.bestAtStart > 0) {
        state.bestCelebrated = true;
        celebrateBest();
      }
    }
    document.dispatchEvent(new CustomEvent("lp:score", { detail: { word: word || null, points: n, total: state.score, best: bestScore, newBest: newBest } }));
  }

  function celebrateBest() {
    var toast = document.getElementById("lp-best-toast");
    if (toast) {
      toast.textContent = "New high score! " + bestScore;
      toast.classList.remove("lp-best-show");
      void toast.offsetWidth;
      toast.classList.add("lp-best-show");
      toast.hidden = false;
      toast.addEventListener("animationend", function onEnd() {
        toast.hidden = true;
        toast.removeEventListener("animationend", onEnd);
      });
    }
    var field = document.querySelector('.gk-hud-field[data-key="best"]');
    if (field) {
      field.classList.remove("lp-best-flash");
      void field.offsetWidth;
      field.classList.add("lp-best-flash");
      field.addEventListener("animationend", function onEnd() {
        field.classList.remove("lp-best-flash");
        field.removeEventListener("animationend", onEnd);
      });
    }
    sound("newpot");
  }

  function makeTileEl(tile, source) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "tile lp-tile";
    el.textContent = tile.letter;
    el.dataset.tileId = tile.id;
    el.dataset.source = source;
    if (source === "tray" && tile.id === lastPlacedId) el.classList.add("tile-slide-in");
    el.setAttribute("aria-label", "Letter " + tile.letter);
    attachPointerHandlers(el, tile.id, source);
    return el;
  }

  function sizeMobileReceiver() {
    var trayEl = document.getElementById("tray");
    if (window.innerWidth > 899) {
      trayEl.style.removeProperty("--receiver-edge");
      trayEl.style.removeProperty("--receiver-font");
      return;
    }
    var style = getComputedStyle(trayEl);
    var innerWidth = trayEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    var gap = parseFloat(style.columnGap) || 0;
    var bankTile = document.querySelector("#pot .tile");
    var bankEdge = bankTile ? parseFloat(getComputedStyle(bankTile).width) : 58;
    var count = Math.max(state.tray.length, 1);
    var edge = Math.min(bankEdge, Math.floor((innerWidth - gap * (count - 1)) / count));
    trayEl.style.setProperty("--receiver-edge", edge + "px");
    trayEl.style.setProperty("--receiver-font", Math.max(20, Math.floor(edge * .56)) + "px");
  }

  function render() {
    var potEl = document.getElementById("pot");
    var trayEl = document.getElementById("tray");
    potEl.innerHTML = "";
    trayEl.innerHTML = "";
    state.pot.forEach(function (tile) {
      if (tile.inTray) {
        var hole = document.createElement("span");
        hole.className = "pot-hole";
        hole.dataset.tileId = tile.id;
        hole.setAttribute("aria-hidden", "true");
        potEl.appendChild(hole);
      } else {
        potEl.appendChild(makeTileEl(tile, "pot"));
      }
    });
    state.tray.forEach(function (id) {
      var tile = tileById(id);
      if (tile) trayEl.appendChild(makeTileEl(tile, "tray"));
    });
    sizeMobileReceiver();

    var hit = state.found.length;
    var Y = state.possible.length;
    document.getElementById("round-progress").textContent =
      hit + " / " + Y + " words in this pot";
    document.getElementById("new-tally").textContent =
      "New words all-time: " + stats.totalNew;

    var list = document.getElementById("found-list");
    list.innerHTML = "";
    state.found
      .slice()
      .reverse()
      .forEach(function (w) {
        var li = document.createElement("li");
        li.textContent = w;
        li.dataset.word = w;
        li.dataset.len = String(Math.min(w.length, 7));
        list.appendChild(li);
      });

    var nextBtn = document.getElementById("next-pot");
    nextBtn.textContent =
      hit === Y ? "Pot cleared - New Pot" : "New Pot";

    lastPlacedId = null;
  }

  // Pointer Events unify mouse and touch drag. A short drag (or a plain
  // click) counts as a tap-to-place fallback so the game is fully playable
  // without precise dragging.
  var DRAG_THRESHOLD = 6;

  function attachPointerHandlers(el, tileId, source) {
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var ghost = null;

    function makeGhost() {
      var g = el.cloneNode(true);
      g.className = "tile lp-tile tile-ghost";
      var tileStyle = getComputedStyle(el);
      g.style.width = tileStyle.width;
      g.style.height = tileStyle.height;
      g.style.fontSize = tileStyle.fontSize;
      g.style.position = "fixed";
      g.style.pointerEvents = "none";
      g.style.zIndex = "1000";
      document.body.appendChild(g);
      return g;
    }

    function positionGhost(x, y) {
      if (!ghost) return;
      var r = ghost.getBoundingClientRect();
      ghost.style.left = x - r.width / 2 + "px";
      ghost.style.top = y - r.height / 2 + "px";
    }

    function onMove(e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragging = true;
        el.classList.add("tile-dragging");
        ghost = makeGhost();
      }
      if (dragging) positionGhost(e.clientX, e.clientY);
    }

    function onUp(e) {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      el.classList.remove("tile-dragging");
      if (ghost) {
        ghost.remove();
        ghost = null;
      }

      var dropTarget = null;
      if (dragging) {
        var under = document.elementFromPoint(e.clientX, e.clientY);
        dropTarget = under ? under.closest(".pot, .tray") : null;
      }

      if (e.type === "pointercancel") {
        dragging = false;
        return;
      }
      if (source === "pot") {
        // Tap, or a drag that ended over the tray: place the tile.
        if (!dragging || (dropTarget && dropTarget.id === "tray")) {
          moveToTray(tileId);
        }
      } else {
        // Tap, or a drag that ended over the pot: return the tile.
        if (!dragging || (dropTarget && dropTarget.id === "pot")) {
          moveToPot(tileId);
        }
      }
      dragging = false;
    }

    el.addEventListener("pointerdown", function (e) {
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      sound("pick");
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }

  function init() {
    window.addEventListener("resize", sizeMobileReceiver);
    document.getElementById("submit-word").addEventListener("click", submitWord);
    document.getElementById("clear-tray").addEventListener("click", function () {
      sound("menu");
      clearTray();
    });
    document.getElementById("next-pot").addEventListener("click", function () { startNewPot(true); });
    document.getElementById("lp-shuffle").addEventListener("click", shufflePot);
    var keyEl = document.getElementById("lp-points-key");
    if (keyEl) {
      keyEl.textContent = "Points by length:" + " " + [3, 4, 5, 6, 7, 8, 9].map(function (L) {
        return L + " → " + POINTS[L];
      }).join(" · ");
    }
    startNewPot();
  }

  window.LetterPot = {
    shuffle: shufflePot,
    newPot: function () { startNewPot(true); },
    points: pointsFor,
    addBonus: function (n) { if (n > 0) { addPoints(n, null); render(); } },
    snapshot: function () { return { found: state.found.slice(), possible: state.possible.slice(), score: state.score, best: bestScore }; },
    play: judgeWord
  };

  document.addEventListener("DOMContentLoaded", init);
})();
