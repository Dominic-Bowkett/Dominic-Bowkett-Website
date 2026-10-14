// /api/admin/* — JSON API behind the admin login cookie.
import { isAdmin, sameOrigin } from "../../_shared/auth.js";
import { db, getInvoice } from "../../_shared/db.js";
import {
  UserError, syncPartners, listPartners, updatePartner, createInvoice, editInvoice, sendInvoice, voidInvoice,
  reconcileFromStripe, sendPaidEmails, runReminders,
} from "../../_shared/invoicing.js";
import { partnerOf, supplierName } from "../../_shared/docs.js";
import { portalStatus, invitePartnerUser, revokePartnerUser, PortalError } from "../../_shared/portal.js";
import {
  JobError, listJobs, getJob, createJob, editJob, jobMessages, partnersForJob, offerJob, partnerResponds, sendMessage, askForAddress,
  confirmBooking, updateJob, addMessage, invoiceDraftFromJob, STATUS_LABEL,
} from "../../_shared/jobs.js";
import { getPartner as partnerRow } from "../../_shared/db.js";
import { PARTNER_SERVICES } from "../../_shared/services.js";

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
      return json({ ok: true, checks, dbOk, counts, webhook_url: `${origin}/api/stripe/webhook`, partner_services: PARTNER_SERVICES });
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
      if (id && action === "portal") {
        if (method === "GET") return json({ ok: true, users: await portalStatus(env, id) });
        if (method === "POST" && body.action === "invite") {
          const r = await invitePartnerUser(env, id, body.email, origin);
          return json({ ok: true, ...r, users: await portalStatus(env, id) });
        }
        if (method === "POST" && body.action === "revoke") {
          await revokePartnerUser(env, body.user_id);
          return json({ ok: true, users: await portalStatus(env, id) });
        }
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

    if (head === "jobs") {
      if (method === "GET" && !id) {
        const jobs = await listJobs(env, { status: url.searchParams.get("status") || "open", q: (url.searchParams.get("q") || "").trim() });
        const partners = await listPartners(env);
        const names = Object.fromEntries(partners.map((p) => [p.stripe_account_id, p.display_name || p.business_name]));
        return json({ ok: true, jobs: jobs.map((j) => ({ ...j, partner_name: names[j.partner_account_id] || null, status_label: STATUS_LABEL[j.status] })) });
      }
      if (method === "POST" && !id) return json({ ok: true, job: await createJob(env, { ...body, source: "manual" }, origin, { notify: false, ack: body.send_ack !== false }) });
      if (id && method === "GET") {
        const job = await getJob(env, id);
        if (!job) return json({ ok: false, error: "Not found" }, 404);
        const partner = job.partner_account_id ? await partnerRow(env, job.partner_account_id) : null;
        const candidates = (await partnersForJob(env, job)).map((p) => ({ stripe_account_id: p.stripe_account_id, name: p.display_name || p.business_name, miles: p.miles == null ? null : Math.round(p.miles * 10) / 10, charges_enabled: p.charges_enabled, phone: p.phone, dispatch_mode: p.dispatch_mode, commission_pct: p.commission_pct, coverage_postcode: p.coverage_postcode, offers: p.offers, services: p.service_list }));
        return json({ ok: true, job: { ...job, status_label: STATUS_LABEL[job.status] }, partner, candidates, messages: await jobMessages(env, id), invoice_draft: invoiceDraftFromJob(job, partner) });
      }
      if (id && method === "PUT") return json({ ok: true, job: await editJob(env, id, body) });
      if (id && method === "POST") {
        if (action === "offer") return json({ ok: true, job: await offerJob(env, id, body.partner_account_id, origin, { by: "admin" }) });
        if (action === "respond") return json({ ok: true, job: await partnerResponds(env, id, !!body.accepted, origin, { via: "admin", note: body.note || "" }) });
        if (action === "message") return json({ ok: true, job: await sendMessage(env, id, { to: body.to || "customer", channel: body.channel || "sms", body: body.body, subject: body.subject, party: "admin", origin }) });
        if (action === "ask-address") return json({ ok: true, job: await askForAddress(env, id, origin) });
        if (action === "book") return json({ ok: true, job: await confirmBooking(env, id, { booked_date: body.booked_date, booked_time: body.booked_time, price: body.price, party: "admin" }, origin) });
        if (action === "note") { await addMessage(env, id, { direction: "in", channel: "note", party: "admin", body: String(body.body || "") }); return json({ ok: true, job: await getJob(env, id) }); }
        if (action === "status") {
          if (!["new", "taken", "closed", "declined"].includes(body.status)) throw new JobError("That status can't be set by hand");
          await updateJob(env, id, { status: body.status, ...(body.status === "new" ? { partner_account_id: null, partner_response: null } : {}) });
          await addMessage(env, id, { direction: "in", channel: "system", party: "admin", body: `Status set to ${STATUS_LABEL[body.status]}${body.note ? `: ${body.note}` : ""}` });
          return json({ ok: true, job: await getJob(env, id) });
        }
        if (action === "invoice") {
          const job = await getJob(env, id);
          if (!job) throw new JobError("Job not found", 404);
          if (!job.partner_account_id) throw new JobError("Assign a partner first");
          const partner = await partnerRow(env, job.partner_account_id);
          const inv = await createInvoice(env, { ...invoiceDraftFromJob(job, partner), ...body.overrides });
          await updateJob(env, id, { invoice_id: inv.id, status: "invoiced" });
          await addMessage(env, id, { direction: "in", channel: "system", party: "admin", body: `Invoice ${inv.number} created (draft).` });
          return json({ ok: true, job: await getJob(env, id), invoice: inv });
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
    const status = e instanceof UserError || e instanceof PortalError || e instanceof JobError ? e.status : 500;
    if (status === 500) console.error("admin api error", e);
    return json({ ok: false, error: e.message || String(e) }, status);
  }
}
