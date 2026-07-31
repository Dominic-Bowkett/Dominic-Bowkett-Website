# Rebuild the sectioned journal index and its per-category archive pages.
#
# Run from the repo root after adding a post directory under public/journal/:
#     python scripts/rebuild-journal.py
#
# Idempotent. The post directories on disk are the source of truth for which
# posts exist and when they were published (datePublished in each page's
# JSON-LD). Row titles, descriptions and numbers are carried over from whichever
# already-generated page holds them (front page, archive page or /kit/), so the
# curated wording survives every rebuild; anything new falls back to the post's
# own og:title / meta description and takes the next number in the sequence.
#
# Category comes from the slug:
#     news-*        -> Surveyor's notes  -> /journal/notes/
#     *-cost        -> Costs             -> /journal/costs/
#     best-*        -> Field kit         -> /kit/  (hand-curated, not written here)
#     anything else -> Selected writing  (kept in full on the front page)

import re, html, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
J = ROOT / 'public/journal'
IDX = J / 'index.html'
FRONT_N = 3

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

# Directories under public/journal/ that are archive listings, not posts.
NOT_POSTS = {'notes', 'costs'}

ROW_RE = re.compile(
    r'<a class="post-row" href="(?P<href>[^"]+)">\s*'
    r'<span class="num">(?P<num>[^<]*)</span>\s*'
    r'<span class="date">(?P<date>[^<]*)</span>\s*'
    r'<span class="post-main">\s*'
    r'<h2>(?P<title>.*?)</h2>\s*'
    r'<p>(?P<desc>.*?)</p>\s*'
    r'</span>\s*'
    r'<span class="arrow" aria-hidden="true">&rarr;</span>\s*'
    r'</a>', re.S)


def classify(slug):
    if slug.startswith('news-'):
        return 'notes'
    if slug.endswith('-cost'):
        return 'costs'
    if slug.startswith('best-'):
        return 'kit'
    return 'writing'


# Order matters — this is the order the sections appear on the front page.
# (key, heading, more-link href or None, archive label, blurb)
CATS = [
    ('writing', 'Selected writing', None, None,
     'Longer pieces, written when a question comes up often enough to be worth '
     'answering properly.'),
    ('notes', 'Surveyor&rsquo;s notes', 'notes/', 'Surveyor&rsquo;s notes',
     'Short daily notes on the EPC, landlord and surveying news that actually '
     'changes something &mdash; and what it means in practice.'),
    ('costs', 'Costs', 'costs/', 'Cost guides',
     'What things really cost in 2026, as ranges rather than false precision, '
     'with a surveyor&rsquo;s view on whether the work is worth doing.'),
    ('kit', 'Field kit', '../kit/', 'Field kit guides',
     'The tools I actually carry, and the ones not worth the money. Tested '
     'against survey work, not a spec sheet.'),
]

# ------------------------------------------------- carry over curated wording
curated = {}
for page in [IDX, J / 'notes/index.html', J / 'costs/index.html',
             ROOT / 'public/kit/index.html']:
    if not page.exists():
        continue
    for m in ROW_RE.finditer(page.read_text(encoding='utf-8')):
        slug = m.group('href').strip('/').split('/')[-1]
        curated.setdefault(slug, (m.group('num').strip(), m.group('title').strip(),
                                  m.group('desc').strip()))

# ------------------------------------------------------- read posts from disk
posts = []
for d in sorted(p for p in J.iterdir() if p.is_dir() and p.name not in NOT_POSTS):
    f = d / 'index.html'
    if not f.exists():
        continue
    src = f.read_text(encoding='utf-8')
    iso = re.search(r'"datePublished":\s*"(\d{4})-(\d{2})-(\d{2})', src)
    if not iso:
        sys.exit('no datePublished in %s' % f)
    y, mo, day = (int(x) for x in iso.groups())
    num, title, desc = curated.get(d.name, (None, None, None))
    if title is None:
        t = re.search(r'<meta property="og:title" content="(.*?)"', src)
        dsc = re.search(r'<meta name="description" content="(.*?)"', src)
        title = html.escape(html.unescape(t.group(1)), quote=False) if t else d.name
        desc = dsc.group(1).strip() if dsc else ''
    posts.append(dict(slug=d.name, key=y * 10000 + mo * 100 + day,
                      date='%d %s %d' % (day, MONTHS[mo - 1], y),
                      num=num, title=title, desc=desc, cat=classify(d.name)))

