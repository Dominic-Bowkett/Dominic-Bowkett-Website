# Enquiry email + unsubscribe (Cloudflare Pages Functions)

Endpoints:

- `POST /api/enquiry` — sends an owner notification + a confirmation to the enquirer.
  The confirmation includes an **unsubscribe button** and the
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers, and is suppressed for
  anyone who has opted out.
  Body: `{ "name": "...", "email": "...", "message": "...", "phone"?: "..." }`
- `GET /api/unsubscribe?e=&t=` — human confirmation page; records the opt-out.
- `POST /api/unsubscribe?e=&t=` — RFC 8058 one-click unsubscribe (what mail apps hit).

Unsubscribe links are signed with `UNSUB_SECRET` (HMAC-SHA256 over the email),
so they can't be forged. Opt-outs are stored in the `SUPPRESSED` KV namespace.

## One-time activation

The endpoints are deployed but **dormant** until these are configured:

```sh
# 1. Create the suppression KV namespace
wrangler kv namespace create SUPPRESSED
#    -> paste the id into wrangler.toml and uncomment the [[kv_namespaces]] block

# 2. Set secrets (Pages project)
wrangler pages secret put RESEND_API_KEY   # your Resend API key
wrangler pages secret put UNSUB_SECRET     # any long random string, e.g. `openssl rand -hex 32`
```

Resend requires `dominicbowkett.com` to be a verified sending domain (SPF/DKIM).

## Send a one-off enquiry email

```sh
curl -X POST https://www.dominicbowkett.com/api/enquiry \
  -H 'content-type: application/json' \
  -d '{"name":"Test","email":"you@example.com","message":"hello"}'
```
