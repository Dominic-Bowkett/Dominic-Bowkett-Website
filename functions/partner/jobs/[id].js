// GET /partner/jobs/:id — one job: details, message thread, accept/decline, quote, message the customer, confirm booking, invoice.
// POST — actions: accept | decline | ask | message | quote | book | invoice | send_invoice
import { currentPartnerUser } from "../../_shared/partner-auth.js";
import { portalPage } from "../../_shared/portal.js";
import { getJob, jobMessages, partnerResponds, sendMessage, confirmBooking, partnerToDom, sendQuote, partnerInvoice, partnerSendInvoice, partnerBreakdown, STRIPE_EST, STATUS_LABEL, JobError } from "../../_shared/jobs.js";
import { getPartner, getInvoice } from "../../_shared/db.js";
import { esc, linkify, statusLabel } from "../../_shared/docs.js";
import { fmtDate, gbp } from "../../_shared/money.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
const when = (v) => fmtDate(v, { withTime: true });
const pounds = (pence) => (pence == null ? "" : (pence / 100).toFixed(2));
const field = `style="width:100%;padding:10px;border:1px solid var(--rule);border-radius:4px;font:inherit"`;

// Fee breakdown table (partner only — customers never see this). `calc` is the data-calc group the inline script updates.
function breakdownHtml(pence, pct, calc) {
  const b = partnerBreakdown(pence || 0, pct);
  const row = (label, key, value, strong = false) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--rule)${strong ? ";font-weight:600;border-bottom:0" : ""}"><span>${label}</span><span data-out="${key}">${value}</span></div>`;
  return `<div class="small" data-calc="${calc}" data-pct="${esc(String(pct))}" style="margin-top:10px;background:var(--paper);border:1px solid var(--rule);border-radius:4px;padding:8px 12px;max-width:420px">
${row("Price to the customer", "amount", gbp(b.amount))}
${row(`Platform fee (${esc(String(pct))}% inc VAT)`, "fee", "−" + gbp(b.fee))}
${row(`Stripe processing fee (est. ${STRIPE_EST.pct}% + ${STRIPE_EST.fixed_pence}p)`, "stripe", "−" + gbp(b.stripe))}
${row("You receive (approx.)", "net", gbp(b.net), true)}
<p class="muted" style="margin:6px 0 0">For your eyes only. The platform fee is exact and comes off automatically; Stripe's fee is an estimate for a standard UK card and is taken by Stripe in your account.</p></div>`;
}

const CALC_SCRIPT = `<script>
(function(){
  var est={pct:${STRIPE_EST.pct},fixed:${STRIPE_EST.fixed_pence}};
  function gbp(p){var n=Math.abs(Math.round(p));var s=Math.floor(n/100).toLocaleString('en-GB')+'.'+String(n%100).padStart(2,'0');return (p<0?'-':'')+'£'+s;}
  document.querySelectorAll('[data-calc]').forEach(function(box){
    var input=document.querySelector('[data-calc-input="'+box.dataset.calc+'"]'); if(!input) return;
    var pct=Number(box.dataset.pct)||0;
    function update(){
      var amount=Math.round((Number(String(input.value).replace(/[£,\\s]/g,''))||0)*100); if(amount<0) amount=0;
      var fee=Math.round(amount*pct/100), stripe=amount?Math.round(amount*est.pct/100)+est.fixed:0;
      var out=function(k,v){var el=box.querySelector('[data-out="'+k+'"]'); if(el) el.textContent=v;};
      out('amount',gbp(amount)); out('fee','−'+gbp(fee)); out('stripe','−'+gbp(stripe)); out('net',gbp(amount-fee-stripe));
    }
    input.addEventListener('input',update); update();
  });
})();
</script>`;

