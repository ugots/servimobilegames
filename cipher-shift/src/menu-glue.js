// Wraps Cipher Shift (game.js) with the shared title/pause/exit menu kit.
import { mountMenu } from "../../_base/menu.js";

function sound(kind) {
  document.dispatchEvent(new CustomEvent("cs:sound", { detail: { kind } }));
}

const menu = mountMenu({
  title: "Cipher Shift",
  howTo: "Every ring is off by the same turn: tap a brass side plate or drag the rings to find the one turn that reveals the word; three words clear a level.",
  onPlay: () => {
    window.__cipher.show();
    window.__cipher.start();
    sound("menu");
  },
  onExit: () => {
    window.__cipher.stop();
    window.__cipher.hide();
    sound("menu");
  },
  onPause: () => {
    window.__cipher.setPaused(true);
    sound("menu");
  },
  onResume: () => {
    window.__cipher.setPaused(false);
    sound("menu");
  },
  onFinish: () => window.__cipher.finish(),
});

// Title Exit with no play in progress: closing the tab is the only real exit.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".gk-exit-link")) return;
  if (document.getElementById("cs-play").classList.contains("gk-hidden")) {
    window.close();
    setTimeout(() => {
      const subtitle = document.querySelector(".gk-subtitle");
      if (subtitle) subtitle.textContent = "To leave, close this browser tab. Press Play to keep going.";
    }, 200);
  }
});

// #cs-menu opens the pause overlay (which has Resume and Exit).
document.getElementById("cs-menu").addEventListener("click", () => menu.showPause());
