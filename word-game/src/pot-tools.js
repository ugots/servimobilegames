(function () {
  "use strict";

  var overlay = document.getElementById("lp-giveup-dialog");
  var titleEl = document.getElementById("lp-giveup-title");
  var textEl = document.getElementById("lp-giveup-text");
  var listsEl = document.querySelector(".lp-gu-lists");
  var foundH = document.getElementById("lp-gu-found-h");
  var foundList = document.getElementById("lp-gu-found");
  var missedList = document.getElementById("lp-gu-missed");
  var missedH = missedList ? missedList.previousElementSibling : null;
  var yesBtn = document.getElementById("lp-gu-yes");
  var noBtn = document.getElementById("lp-gu-no");
  var newBtn = document.getElementById("lp-gu-new");
  var revealed = false;

  function dispatchSound(kind) {
    document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: kind } }));
  }

  function showOverlay() {
    overlay.classList.remove("gk-hidden");
  }

  function hideOverlay() {
    overlay.classList.add("gk-hidden");
  }

  function showConfirm(found) {
    revealed = false;
    titleEl.textContent = "Give up this pot?";
    textEl.textContent =
      "You found " + found.length + " words. Giving up shows the rest and deals a fresh pot.";
    listsEl.classList.add("gk-hidden");
    newBtn.classList.add("gk-hidden");
    yesBtn.classList.remove("gk-hidden");
    noBtn.classList.remove("gk-hidden");
    showOverlay();
    dispatchSound("menu");
    noBtn.focus();
  }

  function showReveal(found, possible) {
    revealed = true;
    var missed = possible.filter(function (w) { return found.indexOf(w) === -1; });
    titleEl.textContent = "Words in this pot";
    textEl.textContent =
      missed.length === 0
        ? "You found every word in this pot."
        : "You found " + found.length + " · " + missed.length + " more were hiding";

    foundList.innerHTML = "";
    found.forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w;
      foundList.appendChild(li);
    });
    var hideFound = found.length === 0;
    foundList.classList.toggle("gk-hidden", hideFound);
    foundH.classList.toggle("gk-hidden", hideFound);

    missed.sort(function (a, b) {
      return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
    });
    missedList.innerHTML = "";
    missed.forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w;
      missedList.appendChild(li);
    });
    var hideMissed = missed.length === 0;
    missedList.classList.toggle("gk-hidden", hideMissed);
    if (missedH) missedH.classList.toggle("gk-hidden", hideMissed);

    listsEl.classList.remove("gk-hidden");
    yesBtn.classList.add("gk-hidden");
    noBtn.classList.add("gk-hidden");
    newBtn.classList.remove("gk-hidden");
    showOverlay();
    dispatchSound("menu");
    newBtn.focus();
  }

  function onGiveupClick() {
    var snap = window.LetterPot.snapshot();
    if (snap.found.length === 0) {
      showReveal(snap.found, snap.possible);
    } else {
      showConfirm(snap.found);
    }
  }

  var giveupTrigger = document.getElementById("lp-giveup");
  if (giveupTrigger) giveupTrigger.addEventListener("click", onGiveupClick);

  if (yesBtn) {
    yesBtn.addEventListener("click", function () {
      var snap = window.LetterPot.snapshot();
      showReveal(snap.found, snap.possible);
    });
  }

  if (noBtn) {
    noBtn.addEventListener("click", function () {
      hideOverlay();
      dispatchSound("menu");
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", function () {
      hideOverlay();
      window.LetterPot.newPot();
      var msg = document.getElementById("message");
      if (msg) msg.textContent = "";
    });
  }

  window.addEventListener(
    "keydown",
    function (e) {
      if (!overlay || overlay.classList.contains("gk-hidden")) return;
      if (e.code === "Escape") {
        if (!revealed) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (noBtn) noBtn.click();
        }
      } else if (e.code === "Space" || e.code === "KeyP") {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );
})();
