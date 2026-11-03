# Build the 1200x630 social cards (Open Graph / X) and point each page at its own.
#
#     python scripts/build-cards.py            # cards for pages that don't have one yet
#     python scripts/build-cards.py --all      # rebuild every card (after a design change)
#     python scripts/build-cards.py <slug> ... # just these journal posts
#
# The site default (public/assets/og-default.png) is used by every page that isn't a
# journal post. Each post gets public/assets/og/<slug>.png showing its own title, and
# its og:image / twitter:image tags are rewritten to match. Cards are drawn as HTML in
# the site's own type (Inter + JetBrains Mono from Google Fonts) and screenshotted with
# headless Chrome, so they always match the site. Run after rebuild-journal.py.

import html, pathlib, re, subprocess, sys, tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / 'public'
J = PUB / 'journal'
OG = PUB / 'assets' / 'og'
DEFAULT = PUB / 'assets' / 'og-default.png'
SITE = 'https://www.dominicbowkett.com'
NOT_POSTS = {'notes', 'costs'}
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=block');
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { background: #fafaf8; color: #0c0c0c; font-family: Inter, sans-serif;
       padding: 64px 72px 60px; display: flex; flex-direction: column; }
.mono { font-family: 'JetBrains Mono', monospace; font-size: 17px; letter-spacing: .08em;
        text-transform: uppercase; }
.top { display: flex; justify-content: space-between; padding-bottom: 18px;
       border-bottom: 1px solid #0c0c0c; }
.top .r { color: #7a7873; }
.main { flex: 1; display: flex; flex-direction: column; justify-content: center; }
h1 { text-wrap: balance; font-weight: 300; letter-spacing: -0.03em; line-height: 1.06; max-width: 1020px; }
.tag { margin-top: 26px; display: inline-flex; gap: 10px; align-items: center; color: #0c0c0c; }
.tag i { width: 0; height: 0; border-left: 12px solid #0c0c0c; border-top: 7px solid transparent;
         border-bottom: 7px solid transparent; }
.foot { display: flex; justify-content: space-between; align-items: flex-end;
        padding-top: 20px; border-top: 1px solid #0c0c0c; }
.name { font-size: 30px; font-weight: 500; letter-spacing: -0.01em; }
.role { margin-top: 6px; font-size: 19px; color: #7a7873; }
.url { font-family: 'JetBrains Mono', monospace; font-size: 20px; }
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="top mono"><span>{left}</span><span class="r">{right}</span></div>
<div class="main"><h1 style="font-size:{size}px">{title}</h1>{tag}</div>
<div class="foot"><div><div class="name">Dominic Bowkett</div>
<div class="role">Building surveyor &middot; Energy and retrofit assessor &middot; Hartfield, East Sussex</div></div>
<div class="url">dominicbowkett.com</div></div>
</body></html>"""


def category(slug):
    if slug.startswith('news-'):
        return "Surveyor's notes"
    if slug.endswith('-cost'):
        return 'Cost guide'
    if slug.startswith('best-') or slug.endswith('-kit'):
        return 'Field kit'
    return 'Journal'


def size_for(title):
    n = len(title)
    return 84 if n <= 40 else 72 if n <= 62 else 62 if n <= 90 else 54 if n <= 120 else 46


def render(out, title, left, right, tag=''):
    title = title.replace("'", '’')
    doc = PAGE.format(css=CSS, left=html.escape(left), right=html.escape(right),
                      size=size_for(title), title=html.escape(title, quote=False),
                      tag=f'<div class="tag mono"><i></i>{html.escape(tag)}</div>' if tag else '')
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / 'card.html'
        src.write_text(doc, encoding='utf-8')
        shot = pathlib.Path(tmp) / 'shot.png'
        # Headless Chrome counts ~100px of window frame in --window-size, so shoot tall and crop.
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        f'--user-data-dir={tmp}\\prof', '--window-size=1200,800',
                        '--virtual-time-budget=8000', f'--screenshot={shot}', src.as_uri()],
                       check=True, capture_output=True)
        Image.open(shot).convert('RGB').crop((0, 0, 1200, 630)).save(out, optimize=True)


def meta(src, prop):
    m = re.search(rf'<meta (?:property|name)="{prop}" content="(.*?)"', src)
    return html.unescape(m.group(1)) if m else ''


def set_image(path, url, alt):
    src = path.read_text(encoding='utf-8')
    alt = html.escape(alt, quote=True)
    new = re.sub(r'(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")',
                 rf'\g<1>{url}\g<2>', src)
    new = re.sub(r'(<meta (?:property="og:image:alt"|name="twitter:image:alt") content=")[^"]*(")',
                 lambda m: m.group(1) + alt + m.group(2), new)
    if new != src:
        path.write_text(new, encoding='utf-8')


def post_title(src):
    t = meta(src, 'og:title')
    return re.sub(r'\s+[—-]\s+Dominic Bowkett$', '', t)


def build_post(d, force):
    page = d / 'index.html'
    src = page.read_text(encoding='utf-8')
    title = post_title(src)
    if not title:
        return False
    out = OG / f'{d.name}.png'
    if force or not out.exists():
        m = re.search(r'"datePublished":\s*"(\d{4})-(\d{2})', src)
        right = f"{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][int(m.group(2)) - 1]} {m.group(1)}" if m else ''
        render(out, title, category(d.name), right, 'With video' if meta(src, 'og:video') else '')
    set_image(page, f'{SITE}/assets/og/{d.name}.png', title)
    return True


def main(args):
    force = '--all' in args
    slugs = [a for a in args if not a.startswith('--')]
    OG.mkdir(parents=True, exist_ok=True)
    if force or not DEFAULT.exists():
        render(DEFAULT, 'Independent building surveyor for London and the South East.',
               'Independent practice', 'Surveys · EPCs · Retrofit')
        # Old shares and anything still pointing at og.png get the new design too.
        (PUB / 'assets' / 'og.png').write_bytes(DEFAULT.read_bytes())
    dirs = [J / s for s in slugs] if slugs else sorted(
        p for p in J.iterdir() if p.is_dir() and p.name not in NOT_POSTS and (p / 'index.html').exists())
    done = sum(build_post(d, force) for d in dirs)
    # Everything else (home, services, archives, kit hub...) uses the default card.
    old = f'{SITE}/assets/og.png'
    for page in PUB.rglob('*.html'):
        src = page.read_text(encoding='utf-8')
        if old in src:
            page.write_text(src.replace(old, f'{SITE}/assets/og-default.png').replace(
                'Dominic Bowkett — Plan it well. Build it once.',
                'Dominic Bowkett, independent building surveyor for London and the South East').replace(
                'Dominic Bowkett &mdash; Plan it well. Build it once.',
                'Dominic Bowkett, independent building surveyor for London and the South East'), encoding='utf-8')
    print(f'{done} post cards; default card {DEFAULT.relative_to(ROOT)}')


if __name__ == '__main__':
    main(sys.argv[1:])