if not posts:
    sys.exit('no posts found under %s' % J)

# Number anything new: next in the site-wide sequence, oldest new post first.
used = {int(p['num']) for p in posts if p['num']}
nxt = max(used) + 1 if used else 1
for p in sorted((p for p in posts if not p['num']), key=lambda p: p['key']):
    p['num'] = '%03d' % nxt
    print('  new post %s -> num %s' % (p['slug'], p['num']))
    nxt += 1

# Display order: newest first, and within a day the higher number first.
posts.sort(key=lambda p: (p['key'], int(p['num'])), reverse=True)
buckets = {key: [p for p in posts if p['cat'] == key] for key, *_ in CATS}

ROW = ('      <a class="post-row" href="{href}">\n'
       '        <span class="num">{num}</span>\n'
       '        <span class="date">{date}</span>\n'
       '        <span class="post-main">\n'
       '          <h2>{title}</h2>\n'
       '          <p>{desc}</p>\n'
       '        </span>\n'
       '        <span class="arrow" aria-hidden="true">&rarr;</span>\n'
       '      </a>')


def render_rows(items, prefix=''):
    return '\n'.join(ROW.format(href=prefix + p['slug'] + '/', num=p['num'],
                                date=p['date'], title=p['title'], desc=p['desc'])
                     for p in items)


# ---------------------------------------------------------------- front page
src = IDX.read_text(encoding='utf-8')
blocks = []
for i, (key, heading, more_href, more_label, blurb) in enumerate(CATS):
    items = buckets[key]
    if not items:
        continue
    shown = items if more_href is None else items[:FRONT_N]
    head = ['      <div class="cat-head">',
            '        <h2 id="cat-%s">%s</h2>' % (key, heading)]
    if more_href:
        head.append('        <a class="cat-more" href="%s">All %d %s &rarr;</a>'
                    % (more_href, len(items), more_label.lower()))
    head.append('        <p class="cat-blurb">%s</p>' % blurb)
    head.append('      </div>')
    blocks.append('    <section class="posts%s" aria-labelledby="cat-%s">\n%s\n%s\n    </section>'
                  % (' first' if i == 0 else '', key, '\n'.join(head), render_rows(shown)))

new_posts = '\n\n'.join(blocks)
out, n = re.subn(
    r'    <section class="posts[^"]*"[^>]*>.*?</section>'
    r'(?:\s*<section class="posts[^"]*"[^>]*>.*?</section>)*',
    lambda m: new_posts, src, count=1, flags=re.S)
if not n:
    sys.exit('front-page posts section not found — check the markup')

# The Blog JSON-LD still lists every post, front page or not.
blog_ids = ',\n'.join(
    '          { "@id": "https://www.dominicbowkett.com/journal/%s/#article" }' % p['slug']
    for p in posts)
out = re.sub(r'"blogPost": \[.*?\]', lambda m: '"blogPost": [\n' + blog_ids + '\n        ]',
             out, flags=re.S)
IDX.write_text(out, encoding='utf-8')

# ------------------------------------------------------------- archive pages
head_m = re.search(r'(<a class="sr".*?</header>)', src, re.S)
foot_m = re.search(r'(  <footer class="foot".*?</html>\s*)$', src, re.S)
if not (head_m and foot_m):
    sys.exit('could not lift the header/footer skeleton from the journal index')
css_v = re.search(r'site\.css\?v=(\d+)', src).group(1)
HEADER = head_m.group(1).replace('"../', '"../../')
FOOTER = foot_m.group(1).replace('"../', '"../../')

