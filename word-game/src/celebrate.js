"use strict";
(function () {
  var TIER_DUR = { A: 620, B: 760, C: 900 };
  var TIER_BH = { A: "-18%", B: "-24%", C: "-32%" };
  var EASING = "cubic-bezier(.3,.7,.2,1)";

  function tierFor(len) {
    if (len >= 7) return "C";
    if (len >= 5) return "B";
    return "A";
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function clearFx() {
    document.querySelectorAll(".lp-fly, .lp-pts-pop, .lp-spark, .lp-clear").forEach(function (el) {
      el.remove();
    });
  }

  function sparks(x, y, count, radius, opts) {
    opts = opts || {};
    var dur = opts.dur || 700;
    for (var i = 0; i < count; i++) {
      var s = document.createElement("span");
      s.className = "lp-spark";
      if (opts.size) s.style.fontSize = opts.size + "px";
      document.body.appendChild(s);
      var angle = (i * (360 / count)) * (Math.PI / 180);
      var dx = Math.cos(angle) * radius;
      var dy = Math.sin(angle) * radius;
      s.style.left = x + "px";
      s.style.top = y + "px";
      var anim = s.animate(
        [
          { transform: "translate(-50%,-50%) translate(0,0)", opacity: 1 },
          { transform: "translate(-50%,-50%) translate(" + dx + "px," + dy + "px)", opacity: 0 },
        ],
        { duration: dur, easing: "ease-out" }
      );
      anim.onfinish = function (el) {
        return function () {
          el.remove();
        };
      }(s);
    }
  }

  function onFound(evt) {
    var detail = evt.detail || {};
    var word = detail.word;
    var points = detail.points;
    var len = detail.len || (word ? word.length : 3);
    var tier = tierFor(len);
    var tray = document.getElementById("tray");
    var tiles = tray ? Array.prototype.slice.call(tray.querySelectorAll(".tile")) : [];

    var scoreField = document.querySelector('.gk-hud-field[data-key="score"]');
    if (scoreField) {
      scoreField.classList.remove("lp-score-bump");
      void scoreField.offsetWidth;
      scoreField.classList.add("lp-score-bump");
      setTimeout(function () {
        scoreField.classList.remove("lp-score-bump");
      }, 450);
    }

    if (reducedMotion() || !tiles.length) {
      requestAnimationFrame(function () {
        var target = document.querySelector('#found-list li[data-word="' + cssEscape(word) + '"]');
        if (target) {
          target.classList.add("lp-found-arrive");
          setTimeout(function () {
            target.classList.remove("lp-found-arrive");
          }, 900);
        }
        showPop(points, tier, target);
      });
      return;
    }

    var rects = tiles.map(function (t) {
      var r = t.getBoundingClientRect();
      return { tileId: t.dataset.tileId, rect: r, clone: t.cloneNode(true) };
    });
    var tileH = rects.length ? rects[0].rect.height : 58;
    var unionLeft = Math.min.apply(null, rects.map(function (r) { return r.rect.left; }));
    var unionTop = Math.min.apply(null, rects.map(function (r) { return r.rect.top; }));
    var unionRight = Math.max.apply(null, rects.map(function (r) { return r.rect.right; }));
    var unionBottom = Math.max.apply(null, rects.map(function (r) { return r.rect.bottom; }));
    var unionCx = (unionLeft + unionRight) / 2;
    var unionCy = (unionTop + unionBottom) / 2;

    var wrapper = document.createElement("div");
    wrapper.className = "lp-fly";
    wrapper.style.position = "fixed";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    wrapper.style.width = "0";
    wrapper.style.height = "0";
    wrapper.style.zIndex = "8400";
    wrapper.style.pointerEvents = "none";
    wrapper.style.transformOrigin = unionCx + "px " + unionCy + "px";
    rects.forEach(function (r) {
      var clone = r.clone;
      clone.className = (clone.className ? clone.className + " " : "") + "lp-fly-tile";
      clone.style.position = "fixed";
      clone.style.left = r.rect.left + "px";
      clone.style.top = r.rect.top + "px";
      clone.style.width = r.rect.width + "px";
      clone.style.height = r.rect.height + "px";
      clone.style.margin = "0";
      wrapper.appendChild(clone);
    });
    document.body.appendChild(wrapper);

    requestAnimationFrame(function () {
      var target = document.querySelector('#found-list li[data-word="' + cssEscape(word) + '"]');
      var dx, dy, targetH = tileH;
      if (target) {
        target.classList.add("lp-found-pending");
        var tr = target.getBoundingClientRect();
        var tcx = tr.left + tr.width / 2;
        var tcy = tr.top + tr.height / 2;
        if (tcy < 0 || tcy > window.innerHeight) {
          tcy = Math.max(40, Math.min(window.innerHeight - 40, tcy));
        }
        dx = tcx - unionCx;
        dy = tcy - unionCy;
        targetH = tr.height || tileH;
      } else {
        dx = 0;
        dy = -60;
      }
      var s = Math.max(0.25, targetH / tileH);
      var dur = TIER_DUR[tier];
      var anim = wrapper.animate(
        [
          { transform: "none", opacity: 1 },
          { offset: 0.22, transform: "translate(0,-" + 0.35 * tileH + "px) scale(1.08)", opacity: 1 },
          { transform: "translate(" + dx + "px," + dy + "px) scale(" + s + ")", opacity: 0.15 },
        ],
        { duration: dur, easing: EASING, fill: "forwards" }
      );
      anim.onfinish = function () {
        wrapper.remove();
        var arrived = document.querySelector('#found-list li[data-word="' + cssEscape(word) + '"]');
        if (arrived) {
          arrived.classList.remove("lp-found-pending");
          arrived.classList.add("lp-found-arrive");
          setTimeout(function () {
            arrived.classList.remove("lp-found-arrive");
          }, 1000);
        }
        if (tier === "C" && arrived) {
          var ar = arrived.getBoundingClientRect();
          sparks(ar.left + ar.width / 2, ar.top + ar.height / 2, 12, 1.2 * tileH);
        }
      };

      showPop(points, tier, null, unionCx, unionCy - 0.5 * tileH);

      rects.forEach(function (r, i) {
        var potTile = document.querySelector('#pot .tile[data-tile-id="' + cssEscape(r.tileId) + '"]');
        if (!potTile) return;
        potTile.style.setProperty("--lp-bh", TIER_BH[tier]);
        potTile.style.animationDelay = (i * 50) + "ms";
        potTile.classList.add("lp-tile-bounce");
        setTimeout(function () {
          potTile.classList.remove("lp-tile-bounce");
        }, 700 + i * 50);
      });

      if (tier === "C") {
        var pot = document.getElementById("pot");
        if (pot) {
          pot.classList.add("lp-pot-glow");
          setTimeout(function () {
            pot.classList.remove("lp-pot-glow");
          }, 900);
        }
      }
    });
  }

  function showPop(points, tier, target, x, y) {
    var pop = document.createElement("span");
    pop.className = "lp-pts-pop " + (tier === "B" ? "lp-pts-b" : tier === "C" ? "lp-pts-c" : "");
    pop.textContent = "+" + points;
    pop.style.position = "fixed";
    if (typeof x === "number") {
      pop.style.left = x + "px";
      pop.style.top = y + "px";
    } else if (target) {
      var r = target.getBoundingClientRect();
      pop.style.left = (r.left + r.width / 2) + "px";
      pop.style.top = (r.top - 0.5 * r.height) + "px";
    } else {
      pop.style.left = "50%";
      pop.style.top = "50%";
    }
    document.body.appendChild(pop);
    setTimeout(function () {
      pop.remove();
    }, 1100);
  }

  function onMiss(evt) {
    var detail = evt.detail || {};
    var message = document.getElementById("message");
    if (message) {
      message.classList.add("lp-cue-show");
      var text = message.textContent;
      setTimeout(function () {
        if (message.textContent === text) {
          message.textContent = "";
        }
        message.classList.remove("lp-cue-show");
      }, 1800);
    }
    if (detail.reason === "found" && detail.word) {
      var chip = document.querySelector('#found-list li[data-word="' + cssEscape(detail.word) + '"]');
      if (chip) {
        chip.classList.add("lp-found-again");
        setTimeout(function () {
          chip.classList.remove("lp-found-again");
        }, 600);
      }
    }
  }

  function cssEscape(str) {
    if (window.CSS && CSS.escape) return CSS.escape(str);
    return String(str).replace(/["\\]/g, "\\$&");
  }

  function onClear(evt) {
    var detail = evt.detail || {};
    var total = detail.total;
    var bonus = detail.bonus;
    setTimeout(function () {
      document.dispatchEvent(new CustomEvent("lp:sound", { detail: { kind: "clear" } }));

      var wrap = document.createElement("div");
      wrap.className = "lp-clear";
      var glow = document.createElement("div");
      glow.className = "lp-clear-glow";
      var banner = document.createElement("div");
      banner.className = "lp-clear-banner";
      banner.innerHTML = "<b>Pot cleared!</b>All " + total + " words \u00b7 +" + bonus + " bonus";
      wrap.appendChild(glow);
      wrap.appendChild(banner);
      document.body.appendChild(wrap);

      var reduced = reducedMotion();
      if (!reduced) {
        var w = window.innerWidth, h = window.innerHeight;
        var R = Math.min(w, h);
        var S = w >= 1800 ? 120 : w >= 900 ? 90 : 70;
        var rect = banner.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        setTimeout(function () { sparks(cx, cy, 24, 0.28 * R, { size: S, dur: 1100 }); }, 0);
        setTimeout(function () { sparks(cx, cy, 32, 0.42 * R, { size: S, dur: 1100 }); }, 250);
        setTimeout(function () { sparks(cx, cy, 40, 0.60 * R, { size: S, dur: 1100 }); }, 500);
        setTimeout(function () {
          sparks(w * 0.25, h * 0.40, 16, 0.20 * R, { size: S, dur: 1100 });
          sparks(w * 0.75, h * 0.40, 16, 0.20 * R, { size: S, dur: 1100 });
        }, 400);

        var pot = document.getElementById("pot");
        if (pot) {
          pot.classList.add("lp-pot-glow");
          setTimeout(function () { pot.classList.remove("lp-pot-glow"); }, 2600);
        }
        var items = document.querySelectorAll("#found-list li");
        items.forEach(function (li, i) {
          li.style.animationDelay = (i * 40) + "ms";
          li.classList.add("lp-found-arrive");
          setTimeout(function () {
            li.classList.remove("lp-found-arrive");
            li.style.animationDelay = "";
          }, 1000 + i * 40);
        });
      }

      setTimeout(function () {
        wrap.remove();
      }, 3400);
    }, 900);
  }

  document.addEventListener("lp:found", onFound);
  document.addEventListener("lp:miss", onMiss);
  document.addEventListener("lp:potstart", clearFx);
  document.addEventListener("lp:clear", onClear);

  window.LPCelebrate = { sparks: sparks, clear: onClear };
})();
