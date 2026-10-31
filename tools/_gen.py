import json
import os
g = [("anagram-game", "Anagram Ladder", "Calm word unscrambling, one more letter each level", "anagramladder"),
     ("castle-defense", "Castle Defense", "Hold the wall against waves of raiders", "castledefense"),
     ("coin-runner", "Coin Runner", "Dodge enemies and grab coins as it speeds up", "coinrunner"),
     ("number-game", "Number Fun", "Gentle counting play for little mathematicians", "numberfun"),
     ("shooter", "Asteroid Breaker", "Classic asteroid blasting in a 3D space", "asteroidbreaker"),
     ("word-game", "Letter Pot", "Build words from nine letters, no timer", "letterpot"),
     ("cipher-shift", "Cipher Shift", "Turn the brass rings and crack the word", "ciphershift")]
d = {"studio": "ServiMobileGames", "hub": "https://ugots.github.io/servimobilegames/",
     "playDeveloper": "https://play.google.com/store/apps/dev?id=PLACEHOLDER_DEV_ID", "games": []}
for s, t, tg, p in g:
    pk = "com.servimobilegames." + p
    d["games"].append({"slug": s, "title": t, "tagline": tg, "package": pk,
                       "play": "https://play.google.com/store/apps/details?id=" + pk,
                       "web": "https://ugots.github.io/servimobilegames/%s/" % s,
                       "icon": s + "/favicon.svg"})
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(root, "games.json"), "w") as f:
    json.dump(d, f, indent=2)
cards = ""
for x in d["games"]:
    cards += ('<div class="card"><img src="%s" alt="" width="64" height="64"><h2>%s</h2><p>%s</p>'
              '<div class="acts"><a class="btn" href="./%s/">Play in browser</a>'
              '<a class="gp" href="%s">Google Play</a></div></div>\n'
              % (x["icon"], x["title"], x["tagline"], x["slug"], x["play"]))
html = open(os.path.join(root, "tools", "_index_tpl.html")).read().replace("@@CARDS@@", cards)
with open(os.path.join(root, "index.html"), "w") as f:
    f.write(html)
