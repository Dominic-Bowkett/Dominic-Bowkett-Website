// GET /partner/jobs/:id — one job: details, message thread, accept/decline, message the customer, confirm booking.
// POST — actions: accept | decline | message | book
import { currentPartnerUser } from "../../_shared/partner-auth.js";
import { portalPage } from "../../_shared/portal.js";
import { getJob, jobMessages, partnerResponds, sendMessage, confirmBooking, STATUS_LABEL, JobError } from "../../_shared/jobs.js";
import { esc, linkify } from "../../_shared/docs.js";
import { fmtDate, gbp } from "../../_shared/money.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
const when = (v) => fmtDate(v, { withTime: true });

async function render(env, user, job, { error = "", ok = "" } = {}) {
  const msgs = await jobMessages(env, job.id);
  const mine = ["accepted", "booked", "invoiced"].includes(job.status);
  const thread = msgs
    .filter((m) => m.channel !== "system" || m.party !== "system" || true)
    .map((m) => `<li style="padding:8px 0;border-bottom:1px solid var(--rule)"><span class="muted small">${esc(when(m.at))} · ${esc(m.channel)} · ${m.direction === "in" ? "from" : "to"} ${esc(m.direction === "in" ? m.party : m.counterpart || "")}</span>${m.subject && m.channel === "email" ? `<br/><span class="small"><strong>${esc(m.subject)}</strong></span>` : ""}<div style="white-space:pre-wrap">${linkify(esc(m.body))}</div></li>`)
    .join("");
  const summary = `
<dl style="display:grid;grid-template-columns:140px 1fr;gap:4px 12px;margin:0">
<dt class="muted">Service</dt><dd style="margin:0">${esc(job.service)}</dd>
<dt class="muted">Property</dt><dd style="margin:0">${esc(job.property_address || job.postcode || "")}</dd>
${job.requested_times ? `<dt class="muted">Timing</dt><dd style="margin:0">${esc(job.requested_times)}</dd>` : ""}
${job.details ? `<dt class="muted">Customer said</dt><dd style="margin:0;white-space:pre-wrap">${linkify(esc(job.details))}</dd>` : ""}
<dt class="muted">Customer</dt><dd style="margin:0">${mine ? `${esc(job.customer_name || "")}${job.customer_phone ? ` · <a href="tel:${esc(job.customer_phone)}">${esc(job.customer_phone)}</a>` : ""}${job.customer_email ? ` · <a href="mailto:${esc(job.customer_email)}">${esc(job.customer_email)}</a>` : ""}` : `${esc(job.customer_name || "")} <span class="muted small">(contact details released when you accept)</span>`}</dd>
${job.booked_date ? `<dt class="muted">Booked</dt><dd style="margin:0"><strong>${esc(fmtDate(job.booked_date))}${job.booked_time ? ` at ${esc(job.booked_time)}` : ""}</strong>${job.price_pence != null ? ` · ${gbp(job.price_pence)}` : ""}</dd>` : ""}
</dl>`;
  let actions = "";
  if (job.status === "offered") {
    actions = `<form method="post" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button class="btn" name="action" value="accept">Yes, I'll take it</button><button class="btn secondary" name="action" value="decline">No thanks</button></form>`;
  } else if (mine) {
    actions = `
<div class="card"><h2>Message the customer</h2>
<form method="post"><input type="hidden" name="action" value="message" />
<label>Send by</label><select name="channel" style="width:auto;padding:8px;border:1px solid var(--rule);border-radius:4px"><option value="sms" ${job.customer_phone ? "" : "disabled"}>Text message${job.customer_phone ? "" : " (no mobile on file)"}</option><option value="email" ${job.customer_email ? "" : "disabled"}>Email${job.customer_email ? "" : " (no email on file)"}</option></select>
<label>Message</label><textarea name="body" rows="4" style="width:100%;padding:10px;border:1px solid var(--rule);border-radius:4px;font:inherit" placeholder="e.g. Hi, it's Matt from Ecocertsolutions about your EPC. Would Thursday at 10am suit?"></textarea>
<p style="margin-top:12px"><button class="btn" type="submit">Send</button> <span class="muted small">Sent from Dominic Bowkett's number / email with your name; replies come back to this page.</span></p></form></div>
${job.status !== "booked" && job.status !== "invoiced" ? `<div class="card"><h2>Confirm the booking</h2>
<form method="post"><input type="hidden" name="action" value="book" />
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
<div><label>Date</label><input type="date" name="booked_date" required /></div>
<div><label>Time</label><input name="booked_time" placeholder="10:00" /></div>
<div><label>Price agreed (£)</label><input name="price" inputmode="decimal" placeholder="e.g. 95" /></div></div>
<p style="margin-top:12px"><button class="btn" type="submit">Confirm booked</button> <span class="muted small">The customer gets a confirmation and Dom is told.</span></p></form></div>` : `<div class="card"><h2>Change the booking</h2><form method="post"><input type="hidden" name="action" value="book" /><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px"><div><label>Date</label><input type="date" name="booked_date" value="${esc(job.booked_date || "")}" required /></div><div><label>Time</label><input name="booked_time" value="${esc(job.booked_time || "")}" /></div><div><label>Price (£)</label><input name="price" value="${job.price_pence != null ? (job.price_pence / 100).toFixed(2) : ""}" /></div></div><p style="margin-top:12px"><button class="btn secondary" type="submit">Update booking</button></p></form></div>`}`;
  }
  const body = `
<p style="margin:0 0 16px"><a href="/partner/jobs">← Your jobs</a></p>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}${ok ? `<p class="msg ok">${esc(ok)}</p>` : ""}
<div class="card"><h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${esc(job.ref)} <span class="badge ${job.status === "booked" ? "paid" : job.status === "offered" ? "sent" : ""}">${esc(STATUS_LABEL[job.status] || job.status)}</span></h1>
${summary}${job.status === "offered" ? actions : ""}</div>
${job.status === "offered" ? "" : actions}
<div class="card"><h2>Messages</h2><ul style="list-style:none;padding:0;margin:0">${thread || "<li class='muted'>Nothing yet</li>"}</ul></div>`;
  return new Response(portalPage({ title: job.ref, body, user }), { headers });
}

