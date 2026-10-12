// GET /invoice/:token — client-facing invoice view with PDF download and (if unpaid) a pay button.
import { getInvoice } from "../../_shared/db.js";
import { page, invoiceSummaryHtml } from "../../_shared/docs.js";
import { isAdmin } from "../../_shared/auth.js";

export async function onRequestGet({ request, env, params }) {
  const inv = await getInvoice(env, params.token);
  if (inv?.status === "draft" && (await isAdmin(request, env))) inv.status = "sent"; // admin preview of a draft
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
  if (!inv || inv.status === "draft") {
    return new Response(page({ title: "Invoice not found", body: `<div class="card"><h1>Invoice not found</h1><p class="muted">This link is not valid.</p></div>` }), { status: 404, headers });
  }
  const actions =
    inv.status === "sent" || inv.status === "failed"
      ? `<div class="actions"><a class="btn" href="/pay/${inv.id}">Pay this invoice</a><a class="btn secondary" href="/invoice/${inv.id}/pdf">Download PDF invoice</a></div>`
      : `<div class="actions"><a class="btn" href="/invoice/${inv.id}/pdf">Download PDF invoice</a></div>`;
  return new Response(page({ title: `Invoice ${inv.number}`, body: `<div class="card">${invoiceSummaryHtml(inv)}${actions}</div>` }), { headers });
}
