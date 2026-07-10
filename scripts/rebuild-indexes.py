# Rebuild journal index, kit index and sitemap from the guide pages on disk.
# Post numbers are assigned 001..NNN in date order (oldest first).
import re, html, pathlib

J = pathlib.Path('public/journal')

dates = {
 'listed-buildings-epc': ('10 May 2026', 20260510),
 'best-dehumidifiers': ('12 May 2026', 20260512),
 'best-carbon-monoxide-detectors': ('14 May 2026', 20260514),
 'best-damp-meters': ('16 May 2026', 20260516),
 'best-spirit-levels': ('19 May 2026', 20260519),
 'best-stud-finders': ('21 May 2026', 20260521),
 'best-thermal-imaging-cameras': ('23 May 2026', 20260523),
 'best-safety-boots': ('26 May 2026', 20260526),
 'best-tool-bags': ('28 May 2026', 20260528),
 'best-borescopes': ('30 May 2026', 20260530),
 'best-drain-rods': ('2 Jun 2026', 20260602),
 'best-hygrometers': ('4 Jun 2026', 20260604),
 'best-laser-measures': ('6 Jun 2026', 20260606),
 'best-scaffold-towers': ('9 Jun 2026', 20260609),
 'best-ear-defenders': ('11 Jun 2026', 20260611),
 'best-telescopic-ladders': ('13 Jun 2026', 20260613),
 'best-gas-leak-detectors': ('16 Jun 2026', 20260616),
 'best-voltage-testers': ('18 Jun 2026', 20260618),
 'best-sds-drills': ('20 Jun 2026', 20260620),
 'best-cable-detectors': ('23 Jun 2026', 20260623),
 'best-knee-pads': ('25 Jun 2026', 20260625),
 'best-head-torches': ('27 Jun 2026', 20260627),
 'best-work-lights': ('30 Jun 2026', 20260630),
 'best-manhole-keys': ('1 Jul 2026', 20260701),
 'best-binoculars-roof-inspections': ('2 Jul 2026', 20260702),
 'best-laser-levels': ('3 Jul 2026', 20260703),
 'best-radon-detectors': ('6 Jul 2026', 20260706),
 'best-anemometers': ('7 Jul 2026', 20260707),
 'best-crack-monitors': ('8 Jul 2026', 20260708),
 'best-tape-measures': ('9 Jul 2026', 20260709),
 'best-drones-roof-inspections': ('10 Jul 2026', 20260710),
 'best-air-quality-monitors': ('10 Jul 2026', 20260711),  # sorts after drones
}

on_disk = {p.name for p in J.iterdir() if p.is_dir()}
missing = set(dates) - on_disk
extra = on_disk - set(dates)
assert not missing, 'missing: %s' % missing
assert not extra, 'unmapped: %s' % extra

idx = pathlib.Path('public/journal/index.html').read_text(encoding='utf-8')
existing = {}
for m in re.finditer(r'<a class="post-row" href="([a-z-]+)/">.*?<h2>(.*?)</h2>\s*<p>(.*?)</p>', idx, re.S):
    existing[m.group(1)] = (m.group(2).strip(), m.group(3).strip())

def page_meta(slug):
    src = (J / slug / 'index.html').read_text(encoding='utf-8')
    t = re.search(r'<meta property="og:title" content="(.*?)"', src)
    d = re.search(r'<meta name="description" content="(.*?)"', src)
    title = html.escape(html.unescape(t.group(1)), quote=False) if t else slug
    desc = d.group(1).strip() if d else ''
    return title, desc

rows = []
for slug, (disp, key) in dates.items():
    title, desc = existing.get(slug) or page_meta(slug)
    rows.append((key, slug, disp, title, desc))
rows.sort(key=lambda r: r[0])
nums = {}
for i, r in enumerate(rows):
    nums[r[1]] = '%03d' % (i + 1)

ROW = ('      <a class="post-row" href="%s">\n'
       '        <span class="num">%s</span>\n'
       '        <span class="date">%s</span>\n'
       '        <span class="post-main">\n'
       '          <h2>%s</h2>\n'
       '          <p>%s</p>\n'
       '        </span>\n'
       '        <span class="arrow" aria-hidden="true">&rarr;</span>\n'
       '      </a>')

