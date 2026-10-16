// GET  /api/cron/paid-invoices[?since=ISO]  — feed of paid invoices that carried a platform fee (default: last 60 days).
//      Used by the local "Xero booking check" routine (tools/xero-bookings, Step 4d) to raise Dom's fee VAT invoice to the
//      partner as a Xero draft. Auth: X-Cron-Key = CRON_SECRET (same key as the reminders cron) or a signed-in admin.
// POST /api/cron/paid-invoices {"backfill_fee_ids": true}
//      — looks up the Stripe application fee id for paid invoices where the paid-time lookup came back empty.
import { isAdmin } from "../../_shared/auth.js";
import { safeEqual } from "../../_shared/email.js";
import { db } from "../../_shared/db.js";
import { partnerOf, links } from "../../_shared/docs.js";
import { backfillApplicationFee } from "../../_shared/invoicing.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function allowed(request, env) {
  const key = request.headers.get("x-cron-key") || "";
  if (env.CRON_SECRET && safeEqual(key, env.CRON_SECRET)) return true;
  return isAdmin(request, env);
}

async function paidWithFee(env, since) {
  const d = await db(env);
  const { results } = await d
    .prepare(`SELECT * FROM invoices WHERE status = 'paid' AND application_fee_pence > 0 AND paid_at >= ? ORDER BY paid_at`)
    .bind(since)
    .all();
  return results || [];
}

export async function onRequestGet({ request, env }) {
  if (!(await allowed(request, env))) return json({ ok: false, error: "Unauthorised" }, 401);
  const url = new URL(request.url);
  const since = url.searchParams.get("since") || new Date(Date.now() - 60 * 86400e3).toISOString().slice(0, 10);
  const rows = await paidWithFee(env, since);
  const invoices = rows.map((inv) => {
    const p = partnerOf(inv);
    return {
      number: inv.number,
      fee_invoice_number: inv.fee_invoice_number,
      paid_at: inv.paid_at,
      paid_date: (inv.paid_at || "").slice(0, 10),
      currency: inv.currency || "gbp",
      amount_pence: inv.amount_pence,
      application_fee_pence: inv.application_fee_pence, // inc VAT — what was actually deducted
      fee_net_pence: inv.fee_net_pence,
      fee_vat_pence: inv.fee_vat_pence,
      client_name: inv.client_name,
      property_address: inv.property_address,
      service_name: inv.service_name,
      partner: {
        stripe_account_id: inv.partner_account_id,
        business_name: p.business_name || "",
        display_name: p.display_name || "",
        contact_name: p.contact_name || "",
        email: p.invoice_email || p.email || "",
      },
      stripe_charge_id: inv.stripe_charge_id,
      stripe_application_fee_id: inv.stripe_application_fee_id,
      fee_pdf: links(url.origin, inv).feePdf,
    };
  });
  return json({ ok: true, since, count: invoices.length, invoices });
}

export async function onRequestPost({ request, env }) {
  if (!(await allowed(request, env))) return json({ ok: false, error: "Unauthorised" }, 401);
  let body = {};
  try { body = await request.json(); } catch {}
  if (!body.backfill_fee_ids) return json({ ok: false, error: "Nothing to do" }, 400);
  const d = await db(env);
  const { results } = await d
    .prepare(`SELECT * FROM invoices WHERE status = 'paid' AND stripe_charge_id IS NOT NULL AND stripe_application_fee_id IS NULL`)
    .all();
  const out = [];
  for (const inv of results || []) {
    try {
      out.push({ number: inv.number, application_fee_id: await backfillApplicationFee(env, inv) });
    } catch (e) {
      out.push({ number: inv.number, error: e.message });
    }
  }
  return json({ ok: true, checked: out.length, results: out });
}
