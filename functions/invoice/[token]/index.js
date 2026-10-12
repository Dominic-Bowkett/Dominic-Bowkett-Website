// GET /invoice/:token — client-facing invoice view with PDF download and (if unpaid) a pay button.
import { getInvoice } from "../../_shared/db.js";
import { page, invoiceSummaryHtml } from "../../_shared/docs.js";

export async function onRequestGet({ env, params }) {
  const inv = await getInvoice(env, params.token);
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
  if (!inv || inv.status === "draft") {
    return new Response(page({ title: "Invoice not found", body: `<div class="card"><h1>Invoice not found</h1><p class="muted">This link is not valid.</p></div>` }), { status: 404, headers });
  }
  const actions =
    inv.status === "sent" || inv.status === "failed"
      ? `<div class="actions"><a class="btn" href="/pay/${inv.id}">Pay this invoice</a><a class="btn secondary" href="/invoice/${inv.id}/pdf">Download PDF</a></div>`
      : `<div class="actions"><a class="btn" href="/invoice/${inv.id}/pdf">Download PDF</a></div>`;
  return new Response(page({ title: `Invoice ${inv.number}`, body: `<div class="card">${invoiceSummaryHtml(inv)}${actions}</div>` }), { headers });
}
