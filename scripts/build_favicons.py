"""
Build favicons for dominicbowkett.com.

Black square with a white 'DB' wordmark. Outputs:
  /favicon.ico               (multi-size: 16, 32, 48)
  /apple-touch-icon.png      (180x180)
  /assets/icon-192.png       (Android)
  /assets/icon-512.png       (Android, maskable-safe)

Run: python3 scripts/build_favicons.py
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INK = (0, 0, 0)
PAPER = (255, 255, 255)
SANS_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def render(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    # Tight letter sizing so DB fills the square at small sizes.
    font_px = int(size * 0.62)
    f = ImageFont.truetype(SANS_BOLD, font_px)
    text = "DB"
    # Centred via anchor="mm" — Pillow handles cap-height alignment.
    d.text((size / 2, size / 2 + size * 0.04), text,
           font=f, fill=PAPER, anchor="mm")
    return img


# 1) ICO (multi-resolution)
ico_sizes = [(16, 16), (32, 32), (48, 48)]
ico_master = render(48)
ico_path = ROOT / "favicon.ico"
ico_master.save(ico_path, format="ICO", sizes=ico_sizes)
print(f"wrote {ico_path}  ({ico_path.stat().st_size} bytes)")

# 2) Apple touch icon (iOS home screen, 180x180, no transparency)
apple_path = ROOT / "apple-touch-icon.png"
render(180).save(apple_path, "PNG", optimize=True)
print(f"wrote {apple_path}  ({apple_path.stat().st_size} bytes)")

# 3) Android / PWA icons
for px in (192, 512):
    p = ROOT / "assets" / f"icon-{px}.png"
    render(px).save(p, "PNG", optimize=True)
    print(f"wrote {p}  ({p.stat().st_size} bytes)")
