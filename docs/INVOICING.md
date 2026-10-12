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

## Partner portal (`/partner`)

Read-only login for connected accounts: a table of every non-draft invoice sent on their behalf
(amount, platform fee, their share, status, paid date, PDF + fee invoice links) and totals.
Accounts live in `partner_users`; the admin creates one from Connected accounts -> "Portal access",
which emails a 72-hour set-password link (`/partner/setup/<token>`). Passwords are PBKDF2-SHA256
(100k iterations); sessions are a signed cookie that includes the password hash, so a reset logs
other sessions out. "Forgotten your password" on the sign-in page emails the same link.

## Jobs (enquiries -> partner -> booking -> invoice)

`jobs` + `job_messages` tables (functions/_shared/jobs.js). Ways in: **forward any enquiry email to
in@jobs.dominicbowkett.com** (Email Routing on the `jobs.` subdomain -> `workers/jobs-inbox` Email Worker
-> `/api/inbound/email`; Workers AI extracts name/contact/address/service, signatures and quoted text
are dropped; only mail from Dom's addresses creates jobs), the Checkatrade watcher (`/api/inbound/lead`),
or New job in the admin. Texts to the office number are relayed by ecoweald-call-agent to
`/api/inbound/sms`: a partner's YES/NO (matched by mobile) answers an offer; a customer's text is filed
on their open job and, when the job is waiting for an address, the address is extracted automatically.
Admin: Send job to partner (nearest first by coverage postcode; email + text "Interested? Reply YES or NO"),
Ask customer for address, I'll take it myself, Mark booked, Create invoice (pre-filled with price and the
partner's commission). Partners with dispatch mode `auto` get jobs within 25 miles offered automatically.
When a partner accepts, they receive the customer's contact details and the customer is told who will be
in touch. All customer messages go through the system (from Dom's number / info@, Reply-To the jobs inbox,
subject tagged `[DB-JOB-000001]`) so every reply is logged on the job. Partners see only their own jobs
at `/partner/jobs` and can accept/decline, message the customer, and confirm date/time/price.

## Partner self-registration

`/partner/register` -> verification email (48 h link, `partner_signups`) -> `/partner/register/verify/<token>`
sets the password, creates a Stripe **Standard** connected account (`POST /v1/accounts type=standard`),
the `partners` row (commission 10 %, coverage postcode geocoded via postcodes.io) and the login, then
signs them in. The dashboard shows a "Set up Stripe payments" banner until `charges_enabled`; the button
creates an Account Link (`/v1/account_links`, hosted onboarding, existing Stripe logins can be used).
Dom gets a plain-text email on registration and again when the account can take payments.
Each partner has `commission_pct` (admin-editable, default 10 % inc VAT) which pre-fills the fee on
new invoices; the fee can still be typed over per invoice.

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
