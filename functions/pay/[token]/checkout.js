// POST /pay/:token/checkout — create (or reuse) the Stripe Checkout session and redirect the client to it.
import { getInvoice } from "../../_shared/db.js";
import { ensureCheckoutSession, UserError } from "../../_shared/invoicing.js";
import { page } from "../../_shared/docs.js";

export async function onRequestPost({ request, env, params }) {
  const origin = new URL(request.url).origin;
  const inv = await getInvoice(env, params.token);
  if (!inv || inv.status === "draft") return Response.redirect(`${origin}/pay/${params.token}`, 303);
  try {
    const { url } = await ensureCheckoutSession(env, inv.id, origin);
    return Response.redirect(url, 303);
  } catch (e) {
    if (e instanceof UserError && /already been paid/.test(e.message)) return Response.redirect(`${origin}/pay/${inv.id}`, 303);
    const body = `<div class="card"><h1>Payment page unavailable</h1><p>${e instanceof UserError ? e.message : "Something went wrong creating the payment page."}</p><p class="muted small">Please try again in a few minutes, or reply to the invoice email and we'll sort it.</p><p><a class="btn secondary" href="/pay/${inv.id}">Back to invoice</a></p></div>`;
    return new Response(page({ title: "Payment unavailable", body }), { status: 502, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
}
