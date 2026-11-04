# Make sure every page with Amazon links loads the click tracker, and that guides with
# their own Amazon tracking ID use it.
#
#     python scripts/add-amazon-tracking.py
#
# Idempotent; rebuild-journal.py runs it after every publish.
#
# Per-guide tracking IDs live in docs/AMAZON-TRACKING-IDS.md as "slug: tag-21" lines.
# A guide listed there has tag=opeconltd-21 swapped for its own tag, so Associates
# Central's earnings report (Group by: Tracking Id) shows what each one earns.
# Guides not listed keep opeconltd-21.

import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / 'public'
IDS = ROOT / 'docs' / 'AMAZON-TRACKING-IDS.md'
DEFAULT_TAG = 'opeconltd-21'
SCRIPT = '<script src="/assets/amazon-track.js" defer></script>'


def tag_map():
    if not IDS.exists():
        return {}
    return dict(re.findall(r'^- ([a-z0-9-]+): ([a-z0-9-]+-21)\s*$', IDS.read_text(encoding='utf-8'), re.M))


def main():
    tags = tag_map()
    added = retagged = 0
    for page in PUB.rglob('*.html'):
        src = page.read_text(encoding='utf-8')
        if 'amazon.co.uk' not in src:
            continue
        new = src
        if 'amazon-track.js' not in new and '</body>' in new:
            new = new.replace('</body>', SCRIPT + '\n</body>', 1)
            added += 1
        slug = page.parent.name
        if page.parent.parent.name == 'journal' and slug in tags:
            swapped = re.sub(r'tag=[a-z0-9-]+-21', 'tag=' + tags[slug], new)
            if swapped != new:
                retagged += 1
                new = swapped
        if new != src:
            page.write_text(new, encoding='utf-8', newline='')
    print(f'amazon tracking: script added to {added} pages, {retagged} guides retagged')


if __name__ == '__main__':
    main()
