// Partner self-registration: email verification -> password -> Stripe account creation + onboarding.
import { db, getPartner, randomToken, logEmail, logEvent } from "./db.js";
import { stripe, StripeError } from "./stripe.js";
import { sendViaResend, OWNER_TO } from "./email.js";
import { esc } from "./docs.js";
import { hashPassword, validatePassword, getPartnerUserByEmail } from "./partner-auth.js";
import { PortalError, portalPage } from "./portal.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
export const DEFAULT_COMMISSION_PCT = 10;

export function normalisePostcode(pc) {
  const s = String(pc || "").toUpperCase().replace(/\s+/g, "");
  if (!POSTCODE_RE.test(s)) return null;
  return s.slice(0, -3) + " " + s.slice(-3);
}

// Best-effort lat/lng for a UK postcode (postcodes.io, free, no key).
export async function geocodePostcode(pc) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, { signal: ctrl.signal });
    const j = await r.json();
    if (j.status === 200 && j.result) return { lat: j.result.latitude, lng: j.result.longitude, district: j.result.admin_district || "" };
  } catch (e) {
    console.warn("postcode lookup failed", e.message);
  } finally {
    clearTimeout(timer);
  }
  return null;
}

// ---------------------------------------------------------------- step 1: form -> signup row -> verification email

export function registerForm({ error = "", values = {} } = {}) {
  const v = (k) => esc(values[k] || "");
  return portalPage({
    title: "Register as a partner",
    body: `<div class="card login" style="max-width:560px"><h1>Register as a partner</h1>
<p class="muted">For assessors and surveyors who carry out work invoiced through Dominic Bowkett. You'll verify your email, choose a password, then connect a Stripe account so clients can pay you directly.</p>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}
<form method="post" action="/partner/register">
<label for="business">Business name</label><input id="business" name="business_name" required value="${v("business_name")}" placeholder="e.g. Ecocertsolutions" />
<label for="name">Your name</label><input id="name" name="contact_name" required value="${v("contact_name")}" />
<label for="email">Email</label><input id="email" name="email" type="email" required value="${v("email")}" autocomplete="email" />
<label for="phone">Mobile</label><input id="phone" name="phone" type="tel" value="${v("phone")}" autocomplete="tel" />
<label for="pc">Coverage postcode (your home or the centre of the area you cover)</label><input id="pc" name="coverage_postcode" required value="${v("coverage_postcode")}" placeholder="TN2 5HB" autocomplete="postal-code" />
<p style="margin-top:18px"><button class="btn" type="submit">Send verification email</button></p>
</form>
<p class="small muted">Already registered? <a href="/partner">Sign in</a>.</p></div>`,
  });
}

