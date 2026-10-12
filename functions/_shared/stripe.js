// Minimal Stripe REST client for the Workers runtime (no SDK, no bundling).
// Secrets: STRIPE_SECRET_KEY (platform key), STRIPE_WEBHOOK_SECRET (Connect endpoint).

// STRIPE_API_BASE is only for local testing against a mock; leave unset in production.
const API_DEFAULT = "https://api.stripe.com";
const enc = new TextEncoder();

// Encode nested objects/arrays the way Stripe expects: a[b][0][c]=v
export function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") formEncode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

export class StripeError extends Error {
  constructor(status, body) {
    const e = body?.error || {};
    super(e.message || `Stripe HTTP ${status}`);
    this.status = status;
    this.code = e.code;
    this.type = e.type;
    this.param = e.param;
    this.raw = body;
  }
}

export async function stripe(env, method, path, params, { account, idempotencyKey } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Stripe-Version": env.STRIPE_API_VERSION || "2025-08-27.basil",
  };
  if (account) headers["Stripe-Account"] = account;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let url = `${env.STRIPE_API_BASE || API_DEFAULT}${path}`;
  let body;
  if (method === "GET" || method === "DELETE") {
    const qs = formEncode(params);
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = formEncode(params);
  }
  const res = await fetch(url, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(res.status, json);
  return json;
}

// ---- Webhook signature verification (Stripe-Signature: t=..,v1=..) ----

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyWebhook(env, rawBody, sigHeader, toleranceS = 300) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  if (!sigHeader) throw new Error("Missing Stripe-Signature header");
  const parts = Object.create(null);
  const v1s = [];
  for (const kv of sigHeader.split(",")) {
    const [k, v] = kv.split("=", 2).map((s) => s.trim());
    if (k === "v1") v1s.push(v);
    else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!t || !v1s.length) throw new Error("Malformed Stripe-Signature header");
  if (Math.abs(Date.now() / 1000 - t) > toleranceS) throw new Error("Webhook timestamp outside tolerance");
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${rawBody}`);
  if (!v1s.some((v) => timingSafeEqual(v, expected))) throw new Error("Webhook signature mismatch");
  return JSON.parse(rawBody);
}

// ---- Connected accounts ----

export async function listConnectedAccounts(env) {
  const out = [];
  let starting_after;
  for (let i = 0; i < 10; i++) {
    const page = await stripe(env, "GET", "/v1/accounts", { limit: 100, ...(starting_after ? { starting_after } : {}) });
    out.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return out;
}

export function summariseAccount(a) {
  const addr = a.business_profile?.support_address || a.company?.address || a.individual?.address || null;
  const addressText = addr
    ? [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
    : "";
  const name =
    a.business_profile?.name ||
    a.settings?.dashboard?.display_name ||
    a.company?.name ||
    [a.individual?.first_name, a.individual?.last_name].filter(Boolean).join(" ") ||
    a.id;
  return {
    stripe_account_id: a.id,
    business_name: name,
    email: a.email || a.business_profile?.support_email || "",
    phone: a.business_profile?.support_phone || "",
    address: addressText,
    charges_enabled: a.charges_enabled ? 1 : 0,
    payouts_enabled: a.payouts_enabled ? 1 : 0,
    account_type: a.type || a.controller?.type || "",
    fees_payer: a.controller?.fees?.payer || (a.type === "standard" ? "account" : ""),
    country: a.country || "",
    default_currency: a.default_currency || "",
  };
}