async function render(env, user, job, { error = "", ok = "" } = {}) {
  const msgs = await jobMessages(env, job.id);
  const partner = await getPartner(env, user.stripe_account_id);
  const pct = partner?.commission_pct ?? 10;
  const invoice = job.invoice_id ? await getInvoice(env, job.invoice_id) : null;
  const mine = ["accepted", "quoted", "booked", "invoiced"].includes(job.status);
  const thread = msgs
    .map((m) => `<li style="padding:8px 0;border-bottom:1px solid var(--rule)"><span class="muted small">${esc(when(m.at))} · ${esc(m.channel)} · ${m.direction === "in" ? "from" : "to"} ${esc(m.direction === "in" ? m.party : m.counterpart || "")}</span>${m.subject && m.channel === "email" ? `<br/><span class="small"><strong>${esc(m.subject)}</strong></span>` : ""}<div style="white-space:pre-wrap">${linkify(esc(m.body))}</div></li>`)
    .join("");
  const quoteLine = job.quote_pence != null
    ? `<dt class="muted">Quote</dt><dd style="margin:0"><strong>${gbp(job.quote_pence)}</strong> ${job.quote_accepted_at ? `· <span style="color:var(--ok)">accepted by the customer ${esc(when(job.quote_accepted_at))}</span>` : job.quote_declined_at ? `· turned down ${esc(when(job.quote_declined_at))}` : job.status === "quoted" ? `· sent ${esc(when(job.quote_sent_at))}, waiting for the customer` : ""}</dd>`
    : "";
  const summary = `
<dl style="display:grid;grid-template-columns:140px 1fr;gap:4px 12px;margin:0">
<dt class="muted">Service</dt><dd style="margin:0">${esc(job.service)}</dd>
<dt class="muted">Property</dt><dd style="margin:0">${esc(job.property_address || job.postcode || "")}</dd>
${job.requested_times ? `<dt class="muted">Timing</dt><dd style="margin:0">${esc(job.requested_times)}</dd>` : ""}
${job.details ? `<dt class="muted">Customer said</dt><dd style="margin:0;white-space:pre-wrap">${linkify(esc(job.details))}</dd>` : ""}
<dt class="muted">Customer</dt><dd style="margin:0">${mine ? `${esc(job.customer_name || "")}${job.customer_phone ? ` · <a href="tel:${esc(job.customer_phone)}">${esc(job.customer_phone)}</a>` : ""}${job.customer_email ? ` · <a href="mailto:${esc(job.customer_email)}">${esc(job.customer_email)}</a>` : ""}` : `${esc(job.customer_name || "")} <span class="muted small">(contact details released when you accept)</span>`}</dd>
${quoteLine}
${job.booked_date ? `<dt class="muted">Booked</dt><dd style="margin:0"><strong>${esc(fmtDate(job.booked_date))}${job.booked_time ? ` at ${esc(job.booked_time)}` : ""}</strong>${job.price_pence != null ? ` · ${gbp(job.price_pence)}` : ""}</dd>` : ""}
${invoice ? `<dt class="muted">Invoice</dt><dd style="margin:0"><span class="mono">${esc(invoice.number)}</span> · ${gbp(invoice.amount_pence)} · <span class="badge ${esc(invoice.status)}">${esc(statusLabel(invoice))}</span> · <a href="/invoice/${esc(invoice.id)}/pdf" target="_blank">PDF</a></dd>` : ""}
</dl>`;

  let actions = "";
  if (job.status === "offered") {
    actions = `<form method="post" style="margin-top:18px">
<label for="note">Message to Dom (optional)</label>
<textarea id="note" name="note" rows="3" ${field} placeholder="e.g. I can't do the 26th but could do Tuesday 28th at 10am, or Thursday afternoon."></textarea>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
<button class="btn" name="action" value="accept">Yes, I'll take it</button>
<button class="btn secondary" name="action" value="ask">Send message only</button>
<button class="btn secondary" name="action" value="decline">No thanks</button></div>
<p class="small muted" style="margin-top:8px">If the requested time doesn't suit, say which times you can do. You can accept with a note, or just send the message and decide once Dom replies.</p>
</form>`;
  } else if (mine) {
    const canQuote = ["accepted", "quoted"].includes(job.status) && !job.quote_accepted_at && !invoice;
    const quoteCard = canQuote ? `
<div class="card"><h2>${job.status === "quoted" ? "Quote sent — waiting for the customer" : "Send the customer a quote"}</h2>
${job.status === "quoted" ? `<p class="small muted">You quoted <strong>${gbp(job.quote_pence)}</strong> on ${esc(when(job.quote_sent_at))}. They can accept by the link in the email/text or by replying YES. Sending again replaces it.</p>` : `<p class="small muted">The customer gets the price and your message by email and text, with a link to accept. Once they accept, the price carries through to the booking and the invoice.</p>`}
<form method="post"><input type="hidden" name="action" value="quote" />
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end">
<div><label>Price to the customer (£)</label><input name="price" inputmode="decimal" required placeholder="e.g. 95" value="${esc(pounds(job.quote_pence))}" data-calc-input="quote" /></div></div>
${breakdownHtml(job.quote_pence, pct, "quote")}
<label>Message to the customer (optional)</label>
<textarea name="message" rows="3" ${field} placeholder="e.g. That covers the visit and the lodged certificate. I can usually do mornings this week.">${esc(job.quote_message || "")}</textarea>
<p style="margin-top:12px"><button class="btn" type="submit">${job.status === "quoted" ? "Send new quote" : "Send quote"}</button> <span class="muted small">Sent from Dominic Bowkett's email/number with your name. The customer does not see the fee breakdown.</span></p></form></div>` : "";

    const messageCard = `
<div class="card"><h2>Send a message</h2>
<form method="post"><input type="hidden" name="action" value="message" />
<label>To</label><select name="to" style="width:auto;padding:8px;border:1px solid var(--rule);border-radius:4px"><option value="customer">The customer</option><option value="dom">Dom</option></select>
<label>Send by (customer only)</label><select name="channel" style="width:auto;padding:8px;border:1px solid var(--rule);border-radius:4px"><option value="sms" ${job.customer_phone ? "" : "disabled"}>Text message${job.customer_phone ? "" : " (no mobile on file)"}</option><option value="email" ${job.customer_email ? "" : "disabled"}>Email${job.customer_email ? "" : " (no email on file)"}</option></select>
<label>Message</label><textarea name="body" rows="4" ${field} placeholder="e.g. Hi, it's Matt from Ecocertsolutions about your EPC. Would Thursday at 10am suit?"></textarea>
<p style="margin-top:12px"><button class="btn" type="submit">Send</button> <span class="muted small">Sent from Dominic Bowkett's number / email with your name; replies come back to this page.</span></p></form></div>`;

    const bookingPrice = job.price_pence != null ? job.price_pence : job.quote_accepted_at ? job.quote_pence : null;
    const bookingCard = job.status !== "booked" && job.status !== "invoiced" ? `<div class="card"><h2>Confirm the booking</h2>
<form method="post"><input type="hidden" name="action" value="book" />
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
<div><label>Date</label><input type="date" name="booked_date" required /></div>
<div><label>Time</label><input name="booked_time" placeholder="10:00" /></div>
<div><label>Price agreed (£)</label><input name="price" inputmode="decimal" placeholder="e.g. 95" value="${esc(pounds(bookingPrice))}" /></div></div>
<p style="margin-top:12px"><button class="btn" type="submit">Confirm booked</button> <span class="muted small">The customer gets a confirmation and Dom is told.${job.quote_accepted_at ? " Price pre-filled from the accepted quote." : ""}</span></p></form></div>`
      : `<div class="card"><h2>Change the booking</h2><form method="post"><input type="hidden" name="action" value="book" /><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px"><div><label>Date</label><input type="date" name="booked_date" value="${esc(job.booked_date || "")}" required /></div><div><label>Time</label><input name="booked_time" value="${esc(job.booked_time || "")}" /></div><div><label>Price (£)</label><input name="price" value="${esc(pounds(job.price_pence))}" /></div></div><p style="margin-top:12px"><button class="btn secondary" type="submit">Update booking</button></p></form></div>`;

    let invoiceCard = "";
    if (invoice) {
      const net = invoice.amount_pence - invoice.application_fee_pence;
      invoiceCard = `<div class="card"><h2>Invoice ${esc(invoice.number)}</h2>
<p>${gbp(invoice.amount_pence)} to ${esc(invoice.client_email)} · <span class="badge ${esc(invoice.status)}">${esc(statusLabel(invoice))}</span>${invoice.paid_at ? ` · paid ${esc(fmtDate(invoice.paid_at))}` : ""}</p>
<p class="small muted">Platform fee ${gbp(invoice.application_fee_pence)} inc VAT comes off the payment automatically; you receive ${gbp(net)} less Stripe's processing fee. <a href="/invoice/${esc(invoice.id)}/pdf" target="_blank">Invoice PDF</a>${invoice.fee_invoice_number ? ` · <a href="/fee-invoice/${esc(invoice.id)}/pdf" target="_blank">Fee invoice</a>` : ""}</p>
${invoice.status === "draft" ? `<form method="post"><input type="hidden" name="action" value="send_invoice" /><p><button class="btn" type="submit">Send invoice now</button> <span class="muted small">It was saved but not sent. If this fails, check your Stripe setup on the Invoices page.</span></p></form>` : ""}
</div>`;
    } else if (["accepted", "quoted", "booked"].includes(job.status)) {
      const amount = job.price_pence != null ? job.price_pence : job.quote_pence;
      invoiceCard = `<div class="card"><h2>Invoice the customer</h2>
<p class="small muted">${job.status === "booked" ? "Once the job is done, send the invoice from here." : "Usually done after the visit; you can send it now if the work is complete."} The customer gets the invoice by email with a secure payment link; the money goes to your Stripe account with the platform fee taken off, and Dom gets a copy.</p>
<form method="post"><input type="hidden" name="action" value="invoice" />
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end">
<div><label>Amount (£)</label><input name="amount" inputmode="decimal" required placeholder="e.g. 95" value="${esc(pounds(amount))}" data-calc-input="invoice" /></div>
${job.customer_email ? "" : `<div><label>Customer's email (none on file)</label><input name="customer_email" type="email" required placeholder="customer@example.com" /></div>`}</div>
<p class="small muted" style="margin-top:6px">${job.quote_accepted_at ? `Pre-filled from the accepted quote of ${gbp(job.quote_pence)}; change it if extras were agreed.` : amount != null ? "Pre-filled from the job; change it if needed." : ""}</p>
${breakdownHtml(amount, pct, "invoice")}
<label>Message to the customer (optional)</label>
<textarea name="client_message" rows="3" ${field} placeholder="e.g. Thank you for having me yesterday. The certificate is lodged and the link is below."></textarea>
<label>Link to the EPC certificate (optional)</label>
<input name="certificate_url" type="url" placeholder="https://find-energy-certificate.service.gov.uk/energy-certificate/..." />
<p style="margin-top:12px"><button class="btn" type="submit">Send invoice</button> <span class="muted small">Goes straight out; there is no draft step. Check the amount first.</span></p></form></div>`;
    }
    actions = `${quoteCard}${messageCard}${bookingCard}${invoiceCard}`;
  }
  const body = `
<p style="margin:0 0 16px"><a href="/partner/jobs">← Your jobs</a></p>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}${ok ? `<p class="msg ok">${esc(ok)}</p>` : ""}
<div class="card"><h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${esc(job.ref)} <span class="badge ${job.status === "booked" || job.status === "invoiced" ? "paid" : job.status === "offered" || job.status === "quoted" ? "sent" : ""}">${esc(STATUS_LABEL[job.status] || job.status)}</span></h1>
${summary}${job.status === "offered" ? actions : ""}</div>
${job.status === "offered" ? "" : actions}
<div class="card"><h2>Messages</h2><ul style="list-style:none;padding:0;margin:0">${thread || "<li class='muted'>Nothing yet</li>"}</ul></div>
${CALC_SCRIPT}`;
  return new Response(portalPage({ title: job.ref, body, user }), { headers });
}

async function load(request, env, params) {
  const user = await currentPartnerUser(request, env);
  if (!user) return { redirect: Response.redirect(new URL(`/partner?next=${encodeURIComponent(`/partner/jobs/${params.id}`)}`, request.url).toString(), 303) };
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
  const s = (k) => String(fd.get(k) || "");
  const origin = new URL(request.url).origin;
  try {
    if (action === "ask") {
      const j = await partnerToDom(env, job.id, s("note"), origin);
      return render(env, user, j, { ok: "Message sent to Dom. He'll reply by email or here, and the job stays open for you." });
    }
    if (action === "accept" || action === "decline") {
      const note = s("note").trim().slice(0, 1000);
      const j = await partnerResponds(env, job.id, action === "accept", origin, { via: "portal", note });
      return render(env, user, j, { ok: action === "accept" ? "Thanks. The customer's details are now shown above; please get in touch with them and confirm the booking here once arranged." : "Declined. Thanks for letting us know." });
    }
    if (action === "message") {
      if (s("to") === "dom") {
        const j = await partnerToDom(env, job.id, s("body"), origin);
        return render(env, user, j, { ok: "Message sent to Dom." });
      }
      const j = await sendMessage(env, job.id, { to: "customer", channel: s("channel") || "sms", body: s("body"), party: "partner", origin });
      return render(env, user, j, { ok: "Message sent." });
    }
    if (action === "quote") {
      const j = await sendQuote(env, job.id, { price: s("price"), message: s("message") }, origin);
      return render(env, user, j, { ok: `Quote of ${gbp(j.quote_pence)} sent. You'll get an email and a text when the customer accepts.` });
    }
    if (action === "book") {
      const j = await confirmBooking(env, job.id, { booked_date: s("booked_date"), booked_time: s("booked_time"), price: s("price"), party: "partner" }, origin);
      return render(env, user, j, { ok: "Booking confirmed." });
    }
    if (action === "invoice") {
      const { job: j, invoice } = await partnerInvoice(env, job.id, { amount: s("amount"), client_message: s("client_message"), certificate_url: s("certificate_url"), customer_email: s("customer_email") }, origin);
      return render(env, user, j, { ok: `Invoice ${invoice.number} for ${gbp(invoice.amount_pence)} sent to ${invoice.client_email}. You'll be emailed when it's paid.` });
    }
    if (action === "send_invoice") {
      const { job: j, invoice } = await partnerSendInvoice(env, job.id, origin);
      return render(env, user, j, { ok: `Invoice ${invoice.number} sent to ${invoice.client_email}.` });
    }
    return render(env, user, job, { error: "Unknown action" });
  } catch (e) {
    return render(env, user, await getJob(env, job.id), { error: e.message });
  }
}
