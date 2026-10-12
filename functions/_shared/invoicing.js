// Core invoicing workflow shared by the admin API, pay page and Stripe webhook.
import { db, getInvoice, getPartner, updateInvoice, logEvent, logEmail, nextNumber, randomToken } from "./db.js";
import { stripe, StripeError, listConnectedAccounts, summariseAccount } from "./stripe.js";
import { sendViaResend, OWNER_TO } from "./email.js";
import { toPence, splitGross, todayISO, gbp } from "./money.js";
import { platform } from "./business.js";
import { normalisePostcode, geocodePostcode } from "./register.js";
import {
  clientInvoiceEmail, partnerCopyEmail, clientPaidEmail, partnerPaidEmail, ownerNotice, partnerOf,
  clientReminderEmail, REMINDER_DAYS, REMINDER_MAX, supplierName,
} from "./docs.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// ---------------------------------------------------------------- partners

export async function syncPartners(env) {
  const d = await db(env);
  const accounts = await listConnectedAccounts(env);
  const stmts = accounts.map((a) => {
    const s = summariseAccount(a);
    return d
      .prepare(
        `INSERT INTO partners (stripe_account_id, business_name, email, phone, address, charges_enabled, payouts_enabled,
           account_type, fees_payer, country, default_currency, stripe_json, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(stripe_account_id) DO UPDATE SET
           business_name = excluded.business_name,
           email = CASE WHEN partners.email IS NULL OR partners.email = '' THEN excluded.email ELSE partners.email END,
           phone = CASE WHEN partners.phone IS NULL OR partners.phone = '' THEN excluded.phone ELSE partners.phone END,
           address = CASE WHEN partners.address IS NULL OR partners.address = '' THEN excluded.address ELSE partners.address END,
           charges_enabled = excluded.charges_enabled, payouts_enabled = excluded.payouts_enabled,
           account_type = excluded.account_type, fees_payer = excluded.fees_payer, country = excluded.country,
           default_currency = excluded.default_currency, stripe_json = excluded.stripe_json,
           synced_at = datetime('now'), updated_at = datetime('now')`
      )
      .bind(
        s.stripe_account_id, s.business_name, s.email, s.phone, s.address, s.charges_enabled, s.payouts_enabled,
        s.account_type, s.fees_payer, s.country, s.default_currency,
        JSON.stringify({ id: a.id, type: a.type, controller: a.controller, capabilities: a.capabilities, business_profile: a.business_profile, settings: { dashboard: a.settings?.dashboard } })
      );
  });
  if (stmts.length) await d.batch(stmts);
  return accounts.length;
}

export async function listPartners(env) {
  const d = await db(env);
  const r = await d.prepare(`SELECT * FROM partners ORDER BY COALESCE(display_name, business_name)`).all();
  return r.results || [];
}

