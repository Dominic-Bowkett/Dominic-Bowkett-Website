// /api/admin/* — JSON API behind the admin login cookie.
import { isAdmin, sameOrigin } from "../../_shared/auth.js";
import { db, getInvoice } from "../../_shared/db.js";
import {
  UserError, syncPartners, listPartners, updatePartner, createInvoice, editInvoice, sendInvoice, voidInvoice,
  reconcileFromStripe, sendPaidEmails, runReminders,
} from "../../_shared/invoicing.js";
import { partnerOf, supplierName } from "../../_shared/docs.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!(await isAdmin(request, env))) return json({ ok: false, error: "Not signed in" }, 401);
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return json({ ok: false, error: "Bad origin" }, 403);
  const parts = Array.isArray(params.route) ? params.route : params.route ? [params.route] : [];
  const url = new URL(request.url);
  const origin = url.origin;
  let body = {};
  if (method !== "GET") {
    try { body = await request.json(); } catch { body = {}; }
  }

  try {
    const [head, id, action] = parts;

    if (head === "status" && method === "GET") {
      const checks = {
        DB: !!env.DB,
        STRIPE_SECRET_KEY: !!env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: !!env.STRIPE_WEBHOOK_SECRET,
        RESEND_API_KEY: !!env.RESEND_API_KEY,
        ADMIN_PASSWORD: !!env.ADMIN_PASSWORD,
        ADMIN_SECRET: !!env.ADMIN_SECRET,
        live_mode: !!env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.startsWith("sk_live_"),
      };
      let dbOk = false, counts = {};
      if (env.DB) {
        const d = await db(env);
        const r = await d.prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(amount_pence),0) total FROM invoices GROUP BY status`).all();
        for (const row of r.results || []) counts[row.status] = { n: row.n, total: row.total };
        dbOk = true;
      }
      return json({ ok: true, checks, dbOk, counts, webhook_url: `${origin}/api/stripe/webhook` });
    }

    if (head === "partners") {
      if (method === "GET" && !id) {
        let partners = await listPartners(env);
        if (!partners.length && env.STRIPE_SECRET_KEY) { await syncPartners(env); partners = await listPartners(env); }
        return json({ ok: true, partners });
      }
      if (method === "POST" && id === "sync") {
        const n = await syncPartners(env);
        return json({ ok: true, synced: n, partners: await listPartners(env) });
      }
      if (method === "PATCH" && id) {
        await updatePartner(env, id, body);
        return json({ ok: true, partners: await listPartners(env) });
      }
    }

    if (head === "invoices") {
      if (method === "GET" && !id) {
        const d = await db(env);
        const status = url.searchParams.get("status");
        const q = (url.searchParams.get("q") || "").trim();
        const where = [], binds = [];
        if (status && status !== "all") { where.push("status = ?"); binds.push(status); }
        if (q) {
          where.push("(number LIKE ? OR client_email LIKE ? OR client_name LIKE ? OR bill_to_business LIKE ? OR property_address LIKE ? OR service_name LIKE ?)");
          for (let i = 0; i < 6; i++) binds.push(`%${q}%`);
        }
        const r = await d
          .prepare(`SELECT * FROM invoices ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 300`)
          .bind(...binds)
          .all();
        const invoices = (r.results || []).map((inv) => ({ ...inv, partner_name: supplierName(partnerOf(inv)) }));
        return json({ ok: true, invoices });
      }
      if (method === "POST" && !id) {
        let inv = await createInvoice(env, body);
        if (body.send) inv = await sendInvoice(env, inv.id, origin);
        return json({ ok: true, invoice: inv });
      }
      if (id && method === "GET") {
        const inv = await getInvoice(env, id);
        if (!inv) return json({ ok: false, error: "Not found" }, 404);
        const d = await db(env);
        const ev = await d.prepare(`SELECT * FROM invoice_events WHERE invoice_id = ? ORDER BY id`).bind(id).all();
        const em = await d.prepare(`SELECT * FROM email_log WHERE invoice_id = ? ORDER BY id`).bind(id).all();
        return json({ ok: true, invoice: { ...inv, partner_name: supplierName(partnerOf(inv)) }, events: ev.results || [], emails: em.results || [], links: {
          pay: `${origin}/pay/${inv.id}`, view: `${origin}/invoice/${inv.id}`, pdf: `${origin}/invoice/${inv.id}/pdf`, feePdf: `${origin}/fee-invoice/${inv.id}/pdf`,
        } });
      }
      if (id && method === "PUT") return json({ ok: true, invoice: await editInvoice(env, id, body) });
      if (id && method === "POST") {
        if (action === "send") return json({ ok: true, invoice: await sendInvoice(env, id, origin) });
        if (action === "resend") return json({ ok: true, invoice: await sendInvoice(env, id, origin, { resend: true }) });
        if (action === "void") return json({ ok: true, invoice: await voidInvoice(env, id, body.reason) });
        if (action === "reconcile") return json({ ok: true, invoice: await reconcileFromStripe(env, id, origin) });
        if (action === "resend-paid-emails") {
          const inv = await getInvoice(env, id);
          if (!inv || inv.status !== "paid") throw new UserError("Invoice is not paid");
          await sendPaidEmails(env, inv, origin);
          return json({ ok: true, invoice: await getInvoice(env, id) });
        }
      }
    }

    if (head === "reminders" && method === "POST") {
      const result = await runReminders(env, origin, { asOf: body.as_of || undefined, dryRun: !!body.dry_run });
      return json({ ok: true, ...result });
    }

    if (head === "export.csv" && method === "GET") {
      const d = await db(env);
      const r = await d.prepare(`SELECT * FROM invoices ORDER BY created_at`).all();
      const cols = ["number", "status", "issued_at", "sent_at", "paid_at", "partner", "partner_account_id", "client_name", "client_email", "bill_to_business", "bill_to_address", "property_address", "service_name", "amount", "client_vat_rate", "fee_net", "fee_vat", "fee_total", "fee_invoice_number", "stripe_payment_intent_id", "stripe_charge_id"];
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [cols.join(",")];
      for (const inv of r.results || []) {
        const p = partnerOf(inv);
        lines.push([
          inv.number, inv.status, inv.issued_at, inv.sent_at, inv.paid_at, supplierName(p), inv.partner_account_id, inv.client_name, inv.client_email,
          inv.bill_to_business, inv.bill_to_address, inv.property_address, inv.service_name, (inv.amount_pence / 100).toFixed(2), inv.client_vat_rate,
          (inv.fee_net_pence / 100).toFixed(2), (inv.fee_vat_pence / 100).toFixed(2), (inv.application_fee_pence / 100).toFixed(2), inv.fee_invoice_number,
          inv.stripe_payment_intent_id, inv.stripe_charge_id,
        ].map(cell).join(","));
      }
      return new Response(lines.join("\r\n"), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
      });
    }

    return json({ ok: false, error: "Unknown endpoint" }, 404);
  } catch (e) {
    const status = e instanceof UserError ? e.status : 500;
    if (status === 500) console.error("admin api error", e);
    return json({ ok: false, error: e.message || String(e) }, status);
  }
}