export async function startRegistration(env, form, origin) {
  const values = {
    business_name: String(form.get("business_name") || "").trim().slice(0, 120),
    contact_name: String(form.get("contact_name") || "").trim().slice(0, 120),
    email: String(form.get("email") || "").trim().toLowerCase(),
    phone: String(form.get("phone") || "").trim().slice(0, 40),
    coverage_postcode: String(form.get("coverage_postcode") || "").trim(),
  };
  if (!values.business_name) throw new PortalError("Business name is required");
  if (!values.contact_name) throw new PortalError("Your name is required");
  if (!EMAIL_RE.test(values.email)) throw new PortalError("A valid email address is required");
  const pc = normalisePostcode(values.coverage_postcode);
  if (!pc) throw new PortalError("That doesn't look like a UK postcode");
  values.coverage_postcode = pc;
  if (await getPartnerUserByEmail(env, values.email)) throw new PortalError("That email already has an account. Sign in, or use 'Forgotten your password'.");

  const d = await db(env);
  const token = randomToken(24);
  const expires = new Date(Date.now() + 48 * 3600000).toISOString();
  await d
    .prepare(`INSERT INTO partner_signups (token, email, business_name, contact_name, phone, coverage_postcode, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(token, values.email, values.business_name, values.contact_name, values.phone, pc, expires)
    .run();
  const link = `${origin}/partner/register/verify/${token}`;
  const msg = {
    to: values.email,
    replyTo: OWNER_TO,
    subject: "Verify your email — Dominic Bowkett partner account",
    html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0c0c0c;line-height:1.6;max-width:600px;">
<p>Hello ${esc(values.contact_name.split(" ")[0])},</p>
<p>Thanks for registering <strong>${esc(values.business_name)}</strong> as a partner. Please confirm this is your email address, then you can choose a password and connect your Stripe account.</p>
<p style="margin:22px 0;"><a href="${link}" style="background:#0c0c0c;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:600;display:inline-block;">Verify my email</a></p>
<p style="font-size:13px;color:#7a7873;">Or copy this link into your browser: ${link}<br/>The link works for 48 hours. If you didn't register, you can ignore this email.</p>
<p>Thanks,<br/>Dominic Bowkett</p>
<p style="font-size:12px;color:#7a7873;margin-top:28px;border-top:1px solid #e2dfd8;padding-top:14px;">Dominic Bowkett · EMS-2 Ltd, 128 City Road, London, EC1V 2NX · Company No. 11235441 · info@dominicbowkett.com</p></div>`,
  };
  try {
    const r = await sendViaResend(env, msg);
    await logEmail(env, { kind: "partner_verify", to: values.email, subject: msg.subject, resend_id: r?.id });
  } catch (e) {
    await logEmail(env, { kind: "partner_verify", to: values.email, subject: msg.subject, error: e.message });
    throw new PortalError(`We couldn't send the verification email: ${e.message}`, 502);
  }
  return values;
}

export const checkEmailPage = (email) =>
  portalPage({
    title: "Check your email",
    body: `<div class="card login"><h1>Check your email</h1><p>We've sent a verification link to <strong>${esc(email)}</strong>. Click it to continue; it works for 48 hours.</p><p class="muted small">Not arrived? Check your spam folder, or <a href="/partner/register">register again</a>.</p></div>`,
  });

// ---------------------------------------------------------------- step 2: verified link -> password -> Stripe account

export async function getSignup(env, token) {
  if (!token) return null;
  const d = await db(env);
  const s = await d.prepare(`SELECT * FROM partner_signups WHERE token = ?`).bind(token).first();
  if (!s || s.completed_at || new Date(s.expires_at) < new Date()) return null;
  return s;
}

export function passwordForm(token, signup, { error = "" } = {}) {
  return portalPage({
    title: "Choose a password",
    body: `<div class="card login"><h1>Email verified. Choose a password</h1>
<p class="muted">${esc(signup.business_name)} · ${esc(signup.email)}</p>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}
<form method="post" action="/partner/register/verify/${token}">
<label for="pw">Password (at least 10 characters)</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="10" required autofocus />
<label for="pw2">Repeat it</label><input id="pw2" name="password2" type="password" autocomplete="new-password" minlength="10" required />
<p style="margin-top:18px"><button class="btn" type="submit">Create my account</button></p>
<p class="small muted">Next you'll connect a Stripe account (new or existing) so clients can pay you.</p>
</form></div>`,
  });
}

export const expiredPage = () =>
  portalPage({
    title: "Link expired",
    body: `<div class="card login"><h1>This link has expired or was already used</h1><p class="muted">Verification links work for 48 hours. <a href="/partner/register">Register again</a> or <a href="/partner">sign in</a> if you already have an account.</p></div>`,
  });