const PARTNER_EDITABLE = ["display_name", "invoice_email", "address", "vat_number", "phone", "copy_invoices", "hidden", "notes", "email", "contact_name", "coverage_postcode", "commission_pct"];
export async function updatePartner(env, id, fields) {
  const d = await db(env);
  const keys = Object.keys(fields).filter((k) => PARTNER_EDITABLE.includes(k));
  if (!keys.length) return;
  // (coverage_lat/lng are appended to keys below when a postcode is saved)
  if (fields.invoice_email && !EMAIL_RE.test(fields.invoice_email)) throw new UserError("Invoice email is not valid");
  if (keys.includes("commission_pct")) {
    const pct = Number(fields.commission_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new UserError("Commission must be between 0 and 50 percent");
    fields.commission_pct = Math.round(pct * 100) / 100;
  }
  if (keys.includes("coverage_postcode")) {
    const pc = normalisePostcode(fields.coverage_postcode);
    if (fields.coverage_postcode && !pc) throw new UserError("That doesn't look like a UK postcode");
    fields.coverage_postcode = pc;
    const geo = pc ? await geocodePostcode(pc) : null;
    keys.push("coverage_lat", "coverage_lng");
    fields.coverage_lat = geo?.lat ?? null;
    fields.coverage_lng = geo?.lng ?? null;
  }
  await d
    .prepare(`UPDATE partners SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE stripe_account_id = ?`)
    .bind(...keys.map((k) => (k === "copy_invoices" || k === "hidden" ? (fields[k] ? 1 : 0) : fields[k] ?? null)), id)
    .run();
}

// ---------------------------------------------------------------- invoices

export function validateInvoiceInput(env, body) {
  const biz = platform(env);
  const out = {};
  out.partner_account_id = String(body.partner_account_id || "").trim();
  if (!out.partner_account_id) throw new UserError("Choose the connected account (partner) this invoice is for");
  out.client_email = String(body.client_email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(out.client_email)) throw new UserError("A valid client email is required");
  out.client_name = String(body.client_name || "").trim() || null;
  out.bill_to_business = String(body.bill_to_business || "").trim() || null;
  out.bill_to_address = String(body.bill_to_address || "").trim() || null;
  out.property_address = String(body.property_address || "").trim() || null;
  out.service_name = String(body.service_name || "").trim();
  if (!out.service_name) throw new UserError("Service name is required");
  out.description = String(body.description || "").trim() || null;
  out.client_message = String(body.client_message || "").trim().slice(0, 2000) || null;
  out.amount_pence = toPence(body.amount);
  if (!Number.isInteger(out.amount_pence) || out.amount_pence < 100) throw new UserError("Amount must be at least £1.00");
  if (out.amount_pence > 5_000_000) throw new UserError("Amount is over the £50,000 safety limit");
  out.client_vat_rate = body.client_vat_inclusive ? 20 : 0;
  // The platform fee is entered INCLUSIVE of VAT (e.g. £10 taken = £8.33 net + £1.67 VAT).
  const feeGross = body.fee === "" || body.fee == null ? 0 : toPence(body.fee);
  if (!Number.isInteger(feeGross) || feeGross < 0) throw new UserError("Platform fee must be a positive amount (inc VAT)");
  out.fee_vat_rate = biz.feeVatRate;
  const split = splitGross(feeGross, out.fee_vat_rate);
  out.fee_net_pence = split.net;
  out.fee_vat_pence = split.vat;
  out.application_fee_pence = feeGross;
  if (out.application_fee_pence >= out.amount_pence) throw new UserError("Platform fee must be less than the invoice amount");
  out.due_date = /^\d{4}-\d{2}-\d{2}$/.test(body.due_date || "") ? body.due_date : null;
  return out;
}

function assertVatAllowed(fields, partner) {
  if (fields.client_vat_rate && !String(partner.vat_number || "").trim()) {
    throw new UserError(`"Amount includes VAT" is ticked, but ${partner.display_name || partner.business_name} has no VAT number on file. Add it under Connected accounts first, or untick VAT.`);
  }
}

export async function createInvoice(env, body) {
  const fields = validateInvoiceInput(env, body);
  const partner = await getPartner(env, fields.partner_account_id);
  if (!partner) throw new UserError("Unknown partner account. Sync connected accounts first.");
  assertVatAllowed(fields, partner);
  const d = await db(env);
  const id = randomToken(16);
  const number = await nextNumber(env, "invoice", "DB-INV-");
  const cols = Object.keys(fields);
  await d
    .prepare(
      `INSERT INTO invoices (id, number, status, partner_snapshot, issued_at, ${cols.join(", ")})
       VALUES (?, ?, 'draft', ?, ?, ${cols.map(() => "?").join(", ")})`
    )
    .bind(id, number, JSON.stringify(partner), todayISO(), ...cols.map((k) => fields[k]))
    .run();
  await logEvent(env, id, "created", { number });
  return getInvoice(env, id);
}

export async function editInvoice(env, id, body) {
  const inv = await getInvoice(env, id);
  if (!inv) throw new UserError("Invoice not found", 404);
  if (inv.status !== "draft") throw new UserError("Only draft invoices can be edited. Void it and create a new one.");
  const fields = validateInvoiceInput(env, body);
  const partner = await getPartner(env, fields.partner_account_id);
  if (!partner) throw new UserError("Unknown partner account");
  assertVatAllowed(fields, partner);
  await updateInvoice(env, id, { ...fields, partner_snapshot: JSON.stringify(partner) });
  await logEvent(env, id, "edited");
  return getInvoice(env, id);
}

async function email(env, inv, kind, msg) {
  try {
    const r = await sendViaResend(env, msg);
    await logEmail(env, { invoice_id: inv.id, kind, to: msg.to, subject: msg.subject, resend_id: r?.id });
    await logEvent(env, inv.id, `email.${kind}`, { to: msg.to, id: r?.id });
    return true;
  } catch (e) {
    await logEmail(env, { invoice_id: inv.id, kind, to: msg.to, subject: msg.subject, error: e.message });
    await logEvent(env, inv.id, `email.${kind}.failed`, e.message);
    return false;
  }
}

// Validate the partner can take payments right now (live check against Stripe).
async function assertPartnerReady(env, inv) {
  let acct;
  try {
    acct = await stripe(env, "GET", `/v1/accounts/${inv.partner_account_id}`);
  } catch (e) {
    throw new UserError(`Could not verify the partner's Stripe account: ${e.message}`, 502);
  }
  if (!acct.charges_enabled) throw new UserError("The partner's Stripe account cannot accept payments yet (charges_enabled is false). Ask them to finish Stripe onboarding.");
  if (acct.capabilities?.card_payments && acct.capabilities.card_payments !== "active") {
    throw new UserError(`The partner's card_payments capability is '${acct.capabilities.card_payments}', so direct charges will fail.`);
  }
  return acct;
}

export async function sendInvoice(env, id, origin, { resend = false } = {}) {
  const inv = await getInvoice(env, id);
  if (!inv) throw new UserError("Invoice not found", 404);
  if (!["draft", "sent", "failed"].includes(inv.status)) throw new UserError(`Invoice is ${inv.status}; it cannot be sent`);
  await assertPartnerReady(env, inv);

  // Refresh the partner snapshot from the latest saved details when first sending.
  if (inv.status === "draft") {
    const partner = await getPartner(env, inv.partner_account_id);
    if (partner) await updateInvoice(env, id, { partner_snapshot: JSON.stringify(partner) });
  }
  // Make sure a live Checkout session exists so the email's pay link lands on a ready page.
  await ensureCheckoutSession(env, id, origin);
  const fresh = await getInvoice(env, id);

  const okClient = await email(env, fresh, resend ? "client_invoice_resend" : "client_invoice", {
    to: fresh.client_email,
    replyTo: OWNER_TO,
    ...clientInvoiceEmail(fresh, origin),
  });
  if (!okClient) {
    await updateInvoice(env, id, { last_error: "Client email failed to send" });
    throw new UserError("The invoice email could not be sent (see timeline). Nothing was marked as sent.", 502);
  }
  // Dom always gets a copy of exactly what the client received.
  const clientMsg = clientInvoiceEmail(fresh, origin);
  await email(env, fresh, "owner_copy", {
    to: OWNER_TO,
    subject: `Copy to ${fresh.client_email}: ${clientMsg.subject}`,
    html: `<p style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;color:#7a7873;border-bottom:1px solid #e2dfd8;padding-bottom:10px;margin-bottom:16px;">Copy of the invoice email ${resend ? "re-sent" : "sent"} to ${fresh.client_email}${fresh.client_name ? ` (${fresh.client_name})` : ""}. Admin: ${origin}/admin#inv/${fresh.id}</p>${clientMsg.html}`,
  });
  const p = partnerOf(fresh);
  if (p.copy_invoices !== 0 && (p.invoice_email || p.email)) {
    await email(env, fresh, "partner_copy", { to: p.invoice_email || p.email, replyTo: OWNER_TO, ...partnerCopyEmail(fresh, origin) });
  }
  await updateInvoice(env, id, { status: "sent", sent_at: fresh.sent_at || new Date().toISOString(), last_error: null });
  await logEvent(env, id, resend ? "resent" : "sent", { to: fresh.client_email });
  return getInvoice(env, id);
}

export async function voidInvoice(env, id, reason) {
  const inv = await getInvoice(env, id);
  if (!inv) throw new UserError("Invoice not found", 404);
  if (inv.status === "paid") throw new UserError("A paid invoice cannot be voided. Issue a refund in Stripe instead.");
  if (inv.stripe_checkout_session_id && inv.stripe_checkout_expires_at > Date.now() / 1000) {
    try {
      await stripe(env, "POST", `/v1/checkout/sessions/${inv.stripe_checkout_session_id}/expire`, {}, { account: inv.partner_account_id });
    } catch (e) {
      await logEvent(env, id, "checkout.expire.failed", e.message);
    }
  }
  await updateInvoice(env, id, { status: "void", voided_at: new Date().toISOString() });
  await logEvent(env, id, "voided", reason || null);
  return getInvoice(env, id);
}

// ---------------------------------------------------------------- Stripe Checkout (direct charge on the partner's account)

export async function ensureCheckoutSession(env, id, origin) {
  const inv = await getInvoice(env, id);
  if (!inv) throw new UserError("Invoice not found", 404);
  if (["paid", "void", "refunded"].includes(inv.status)) throw new UserError(`Invoice is ${inv.status}`);
  const now = Math.floor(Date.now() / 1000);

  // Reuse an open session if it has more than 10 minutes left.
  if (inv.stripe_checkout_session_id && inv.stripe_checkout_url && (inv.stripe_checkout_expires_at || 0) > now + 600) {
    try {
      const s = await stripe(env, "GET", `/v1/checkout/sessions/${inv.stripe_checkout_session_id}`, {}, { account: inv.partner_account_id });
      if (s.status === "open") return { url: s.url, id: s.id, reused: true };
      if (s.status === "complete" && s.payment_status === "paid") {
        await reconcileSession(env, inv, s);
        throw new UserError("This invoice has already been paid");
      }
    } catch (e) {
      if (e instanceof UserError) throw e;
      await logEvent(env, id, "checkout.lookup.failed", e.message);
    }
  }

  const p = partnerOf(inv);
  const expires = now + 24 * 60 * 60;
  const params = {
    mode: "payment",
    client_reference_id: inv.number,
    customer_email: inv.client_email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: inv.currency || "gbp",
          unit_amount: inv.amount_pence,
          product_data: {
            name: `${inv.service_name} — ${inv.number}`,
            description: [inv.property_address, p.display_name || p.business_name].filter(Boolean).join(" · ").slice(0, 500) || undefined,
          },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: inv.application_fee_pence,
      description: `${inv.number} ${inv.service_name}`,
      metadata: { invoice_id: inv.id, invoice_number: inv.number },
    },
    metadata: { invoice_id: inv.id, invoice_number: inv.number },
    expires_at: expires,
    success_url: `${origin}/pay/${inv.id}?result=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pay/${inv.id}?result=cancelled`,
  };
  let s;
  try {
    s = await stripe(env, "POST", "/v1/checkout/sessions", params, {
      account: inv.partner_account_id,
      idempotencyKey: `cs-${inv.id}-${Math.floor(now / 600)}`,
    });
  } catch (e) {
    const msg = e instanceof StripeError ? `${e.message}${e.code ? ` [${e.code}]` : ""}` : e.message;
    await updateInvoice(env, id, { last_error: `Checkout: ${msg}` });
    await logEvent(env, id, "checkout.create.failed", msg);
    throw new UserError(`Stripe refused to create the payment page: ${msg}`, 502);
  }
  await updateInvoice(env, id, {
    stripe_checkout_session_id: s.id,
    stripe_checkout_url: s.url,
    stripe_checkout_expires_at: s.expires_at || expires,
    stripe_payment_intent_id: s.payment_intent || inv.stripe_payment_intent_id,
    last_error: null,
  });
  await logEvent(env, id, "checkout.created", { session: s.id, expires_at: s.expires_at });
  return { url: s.url, id: s.id, reused: false };
}

