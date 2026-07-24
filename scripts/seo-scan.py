# Deterministic on-page SEO scan across all pages (mirrors Ahrefs on-page checks).
import re, pathlib, json
root = pathlib.Path('public')

def rl(s):
    return len(re.sub(r'&[a-z]+;', 'x', s))

issues = {k: [] for k in [
    'title_long','title_short','title_missing','title_multi',
    'desc_long','desc_short','desc_missing','desc_multi',
    'h1_missing','h1_multi','canonical_missing','alt_missing',
    'http_link','jsonld_bad']}

for f in sorted(root.rglob('index.html')):
    rel = str(f.relative_to(root)).replace(chr(92), '/')
    s = f.read_text(encoding='utf-8')

    titles = re.findall(r'<title>(.*?)</title>', s, re.S)
    if not titles:
        issues['title_missing'].append(rel)
    elif len(titles) > 1:
        issues['title_multi'].append(rel)
    else:
        L = rl(titles[0])
        if L > 60: issues['title_long'].append('%s (%d)' % (rel, L))
        elif L < 15: issues['title_short'].append('%s (%d)' % (rel, L))

    descs = re.findall(r'<meta name="description" content="(.*?)"', s, re.S)
    if not descs:
        issues['desc_missing'].append(rel)
    elif len(descs) > 1:
        issues['desc_multi'].append(rel)
    else:
        L = rl(descs[0])
        if L > 160: issues['desc_long'].append('%s (%d)' % (rel, L))
        elif L < 70: issues['desc_short'].append('%s (%d)' % (rel, L))

    h1s = re.findall(r'<h1[ >]', s)
    if len(h1s) == 0: issues['h1_missing'].append(rel)
    elif len(h1s) > 1: issues['h1_multi'].append(rel)

    if 'rel="canonical"' not in s:
        issues['canonical_missing'].append(rel)

    for img in re.findall(r'<img[^>]*>', s):
        if 'alt=' not in img:
            issues['alt_missing'].append('%s: %s' % (rel, img[:60]))

    for m in re.finditer(r'(?:src|href)="(http://[^"]+)"', s):
        issues['http_link'].append('%s: %s' % (rel, m.group(1)))

    for ld in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try:
            json.loads(ld)
        except Exception as e:
            issues['jsonld_bad'].append('%s: %s' % (rel, e))

total = 0
for k, v in issues.items():
    if v:
        total += len(v)
        print('## %s (%d)' % (k, len(v)))
        for x in v[:30]:
            print('   ', x)
print('---')
print('CLEAN' if total == 0 else 'TOTAL ISSUES: %d' % total)
