# Cost guide spec — dominicbowkett.com "cost of X in 2026" posts

How to write one authoritative UK cost guide for the site of Dominic Bowkett, an
independent building surveyor, domestic energy assessor and PAS 2035 retrofit assessor
in Hartfield, East Sussex. UK English. Same design system and dry practitioner voice as
the rest of the site — read `public/journal/listed-buildings-epc/index.html` for register.

## What this post is

A genuinely useful, current-year answer to "how much does X cost?" — the kind of page a
homeowner, landlord or buyer lands on mid-decision. The edge over the price-comparison
sites that dominate these queries is Dom's professional judgement: not just the number,
but what drives it, where the quotes hide teeth, what's a fair price vs a rip-off, and —
crucially — whether the reader actually needs the work at all. A surveyor is the honest
broker here: he doesn't sell heat pumps or damp-proofing, so he can say when they're
oversold. Roughly 50% numbers, 50% judgement.

## Voice & integrity

First-person practitioner, plain, unhurried, quietly sceptical of the trades that
oversell. Dom does the diagnosis end, not the installation, so he comments on price and
necessity without a dog in the fight. He may give firm opinions ("most 'rising damp' I'm
called to is condensation, and no chemical DPC will fix it"). Never: exclamation marks,
emoji, hype, fake precision. No claim that Dom personally carried out installation work.

## Pricing — sourced, ranged, dated, honest

- Research live figures via web search. Good sources: Checkatrade cost guides, MyBuilder,
  HomeOwners Alliance, Which?, Federation of Master Builders, Energy Saving Trust,
  BOXT/Heatable (boilers/heat pumps), MCS data, government grant pages (gov.uk), Nimblefins,
  and any recent (2025-2026) trade surveys. Cross-check at least TWO sources per headline
  figure. Prefer 2026 figures; if only 2025 exists, say so.
- EVERY price is a RANGE ("typically £X–£Y"), never a single false-precise number. Give a
  representative worked example where it helps ("a 3-bed semi, air source, after grant").
- State the date the prices were checked, in the body and the small print. Note that
  prices move and quotes vary by region — Dom's patch (Kent/Sussex/Surrey/London) trends
  above national average; say so where relevant.
- Factor in current grants explicitly where they exist (e.g. Boiler Upgrade Scheme for
  heat pumps, ECO4/GBIS for insulation) with the grant value and eligibility in brief.
- NO invented figures. If a number can't be sourced, omit it or say it varies too widely
  to quote.

## Kit box — the only affiliate element (added 9 Sep 2026)

Cost guides are editorial authority pieces; the commercial payoff is still the service
cross-link and the phone/email CTA. The ONE affiliate element is a "Kit for this job"
`<aside class="kit-box">` placed immediately before the closing `<hr/>`. Copy the markup
from `public/journal/damp-proofing-cost/index.html` exactly (the `.kit-box` CSS shipped in
`site.css?v=20260909`; use that `?v=` or later in the page head).

- 3–5 items. Each item: `.kit-name` (exact product name), `.kit-why` (one short sentence in
  Dom's voice on why it earns its place for THIS job), and an `a.buy` button
  "Check price on Amazon".
- Prefer products that already have a Field Kit guide: use that guide's TOP PICK name and
  its Amazon search link verbatim, add `<a class="kit-guide" href="../best-<slug>/">Full
  guide</a>` and the guide's `.price-note` text inside `<span class="kit-price">`. Only where
  no guide exists, use a plain Amazon search link for a named product (no price, no guide
  link). `scripts/kit-boxes.py` shows the mapping used for the first 44 guides.
- Amazon links follow KIT-GUIDE-SPEC exactly: search URL with `tag=opeconltd-21`,
  `linkCode=ll2`, `linkId=82f351c719c3e9b898aac4324778e6cd`, `&amp;` in hrefs,
  `target="_blank" rel="sponsored nofollow noopener"`.
- One-sentence `.kit-intro` above the list, and the `.kit-disc` disclosure paragraph below it
  (Amazon Associates statement + "I haven't lab-tested these products myself"), both copied
  from the reference page and adapted.
- NO product images, NO affiliate links anywhere else in the body, NO testing/ownership
  claims. A relevant kit guide may still be linked inline where genuinely useful.

## Page structure

Slug: given per topic (e.g. `house-survey-cost`), file `public/journal/<slug>/index.html`.
Copy the head/header/footer skeleton from a recent non-kit post
(`public/journal/listed-buildings-epc/index.html`), keeping the current CSS `?v=` param
and the nav exactly as found (no Kit item). Asset paths from a post are `../../`.

- Title MAX 60 characters (Ahrefs flags >60), contains the primary keyword and "2026", ends "— Dominic Bowkett". Drop filler to stay within 60 (e.g. "How much does an X cost in 2026?" → "X cost in 2026 —" if needed).
  e.g. "How much does a house survey cost in 2026? — Dominic Bowkett".
- meta description ≤ 160 chars with the primary keyword and a headline price range.
- article:section "Costs". Canonical https://www.dominicbowkett.com/journal/<slug>/.
- Hero: H1 (may break lines), a 1-2 sentence lede that includes the headline range, and
  the meta row: Published DATE · Reading time · N min · By Dominic Bowkett · MRPSA.
- Breadcrumb: Home → Writing → [short topic].
- Body inside `<article class="prose"><div class="body">`:
  1. Intro (2-3 paras): the honest short answer with the headline range up top, then
     "but it depends on…".
  2. `<h2>The short answer</h2>` — a compact price summary. Use a `table.compare` in a
     `.compare-wrap` (these classes already exist) to lay out scenarios/tiers vs typical
     price. 2-4 rows, columns that suit the topic (e.g. Property type | Typical cost |
     What's included).
  3. `<h2>What drives the price</h2>` — the real cost factors, from a surveyor's view.
  4. `<h2>` topic-specific section(s) — e.g. "Do you actually need it?", grants, regional
     variation, the common overcharge. This is where the professional judgement lives.
  5. `<h2>What I'd watch for in a quote</h2>` — red flags, what a fair quote includes,
     questions to ask. A short list is good here.
  6. `<h2>Questions I get asked</h2>` — 3-4 FAQs targeting long-tail variants, one para each.
  7. `<aside class="kit-box">` "Kit for this job" — see the Kit box section above. Sits
     immediately before the `<hr/>`.
  8. `<hr/>` + closing paragraph linking the most relevant service page
     (`../../services/epc|retrofit|building-surveys|ventilation/`) and `../../contact/`,
     with the phone (07946 618203) mentioned. The natural CTA: an independent survey/
     assessment tells you which of these you actually need before you spend.
  9. Small-print para (same style as other posts): general-guidance disclaimer + "Prices
     were researched and correct to the best of my knowledge on DATE; costs move and vary
     by region and property. Always get at least three written quotes."
- 1,300–2,200 words. No images. No `<style>`/`<script>` beyond the footer year script.
- JSON-LD: BlogPosting + BreadcrumbList (copy pattern). Optionally add an FAQPage node
  built from the "Questions I get asked" Q&As (real questions/answers only). No Product/
  Offer/Review markup and no invented aggregate prices in schema.

## Publishing steps

1. Run `python scripts/rebuild-journal.py`. It picks the new post up from disk, files it
   under Costs, gives it the next `num` in the site-wide sequence, refreshes the Blog
   JSON-LD blogPost array, and rebuilds `/journal/` (newest three per category) plus the
   `/journal/costs/` archive. Do NOT hand-edit the row into `public/journal/index.html` —
   the front page only carries the three newest cost guides now, so a hand-added row will
   be dropped on the next rebuild. Do NOT touch `public/kit/index.html`.
2. Add the URL to `public/sitemap.xml` (lastmod = today, changefreq monthly, priority 0.7)
   and bump the lastmod on `/journal/` and `/journal/costs/` to today.
3. Tick the topic in `docs/COST-CALENDAR.md` (mark `[x]`, add slug + today's date).
4. Self-verify: every source link opened and read during research; two-source cross-check
   on headline figures; JSON-LD parses; internal links resolve; date consistent across
   title/meta/JSON-LD/hero/small print; kit box present with 3–5 items and the disclosure,
   every Amazon href carrying `tag=opeconltd-21` and `rel="sponsored nofollow noopener"`,
   every `../best-*/` link resolving to a file; no affiliate links outside the box; no images.
5. Commit "Add cost guide: <slug>" with the
   Co-Authored-By: Claude <noreply@anthropic.com> trailer, push to main; on failure retry
   once after `git pull --rebase origin main`.