// Given a Checkout Session object fetched from Stripe (connected account), bring the invoice up to date.
// Idempotent: safe to call from the webhook, the success redirect, and the admin "reconcile" button.
export async function reconcileSession(env, inv, s, origin) {
  if (!s || s.metadata?.invoice_id !== inv.id) {
    await logEvent(env, inv.id, "reconcile.mismatch", { session: s?.id, meta: s?.metadata });
    return inv;
  }
  if (s.status === "complete" && s.payment_status === "paid") {
    if (inv.status === "paid") return inv;
    // Guard: the amount actually charged must match what we invoiced.
    if (s.amount_total !== inv.amount_pence || (s.currency || "gbp") !== (inv.currency || "gbp")) {
      await updateInvoice(env, inv.id, { last_error: `Paid amount ${s.amount_total} ${s.currency} does not match invoice ${inv.amount_pence} ${inv.currency}` });
      await logEvent(env, inv.id, "paid.amount_mismatch", { amount_total: s.amount_total, currency: s.currency, session: s.id });
      await notifyOwner(env, inv, origin, "ATTENTION: paid amount mismatch");
      return getInvoice(env, inv.id);
    }
    return markPaid(env, inv, s, origin);
  }
  if (s.status === "expired" && inv.status === "sent") {
    await logEvent(env, inv.id, "checkout.expired", { session: s.id });
    await updateInvoice(env, inv.id, { stripe_checkout_url: null, stripe_checkout_expires_at: 0 });
  }
  if (s.status === "complete" && s.payment_status === "unpaid") {
    await logEvent(env, inv.id, "checkout.completed_unpaid", { session: s.id, payment_status: s.payment_status });
  }
  return getInvoice(env, inv.id);
}

