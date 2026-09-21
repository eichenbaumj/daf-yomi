"""Generate the site's social cards (1200x630) in the parchment palette.
Run: python3 scripts/og-card.py            -> public/og.png    (English)
     python3 scripts/og-card.py --lang he  -> public/og-he.png (Hebrew)
Downloads Source Serif 4 and Frank Ruhl Libre once into scripts/.fonts-cache. Pillow here has no raqm, so
Hebrew lines (letters and punctuation only, no digits) are reversed by hand and right-aligned."""
import os, sys, urllib.request
from PIL import Image, ImageDraw, ImageFont, features
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FONTS = os.path.join(HERE, ".fonts-cache"); os.makedirs(FONTS, exist_ok=True)
URLS = {
  "SourceSerif4-Bold.ttf": "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-Bold.ttf",
  "SourceSerif4-Regular.ttf": "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-Regular.ttf",
  "FrankRuhlLibre.ttf": "https://github.com/google/fonts/raw/main/ofl/frankruhllibre/FrankRuhlLibre%5Bwght%5D.ttf",
}
for n, u in URLS.items():
    p = os.path.join(FONTS, n)
    if not os.path.exists(p): urllib.request.urlretrieve(u, p)
PAPER, INK, INK2, ACCENT, GOLD, RULE = (243,234,215), (43,33,24), (102,86,63), (139,46,31), (169,129,47), (211,194,160)
W, H = 1200, 630
LANG = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else "en"
im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
bold = lambda s: ImageFont.truetype(os.path.join(FONTS, "SourceSerif4-Bold.ttf"), s)
reg = lambda s: ImageFont.truetype(os.path.join(FONTS, "SourceSerif4-Regular.ttf"), s)
def heb(size, weight):
    f = ImageFont.truetype(os.path.join(FONTS, "FrankRuhlLibre.ttf"), size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f
RAQM = features.check("raqm")
def rtl(text, y, font, fill, right=W - 90):
    """Draw a Hebrew line ending at `right`. With raqm the layout engine shapes it; without, reverse by hand."""
    if RAQM:
        d.text((right, y), text, font=font, fill=fill, anchor="ra", direction="rtl")
    else:
        assert not any(ch.isdigit() for ch in text), "hand-reversed lines must not contain digits"
        s = text[::-1]
        d.text((right - d.textlength(s, font=font), y), s, font=font, fill=fill)
# the six Orders as a thin bar, proportional to days (Zeraim 63, Moed 731, Nashim 605, Nezikin 682, Kodashim 558, Tahorot 72)
days = [63, 731, 605, 682, 558, 72]; ramp = [(185,137,58),(164,112,47),(140,88,40),(115,67,34),(91,49,28),(67,33,22)]
x, y0, bw = 90, 92, W - 180
for dcount, col in zip(days, ramp):
    w = bw * dcount / 2711
    d.rectangle([x, y0, x + w - 3, y0 + 14], fill=col); x += w
if LANG == "he":
    d.polygon([(W - 101, 133), (W - 92, 145), (W - 101, 157), (W - 110, 145)], fill=GOLD)
    rtl("הדף היומי", 124, heb(30, 400), GOLD, right=W - 124)
    rtl("הדף של היום, עם ביאור שטיינזלץ,", 190, heb(72, 700), INK)
    rtl("בעברית.", 280, heb(72, 700), INK)
    rtl("איפה הוא נמצא בש״ס, והערה קצרה לעורר מחשבה.", 400, heb(34, 400), INK2)
    rtl("נכתבה על ידי בינה מלאכותית, וכך גם נאמר. חינם.", 446, heb(34, 400), INK2)
    d.line([90, 530, W - 90, 530], fill=RULE, width=2)
    rtl("daf-yomi.dev"[::-1] if not RAQM else "daf-yomi.dev", 552, bold(36), ACCENT)  # Latin, right-aligned: reverse back
    rtl("דף יומי · דף אחד ביום", 556, heb(30, 400), INK2, right=90 + d.textlength("דף יומי · דף אחד ביום"[::-1], font=heb(30, 400)))
    out = os.path.join(ROOT, "public", "og-he.png")
else:
    d.polygon([(101, 133), (110, 145), (101, 157), (92, 145)], fill=GOLD)  # a small diamond; the font has no ✦
    d.text((124, 130), "TODAY'S DAF", font=reg(26), fill=GOLD)
    d.text((90, 190), "The day's page of Talmud,", font=bold(76), fill=INK)
    d.text((90, 280), "in English.", font=bold(76), fill=INK)
    d.text((90, 400), "Where it sits in the whole Talmud, and a short note to get", font=reg(32), fill=INK2)
    d.text((90, 442), "you thinking. Written by an AI, and it says so. Free.", font=reg(32), fill=INK2)
    d.line([90, 530, W - 90, 530], fill=RULE, width=2)
    d.text((90, 552), "daf-yomi.dev", font=bold(36), fill=ACCENT)
    d.text((W - 90 - d.textlength("Daf Yomi · one page a day · 2,711 days", font=reg(28)), 558), "Daf Yomi · one page a day · 2,711 days", font=reg(28), fill=INK2)
    out = os.path.join(ROOT, "public", "og.png")
im.save(out, optimize=True); print("wrote", out, im.size)