post_rows = [ROW % (slug + '/', nums[slug], disp, title, desc)
             for key, slug, disp, title, desc in reversed(rows)]
posts_html = '    <section class="posts" aria-label="Posts">\n' + '\n'.join(post_rows) + '\n    </section>'
idx = re.sub(r'    <section class="posts" aria-label="Posts">.*?</section>', lambda m: posts_html, idx, flags=re.S)

blog_ids = ',\n'.join('          { "@id": "https://www.dominicbowkett.com/journal/%s/#article" }' % slug
                      for key, slug, disp, title, desc in reversed(rows))
idx = re.sub(r'"blogPost": \[.*?\]', lambda m: '"blogPost": [\n' + blog_ids + '\n        ]', idx, flags=re.S)
pathlib.Path('public/journal/index.html').write_text(idx, encoding='utf-8')

cats = [
 ('Damp, air &amp; diagnostics', ['best-damp-meters','best-thermal-imaging-cameras','best-borescopes','best-dehumidifiers','best-hygrometers','best-air-quality-monitors','best-radon-detectors','best-gas-leak-detectors','best-carbon-monoxide-detectors']),
 ('Measurement &amp; detection', ['best-laser-measures','best-laser-levels','best-spirit-levels','best-tape-measures','best-anemometers','best-crack-monitors','best-stud-finders','best-cable-detectors','best-voltage-testers']),
 ('Access, light &amp; lofts', ['best-telescopic-ladders','best-scaffold-towers','best-sds-drills','best-head-torches','best-work-lights','best-drones-roof-inspections','best-binoculars-roof-inspections']),
 ('Drainage', ['best-drain-rods','best-manhole-keys']),
 ('Wear &amp; carry', ['best-safety-boots','best-ear-defenders','best-knee-pads','best-tool-bags']),
]
by_slug = {}
for key, slug, disp, title, desc in rows:
    by_slug[slug] = (disp, title, desc)
n_cat = sum(len(s) for c, s in cats)
assert n_cat == len(rows) - 1, 'kit categories out of sync: %d vs %d' % (n_cat, len(rows) - 1)

kit_rows = []
for cat, slugs in cats:
    kit_rows.append('\n      <h2 class="kit-cat">%s</h2>\n' % cat)
    for slug in slugs:
        disp, title, desc = by_slug[slug]
        kit_rows.append(ROW % ('../journal/' + slug + '/', nums[slug], disp, title, desc))
kit_html = '    <section class="posts" aria-label="Field kit guides">\n' + '\n'.join(kit_rows) + '\n\n    </section>'
kit = pathlib.Path('public/kit/index.html').read_text(encoding='utf-8')
kit = re.sub(r'    <section class="posts" aria-label="Field kit guides">.*?</section>', lambda m: kit_html, kit, flags=re.S)
kit = re.sub(r'<span>\d+ guides</span>', '<span>%d guides</span>' % (len(rows) - 1), kit)
pathlib.Path('public/kit/index.html').write_text(kit, encoding='utf-8')

sm = pathlib.Path('public/sitemap.xml').read_text(encoding='utf-8')
sm = re.sub(r'  <url>\n    <loc>https://www\.dominicbowkett\.com/journal/best-[a-z-]+/</loc>.*?</url>\n', '', sm, flags=re.S)
iso = {}
for key, slug, disp, title, desc in rows:
    iso[slug] = '%04d-%02d-%02d' % (key // 10000, key % 10000 // 100, key % 100)
iso['best-air-quality-monitors'] = '2026-07-10'
ENTRY = ('  <url>\n    <loc>https://www.dominicbowkett.com/journal/%s/</loc>\n'
         '    <lastmod>%s</lastmod>\n    <changefreq>monthly</changefreq>\n'
         '    <priority>0.7</priority>\n  </url>\n')
entries = ''.join(ENTRY % (slug, iso[slug]) for key, slug, disp, title, desc in rows if slug != 'listed-buildings-epc')
sm = sm.replace('</urlset>', entries + '</urlset>')
pathlib.Path('public/sitemap.xml').write_text(sm, encoding='utf-8')

print('journal rows:', len(rows), '| kit rows:', len(rows) - 1, '| 001 =', rows[0][1])
