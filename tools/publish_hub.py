"""Copy the Games base folder and the 7 web games into the repo root. Stdlib only, rerunnable."""
import fnmatch
import html
import json
import os
import re
import shutil
import sys

SRC = os.environ.get("GAMES_SRC", r"C:\AI\local-llm-tools\Games")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDERS = ["_base", "anagram-game", "castle-defense", "coin-runner",
           "number-game", "shooter", "word-game", "cipher-shift"]
SKIP_DIRS = {"tools", "artifacts", "reports", "__pycache__", ".pytest_cache", "node_modules", ".venv", "Demo", "tests", "preedit"}
SKIP_FILES = ["*.bak*", "*.pre_*", "*.log", "*.py", "capture_recipe.json",
              "RETURN_*.md", "README.md", "ASSETS.md", "*.p7c-backup*"]
TEXT_EXT = (".html", ".js", ".css")
# absolute site-root refs ("/_base/x") break under the /servimobilegames/ Pages prefix
ABS = re.compile(r"""(["'`(=]\s*)/((?:_base|%s)/)""" % "|".join(FOLDERS[1:]))
# fetch()/Audio() strings resolve against the HTML page (game root), not the module file,
# so a runtime "../../_base/" only worked on a root server (the extra ../ clamps at /)
OVER = re.compile(r"(?:\.\./){2,}_base/")
MAX = 20 * 1024 * 1024


def rewrite_abs(dst):
    n = 0
    for cur, _d, files in os.walk(dst):
        for f in files:
            if not f.endswith(TEXT_EXT):
                continue
            p = os.path.join(cur, f)
            with open(p, encoding="utf-8", newline="") as fh:
                t = fh.read()
            t2, k = ABS.subn(lambda m: m.group(1) + ("../" * (os.path.relpath(cur, ROOT).count(os.sep) + 1)) + m.group(2), t)
            if f.endswith(".js") and "/vendor" not in cur.replace(os.sep, "/") and os.path.relpath(cur, ROOT).count(os.sep) >= 1 and not os.path.relpath(cur, ROOT).startswith("_base"):
                out = []
                for ln in t2.split(chr(10)):
                    if not re.search(r"(import|from)", ln):
                        ln, j = OVER.subn("../_base/", ln)
                        k += j
                    out.append(ln)
                t2 = chr(10).join(out)
            if k:
                with open(p, "w", encoding="utf-8", newline="") as fh:
                    fh.write(t2)
                print("  rewrote %d abs ref(s) in %s" % (k, os.path.relpath(p, ROOT)))
                n += k
    return n


def inject_og(games):
    """Insert Open Graph tags before </head> of each copied game page; idempotent."""
    hub = games.get("hub", "https://ugots.github.io/servimobilegames/")
    for g in games["games"]:
        p = os.path.join(ROOT, g["slug"], "index.html")
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8", newline="") as fh:
            t = fh.read()
        if "<!--og-->" in t:
            continue
        q = lambda s: html.escape(s, quote=True)
        blk = ("<!--og--><meta property=\"og:title\" content=\"%s\">"
               "<meta property=\"og:description\" content=\"%s\">"
               "<meta property=\"og:image\" content=\"%sshare/%s.png\">"
               "<meta property=\"og:url\" content=\"%s%s/\">") % (
                   q(g["title"]), q(g["tagline"]), hub, g["slug"], hub, g["slug"])
        if "</head>" not in t:
            continue
        t = t.replace("</head>", blk + "</head>", 1)
        with open(p, "w", encoding="utf-8", newline="") as fh:
            fh.write(t)
        print("  og tags ->", g["slug"])


def main():
    big = []
    for name in FOLDERS:
        src = os.path.join(SRC, name)
        dst = os.path.join(ROOT, name)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        count = 0
        for cur, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            rel = os.path.relpath(cur, src)
            for f in files:
                if any(fnmatch.fnmatch(f, p) for p in SKIP_FILES):
                    continue
                s = os.path.join(cur, f)
                if os.path.getsize(s) > MAX:
                    big.append(s)
                    continue
                d = os.path.normpath(os.path.join(dst, rel, f))
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(s, d)
                count += 1
        print("%-16s %d files" % (name, count))
        rewrite_abs(dst)
    shutil.copy2(os.path.join(SRC, "_base", "games.json"), os.path.join(ROOT, "games.json"))
    print("games.json refreshed from _base")
    with open(os.path.join(ROOT, "games.json"), encoding="utf-8") as fh:
        inject_og(json.load(fh))
    for b in big:
        print("SKIPPED over 20 MB:", b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
