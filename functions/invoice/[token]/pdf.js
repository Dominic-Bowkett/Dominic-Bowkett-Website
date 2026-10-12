// GET /invoice/:token/pdf — the client invoice as a PDF (receipted once paid).
import { getInvoice } from "../../_shared/db.js";
import { clientInvoicePdf } from "../../_shared/docs.js";
import { isAdmin } from "../../_shared/auth.js";

export async function onRequestGet({ request, env, params }) {
  const inv = await getInvoice(env, params.token);
  if (!inv || (inv.status === "draft" && !(await isAdmin(request, env)))) return new Response("Not found", { status: 404 });
  const bytes = clientInvoicePdf(inv, env, new URL(request.url).origin);
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${inv.number}${inv.status === "paid" ? "-paid" : ""}.pdf"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
