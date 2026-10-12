// GET /pay/:token — the client's payment page. Also the Checkout success/cancel return URL.
import { getInvoice, logEvent } from "../../_shared/db.js";
import { stripe } from "../../_shared/stripe.js";
import { reconcileSession } from "../../_shared/invoicing.js";
import { page, invoiceSummaryHtml, esc } from "../../_shared/docs.js";
import { fmtDate } from "../../_shared/money.js";

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const origin = url.origin;
  let inv = await getInvoice(env, params.token);
  if (!inv || inv.status === "draft") {
    return html(page({ title: "Invoice not found", body: `<div class="card"><h1>Invoice not found</h1><p class="muted">This link is not valid. If you received it by email, please reply to that email.</p></div>` }), 404);
  }

  const result = url.searchParams.get("result");
  const sessionId = url.searchParams.get("session_id");
  let notice = "";
  if (result === "success" && sessionId && inv.status !== "paid") {
    // Reconcile on return in case the webhook hasn't landed yet. The session id must be ours.
    if (sessionId === inv.stripe_checkout_session_id) {
      try {
        const s = await stripe(env, "GET", `/v1/checkout/sessions/${sessionId}`, {}, { account: inv.partner_account_id });
        inv = await reconcileSession(env, inv, s, origin);
        if (inv.status !== "paid" && s.payment_status === "unpaid" && s.status === "complete") {
          notice = `<p class="msg">Your payment is being processed. You'll receive an email confirmation as soon as it clears.</p>`;
        }
      } catch (e) {
        await logEvent(env, inv.id, "return.reconcile_failed", e.message);
        notice = `<p class="msg">Thanks. We're confirming your payment with Stripe; you'll get an email confirmation shortly.</p>`;
      }
    }
  } else if (result === "cancelled") {
    notice = `<p class="msg">No payment was taken. You can pay whenever you're ready.</p>`;
  }

  let action = "";
  if (inv.status === "paid") {
    action = `<p class="msg ok" style="background:#e4f3e8;color:#1b6b33;padding:12px;border-radius:4px"><strong>Paid, thank you.</strong> Received ${esc(fmtDate(inv.paid_at, { withTime: true }))}${inv.payment_method ? ` by ${esc(inv.payment_method)}` : ""}. A confirmation has been emailed to you.</p>
<div class="actions"><a class="btn" href="/invoice/${inv.id}/pdf">Download receipted invoice (PDF)</a>${inv.receipt_url ? `<a class="btn secondary" href="${esc(inv.receipt_url)}">Stripe receipt</a>` : ""}</div>`;
  } else if (inv.status === "void") {
    action = `<p class="msg" style="background:#f6e4e4;color:#8a2a2a;padding:12px;border-radius:4px">This invoice has been cancelled and is not payable.</p>`;
  } else if (inv.status === "refunded") {
    action = `<p class="msg">This invoice was paid and has since been refunded.</p>`;
  } else {
    action = `${notice}
<form method="post" action="/pay/${inv.id}/checkout" class="actions">
  <button class="btn" type="submit">Pay ${esc(fmtGbp(inv.amount_pence))} securely</button>
  <a class="btn secondary" href="/invoice/${inv.id}/pdf">Download PDF</a>
</form>
<p class="muted small" style="margin-top:14px">You'll be taken to Stripe's secure checkout. Card payments are protected by 3-D Secure; the charge appears on your statement under the supplier's name.</p>`;
  }

  return html(page({ title: `Invoice ${inv.number}`, body: `<div class="card">${invoiceSummaryHtml(inv)}${action}</div>` }));
}

function fmtGbp(p) {
  return `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
