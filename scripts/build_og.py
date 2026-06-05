"""
Build the 1200x630 Open Graph / Twitter card for dominicbowkett.com.

Pure black-and-white, brutalist, matches the site's design system.
Run:  python3 scripts/build_og.py
Output: assets/og.png
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 1200, 630
PAD = 72
INK = (0, 0, 0)
PAPER = (255, 255, 255)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "og.png"

SANS_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
SANS_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

f_hero = ImageFont.truetype(SANS_BOLD, 108)
f_name = ImageFont.truetype(SANS_BOLD, 38)
f_role = ImageFont.truetype(SANS_REG, 22)
f_url = ImageFont.truetype(SANS_BOLD, 26)
f_mono_sm = ImageFont.truetype(MONO, 16)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

# Top rule + locator
d.rectangle([(PAD, PAD), (W - PAD, PAD + 3)], fill=INK)
d.text((PAD, PAD + 16), "§ DB  ·  TUNBRIDGE WELLS  ·  KENT  ·  UK",
       font=f_mono_sm, fill=INK)
d.text((W - PAD, PAD + 16), "EST. 2018",
       font=f_mono_sm, fill=INK, anchor="ra")

# Hero
hero_y = 175
line_gap = 118
d.text((PAD, hero_y), "PLAN IT WELL.", font=f_hero, fill=INK)
d.text((PAD, hero_y + line_gap), "BUILD IT ONCE.", font=f_hero, fill=INK)

# Mid rule
mid_y = 450
d.rectangle([(PAD, mid_y), (W - PAD, mid_y + 1.5)], fill=INK)

# Bottom block: name + role on the left, URL on the right
bot_y = mid_y + 28
d.text((PAD, bot_y), "Dominic Bowkett", font=f_name, fill=INK)
d.text((PAD, bot_y + 52),
       "Building Surveyor  ·  Energy Assessor  ·  Retrofit Assessor",
       font=f_role, fill=INK)
d.text((W - PAD, bot_y + 8), "dominicbowkett.com",
       font=f_url, fill=INK, anchor="ra")

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT}  ({OUT.stat().st_size} bytes)")
