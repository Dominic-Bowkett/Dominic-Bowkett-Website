// POST /api/stripe/webhook — Stripe Connect webhook endpoint ("Listen to events on Connected accounts").
// Verifies the signature, de-duplicates by event id, and reconciles the matching invoice.
import { db, getInvoice, logEvent, updateInvoice } from "../../_shared/db.js";
import { verifyWebhook, stripe } from "../../_shared/stripe.js";
import { reconcileSession, recordPaymentFailure, notifyOwner } from "../../_shared/invoicing.js";

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
]);

async function findByPaymentIntent(env, piId) {
  if (!piId) return null;
  const d = await db(env);
  return d.prepare(`SELECT * FROM invoices WHERE stripe_payment_intent_id = ?`).bind(piId).first();
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  let event;
  try {
    event = await verifyWebhook(env, raw, request.headers.get("stripe-signature"));
  } catch (e) {
    return new Response(`Webhook error: ${e.message}`, { status: 400 });
  }
  const origin = new URL(request.url).origin;
  const d = await db(env);

  // Idempotency: Stripe retries; process each event once.
  const ins = await d
    .prepare(`INSERT OR IGNORE INTO stripe_events (id, type, account, outcome) VALUES (?, ?, ?, 'processing')`)
    .bind(event.id, event.type, event.account || null)
    .run();
  if (!ins.meta?.changes) return new Response("duplicate", { status: 200 });

  let outcome = "ignored";
  try {
    if (HANDLED.has(event.type)) outcome = await handle(env, event, origin);
  } catch (e) {
    outcome = `error: ${e.message}`;
    await d.prepare(`UPDATE stripe_events SET outcome = ? WHERE id = ?`).bind(outcome, event.id).run();
    // 500 makes Stripe retry later; the INSERT above is left in place so a retry is treated as a duplicate.
    // Clear it so the retry can be processed.
    await d.prepare(`DELETE FROM stripe_events WHERE id = ?`).bind(event.id).run();
    return new Response(outcome, { status: 500 });
  }
  await d.prepare(`UPDATE stripe_events SET outcome = ? WHERE id = ?`).bind(outcome, event.id).run();
  return new Response(outcome, { status: 200 });
}

async function handle(env, event, origin) {
  const obj = event.data.object;
  const account = event.account;

  if (event.type.startsWith("checkout.session.")) {
    const invId = obj.metadata?.invoice_id;
    const inv = invId ? await getInvoice(env, invId) : null;
    if (!inv) return "no matching invoice";
    if (inv.partner_account_id !== account) {
      await logEvent(env, inv.id, "webhook.account_mismatch", { event: event.id, account });
      return "account mismatch";
    }
    if (event.type === "checkout.session.async_payment_failed") {
      await recordPaymentFailure(env, inv, { message: "Delayed payment method failed", session: obj.id }, origin);
      return "async failure recorded";
    }
    // completed / async_payment_succeeded / expired: fetch a fresh copy rather than trusting the payload's age.
    const s = await stripe(env, "GET", `/v1/checkout/sessions/${obj.id}`, {}, { account });
    await reconcileSession(env, inv, s, origin);
    return "reconciled";
  }

  if (event.type === "payment_intent.payment_failed") {
    const inv = (obj.metadata?.invoice_id && (await getInvoice(env, obj.metadata.invoice_id))) || (await findByPaymentIntent(env, obj.id));
    if (!inv) return "no matching invoice";
    const err = obj.last_payment_error || {};
    await recordPaymentFailure(env, inv, { code: err.code, decline_code: err.decline_code, message: err.message, payment_intent: obj.id }, origin);
    return "failure recorded";
  }

  if (event.type === "charge.refunded") {
    const inv = (obj.metadata?.invoice_id && (await getInvoice(env, obj.metadata.invoice_id))) || (await findByPaymentIntent(env, obj.payment_intent));
    if (!inv) return "no matching invoice";
    const full = obj.amount_refunded >= obj.amount;
    await logEvent(env, inv.id, full ? "refunded" : "partially_refunded", { charge: obj.id, amount_refunded: obj.amount_refunded });
    if (full) await updateInvoice(env, inv.id, { status: "refunded" });
    await notifyOwner(env, inv, origin, full ? "Invoice refunded in full" : "Invoice partially refunded");
    return "refund recorded";
  }

  if (event.type === "charge.dispute.created") {
    const inv = await findByPaymentIntent(env, obj.payment_intent);
    if (!inv) return "no matching invoice";
    await logEvent(env, inv.id, "dispute.created", { dispute: obj.id, reason: obj.reason, amount: obj.amount });
    await updateInvoice(env, inv.id, { last_error: `Dispute opened: ${obj.reason}` });
    await notifyOwner(env, inv, origin, "ATTENTION: chargeback / dispute opened");
    return "dispute recorded";
  }
  return "ignored";
}
