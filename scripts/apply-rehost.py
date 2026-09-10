"""Apply the confident image swaps proposed by scripts/rehost-kit-images.js.

  python scripts/apply-rehost.py proposals.json            # dry run: show what would change
  python scripts/apply-rehost.py proposals.json --apply    # edit the guides

Only entries marked "matched" are touched, and only after the replacement URL is
confirmed to return 200 with an image content type. Everything else is listed for a
human to resolve — usually by finding the manufacturer's own image (and adding the
host to docs/IMAGE-HOSTS-ALLOWED.txt) or deleting the figure.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNAL = os.path.join(ROOT, "public", "journal")
HEADERS = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
           "Referer": "https://www.dominicbowkett.com/journal/",
           "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}


def loads_ok(url: str) -> bool:
    try:
        r = requests.get(url, headers=HEADERS, timeout=25, stream=True, allow_redirects=True)
        ok = r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
        r.close()
        return ok
    except Exception:
        return False


def main(argv) -> int:
    if not argv:
        print(__doc__)
        return 1
    props = json.load(open(argv[0], encoding="utf-8"))
    apply = "--apply" in argv

    matched = [p for p in props if p.get("matched") and p.get("newUrl")]
    unmatched = [p for p in props if not (p.get("matched") and p.get("newUrl"))]

    urls = sorted({p["newUrl"] for p in matched})
    with ThreadPoolExecutor(max_workers=12) as ex:
        good = dict(zip(urls, ex.map(loads_ok, urls)))
    live = [p for p in matched if good[p["newUrl"]]]
    dead = [p for p in matched if not good[p["newUrl"]]]

    print(f"proposals: {len(props)} | confident: {len(matched)} | replacement loads: {len(live)}")
    if dead:
        print(f"  {len(dead)} confident match(es) whose Amazon image did not load - skipped")

    changed = {}
    for p in live:
        path = os.path.join(JOURNAL, p["slug"], "index.html")
        s = changed.get(path) or open(path, encoding="utf-8").read()
        esc = html.escape(p["url"], quote=True).replace("&amp;amp;", "&amp;")
        hit = None
        for cand in (p["url"], esc, p["url"].replace("&", "&amp;")):
            if cand in s:
                hit = cand
                break
        if hit is None:
            print(f"  ! {p['slug']}: source URL no longer present, skipped")
            continue
        s = s.replace(hit, p["newUrl"], 1)
        changed[path] = s

    print(f"\n{len(live)} image(s) in {len(changed)} guide(s) "
          f"{'REPLACED' if apply else 'would be replaced'}:")
    for p in live:
        print(f"  {p['slug']:<32} {p['name'][:44]}")
        print(f"      was {p['host']}  ->  {p['newUrl'].rsplit('/', 1)[-1]}   [{p['why']}]")

    if apply:
        for path, s in changed.items():
            open(path, "w", encoding="utf-8", newline="\n").write(s)
        print(f"\nwrote {len(changed)} file(s)")
    else:
        print("\n(dry run - pass --apply to write)")

    if unmatched:
        print(f"\nNOT MATCHED ({len(unmatched)}) - resolve by hand: manufacturer image "
              f"(+ allowlist) or delete the figure")
        by_slug = {}
        for p in unmatched:
            by_slug.setdefault(p["slug"], []).append(p)
        for slug, group in sorted(by_slug.items()):
            print(f"  {slug}")
            for p in group:
                print(f"      {p['name'][:56]:<56} {p['host']}")
                print(f"          amazon said: {(p.get('amazonTitle') or '-')[:80]}  [{p['why']}]")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