// Creates the Stripe Standard account, the partner row and the login. Returns the partner_users row.
export async function completeRegistration(env, signup, password, origin) {
  const err = validatePassword(password);
  if (err) throw new PortalError(err);
  if (await getPartnerUserByEmail(env, signup.email)) throw new PortalError("That email already has an account. Please sign in.");
  let acct;
  try {
    acct = await stripe(
      env,
      "POST",
      "/v1/accounts",
      {
        type: "standard",
        country: "GB",
        email: signup.email,
        business_profile: { name: signup.business_name, support_email: signup.email, ...(signup.phone ? { support_phone: signup.phone } : {}) },
        metadata: { source: "dominicbowkett.com partner registration", contact_name: signup.contact_name, coverage_postcode: signup.coverage_postcode },
      },
      { idempotencyKey: `reg-${signup.token}` }
    );
  } catch (e) {
    const msg = e instanceof StripeError ? e.message : e.message;
    throw new PortalError(`Stripe could not create your account: ${msg}`, 502);
  }
  const geo = await geocodePostcode(signup.coverage_postcode);
  const d = await db(env);
  const { salt, hash } = await hashPassword(password);
  const userId = randomToken(12);
  await d.batch([
    d
      .prepare(
        `INSERT INTO partners (stripe_account_id, business_name, display_name, email, invoice_email, phone, contact_name, coverage_postcode, coverage_lat, coverage_lng, commission_pct,
           charges_enabled, payouts_enabled, account_type, fees_payer, country, default_currency, registered_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'standard', 'account', 'GB', 'gbp', datetime('now'), datetime('now'))
         ON CONFLICT(stripe_account_id) DO NOTHING`
      )
      .bind(acct.id, signup.business_name, signup.business_name, signup.email, signup.email, signup.phone || null, signup.contact_name, signup.coverage_postcode, geo?.lat ?? null, geo?.lng ?? null, DEFAULT_COMMISSION_PCT),
    d.prepare(`INSERT INTO partner_users (id, stripe_account_id, email, password_salt, password_hash, activated_at, last_login_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).bind(userId, acct.id, signup.email, salt, hash),
    d.prepare(`UPDATE partner_signups SET completed_at = datetime('now'), stripe_account_id = ? WHERE token = ?`).bind(acct.id, signup.token),
  ]);
  // Tell Dom (plain text, one line per fact).
  try {
    await sendViaResend(env, {
      to: OWNER_TO,
      subject: `New partner registered — ${signup.business_name}`,
      text:
        `${signup.business_name} has registered as a partner.\n\nContact: ${signup.contact_name} <${signup.email}>${signup.phone ? ` ${signup.phone}` : ""}\n` +
        `Coverage postcode: ${signup.coverage_postcode}${geo?.district ? ` (${geo.district})` : ""}\nStripe account: ${acct.id} (Standard, onboarding not yet completed)\nCommission: ${DEFAULT_COMMISSION_PCT}% (default)\n\n` +
        `Admin: ${origin}/admin#partners\n`,
    });
  } catch (e) { console.error("owner notice failed", e.message); }
  const user = await d.prepare(`SELECT * FROM partner_users WHERE id = ?`).bind(userId).first();
  return user;
}

// ---------------------------------------------------------------- Stripe onboarding (Account Links)

export async function stripeOnboardingUrl(env, accountId, origin) {
  try {
    const link = await stripe(env, "POST", "/v1/account_links", {
      account: accountId,
      refresh_url: `${origin}/partner?stripe=refresh`,
      return_url: `${origin}/partner?stripe=return`,
      type: "account_onboarding",
    });
    return link.url;
  } catch (e) {
    throw new PortalError(`Stripe onboarding is unavailable right now: ${e.message}`, 502);
  }
}

// Pull the live account status into the partners row (used after onboarding returns and on dashboard load).
export async function refreshPartnerFromStripe(env, accountId) {
  const a = await stripe(env, "GET", `/v1/accounts/${accountId}`);
  const d = await db(env);
  const before = await getPartner(env, accountId);
  await d
    .prepare(`UPDATE partners SET charges_enabled = ?, payouts_enabled = ?, fees_payer = COALESCE(?, fees_payer), synced_at = datetime('now'), updated_at = datetime('now') WHERE stripe_account_id = ?`)
    .bind(a.charges_enabled ? 1 : 0, a.payouts_enabled ? 1 : 0, a.controller?.fees?.payer || null, accountId)
    .run();
  if (before && !before.charges_enabled && a.charges_enabled) {
    try {
      await sendViaResend(env, {
        to: OWNER_TO,
        subject: `Partner ready to take payments — ${before.display_name || before.business_name}`,
        text: `${before.display_name || before.business_name} (${accountId}) has completed Stripe onboarding and can now receive payments. You can send invoices on their behalf.\n`,
      });
    } catch {}
  }
  return a;
}
