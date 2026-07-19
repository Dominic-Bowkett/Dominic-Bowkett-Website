# News roundup spec — dominicbowkett.com daily briefing posts

How to write one daily news-commentary post for the site of Dominic Bowkett, an
independent building surveyor, domestic energy assessor and PAS 2035 retrofit assessor
in Hartfield, East Sussex. UK English. Same design system and voice as the rest of the
site — read `public/journal/listed-buildings-epc/index.html` for the register.

## What this post is

A working surveyor's briefing on what happened in the last day or so across his world:
EPCs and MEES, landlord regulation (Renters' Rights, licensing, deposits, Section 21),
retrofit and PAS 2035 (ECO, grant schemes, Great British Insulation Scheme, heat pumps),
building surveying and conveyancing, RICS/RPSA/professional-body news, housing-market
data (HMRC transactions, Halifax/Nationwide indices, Rightmove/Zoopla), building safety,
damp-and-mould enforcement (Awaab's Law), planning and Building Regulations changes.

The value is NOT the news itself — readers can get that anywhere. The value is the
practitioner's read: what each story actually changes for a homeowner, landlord or
small developer in the South East, what to do about it, and what the coverage is
missing. Roughly 30% summary, 70% commentary. Bold, plain-spoken, occasionally wry —
never hedge-everything corporate.

## Sourcing rules — this is journalism-adjacent, so be careful

- Find stories via web search. Good hunting grounds: gov.uk announcements and
  consultations, MHCLG, DESNZ, Propertymark, NRLA, RICS, Elmhurst/Quidos news pages,
  LandlordZone, Property118, Landlord Today, Inside Housing, Housing Today,
  Construction News, BBC housing coverage, This is Money property section.
- ONLY cover stories you can open and read. Fetch the actual page; never write from
  a headline alone. If a claim matters (a date, a figure, a threshold), it must come
  from the fetched text.
- Link every story to its source with a normal external link
  (`target="_blank" rel="noopener"`). Name the outlet in the prose ("MHCLG's
  consultation document says…", "as Inside Housing reports…").
- Quote at most a sentence or two per source, always attributed. Summarise and comment
  in Dom's own words — never reproduce paragraphs.
- Prefer primary sources (the consultation PDF, the legislation, the data release)
  over secondary reporting when both exist.
- Date every post honestly. If a story is older than ~5 days, don't present it as
  news; either skip it or frame it as "still worth your attention".
- NO invented quotes, NO stories that could not be verified, NO paywalled content
  summarised from memory.

## The skip rule

3–5 stories per post. If genuine, on-topic news for the last day can't fill THREE
stories, do not publish — exit cleanly, log "no post today: thin news day", and leave
the repo untouched. A missed day is invisible; a padded post erodes the whole site.

## Page structure

Slug: `news-DD-MM-YYYY` (e.g. news-14-07-2026), file
`public/journal/<slug>/index.html`. Copy the head/header/footer skeleton from an
existing news post if one exists (`ls public/journal/news-*` first), else from
`public/journal/listed-buildings-epc/index.html`. Keep the current CSS `?v=` param and
the nav exactly as found in the copied page (no Kit item).

- Title: "Surveyor's notes — DATE: [hook from the lead story]" ≤65 chars where
  possible. H1 may break lines like other posts. article:section "Surveyor's notes".
- meta description ≤160 chars naming the two biggest stories.
- Hero meta row: Published date · Reading time · By Dominic Bowkett · MRPSA.
- Breadcrumb: Home → Writing → Notes, DATE.
- Body inside `<article class="prose"><div class="body">`:
  1. Short intro paragraph (2–3 sentences): the shape of the day.
  2. One `<h2>` per story — the h2 is Dom's angle, not the outlet's headline
     ("The EPC C deadline just got real for 2028 landlords", not "Government
     publishes response to MEES consultation").
     Under each: 2–4 paragraphs — what happened (with source link), then the
     practitioner's read, then who should do what.
  3. `<h2>What I'd actually do</h2>` — a short ordered list: concrete actions for
     homeowners/landlords arising from today's stories.
  4. `<hr/>` + closing paragraph linking the most relevant service page
     (`../../services/epc/`, `../../services/retrofit/`,
     `../../services/building-surveys/`, `../../services/ventilation/`) and
     `../../contact/`.
  5. Small-print paragraph (same style as other posts' disclaimers): "General
     commentary, not advice for your specific circumstances… Sources linked were
     accurate when read on DATE."
- NO affiliate links in news posts. NO images. No `<style>`/`<script>` beyond the
  footer year script.
- JSON-LD: BlogPosting + BreadcrumbList only (copy pattern, adjust). No ItemList.
- 900–1,600 words. Reading time 5–8 min.

## Voice guardrails

First person throughout; Dom's genuine professional lens is the point. He may comment
on regulation, markets and practice freely. He must NOT claim personal involvement in
a story ("I was consulted on this") or personal testing of any product. Predictions
are fine when flagged as opinion ("my bet is…"). No exclamation marks, no emoji.

## Publishing steps

1. Add the post row to `public/journal/index.html` — newest first, next `num` in the
   site-wide sequence (check the highest existing `num` on that page and increment),
   and add its @id to the Blog JSON-LD blogPost array.
   Do NOT add news posts to `public/kit/index.html` — that page is kit guides only.
2. Add the URL to `public/sitemap.xml` (lastmod = today, changefreq monthly) and bump
   the journal index lastmod to today.
3. Self-verify: every external link fetched and returning 200 during research; JSON-LD
   parses; internal links resolve; date in title/meta/JSON-LD/hero all match today.
4. Commit "Add surveyor's notes: DD Mon YYYY" with the
   Co-Authored-By: Claude <noreply@anthropic.com> trailer, push to main; on failure
   retry once after `git pull --rebase origin main`.
