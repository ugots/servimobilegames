// Anagram Adventure: unscramble the tiles, three words a level, three lives, each level one letter longer.
// Rules live in levels.js (AnagramRules); this file is state, rendering and input.
(function () {
  "use strict";
  var R = window.AnagramRules;
  var TARGETS = window.ANAGRAM_TARGETS;
  var DICT = new Set(window.ENABLE_WORDS);
  var K_BEST = "anagram-ladder-best-score";
  var DRAG_THRESHOLD = 8;
  var PER = R.WORDS_PER_LEVEL;

  function readNum(key) {
    try { return parseInt(localStorage.getItem(key) || "0", 10) || 0; } catch (e) { return 0; }
  }
  function writeNum(key, n) {
    try { localStorage.setItem(key, String(n)); } catch (e) {}
  }

  var st = {
    level: 1, wordIndex: 0, solvedInLevel: 0, score: 0, best: readNum(K_BEST),
    lives: R.LIVES, target: "", bank: [], tray: [], runOver: false, clearing: false
  };
  var used = new Set();
  var locked = false;
  var bannerText = "";
  var glow = false;
  var revealed = false;
  var epoch = 0;

  var $ = function (id) { return document.getElementById(id); };
  var trayEl = $("an-tray");
  var bankEl = $("an-bank");
  var boardEl = $("an-board");
  var playArea = $("playArea");

  function sound(kind) {
    document.dispatchEvent(new CustomEvent("an:sound", { detail: { kind: kind } }));
  }
  // Delayed work belongs to one deal; a new deal (epoch change) cancels it.
  function later(fn, ms) {
    var e = epoch;
    setTimeout(function () { if (e === epoch) fn(); }, ms);
  }
  function byId(id) {
    for (var i = 0; i < st.bank.length; i++) if (st.bank[i].id === id) return st.bank[i];
    return null;
  }

  // ---- dealing ----
  function deal(word, scrambled) {
    epoch++;
    locked = false;
    glow = false;
    revealed = false;
    st.target = word;
    st.wordIndex = Math.min(st.solvedInLevel, PER - 1);
    st.bank = scrambled.split("").map(function (l, i) { return { id: i, letter: l, inTray: false }; });
    st.tray = [];
    used.add(word);
    render();
  }

  function nextWord() {
    var p = R.pickTarget(st.level, st.wordIndex = Math.min(st.solvedInLevel, PER - 1), used, TARGETS, DICT);
    if (!p) { used.clear(); p = R.pickTarget(st.level, st.wordIndex, used, TARGETS, DICT); }
    deal(p.target, p.scramble);
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function newRun() {
    epoch++;
    st.level = 1; st.solvedInLevel = 0; st.score = 0; st.lives = R.LIVES;
    st.runOver = false; st.clearing = false;
    bannerText = "";
    hideBanner();
    hideRunOver();
    used.clear();
    nextWord();
  }

  // ---- check, accept, refuse ----
  function trayWord() {
    return st.tray.map(function (id) { return byId(id).letter; }).join("");
  }

  function check() {
    if (locked || st.runOver || st.clearing || !st.bank.length || st.tray.length !== st.bank.length) return;
    if (R.accepts(trayWord(), st.target, DICT)) accept(); else refuse();
  }

  function accept() {
    locked = true;
    glow = true;
    st.solvedInLevel++;
    st.score++;
    if (st.score > st.best) { st.best = st.score; writeNum(K_BEST, st.best); }
    sound("accept");
    render();
    later(function () {
      if (st.solvedInLevel >= PER) levelComplete(); else nextWord();
    }, 700);
  }

  // A wrong full tray costs nothing: shake, then every tile goes back to its own bank slot.
  function refuse() {
    locked = true;
    sound("wrong");
    trayEl.classList.remove("an-shake");
    void trayEl.offsetWidth;
    trayEl.classList.add("an-shake");
    setTimeout(function () { trayEl.classList.remove("an-shake"); }, 300);
    later(function () {
      st.tray.forEach(function (id) { byId(id).inTray = false; });
      st.tray = [];
      locked = false;
      render();
    }, 400);
  }

  function showBanner(text) {
    bannerText = text;
    var el = $("an-banner");
    el.textContent = text;
    el.hidden = false;
    // sit just above the tray so no tile is covered
    var tr = trayEl.getBoundingClientRect();
    el.style.top = Math.max(el.offsetHeight / 2 + 4, Math.round(tr.top - el.offsetHeight / 2 - 14)) + "px";
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
  }
  function hideBanner() {
    bannerText = "";
    var el = $("an-banner");
    if (el) { el.hidden = true; el.classList.remove("show"); }
  }

  // Level clear: burst from the tray tiles, banner names the level just cleared, then the next level starts by itself.
  function levelComplete() {
    var cleared = st.level;
    st.clearing = true;
    locked = true;
    sound("levelup");
    burst();
    showBanner("Level " + cleared + " Cleared");
    render();
    later(function () {
      st.clearing = false;
      hideBanner();
      st.level++;
      st.solvedInLevel = 0;
      used.clear();
      sound("menu");
      nextWord();
    }, 1400);
  }

  function burst() {
    var host = $("an-burst");
    host.innerHTML = "";
    var tiles = trayEl.querySelectorAll(".an-tile");
    var pts = [];
    Array.prototype.forEach.call(tiles, function (t) {
      var r = t.getBoundingClientRect();
      pts.push([r.left + r.width / 2, r.top + r.height / 2]);
    });
    if (!pts.length) pts.push([window.innerWidth / 2, window.innerHeight / 2]);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      for (var i = 0; i < 24; i++) {
        var d = document.createElement("i");
        var p = pts[i % pts.length];
        var a = (i / 24) * Math.PI * 2;
        var r2 = 70 + (i % 5) * 35;
        d.style.left = Math.round(p[0] - 5) + "px";
        d.style.top = Math.round(p[1] - 5) + "px";
        d.style.setProperty("--dx", Math.round(Math.cos(a) * r2) + "px");
        d.style.setProperty("--dy", Math.round(Math.sin(a) * r2) + "px");
        d.className = i % 2 ? "cream" : "brass";
        host.appendChild(d);
      }
      host.classList.remove("go");
      void host.offsetWidth;
      host.classList.add("go");
    }
    setTimeout(function () { host.classList.remove("go"); host.innerHTML = ""; }, 900);
  }

  function hideRunOver() {
    var el = $("an-runover");
    if (el) el.classList.add("gk-hidden");
  }
  function showRunOver() {
    setText("an-ro-level", "Level reached " + st.level);
    setText("an-ro-score", "Score " + st.score);
    setText("an-ro-best", "Best " + st.best);
    $("an-runover").classList.remove("gk-hidden");
    $("an-again").focus();
  }

  // ---- tile moves ----
  function removeFromTray(id) {
    var k = st.tray.indexOf(id);
    if (k >= 0) st.tray.splice(k, 1);
  }
  function toTray(id, index) {
    if (locked || st.runOver) return;
    var t = byId(id);
    if (!t) return;
    removeFromTray(id);
    var at = index === undefined ? st.tray.length : Math.max(0, Math.min(index, st.tray.length));
    st.tray.splice(at, 0, id);
    t.inTray = true;
    sound("drop");
    render();
    check();
  }
  function toBank(id) {
    if (locked || st.runOver) return;
    var t = byId(id);
    if (!t) return;
    removeFromTray(id);
    t.inTray = false;
    sound("drop");
    render();
  }
  function clearTray() {
    if (locked || st.runOver) return;
    st.tray.forEach(function (id) { byId(id).inTray = false; });
    st.tray = [];
    sound("drop");
    render();
  }
  // Give Up: show the word for 1.5 s, lose a life, the word does not count.
  function giveUp() {
    if (locked || st.runOver || st.clearing) return;
    locked = true;
    st.lives--;
    revealed = true;
    st.bank.forEach(function (b) { b.inTray = false; });
    var taken = {};
    st.tray = st.target.split("").map(function (ch) {
      for (var i = 0; i < st.bank.length; i++) {
        var b = st.bank[i];
        if (!taken[b.id] && b.letter === ch) { taken[b.id] = true; b.inTray = true; return b.id; }
      }
      return null;
    });
    sound("lifelost");
    render();
    later(function () {
      if (st.lives > 0) { nextWord(); return; }
      st.runOver = true;
      revealed = false;
      sound("runover");
      render();
      showRunOver();
    }, 1500);
  }

  // ---- rendering ----
  function makeTile(item) {
    var el = document.createElement("div");
    el.className = "lp-tile an-tile";
    el.setAttribute("data-id", String(item.id));
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", item.letter);
    el.textContent = item.letter;
    attachPointerHandlers(el, item.id);
    return el;
  }

  function render() {
    var n = st.bank.length;
    boardEl.setAttribute("data-len", String(n));
    boardEl.classList.toggle("an-revealed", revealed);
    trayEl.innerHTML = "";
    bankEl.innerHTML = "";
    for (var i = 0; i < n; i++) {
      var slot = document.createElement("div");
      slot.className = "an-slot";
      if (i < st.tray.length) {
        var tile = makeTile(byId(st.tray[i]));
        if (glow) tile.classList.add("an-glow");
        slot.appendChild(tile);
      }
      trayEl.appendChild(slot);
      var bslot = document.createElement("div");
      bslot.className = "an-slot";
      if (!st.bank[i].inTray) bslot.appendChild(makeTile(st.bank[i]));
      bankEl.appendChild(bslot);
    }
    // HUD row: Level, Score, Best, and one heart tile per life.
    setText("an-level", "Level " + st.level);
    setText("an-score", "Score " + st.score);
    setText("an-best", "Best " + st.best);
    var hearts = $("an-lives");
    hearts.setAttribute("aria-label", st.lives + (st.lives === 1 ? " life left" : " lives left"));
    Array.prototype.forEach.call(hearts.querySelectorAll(".an-heart"), function (h, i) {
      h.classList.toggle("lost", i >= st.lives);
    });
  }

  // ---- pointer input (tap within 8 px, else drag a ghost) ----
  function nearestSlot(x, y) {
    var best = 0, bd = Infinity;
    Array.prototype.forEach.call(trayEl.children, function (s, i) {
      var r = s.getBoundingClientRect();
      var d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function attachPointerHandlers(el, tileId) {
    var startX = 0, startY = 0, dragging = false, ghost = null;

    function makeGhost() {
      var g = el.cloneNode(true);
      g.className = "lp-tile an-tile an-ghost";
      var cs = getComputedStyle(el);
      g.style.width = cs.width;
      g.style.height = cs.height;
      g.style.fontSize = cs.fontSize;
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
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD) {
        dragging = true;
        el.classList.add("an-dragging");
        ghost = makeGhost();
      }
      if (dragging) positionGhost(e.clientX, e.clientY);
    }
    function onUp(e) {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      el.classList.remove("an-dragging");
      if (ghost) { ghost.remove(); ghost = null; }
      var wasDrag = dragging;
      dragging = false;
      if (e.type === "pointercancel") return;
      var inTray = st.tray.indexOf(tileId) >= 0;
      if (!wasDrag) {
        if (inTray) toBank(tileId); else toTray(tileId);
        return;
      }
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var zone = under ? under.closest("#an-tray") : null;
      if (zone) toTray(tileId, nearestSlot(e.clientX, e.clientY));
      else if (inTray) toBank(tileId);
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

  // ---- keyboard ----
  function menuOpen() {
    return !!document.querySelector(".gk-menu-root .gk-screen:not(.gk-hidden)");
  }
  window.addEventListener("keydown", function (e) {
    if (playArea.classList.contains("gk-hidden") || menuOpen()) return;
    if (st.runOver) {
      if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
        e.preventDefault();
        e.stopImmediatePropagation();
        newRun();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      if (!locked && st.tray.length) toBank(st.tray[st.tray.length - 1]);
    } else if (e.key === "Enter") {
      if (e.target && e.target.tagName === "BUTTON") return;
      e.preventDefault();
      check();
    } else if (/^[a-zA-Z]$/.test(e.key) && !locked) {
      var ch = e.key.toLowerCase();
      for (var i = 0; i < st.bank.length; i++) {
        if (!st.bank[i].inTray && st.bank[i].letter === ch) { toTray(st.bank[i].id); break; }
      }
    }
  }, true);

  $("an-clear").addEventListener("click", clearTray);
  $("an-giveup").addEventListener("click", giveUp);
  $("an-again").addEventListener("click", newRun);

  // ---- hooks for the menu glue and the tests ----
  window.__anagram = {
    state: function () {
      return {
        level: st.level, length: st.target.length, wordIndex: st.wordIndex,
        solvedInLevel: st.solvedInLevel, score: st.score, best: st.best, lives: st.lives,
        target: st.target,
        bank: st.bank.map(function (b) { return b.letter; }),
        tray: st.tray.map(function (id) { return byId(id).letter; }),
        runOver: st.runOver, bannerText: bannerText
      };
    },
    setTarget: function (word) {
      var s = R.scramble(word, DICT);
      if (s === null) s = word.slice(1) + word.charAt(0);
      st.clearing = false;
      hideBanner();
      deal(word, s);
    },
    setLevel: function (n) {
      epoch++;
      st.clearing = false;
      hideBanner();
      st.level = n;
      st.solvedInLevel = 0;
      used.clear();
      nextWord();
    },
    rules: window.AnagramRules
  };
  window.AnagramGame = {
    newRun: newRun,
    summary: function () {
      return st.score + " words · level " + st.level + " · best " + st.best;
    }
  };

  newRun();
})();
