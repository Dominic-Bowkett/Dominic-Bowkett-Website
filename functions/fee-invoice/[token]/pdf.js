// GET /fee-invoice/:token/pdf — Dom's VAT invoice to the partner for the platform fee (exists once paid).
import { getInvoice } from "../../_shared/db.js";
import { feeInvoicePdf } from "../../_shared/docs.js";

export async function onRequestGet({ env, params }) {
  const inv = await getInvoice(env, params.token);
  if (!inv || inv.status !== "paid" && inv.status !== "refunded" || !inv.fee_invoice_number) return new Response("Not found", { status: 404 });
  return new Response(feeInvoicePdf(inv, env), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${inv.fee_invoice_number}.pdf"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
