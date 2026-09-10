/*
 * Propose Amazon-CDN replacements for Field Kit product photos that are currently
 * hotlinked from someone else's site (usually a retailer).
 *
 *   node scripts/rehost-kit-images.js proposals.json [--limit N] [--slug best-x]
 *
 * For each off-host figure it takes the product name from the surrounding block,
 * searches amazon.co.uk, and only proposes a swap when the result is a confident
 * match: every model-number token in the product name must appear in the Amazon
 * title, or - where the name carries no model number - the brand plus most of the
 * remaining words must match. Everything else is written out as "unmatched" for a
 * human to deal with. Nothing is edited here; scripts/apply-rehost.py does that.
 */
const { chromium } = require('C:/Users/dbowk/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JOURNAL = path.join(ROOT, 'public', 'journal');
const AMAZON_HOST = 'm.media-amazon.com';

const outPath = process.argv[2] || 'proposals.json';
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const slugArg = process.argv.indexOf('--slug');
const ONLY = slugArg > -1 ? process.argv[slugArg + 1] : null;

function allowedHosts() {
  const f = path.join(ROOT, 'docs', 'IMAGE-HOSTS-ALLOWED.txt');
  if (!fs.existsSync(f)) return new Set();
  return new Set(fs.readFileSync(f, 'utf8').split('\n')
    .map(l => l.split('#')[0].trim().toLowerCase()).filter(Boolean));
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&rsquo;/g, "'").replace(/&mdash;/g, '-')
          .replace(/&ndash;/g, '-').replace(/&pound;/g, '£').replace(/&nbsp;/g, ' ')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&frac12;/g, '1/2').replace(/&frac14;/g, '1/4')
          .replace(/&frac34;/g, '3/4').replace(/&deg;/g, ' ').replace(/&times;/g, 'x')
          .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
}

// Every prod-shot figure, with the <h3> product name from its own block.
function collect() {
  const allow = allowedHosts();
  const items = [];
  for (const dir of fs.readdirSync(JOURNAL)) {
    if (!dir.startsWith('best-')) continue;
    if (ONLY && dir !== ONLY) continue;
    const file = path.join(JOURNAL, dir, 'index.html');
    if (!fs.existsSync(file)) continue;
    const s = fs.readFileSync(file, 'utf8');
    const re = /<figure class="prod-shot"><img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*?>/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const url = decode(m[1]);
      const host = (url.match(/^https?:\/\/([^/]+)/) || [, ''])[1].toLowerCase();
      if (host === AMAZON_HOST || allow.has(host)) continue;
      // nearest preceding <h3> is the product name for this block
      const before = s.slice(0, m.index);
      const h3s = [...before.matchAll(/<h3>([\s\S]*?)<\/h3>/g)];
      const name = h3s.length ? decode(h3s[h3s.length - 1][1].replace(/<[^>]+>/g, '')).trim() : decode(m[2]);
      items.push({ slug: dir, url, alt: decode(m[2]), name, host });
    }
  }
  return items;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'pack', 'set', 'kit', 'of', 'in', 'a', 'uk',
                      'professional', 'pro', 'series', 'edition', 'inch', 'mm', 'cm']);
// A bare measurement is not identity: "100mm" says nothing about which SKU this is.
const UNIT = /^\d+(\.\d+)?(mm|cm|m|in|ft|l|kg|g|w|v|ah|nm|db|lm|mp|k|s|pc)$/;
const SIZE = /^\d+x\d+/;

function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokens(s) { return norm(s).split(' ').filter(Boolean); }
function digitRun(s) { return (s.match(/\d/g) || []).join(''); }

/* Model numbers, read off the raw name before normalising - the separators matter.
   "31-992/SFDI" must survive as one SKU, not split into "31" and "992"; and a bare
   number is only a SKU when it is long enough not to be a size (63730, not 225). */
function skus(raw) {
  const out = new Set();
  for (const m of raw.match(/[A-Za-z]{0,6}[-\u2013]?\d[\dA-Za-z\-\/.]{2,}/g) || []) {
    const t = m.toLowerCase().replace(/[.]+$/, '');
    if (UNIT.test(t) || SIZE.test(t)) continue;
    // a bare "100" or "225" is a size; keep it only with letters or 4+ digits
    const d = digitRun(t);
    if (d.length >= 4 || (d.length >= 3 && /[a-z]/.test(t))) out.add(t);
  }
  for (const t of tokens(raw)) {
    if (UNIT.test(t) || SIZE.test(t)) continue;
    const hasA = /[a-z]/.test(t);
    if ((hasA && /\d/.test(t) && t.length >= 4) || (!hasA && t.length >= 4)) out.add(t);
  }
  return [...out];
}

