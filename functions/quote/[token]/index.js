// GET /quote/:token — the customer's view of a partner's quote, with Accept. POST accept | decline.
// Public by unguessable token, like the pay page. Shows the price only — never the platform fee.
import { getJobByQuoteToken, customerQuoteResponds, STATUS_LABEL } from "../../_shared/jobs.js";
import { getPartner } from "../../_shared/db.js";
import { page, esc, linkify } from "../../_shared/docs.js";
import { gbp, fmtDate } from "../../_shared/money.js";

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

function notFound() {
  return html(page({ title: "Quote not found", section: "Quotes", body: `<div class="card"><h1>Quote not found</h1><p class="muted">This link is not valid. If you received it by email or text, please reply to that message.</p></div>` }), 404);
}

async function view(env, job, { notice = "" } = {}) {
  const p = await getPartner(env, job.partner_account_id);
  const who = p?.contact_name || p?.display_name || p?.business_name || "your assessor";
  const firm = p?.display_name || p?.business_name || "";
  const accepted = !!job.quote_accepted_at;
  const open = job.status === "quoted";
  const state = accepted
    ? `<p><span class="badge paid">Accepted</span> <span class="muted small">on ${esc(fmtDate(job.quote_accepted_at))}</span></p><p>Thank you. ${esc(who)} will be in touch to confirm the date and time${job.booked_date ? `: booked for <strong>${esc(fmtDate(job.booked_date))}${job.booked_time ? ` at ${esc(job.booked_time)}` : ""}</strong>` : ""}. Your invoice with a secure payment link will follow.</p>`
    : open
      ? `<form method="post" class="actions"><button class="btn" name="action" value="accept" type="submit">Accept this quote</button><button class="btn secondary" name="action" value="decline" type="submit">Not for me</button></form>
<p class="small muted" style="margin-top:14px">Accepting lets ${esc(who)} go ahead and arrange a date with you. Nothing is paid now; you'll get an invoice with a payment link once the work is done. Questions? Reply to the email or text you received.</p>`
      : `<p><span class="badge">${esc(STATUS_LABEL[job.status] || job.status)}</span></p><p class="muted">This quote is no longer open. If you'd like to go ahead, reply to the email or text you received and we'll sort it out.</p>`;
  const body = `${notice}<div class="card">
<h1>Quote for your ${esc(job.service)}</h1>
<p class="muted small">${esc(job.ref)}${job.quote_sent_at ? ` · sent ${esc(fmtDate(job.quote_sent_at))}` : ""}</p>
<h2>Property</h2><p>${esc(job.property_address || job.postcode || "")}</p>
<h2>Assessor</h2><p>${esc(who)}${firm && firm !== who ? `<br/><span class="muted small">${esc(firm)}</span>` : ""}<br/><span class="muted small">working with Dominic Bowkett</span></p>
${job.quote_message ? `<h2>Note from ${esc(who)}</h2><p><pre>${linkify(esc(job.quote_message))}</pre></p>` : ""}
<div class="row total" style="margin-top:18px"><span>Price</span><span>${gbp(job.quote_pence || 0)}</span></div>
<p class="small muted">This is the total for the work described; it does not change on acceptance.</p>
${state}
</div>`;
  return html(page({ title: `Quote ${gbp(job.quote_pence || 0)}`, section: "Quotes", body }));
}

export async function onRequestGet({ env, params }) {
  const job = await getJobByQuoteToken(env, params.token);
  if (!job || job.quote_pence == null) return notFound();
  return view(env, job);
}

export async function onRequestPost({ request, env, params }) {
  const job = await getJobByQuoteToken(env, params.token);
  if (!job || job.quote_pence == null) return notFound();
  const fd = await request.formData().catch(() => new FormData());
  const action = String(fd.get("action") || "");
  const origin = new URL(request.url).origin;
  if (action !== "accept" && action !== "decline") return view(env, job);
  try {
    const fresh = await customerQuoteResponds(env, job.id, action === "accept", origin, { via: "link" });
    return view(env, fresh, { notice: action === "accept" ? "" : `<p class="msg" style="margin-bottom:16px">Thanks for letting us know. If anything changes, just reply to the email or text you received.</p>` });
  } catch (e) {
    return view(env, job, { notice: `<p class="msg" style="margin-bottom:16px;color:var(--bad)">${esc(e.message)}</p>` });
  }
}
