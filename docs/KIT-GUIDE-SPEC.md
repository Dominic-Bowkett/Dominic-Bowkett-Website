# Field Kit guide spec — dominicbowkett.com affiliate review posts (v2)

How to write one complete, self-contained product-guide HTML page for the website of
Dominic Bowkett, an independent building surveyor, domestic energy assessor and retrofit
assessor in Hartfield, East Sussex ("Dominic Bowkett — Independent Practice", EMS-2 Ltd).
Static site, typography-led, near-monochrome. UK English only.

## Output location
`public/journal/<SLUG>/index.html` — one file, nothing else (unless you are also doing
the publish steps in "Publishing" below).

## Voice — this matters most
First-person practitioner: Dom is a working surveyor who lives in lofts, crawl spaces
and Victorian terraces. Plain English, dry, unhurried, zero hype. "Field notes", not
listicle. Reference the realities of survey work: RdSAP, damp diagnosis, cavity checks,
MEES, PAS 2035, loft hatches, suspended timber floors, the van. Never use: "game-changer",
"must-have", "in today's fast-paced world", exclamation marks, emoji, stars/ratings.

**CRITICAL — no personal-testing claims.** Dom has NOT tested these products. Never claim
or imply he owns, carries, uses or has tested any reviewed product ("the one I carry",
"mine has", "I've used it for years" are all banned). What IS allowed and encouraged:
- job context ("half the surveys I do start with someone pointing at a stain")
- opinion on what features matter ("what I look for in a damp meter")
- verdicts ("the one I'd buy", "best on a budget").
Assessments are sourced from manufacturers' specifications and published user feedback,
phrased that way where a claim needs grounding ("owner feedback is consistent that…").

## Research
Identify 6–8 real, currently-available products on amazon.co.uk (mix of professional and
value picks, UK models, GBP prices). Verify model names are current. Prices always as
ranges/approximations ("typically £X–£Y"), never exact. Pick ONE winner, one budget pick,
one premium/professional pick.

## Affiliate links — exact format, no deviation
Amazon SEARCH links for the exact model name (never ASIN product links — search never 404s):

https://www.amazon.co.uk/s?k=MODEL+NAME+HERE&linkCode=ll2&tag=opeconltd-21&linkId=82f351c719c3e9b898aac4324778e6cd&ref_=as_li_ss_tl

- `&` MUST be written as `&amp;` inside href attributes (raw `&` only inside JSON-LD).
- Every affiliate anchor: `target="_blank" rel="sponsored nofollow noopener"`.
- Buy buttons: `class="buy"`, text `Check price on Amazon`. Table links: plain anchor, text `View`.
- `tag=opeconltd-21` in every Amazon link. No other retailers.

## Product photos — mandatory for every product block
Hotlink from Amazon's CDN. Insert immediately after the `.flag` line (top-pick) or the
`.pick-head` div (picks):

```html
<figure class="prod-shot"><img src="https://m.media-amazon.com/images/I/XXXX._AC_SL500_.jpg" alt="Brand Model Name" loading="lazy" /></figure>
```

Find the image id on the product's amazon.co.uk listing (amazon.com works too — shared CDN).
Prefer the `._AC_SL500_` size variant. VERIFY every URL returns 200 + Content-Type image/*
(PowerShell: `Invoke-WebRequest -Uri <url> -Method Head -UseBasicParsing`). Visually confirm
it shows the correct brand and model. Fallback: manufacturer's official image URL (verified).
If neither verifies, omit the figure rather than ship a broken/wrong image.

## Page structure
Copy the head/header/footer skeleton from any existing guide (e.g.
`public/journal/best-damp-meters/index.html`), adjusting title/meta/OG/canonical/JSON-LD.
Asset paths from a post are `../../` (use the CSS href exactly as in the copied page,
including its `?v=` parameter). The header nav and footer Site list include the Kit item
(`../../kit/`). Do not add any `<style>` or `<script>` beyond the footer year script.

Body, inside `<article class="prose"><div class="body">`:

1. `.affil-note` div at the top — affiliate disclosure. Must contain BOTH:
   - "As an Amazon Associate I earn from qualifying purchases." (+ reader-supported framing,
     commission at no extra cost, nobody pays for placement)
   - the transparency sentence: "I haven't lab-tested these units myself &mdash; this is a
     features overview drawn from manufacturers&rsquo; specifications and published user
     feedback, filtered through what actually matters on a survey."
2. Intro (2–3 paragraphs): why the tool earns its place in survey work.
3. `.top-pick` block: `<p class="flag">The one I&rsquo;d buy</p>`, photo figure, `<h3>` model,
   2–3 sentences, `.price-note`, buy button.
4. `<h2>` "How I judge a [category]" — 3–5 criteria grounded in the job.
5. `<h2>` "The comparison" — `.compare-wrap > table.compare` of ALL products; 2–3 spec
   columns that matter + Typical price + Best for + View link.
6. `<h2>` "The picks in detail" — one `.pick` per product, ranked, top pick repeated as 01:
   `.pick-head` (rank span + h3), photo figure, `.use-case` label, 2–4 sentences,
   `.pros-cons` (For/Against uls), `.price-note`, buy button.
7. `<h2>` buying-advice section ("What actually matters — and what doesn't") including
   what salesmen push that doesn't matter.
8. `<h2>` "Questions I get asked" — 3–4 FAQs, one paragraph each, targeting long-tails.
9. `<hr/>` + closing paragraph cross-linking a relevant service page
   (`../../services/epc|retrofit|building-surveys|ventilation/`), `../../contact/`, and
   `../../kit/` ("More field-kit guides"). Related kit guides may be cross-linked inline
   (`../best-<slug>/`).
10. Small print: general disclaimer + "Prices are indicative, move constantly and are
    checked at the time of writing; the linked page always shows the current price. As an
    Amazon Associate I earn from qualifying purchases." Style it like the existing guides.

## JSON-LD
BlogPosting + BreadcrumbList (copy pattern) + ItemList of ranked products (position, name,
url = affiliate link). NEVER Review/Product markup with ratings.

## Meta
- title ≤65 chars, natural, contains primary keyword, ends "— Dominic Bowkett".
- meta description ≤160 chars with primary keyword. article:section "Field kit".
- Canonical https://www.dominicbowkett.com/journal/<SLUG>/
- Hero meta row: `<span>Published DATE</span><span>Reading time · N min</span><span>By Dominic Bowkett · MRPSA</span>`
- Breadcrumbs: Home → Writing → [short topic].
- 1,800–2,600 words of body copy. No images other than the product figures.

## Publishing (only when told to publish — e.g. the daily routine)
1. Add the post row to `public/journal/index.html` (`.posts` section, date order, newest
   first; renumber `num` spans so 001 is the oldest post by date) and add its @id to the
   Blog JSON-LD blogPost array.
2. Add a row to the right category group on `public/kit/index.html` (same num as journal).
3. Add the URL to `public/sitemap.xml` (lastmod = publish date) and bump the journal
   index lastmod.
4. Tick the topic in `docs/KIT-CALENDAR.md` (mark `[x]`, add slug + date).
5. Commit with a clear message and push to main.
