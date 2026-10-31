"use strict";
(function () {
  document.addEventListener("visibilitychange", applyPause);
  applyPause();

  function applyPause() {
    document.documentElement.classList.toggle("lp-paused", document.hidden);
  }

  function play(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () {
      el.classList.remove(cls);
    }, ms);
  }

  function accept() {
    var tray = document.getElementById("tray");
    var progress = document.getElementById("round-progress");
    play(tray, "lp-tray-accept", 600);
    play(progress, "lp-bump", 400);
    document.dispatchEvent(new CustomEvent("lp:accept"));
  }

  function reject() {
    var tray = document.getElementById("tray");
    play(tray, "lp-shake", 380);
    document.dispatchEvent(new CustomEvent("lp:reject"));
  }

  document.addEventListener("lp:found", accept);
  document.addEventListener("lp:miss", reject);
})();
