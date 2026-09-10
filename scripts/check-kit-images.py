"""Audit the product photos in the Field Kit guides.

Every `figure.prod-shot` image must load, and should be hotlinked from Amazon's own
CDN (m.media-amazon.com). The only sanctioned fallback is the manufacturer's own
domain, listed in docs/IMAGE-HOSTS-ALLOWED.txt. Images served from a retailer's site
(Screwfix, Toolstation, B&Q and the rest) are reported: they are somebody else's
bandwidth and licensed photography, and they get hotlink-blocked without warning.

  python scripts/check-kit-images.py              # audit every guide
  python scripts/check-kit-images.py <slug> ...   # audit named guides only
  python scripts/check-kit-images.py --no-net     # host rules only, no requests

Exit status is 1 if any image is broken or any NEW guide uses an unapproved host.
"""
from __future__ import annotations

import glob
import html
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNAL = os.path.join(ROOT, "public", "journal")
ALLOWED_FILE = os.path.join(ROOT, "docs", "IMAGE-HOSTS-ALLOWED.txt")

AMAZON_HOST = "m.media-amazon.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
HEADERS = {"User-Agent": UA,
           "Referer": "https://www.dominicbowkett.com/journal/",
           "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}

FIG = re.compile(
    r'<figure class="prod-shot"><img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*?>', re.S)


def allowed_hosts() -> set:
    if not os.path.exists(ALLOWED_FILE):
        return set()
    out = set()
    for line in open(ALLOWED_FILE, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(line.lower())
    return out


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url)
    return (m.group(1) if m else "").lower()


def collect(slugs=None):
    paths = sorted(glob.glob(os.path.join(JOURNAL, "best-*", "index.html")))
    if slugs:
        want = set(slugs)
        paths = [p for p in paths if os.path.basename(os.path.dirname(p)) in want]
        missing = want - {os.path.basename(os.path.dirname(p)) for p in paths}
        if missing:
            print("no such guide(s):", ", ".join(sorted(missing)))
            sys.exit(1)
    items = []
    for p in paths:
        slug = os.path.basename(os.path.dirname(p))
        s = open(p, encoding="utf-8").read()
        for src, alt in FIG.findall(s):
            items.append({"slug": slug, "url": html.unescape(src), "alt": html.unescape(alt)})
    return items


def fetch(url: str):
    try:
        r = requests.get(url, headers=HEADERS, timeout=25, stream=True, allow_redirects=True)
        ct = r.headers.get("content-type", "").split(";")[0]
        r.close()
        return r.status_code, ct
    except Exception as exc:
        return 0, type(exc).__name__


def main(argv) -> int:
    net = "--no-net" not in argv
    slugs = [a for a in argv if not a.startswith("--")]
    items = collect(slugs or None)
    if not items:
        print("no product images found")
        return 1
    allow = allowed_hosts()

    statuses = {}
    if net:
        urls = sorted({i["url"] for i in items})
        with ThreadPoolExecutor(max_workers=12) as ex:
            statuses = dict(zip(urls, ex.map(fetch, urls)))

    broken, offhost = [], []
    for it in items:
        h = host_of(it["url"])
        if h != AMAZON_HOST and h not in allow:
            offhost.append(it)
        if net:
            code, ct = statuses[it["url"]]
            if code != 200 or not ct.startswith("image/"):
                broken.append({**it, "code": code, "ct": ct})

    guides = len({i["slug"] for i in items})
    print(f"{len(items)} product images across {guides} guide(s); "
          f"{sum(1 for i in items if host_of(i['url']) == AMAZON_HOST)} on Amazon's CDN")

    if broken:
        print(f"\nBROKEN ({len(broken)}) — replace with a verified image or delete the figure:")
        for b in sorted(broken, key=lambda b: b["slug"]):
            print(f"  {b['code']:>4} {b['ct'][:20]:<20} {b['slug']}  {b['alt'][:44]}")
            print(f"       {b['url'][:140]}")

    if offhost:
        by_host = {}
        for i in offhost:
            by_host.setdefault(host_of(i["url"]), []).append(i)
        print(f"\nNOT ON AMAZON'S CDN ({len(offhost)} images, {len(by_host)} hosts, "
              f"{len({i['slug'] for i in offhost})} guides):")
        for h, group in sorted(by_host.items(), key=lambda kv: -len(kv[1])):
            print(f"  {len(group):3d}  {h}")
        print("  Approved manufacturer domains belong in docs/IMAGE-HOSTS-ALLOWED.txt;"
              "\n  a retailer's image should be replaced with an Amazon one or removed.")

    if not broken and not offhost:
        print("\nall product images load and are hosted by Amazon or an approved manufacturer")
    return 1 if (broken or offhost) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
