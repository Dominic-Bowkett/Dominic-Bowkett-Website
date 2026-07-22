# Regenerate the homepage reviews block from verified, verbatim reviews.
import re, pathlib

WHICH = "https://trustedtraders.which.co.uk/businesses/dominic-bowkett/"
CHECK = "https://www.checkatrade.com/trades/ems2ltdtadominicbowkett"
GOOGLE = "https://share.google/nXk5s3FRBee4E7nsP"

STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path class="s-full" d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 15l-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z"/></svg>'
STARS5 = STAR * 5

def esc(t):
    return (t.replace('&', '&amp;').replace('"', '&quot;')
             .replace("'", '&rsquo;').replace('--', '&mdash;'))

# (title, verbatim body, client, platform label, source url, date label)
CARDS = [
 ("Same-day EPC, sold my flat",
  "I needed this done urgently as I&rsquo;m selling my flat and Dom came out the same day and completed and logged the assessment. Communication was excellent and he was very respectful and efficient.",
  "Lynne W &middot; BN1", "Checkatrade", CHECK, "Jun 2026"),
 ("Turned it around in a day",
  "Dom turned it around within one day of calling him. Professional, friendly and reliable &mdash; 5 stars! Cheers Dom!",
  "Sam P", "Google", GOOGLE, "2026"),
 ("Friendly, efficient and helpful",
  "Dom was great. He was incredibly polite and respectful and good with our dogs. He completed the task super quickly and was very patient in answering all our questions.",
  "Customer in West Sussex", "Which? Trusted Traders", WHICH, "Jul 2026"),
 ("Fully recommend Dominic / EMS-2",
  "Dominic was great and very professional from start to finish. My enquiry was picked up quickly, and contact was made on the same day. Work was carried out efficiently, my tenant was also happy with the service. I would fully recommend Dominic / EMS-2 Ltd.",
  "Mark M &middot; TN9", "Checkatrade", CHECK, "Feb 2026"),
 ("Excellent from enquiry to completion",
  "Excellent service from initial enquiry to job completion. Fast and efficient service, very pleased.",
  "Adam Jones", "Google", GOOGLE, "2026"),
 ("Extremely professional",
  "Dominic is extremely professional. He responds very quickly and is very polite. I highly recommend him.",
  "Sandra G &middot; CR0", "Checkatrade", CHECK, "Mar 2026"),
]

def card(title, body, client, plat, url, date):
    return f'''            <a class="review-card" href="{url}" target="_blank" rel="noopener">
              <span class="stars" aria-label="5 out of 5 stars">
                {STARS5}
              </span>
              <h3>&ldquo;{title}&rdquo;</h3>
              <p>&ldquo;{body}&rdquo;</p>
              <span class="rev-meta"><span>{client}</span><span class="rev-src">{plat} &middot; {date}</span></span>
            </a>'''

def platform_row():
    return f'''          <div class="reviews-platforms" role="list">
            <a class="rev-platform" role="listitem" href="{WHICH}" target="_blank" rel="noopener">
              <span class="stars" aria-hidden="true">{STARS5}</span>
              <span>Which? Trusted Traders</span>
              <b>5.0</b>
            </a>
            <a class="rev-platform" role="listitem" href="{GOOGLE}" target="_blank" rel="noopener">
              <span class="stars" aria-hidden="true">{STARS5}</span>
              <span>Google</span>
              <b>5.0</b>
            </a>
            <a class="rev-platform" role="listitem" href="{CHECK}" target="_blank" rel="noopener">
              <span class="stars" aria-hidden="true">{STARS5}</span>
              <span>Checkatrade</span>
              <b>10 / 10</b>
            </a>
          </div>'''

cards_html = '\n\n'.join(card(*c) for c in CARDS)

block = f'''    <!-- ===============  REVIEWS  =============== -->
    <section class="std" aria-labelledby="reviews-h">
      <div class="section-grid">
        <div class="section-label">004 / Reviews</div>
        <div class="section-content">
          <h2 id="reviews-h">What clients say.</h2>

{platform_row()}

          <div class="review-grid">
{cards_html}
          </div>

          <p style="margin-top: 32px; font-size: 15px; color: var(--muted);">Every review is held on an independent platform &mdash; read them all on <a href="{WHICH}" target="_blank" rel="noopener">Which? Trusted Traders</a>, <a href="{GOOGLE}" target="_blank" rel="noopener">Google</a> and <a href="{CHECK}" target="_blank" rel="noopener">Checkatrade</a>.</p>
        </div>
      </div>
    </section>

    <!-- ===============  SERVICES INDEX  ==============='''

p = pathlib.Path('public/index.html')
s = p.read_text(encoding='utf-8')
new = re.sub(r'    <!-- ===============  REVIEWS  =============== -->.*?    <!-- ===============  SERVICES INDEX  ===============',
             lambda m: block, s, count=1, flags=re.S)
assert new != s, 'reviews block not replaced'
p.write_text(new, encoding='utf-8')
print('reviews rebuilt:', len(CARDS), 'cards')
