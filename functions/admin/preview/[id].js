// GET /admin/preview/:id — admin-only preview of everything a client/partner would receive for an invoice.
import { isAdmin } from "../../_shared/auth.js";
import { getInvoice } from "../../_shared/db.js";
import {
  clientInvoiceEmail, partnerCopyEmail, clientPaidEmail, partnerPaidEmail, partnerOf, supplierName, statusLabel, esc, links,
} from "../../_shared/docs.js";
import { gbp } from "../../_shared/money.js";

const CSS = `
:root{--paper:#fafaf8;--ink:#0c0c0c;--muted:#7a7873;--rule:#e2dfd8}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.5}
header{display:flex;align-items:center;gap:16px;padding:14px 24px;background:#fff;border-bottom:1px solid var(--rule);position:sticky;top:0}
header a{color:var(--ink)}main{max-width:1000px;margin:0 auto;padding:24px 16px 80px}
.card{background:#fff;border:1px solid var(--rule);border-radius:6px;padding:20px;margin-bottom:20px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:0 0 6px}.muted{color:var(--muted)}.small{font-size:12px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:#eee;margin-left:8px}
.subject{font-weight:600;margin:8px 0 10px}iframe{width:100%;height:560px;border:1px solid var(--rule);border-radius:4px;background:#fff}
pre{white-space:pre-wrap;background:var(--paper);border:1px solid var(--rule);border-radius:4px;padding:12px;font:13px/1.5 ui-monospace,Menlo,monospace;margin:0}
.links a{display:inline-block;margin:0 14px 8px 0;font-weight:500}.note{background:#fbf1d8;color:#8a6a1a;padding:10px 12px;border-radius:4px;margin-bottom:16px}
.meta{color:var(--muted);font-size:13px;margin:4px 0 0}
`;

export async function onRequestGet({ request, env, params }) {
  if (!(await isAdmin(request, env))) return Response.redirect(new URL("/admin", request.url).toString(), 303);
  const inv = await getInvoice(env, params.id);
  if (!inv) return new Response("Invoice not found", { status: 404 });
  const origin = new URL(request.url).origin;
  const p = partnerOf(inv);
  const L = links(origin, inv);
  const partnerTo = p.invoice_email || p.email || "(no partner email on file)";
  const clientMail = clientInvoiceEmail(inv, origin);
  const partnerMail = partnerCopyEmail(inv, origin);
  const paidSample = { ...inv, status: "paid", paid_at: inv.paid_at || new Date().toISOString(), payment_method: inv.payment_method || "card", fee_invoice_number: inv.fee_invoice_number || "DB-FEE-xxxxx" };
  const paidMail = clientPaidEmail(paidSample, origin, env);
  const partnerPaid = partnerPaidEmail(paidSample, origin);
  const srcdoc = (html) => esc(`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:16px">${html}</body></html>`);

  const body = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<title>Preview ${esc(inv.number)} · Admin · Dominic Bowkett</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" /><style>${CSS}</style></head><body>
<header><h1>Preview ${esc(inv.number)}<span class="badge">${esc(statusLabel(inv))}</span></h1><a href="/admin#inv/${inv.id}">Back to invoice</a></header>
<main>
${inv.status === "draft" ? `<p class="note">This is a draft. Nothing has been sent yet. The pay link below works for you (signed in) but will show "not found" to anyone else until the invoice is sent.</p>` : ""}
<div class="card"><h2>What the client sees</h2>
<p class="meta">${esc(inv.client_name || "")} &lt;${esc(inv.client_email)}&gt; · ${gbp(inv.amount_pence)} · ${esc(inv.service_name)}${inv.property_address ? ` · ${esc(inv.property_address)}` : ""} · supplier ${esc(supplierName(p))}</p>
<p class="links" style="margin-top:10px"><a href="${L.pay}" target="_blank">Pay page ↗</a><a href="${L.view}" target="_blank">Invoice page ↗</a><a href="${L.pdf}" target="_blank">PDF invoice ↗</a></p></div>

<div class="card"><h2>1. Invoice email to the client</h2>
<p class="meta">To: ${esc(inv.client_email)} · From: Dominic Bowkett &lt;info@dominicbowkett.com&gt; · Reply-To: info@dominicbowkett.com · a copy also goes to info@dominicbowkett.com${p.copy_invoices !== 0 ? ` and the partner (${esc(partnerTo)})` : ""}</p>
<p class="subject">Subject: ${esc(clientMail.subject)}</p>
<iframe sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${srcdoc(clientMail.html)}"></iframe></div>

<div class="card"><h2>2. Notification to the partner (plain text)</h2>
<p class="meta">To: ${esc(partnerTo)}${p.copy_invoices === 0 ? ' · <strong>not sent</strong>: "Email them a copy" is off for this partner' : ""}</p>
<p class="subject">Subject: ${esc(partnerMail.subject)}</p><pre>${esc(partnerMail.text)}</pre></div>

<div class="card"><h2>3. After payment: confirmation to the client</h2>
<p class="meta">Sent automatically when Stripe confirms the payment.</p>
<p class="subject">Subject: ${esc(paidMail.subject)}</p>
<iframe sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${srcdoc(paidMail.html)}"></iframe></div>

<div class="card"><h2>4. After payment: fee VAT invoice notice to the partner (plain text)</h2>
<p class="meta">To: ${esc(partnerTo)} · the fee invoice number is assigned when the payment lands.</p>
<p class="subject">Subject: ${esc(partnerPaid.subject)}</p><pre>${esc(partnerPaid.text)}</pre></div>
</main></body></html>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