async function markPaid(env, inv, s, origin) {
  const paidAt = new Date().toISOString();
  let charge = null, pm = null, receipt = null, appFee = null;
  const piId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  try {
    if (piId) {
      const pi = await stripe(env, "GET", `/v1/payment_intents/${piId}`, { "expand[]": "latest_charge" }, { account: inv.partner_account_id });
      const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      if (ch) {
        charge = ch.id;
        receipt = ch.receipt_url || null;
        appFee = typeof ch.application_fee === "string" ? ch.application_fee : ch.application_fee?.id || null;
        const d = ch.payment_method_details || {};
        pm = d.type === "card" ? `${d.card?.brand || "card"} ending ${d.card?.last4 || ""}`.trim() : d.type || null;
      }
    }
  } catch (e) {
    await logEvent(env, inv.id, "paid.detail_lookup_failed", e.message);
  }
  const feeNumber = inv.fee_invoice_number || (inv.application_fee_pence > 0 ? await nextNumber(env, "fee_invoice", "DB-FEE-", 5) : null);
  await updateInvoice(env, inv.id, {
    status: "paid",
    paid_at: paidAt,
    stripe_payment_intent_id: piId || inv.stripe_payment_intent_id,
    stripe_charge_id: charge,
    stripe_application_fee_id: appFee,
    payment_method: pm,
    receipt_url: receipt,
    fee_invoice_number: feeNumber,
    last_error: null,
  });
  await logEvent(env, inv.id, "paid", { session: s.id, payment_intent: piId, charge, payment_method: pm });
  const fresh = await getInvoice(env, inv.id);
  await sendPaidEmails(env, fresh, origin);
  return getInvoice(env, inv.id);
}

