# Invoicing with Stripe Connect

Split invoices: the client pays the connected account (the partner who does the work) and
Dominic Bowkett takes a platform fee plus VAT out of the payment.

## How the money moves

- **Direct charges.** The Checkout session is created *on the partner's connected account*
  (`Stripe-Account` header) with `payment_intent_data[application_fee_amount]`.
  The partner is the merchant: their name is on the client's card statement, the payment lands in
  their Stripe balance, and **they pay Stripe's processing fee** (Stripe's default for Standard
  accounts; `controller.fees.payer = account`). Destination charges would bill the Stripe fee to
  the platform instead, which is why they are not used.
- **Application fee** = the platform fee Dom enters, which is **inclusive of 20 % VAT**. It transfers
  to Dom's platform balance when the client pays. Example: £100 invoice, £10 fee → application fee
  £10.00 (£8.33 net + £1.67 VAT), partner nets £90 less Stripe's fee. The client only ever sees £100.
- Dom issues the partner a **VAT invoice** (DB-FEE-xxxxx) for the fee the moment the client pays.
  It is marked "settled by deduction".
- The partner must have `charges_enabled` and an active `card_payments` capability; the admin
  checks this live before every send.

## Routes

| Route | What |
| --- | --- |
| `/admin` | Password-protected admin (invoices, new invoice, connected accounts, setup) |
| `/api/admin/*` | JSON API behind the admin cookie |
| `/pay/<token>` | Client's pay page → `POST /pay/<token>/checkout` redirects to Stripe Checkout |
| `/invoice/<token>` | Client view with PDF link; `/invoice/<token>/pdf` is the PDF (receipted once paid) |
| `/fee-invoice/<token>/pdf` | Dom's VAT invoice to the partner (after payment) |
| `/api/stripe/webhook` | Stripe **Connect** webhook (events on connected accounts) |

Tokens are 128-bit random ids; nothing is guessable. All of these pages are `noindex` and
disallowed in robots.txt.

## Emails (Resend, from info@dominicbowkett.com)

| When | To | Content |
| --- | --- | --- |
| Invoice sent | client | HTML: summary, **Pay this invoice** button, view/PDF link |
| Invoice sent | Dom (info@) | exact copy of the client email, subject prefixed "Copy to <client>" |
| Invoice sent | partner (if "copy invoices" on) | plain text copy incl. fee breakdown |
| Paid | client | confirmation, "we'll proceed", receipted PDF link, optional review link (`REVIEW_URL`) |
| Paid | partner | plain text: paid, fee VAT invoice PDF link, "go ahead" |
| Paid / failed / mismatch / refund / dispute | Dom (info@) | one plain-text alert per event |

## Payment reminders

A small scheduled Worker (`workers/invoice-reminders`, cron 08:00 UTC daily) POSTs to
`/api/cron/reminders` with the shared `CRON_SECRET`. Any invoice still `sent`/`failed` gets a
reminder email at 7, 14, 21 and 28 days after `sent_at` (one per 6-day window at most), and Dom gets
a plain-text alert each time. The fourth is a final reminder; the invoice is then flagged
"further action needed" and no more are sent. Setup -> "Run now" / "Preview (dry run)" trigger it by hand.

Deploy the Worker from `workers/invoice-reminders` with `wrangler deploy`, then
`wrangler secret put CRON_SECRET` there and `wrangler pages secret put CRON_SECRET --project-name dominic-bowkett`
with the same value.

## Failure guards

- Webhook signature + 5-minute timestamp tolerance; every event id is recorded so retries are no-ops.
- An invoice is only marked paid when Stripe's session says `complete` + `paid` **and** the
  amount/currency match what was invoiced. A mismatch is logged and Dom is emailed.
- The Checkout success redirect reconciles with Stripe directly, so a late webhook still shows
  "Paid" to the client; the webhook later finds it already paid and does nothing.
- Card declines / async failures are logged on the invoice timeline, Dom gets one alert, and the
  pay link keeps working so the client can retry. Expired sessions are recreated on the next click.
- If the invoice email fails to send the invoice stays in `draft` and the error shows in the admin.
- Every send/attempt/email is in the timeline; the **Export CSV** button gives the accounting
  record (one row per invoice with fee net/VAT/total and Stripe ids). PDFs are regenerated from
  the stored snapshot on demand, so they never go missing.

## One-time setup (dominicbowkett.com Cloudflare account)

```sh
cd Dominic-Bowkett-Website
wrangler login                              # as the account that owns the Pages project
wrangler d1 create dominicbowkett-invoices  # done 12 Oct 2026; id is in wrangler.toml

P=dominic-bowkett                           # the Pages project name
wrangler pages secret put STRIPE_SECRET_KEY     --project-name $P   # platform key
wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name $P   # from the webhook below
wrangler pages secret put ADMIN_PASSWORD        --project-name $P
wrangler pages secret put ADMIN_SECRET          --project-name $P   # openssl rand -hex 32
wrangler pages secret put RESEND_API_KEY        --project-name $P   # if not already set
```

Then in Stripe → Developers → Webhooks → **Add endpoint**, choose **Listen to events on
Connected accounts**, URL `https://www.dominicbowkett.com/api/stripe/webhook`, events:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`.

Push to `main` (the Pages project builds from GitHub). Open `/admin` → **Setup** to confirm every
secret shows as set, then **Connected accounts → Sync from Stripe**, fill in each partner's
invoice details, and raise the first invoice. Test with `sk_test_…` first: the Setup tab shows
test/live mode.

The schema creates itself on first request (`functions/_shared/db.js`).

## Local development

```sh
cp .dev.vars.example .dev.vars   # fill in test keys
npx wrangler pages dev public --port 8788
```