PAGE = '''<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{title} — Dominic Bowkett · Building Surveyor</title>
  <meta name="description" content="{desc}" />
  <meta name="theme-color" content="#0c0c0c" />
  <meta name="author" content="Dominic Bowkett" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <link rel="canonical" href="https://www.dominicbowkett.com/journal/{dir}/" />

  <link rel="icon" href="../../favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="../../apple-touch-icon.png" />
  <link rel="manifest" href="../../site.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../../assets/site.css?v={css_v}" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Dominic Bowkett — Independent Practice" />
  <meta property="og:title" content="{title} — Dominic Bowkett" />
  <meta property="og:description" content="{desc}" />
  <meta property="og:url" content="https://www.dominicbowkett.com/journal/{dir}/" />
  <meta property="og:locale" content="en_GB" />
  <meta property="og:image" content="https://www.dominicbowkett.com/assets/og.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Dominic Bowkett — Plan it well. Build it once." />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title} — Dominic Bowkett" />
  <meta name="twitter:description" content="{desc}" />
  <meta name="twitter:image" content="https://www.dominicbowkett.com/assets/og.png" />

  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@graph": [
      {{
        "@type": "CollectionPage",
        "@id": "https://www.dominicbowkett.com/journal/{dir}/#page",
        "url": "https://www.dominicbowkett.com/journal/{dir}/",
        "name": "{title} — Dominic Bowkett",
        "description": "{desc}",
        "inLanguage": "en-GB",
        "isPartOf": {{ "@id": "https://www.dominicbowkett.com/journal/#blog" }},
        "publisher": {{ "@id": "https://www.dominicbowkett.com/#business" }},
        "mainEntity": {{
          "@type": "ItemList",
          "numberOfItems": {count},
          "itemListElement": [
{items}
          ]
        }}
      }},
      {{
        "@type": "BreadcrumbList",
        "itemListElement": [
          {{ "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.dominicbowkett.com/" }},
          {{ "@type": "ListItem", "position": 2, "name": "Writing", "item": "https://www.dominicbowkett.com/journal/" }},
          {{ "@type": "ListItem", "position": 3, "name": "{title}", "item": "https://www.dominicbowkett.com/journal/{dir}/" }}
        ]
      }}
    ]
  }}
  </script>
</head>
<body>
{header}

  <main id="main">

    <section class="page-hero">
      <div class="inner">
        <nav class="crumbs" aria-label="Breadcrumb">
        <a href="../../">Home</a>
        <span aria-hidden="true">&rarr;</span>
        <a href="../">Writing</a>
        <span aria-hidden="true">&rarr;</span>
        <span>{crumb}</span>
      </nav>
        <div>
          <h1>{h1}</h1>
          <p class="lede">{lede}</p>
        </div>
      </div>
    </section>

    <section class="posts first" aria-label="{plain}">
{rows}
    </section>

    <section class="std">
      <div class="section-grid">
        <div class="section-label">Writing</div>
        <div class="section-content">
          <p><a href="../">&larr; All writing</a></p>
        </div>
      </div>
    </section>

  </main>

{footer}
'''

ARCHIVES = [
    dict(key='notes', dir='notes', title="Surveyor's notes", plain="Surveyor's notes",
         crumb='Surveyor&rsquo;s notes', h1='Surveyor&rsquo;s notes.',
         lede='A short note most days on the EPC, landlord and surveying news that actually '
              'changes something &mdash; and what it means for the people it lands on.',
         desc="Daily notes from independent practice on EPC, landlord and surveying news, and "
              "what each change means in practice."),
    dict(key='costs', dir='costs', title='Cost guides', plain='Cost guides',
         crumb='Costs', h1='Costs.',
         lede='What the work really costs in 2026 &mdash; given as ranges rather than false '
              'precision, with a surveyor&rsquo;s view on whether it is worth doing at all.',
         desc="What building, energy and retrofit work really costs in 2026 — honest ranges and "
              "a surveyor's view on whether it is worth doing."),
]


def json_name(s):
    return html.unescape(s).replace('\\', '\\\\').replace('"', '\\"')


for a in ARCHIVES:
    items = buckets[a['key']]
    listel = ',\n'.join(
        '            {{ "@type": "ListItem", "position": {i}, "url": "https://www.dominicbowkett.com/journal/{slug}/", "name": "{name}" }}'.format(
            i=i + 1, slug=p['slug'], name=json_name(p['title']))
        for i, p in enumerate(items))
    page = PAGE.format(css_v=css_v, count=len(items), items=listel,
                       rows=render_rows(items, prefix='../'),
                       header=HEADER, footer=FOOTER, **a)
    d = J / a['dir']
    d.mkdir(parents=True, exist_ok=True)
    (d / 'index.html').write_text(page, encoding='utf-8')

print('front page: ' + ', '.join(
    '%s %d/%d' % (k, min(len(buckets[k]), FRONT_N) if h else len(buckets[k]), len(buckets[k]))
    for k, _, h, _, _ in CATS))
for a in ARCHIVES:
    print('archive /journal/%s/: %d posts' % (a['dir'], len(buckets[a['key']])))