export async function sendPaidEmails(env, inv, origin) {
  origin = origin || `https://${platform(env).site}`;
  await email(env, inv, "client_paid", { to: inv.client_email, replyTo: OWNER_TO, ...clientPaidEmail(inv, origin, env) });
  const p = partnerOf(inv);
  const partnerTo = p.invoice_email || p.email;
  if (partnerTo) {
    const ok = await email(env, inv, "partner_paid_fee_invoice", { to: partnerTo, replyTo: OWNER_TO, ...partnerPaidEmail(inv, origin) });
    if (ok) await updateInvoice(env, inv.id, { fee_invoice_sent_at: new Date().toISOString() });
  }
  await notifyOwner(env, inv, origin, "Invoice paid");
}

export async function notifyOwner(env, inv, origin, headline) {
  origin = origin || `https://${platform(env).site}`;
  const fresh = (await getInvoice(env, inv.id)) || inv;
  return email(env, fresh, "owner_notice", { to: OWNER_TO, ...ownerNotice(fresh, origin, headline) });
}

export async function recordPaymentFailure(env, inv, detail, origin) {
  await logEvent(env, inv.id, "payment.failed", detail);
  await updateInvoice(env, inv.id, { last_error: `Payment failed: ${detail?.message || detail?.code || "unknown"}` });
  // Keep the invoice payable: the client can retry from the same pay link. Dom gets one heads-up.
  await notifyOwner(env, inv, origin, "Payment attempt failed");
}

