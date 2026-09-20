"""Generate public/og.png (1200x630): the site's social card, in the site's parchment palette.
Run: python3 scripts/og-card.py   (downloads Source Serif 4 Bold + Frank Ruhl Libre once into scripts/.fonts-cache)"""
import os, urllib.request
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FONTS = os.path.join(HERE, ".fonts-cache"); os.makedirs(FONTS, exist_ok=True)
URLS = {
  "SourceSerif4-Bold.ttf": "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-Bold.ttf",
  "SourceSerif4-Regular.ttf": "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-Regular.ttf",
}
for n, u in URLS.items():
    p = os.path.join(FONTS, n)
    if not os.path.exists(p): urllib.request.urlretrieve(u, p)
PAPER, INK, INK2, ACCENT, GOLD, RULE = (243,234,215), (43,33,24), (102,86,63), (139,46,31), (169,129,47), (211,194,160)
W, H = 1200, 630
im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
bold = lambda s: ImageFont.truetype(os.path.join(FONTS, "SourceSerif4-Bold.ttf"), s)
reg = lambda s: ImageFont.truetype(os.path.join(FONTS, "SourceSerif4-Regular.ttf"), s)
# the six Orders as a thin bar, proportional to days (Zeraim 63, Moed 731, Nashim 605, Nezikin 682, Kodashim 558, Tahorot 72)
days = [63, 731, 605, 682, 558, 72]; ramp = [(185,137,58),(164,112,47),(140,88,40),(115,67,34),(91,49,28),(67,33,22)]
x, y0, bw = 90, 92, W - 180
for dcount, col in zip(days, ramp):
    w = bw * dcount / 2711
    d.rectangle([x, y0, x + w - 3, y0 + 14], fill=col); x += w
d.text((90, 130), "✦  TODAY'S DAF", font=reg(26), fill=GOLD)
d.text((90, 190), "The day's page of Talmud,", font=bold(76), fill=INK)
d.text((90, 280), "in English.", font=bold(76), fill=INK)
d.text((90, 400), "Where it sits in the whole Talmud, and a short note to get", font=reg(32), fill=INK2)
d.text((90, 442), "you thinking. Written by an AI, and it says so. Free.", font=reg(32), fill=INK2)
d.line([90, 530, W - 90, 530], fill=RULE, width=2)
d.text((90, 552), "daf-yomi.dev", font=bold(36), fill=ACCENT)
d.text((W - 90 - d.textlength("Daf Yomi · one page a day · 2,711 days", font=reg(28)), 558), "Daf Yomi · one page a day · 2,711 days", font=reg(28), fill=INK2)
out = os.path.join(ROOT, "public", "og.png"); im.save(out, optimize=True); print("wrote", out, im.size)