async function load(request, env, params) {
  const user = await currentPartnerUser(request, env);
  if (!user) return { redirect: Response.redirect(new URL("/partner", request.url).toString(), 303) };
  const job = await getJob(env, params.id);
  if (!job || job.partner_account_id !== user.stripe_account_id) return { redirect: new Response("Not found", { status: 404 }) };
  return { user, job };
}

export async function onRequestGet({ request, env, params }) {
  const { redirect, user, job } = await load(request, env, params);
  if (redirect) return redirect;
  return render(env, user, job);
}

export async function onRequestPost({ request, env, params }) {
  const { redirect, user, job } = await load(request, env, params);
  if (redirect) return redirect;
  const fd = await request.formData().catch(() => new FormData());
  const action = String(fd.get("action") || "");
  const origin = new URL(request.url).origin;
  try {
    if (action === "accept" || action === "decline") {
      const j = await partnerResponds(env, job.id, action === "accept", origin, { via: "portal" });
      return render(env, user, j, { ok: action === "accept" ? "Thanks. The customer's details are now shown above; please get in touch with them and confirm the booking here once arranged." : "Declined. Thanks for letting us know." });
    }
    if (action === "message") {
      const j = await sendMessage(env, job.id, { to: "customer", channel: String(fd.get("channel") || "sms"), body: String(fd.get("body") || ""), party: "partner", origin });
      return render(env, user, j, { ok: "Message sent." });
    }
    if (action === "book") {
      const j = await confirmBooking(env, job.id, { booked_date: String(fd.get("booked_date") || ""), booked_time: String(fd.get("booked_time") || ""), price: String(fd.get("price") || ""), party: "partner" }, origin);
      return render(env, user, j, { ok: "Booking confirmed." });
    }
    return render(env, user, job, { error: "Unknown action" });
  } catch (e) {
    return render(env, user, await getJob(env, job.id), { error: e.message });
  }
}
