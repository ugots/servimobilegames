"""Copy the Games base folder and the 7 web games into the repo root. Stdlib only, rerunnable."""
import fnmatch
import os
import shutil
import sys

SRC = os.environ.get("GAMES_SRC", r"C:\AI\local-llm-tools\Games")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDERS = ["_base", "anagram-game", "castle-defense", "coin-runner",
           "number-game", "shooter", "word-game", "cipher-shift"]
SKIP_DIRS = {"tools", "artifacts", "reports", "__pycache__", ".pytest_cache", "node_modules", ".venv", "Demo"}
SKIP_FILES = ["*.bak*", "*.pre_*", "*.log", "*.py", "capture_recipe.json",
              "RETURN_*.md", "README.md", "ASSETS.md", "*.p7c-backup*"]
MAX = 20 * 1024 * 1024


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
    for b in big:
        print("SKIPPED over 20 MB:", b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