// ---------------------------------------------------------------- payment reminders (run daily by the cron Worker)

// Reminder n goes out once the invoice has been unpaid for n * REMINDER_DAYS days (7, 14, 21, 28).
// Each reminder is mirrored to Dom; the last one flags the invoice for further action.
export async function runReminders(env, origin, { asOf, dryRun = false } = {}) {
  const d = await db(env);
  const now = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(now.getTime())) throw new UserError("Invalid as_of date");
  const r = await d
    .prepare(`SELECT * FROM invoices WHERE status IN ('sent','failed') AND sent_at IS NOT NULL AND COALESCE(reminders_sent, 0) < ? ORDER BY sent_at`)
    .bind(REMINDER_MAX)
    .all();
  const out = { checked: 0, sent: [], skipped: [], dryRun, asOf: now.toISOString() };
  for (const inv of r.results || []) {
    out.checked++;
    const sentAt = new Date(inv.sent_at.includes("T") ? inv.sent_at : inv.sent_at.replace(" ", "T") + "Z");
    const days = Math.floor((now - sentAt) / 86400000);
    const n = (inv.reminders_sent || 0) + 1;
    if (days < n * REMINDER_DAYS) { out.skipped.push({ number: inv.number, days, next_at_day: n * REMINDER_DAYS }); continue; }
    // never more than one reminder per invoice in any 6-day window, even if runs were missed
    if (inv.last_reminder_at && now - new Date(inv.last_reminder_at) < 6 * 86400000) { out.skipped.push({ number: inv.number, days, reason: "reminded recently" }); continue; }
    if (dryRun) { out.sent.push({ number: inv.number, days, reminder: n, dryRun: true }); continue; }
    const ok = await email(env, inv, `client_reminder_${n}`, { to: inv.client_email, replyTo: OWNER_TO, ...clientReminderEmail(inv, origin, n) });
    if (!ok) { out.skipped.push({ number: inv.number, days, reason: "email failed" }); continue; }
    const final = n >= REMINDER_MAX;
    await updateInvoice(env, inv.id, {
      reminders_sent: n,
      last_reminder_at: now.toISOString(),
      ...(final ? { last_error: `Unpaid after ${days} days and ${REMINDER_MAX} reminders: further action needed` } : {}),
    });
    await logEvent(env, inv.id, "reminder.sent", { n, days, final });
    const fresh = await getInvoice(env, inv.id);
    await email(env, fresh, "owner_reminder_alert", {
      to: OWNER_TO,
      subject: `${final ? "ACTION NEEDED: final reminder" : `Reminder ${n} of ${REMINDER_MAX}`} sent — ${inv.number} — ${gbp(inv.amount_pence)} unpaid ${days} days`,
      text:
        `Invoice ${inv.number} (${inv.service_name}${inv.property_address ? `, ${inv.property_address}` : ""}) is still unpaid ${days} days after it was sent.\n` +
        `Client: ${inv.client_name || ""} <${inv.client_email}>\nPartner: ${supplierName(partnerOf(inv))}\nAmount: ${gbp(inv.amount_pence)}` + (inv.due_date ? ` · due ${inv.due_date}` : "") + `\n\n` +
        (final
          ? `That was the final (${REMINDER_MAX}th) automatic reminder. No more will be sent: this one now needs you to take further action.\n`
          : `Reminder ${n} of ${REMINDER_MAX} has just been emailed to the client. The next goes in ${REMINDER_DAYS} days if still unpaid.\n`) +
        `\nAdmin: ${origin}/admin#inv/${inv.id}\nClient pay page: ${origin}/pay/${inv.id}\n`,
    });
    out.sent.push({ number: inv.number, days, reminder: n, final });
  }
  return out;
}

export async function reconcileFromStripe(env, id, origin) {
  const inv = await getInvoice(env, id);
  if (!inv) throw new UserError("Invoice not found", 404);
  if (!inv.stripe_checkout_session_id) return inv;
  const s = await stripe(env, "GET", `/v1/checkout/sessions/${inv.stripe_checkout_session_id}`, {}, { account: inv.partner_account_id });
  return reconcileSession(env, inv, s, origin);
}
