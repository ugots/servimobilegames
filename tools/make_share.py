"""Render share.png and share/<slug>.png (1200x630) with Playwright. Needs playwright; run by hand."""
import base64, json, os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MK = os.environ.get("MARKETING", r"C:\AI\local-llm-tools\Games\marketing")
BG = "background:linear-gradient(135deg,#12151f,#2a3148);"
g = json.load(open(os.path.join(ROOT, "games.json"), encoding="utf-8"))["games"]
def uri(p, mime):
    return "data:%s;base64,%s" % (mime, base64.b64encode(open(p, "rb").read()).decode())
icons = "".join('<img src="%s" style="width:120px;height:120px;border-radius:24px">' % uri(os.path.join(ROOT, x["slug"], "favicon.svg"), "image/svg+xml") for x in g)
hub = ('<body style="margin:0;width:1200px;height:630px;%sfont-family:Segoe UI,Arial,sans-serif;color:#e8ebf5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px">'
       '<div style="font-size:92px;font-weight:700;color:#8fa4ff">ServiMobileGames</div>'
       '<div style="font-size:40px;color:#9aa3b8">Free games for phone and desktop</div>'
       '<div style="display:flex;gap:18px;margin-top:20px">%s</div></body>') % (BG, icons)
os.makedirs(os.path.join(ROOT, "share"), exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.set_content(hub); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(ROOT, "share.png"))
    for x in g:
        f = os.path.join(MK, x["slug"], "feature", "feature.png")
        pg.set_content('<body style="margin:0;width:1200px;height:630px;%sdisplay:flex;align-items:center;justify-content:center"><img src="%s" style="max-width:1200px;max-height:630px"></body>' % (BG, uri(f, "image/png")))
        pg.wait_for_timeout(200); pg.screenshot(path=os.path.join(ROOT, "share", x["slug"] + ".png"))
    b.close()