function score(productName, amazonTitle) {
  const want = tokens(productName).filter(t => !STOP.has(t));
  const got = new Set(tokens(amazonTitle));
  const titleRuns = tokens(amazonTitle).map(digitRun).filter(d => d.length >= 3);
  const overlap = want.length ? want.filter(t => got.has(t)).length / want.length : 0;
  const brand = want[0];
  const brandOk = !!brand && got.has(brand);
  const mine = skus(productName);

  if (mine.length) {
    const hit = mine.filter(t => got.has(t) ||
      (digitRun(t).length >= 4 && titleRuns.some(d => d.includes(digitRun(t)))));
    const why = `brand ${brandOk ? 'ok' : 'MISSING'}, sku ${hit.length}/${mine.length}` +
                `${hit.length ? ' (' + hit[0] + ')' : ''}, overlap ${(overlap * 100).toFixed(0)}%`;
    // One solid model-number hit on the right brand is identity. Word overlap is
    // noise at that point - the two sellers describe the same tool differently.
    return { ok: brandOk && hit.length > 0, why, overlap: overlap + (hit.length ? 1 : 0) };
  }
  return { ok: brandOk && overlap >= 0.7,
           why: `brand ${brandOk ? 'ok' : 'MISSING'}, no sku, overlap ${(overlap * 100).toFixed(0)}%`,
           overlap };
}

(async () => {
  const items = collect().slice(0, LIMIT);
  console.log(`${items.length} off-host image(s) to look up`);
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    locale: 'en-GB', viewport: { width: 1400, height: 1000 },
  });
  const cache = new Map();
  const out = [];
  let n = 0;
  for (const it of items) {
    n++;
    let results = cache.get(it.name);
    if (!results) {
      const pg = await ctx.newPage();
      try {
        await pg.goto('https://www.amazon.co.uk/s?k=' + encodeURIComponent(it.name),
                      { waitUntil: 'domcontentloaded', timeout: 45000 });
        await pg.waitForTimeout(1200 + Math.random() * 1200);
        results = await pg.evaluate(() => [...document.querySelectorAll('div[data-component-type="s-search-result"]')]
          .slice(0, 6).map(r => {
            const img = r.querySelector('img.s-image');
            const price = r.querySelector('.a-price .a-offscreen');
            return img ? { title: (img.getAttribute('alt') || '').trim(),
                           asin: r.getAttribute('data-asin') || null,
                           img: img.getAttribute('src'),
                           price: price ? price.textContent.trim() : null } : null;
          }).filter(Boolean));
      } catch (e) {
        results = [];
        it.error = e.message.split('\n')[0];
      }
      await pg.close();
      cache.set(it.name, results);
      await new Promise(r => setTimeout(r, 2200 + Math.random() * 1600));
    }
    let best = null;
    const scored = [];
    for (const r of results) {
      if (/^Sponsored Ad/i.test(r.title)) continue;
      const sc = score(it.name, r.title);
      scored.push({ title: r.title, asin: r.asin, price: r.price,
                    id: (r.img.match(/\/images\/I\/([^.]+)\./) || [])[1] || null,
                    ok: sc.ok, why: sc.why, overlap: sc.overlap });
      if (!best || (sc.ok && !best.sc.ok) ||
          (sc.ok === best.sc.ok && sc.overlap > best.sc.overlap)) best = { r, sc };
    }
    const id = best && (best.r.img.match(/\/images\/I\/([^.]+)\./) || [])[1];
    out.push({
      ...it,
      matched: !!(best && best.sc.ok && id),
      why: best ? best.sc.why : 'no results',
      amazonTitle: best ? best.r.title : null,
      asin: best ? best.r.asin : null,
      newUrl: id ? `https://${AMAZON_HOST}/images/I/${id}._AC_SL500_.jpg` : null,
      candidates: scored,
    });
    const tick = out[out.length - 1].matched ? 'MATCH' : '  -  ';
    console.log(`[${n}/${items.length}] ${tick} ${it.slug} :: ${it.name.slice(0, 52)} :: ${out[out.length - 1].why}`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  }
  await b.close();
  const ok = out.filter(o => o.matched).length;
  console.log(`\ndone: ${ok} confident match(es), ${out.length - ok} unmatched -> ${outPath}`);
})().catch(e => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });
