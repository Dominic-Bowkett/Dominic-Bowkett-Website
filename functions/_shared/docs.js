// Invoice documents: PDFs, the client-facing HTML page, and email bodies.
import { PDF } from "./pdf.js";
import { gbp, splitGross, fmtDate } from "./money.js";
import { platform } from "./business.js";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Turn URLs and email addresses in already-escaped text into clickable links.
export function linkify(escaped) {
  return String(escaped || "")
    .replace(/(https?:\/\/[^\s<]+?)([.,;:!?)]*)(?=\s|$|<)/g, '<a href="$1" style="color:#0c0c0c;">$1</a>$2')
    .replace(/(^|[\s(>])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2" style="color:#0c0c0c;">$2</a>');
}

export function partnerOf(inv) {
  try { return inv.partner_snapshot ? JSON.parse(inv.partner_snapshot) : {}; } catch { return {}; }
}

export function supplierName(p) {
  return p.display_name || p.business_name || "Supplier";
}

export function links(origin, inv) {
  return {
    pay: `${origin}/pay/${inv.id}`,
    view: `${origin}/invoice/${inv.id}`,
    pdf: `${origin}/invoice/${inv.id}/pdf`,
    feePdf: `${origin}/fee-invoice/${inv.id}/pdf`,
  };
}

// One plain sentence about VAT, shown wherever the client sees the invoice.
export function vatStatement(inv) {
  const p = partnerOf(inv);
  const name = supplierName(p);
  if (inv.client_vat_rate) {
    const { vat } = splitGross(inv.amount_pence, inv.client_vat_rate);
    return `VAT: ${name} is VAT registered${p.vat_number ? ` (VAT No. ${p.vat_number})` : ""}. This invoice includes VAT at ${inv.client_vat_rate}% (${gbp(vat)}).`;
  }
  return p.vat_number
    ? `VAT: no VAT is charged on this invoice.`
    : `VAT: ${name} is not VAT registered, so no VAT is charged on this invoice.`;
}

export function statusLabel(inv) {
  return { draft: "Draft", sent: "Awaiting payment", paid: "Paid", failed: "Payment failed", void: "Cancelled", refunded: "Refunded" }[inv.status] || inv.status;
}

function billTo(inv) {
  const lines = [];
  if (inv.bill_to_business) lines.push(inv.bill_to_business);
  if (inv.client_name) lines.push(inv.client_name);
  if (inv.bill_to_address) lines.push(...inv.bill_to_address.split(/\r?\n/).filter(Boolean));
  if (inv.client_email) lines.push(inv.client_email);
  return lines;
}

// ---------------------------------------------------------------- client invoice PDF

export function clientInvoicePdf(inv, env, origin) {
  const biz = platform(env);
  const p = partnerOf(inv);
  const pdf = new PDF();
  const M = pdf.margin;
  const R = pdf.width - M;

  // Header
  pdf.textAt(M, pdf.y - 18, inv.status === "paid" ? "RECEIPTED INVOICE" : "INVOICE", { size: 18, bold: true });
  pdf.textRight(R, pdf.y - 18, inv.number || "", { size: 12, bold: true });
  pdf.textRight(R, pdf.y - 34, `Issued ${fmtDate(inv.issued_at || inv.created_at)}`, { size: 9, color: "0.48 0.47 0.45" });
  if (inv.due_date && inv.status !== "paid") pdf.textRight(R, pdf.y - 46, `Due ${fmtDate(inv.due_date)}`, { size: 9, color: "0.48 0.47 0.45" });
  if (inv.status === "paid") pdf.textRight(R, pdf.y - 46, `Paid ${fmtDate(inv.paid_at, { withTime: true })}`, { size: 9, bold: true, color: "0.1 0.45 0.2" });
  pdf.space(64);
  pdf.rule();
  pdf.space(16);

  // From / To columns
  const colTop = pdf.y;
  const col2 = M + pdf.contentWidth / 2 + 10;
  pdf.line("FROM", { size: 8, bold: true, color: "0.48 0.47 0.45" });
  pdf.line(supplierName(p), { size: 10, bold: true });
  if (p.business_name && p.display_name && p.business_name !== p.display_name) pdf.line(p.business_name, { size: 9 });
  if (p.address) pdf.paragraph(p.address, { size: 9, maxWidth: pdf.contentWidth / 2 - 20 });
  if (p.invoice_email || p.email) pdf.line(p.invoice_email || p.email, { size: 9 });
  if (p.phone) pdf.line(p.phone, { size: 9 });
  if (inv.client_vat_rate && p.vat_number) pdf.line(`VAT No. ${p.vat_number}`, { size: 9 });
  const leftBottom = pdf.y;

  pdf.y = colTop;
  pdf.line("BILL TO", { size: 8, bold: true, color: "0.48 0.47 0.45", x: col2 });
  for (const [i, l] of billTo(inv).entries()) pdf.line(l, { size: i === 0 ? 10 : 9, bold: i === 0, x: col2 });
  pdf.y = Math.min(leftBottom, pdf.y) - 14;

  if (inv.property_address) {
    pdf.line("PROPERTY", { size: 8, bold: true, color: "0.48 0.47 0.45" });
    pdf.paragraph(inv.property_address, { size: 10 });
    pdf.space(10);
  }

  // Line items table
  const { net, vat } = splitGross(inv.amount_pence, inv.client_vat_rate || 0);
  pdf.ensure(120);
  pdf.rect(M, pdf.y - 18, pdf.contentWidth, 18);
  pdf.textAt(M + 8, pdf.y - 13, "DESCRIPTION", { size: 8, bold: true, color: "0.48 0.47 0.45" });
  pdf.textRight(R - 8, pdf.y - 13, "AMOUNT", { size: 8, bold: true, color: "0.48 0.47 0.45" });
  pdf.space(26);
  const amtY = pdf.y - 10;
  pdf.line(inv.service_name, { size: 10, bold: true, x: M + 8 });
  pdf.textRight(R - 8, amtY, gbp(net), { size: 10 });
  if (inv.description) pdf.paragraph(inv.description, { size: 9, x: M + 8, maxWidth: pdf.contentWidth - 120, color: "0.3 0.3 0.3" });
  pdf.space(8);
  pdf.rule();
  pdf.space(14);

  const totY = () => pdf.y - 10;
  const row = (label, value, bold = false) => {
    pdf.ensure(18);
    pdf.textAt(R - 220, totY(), label, { size: 10, bold });
    pdf.textRight(R - 8, totY(), value, { size: 10, bold });
    pdf.space(16);
  };
  if (inv.client_vat_rate) {
    row("Subtotal", gbp(net));
    row(`VAT at ${inv.client_vat_rate}%`, gbp(vat));
  }
  row(inv.status === "paid" ? "Total paid" : "Total due", gbp(inv.amount_pence), true);
  pdf.space(12);

  // Payment box
  pdf.ensure(80);
  if (inv.status === "paid") {
    pdf.rect(M, pdf.y - 56, pdf.contentWidth, 56, "0.93 0.97 0.94");
    pdf.textAt(M + 12, pdf.y - 20, "Paid in full. Thank you.", { size: 11, bold: true, color: "0.1 0.45 0.2" });
    pdf.textAt(M + 12, pdf.y - 36, `Paid ${fmtDate(inv.paid_at, { withTime: true })}${inv.payment_method ? ` by ${inv.payment_method}` : ""} via Stripe.`, { size: 9 });
    if (inv.stripe_payment_intent_id) pdf.textAt(M + 12, pdf.y - 49, `Payment reference ${inv.stripe_payment_intent_id}`, { size: 8, color: "0.48 0.47 0.45" });
  } else if (inv.status === "void") {
    pdf.rect(M, pdf.y - 40, pdf.contentWidth, 40, "0.97 0.95 0.95");
    pdf.textAt(M + 12, pdf.y - 24, "This invoice has been cancelled and is not payable.", { size: 10, bold: true });
  } else {
    pdf.rect(M, pdf.y - 56, pdf.contentWidth, 56);
    pdf.textAt(M + 12, pdf.y - 20, "How to pay", { size: 11, bold: true });
    pdf.textAt(M + 12, pdf.y - 36, "Pay securely online by card or bank at:", { size: 9 });
    pdf.textAt(M + 12, pdf.y - 49, links(origin, inv).pay, { size: 9, bold: true });
  }
  pdf.space(72);

  // Footer
  pdf.ensure(80);
  pdf.rule();
  pdf.space(10);
  pdf.paragraph(vatStatement(inv), { size: 9, bold: true });
  pdf.space(4);
  pdf.paragraph(
    `Invoice issued on behalf of ${supplierName(p)} and administered by ${biz.legalName}, ${biz.address}. ` +
      `Company No. ${biz.companyNo}. Payments are processed by Stripe; the charge will appear on your statement under the supplier's name. ` +
      `Questions: ${biz.email}`,
    { size: 7.5, color: "0.48 0.47 0.45" }
  );
  return pdf.build({
    title: `${inv.status === "paid" ? "Receipted invoice" : "Invoice"} ${inv.number} — ${inv.service_name}${inv.property_address ? ` — ${inv.property_address}` : ""}`,
    author: supplierName(p),
    subject: `${inv.service_name} for ${inv.bill_to_business || inv.client_name || inv.client_email}`,
  });
}

// ---------------------------------------------------------------- platform fee invoice PDF (to partner)

export function feeInvoicePdf(inv, env) {
  const biz = platform(env);
  const p = partnerOf(inv);
  const pdf = new PDF();
  const M = pdf.margin;
  const R = pdf.width - M;

  pdf.textAt(M, pdf.y - 18, "VAT INVOICE", { size: 18, bold: true });
  pdf.textRight(R, pdf.y - 18, inv.fee_invoice_number || "", { size: 12, bold: true });
  pdf.textRight(R, pdf.y - 34, `Date ${fmtDate(inv.paid_at || inv.created_at)}`, { size: 9, color: "0.48 0.47 0.45" });
  pdf.textRight(R, pdf.y - 46, `Tax point ${fmtDate(inv.paid_at || inv.created_at)}`, { size: 9, color: "0.48 0.47 0.45" });
  pdf.space(64);
  pdf.rule();
  pdf.space(16);

  const colTop = pdf.y;
  const col2 = M + pdf.contentWidth / 2 + 10;
  pdf.line("FROM", { size: 8, bold: true, color: "0.48 0.47 0.45" });
  pdf.line(biz.legalName, { size: 10, bold: true });
  pdf.paragraph(biz.address, { size: 9, maxWidth: pdf.contentWidth / 2 - 20 });
  pdf.line(`Company No. ${biz.companyNo}`, { size: 9 });
  pdf.line(`VAT No. ${biz.vatNo}`, { size: 9 });
  pdf.line(biz.email, { size: 9 });
  const leftBottom = pdf.y;

  pdf.y = colTop;
  pdf.line("TO", { size: 8, bold: true, color: "0.48 0.47 0.45", x: col2 });
  pdf.line(supplierName(p), { size: 10, bold: true, x: col2 });
  if (p.business_name && p.display_name && p.business_name !== p.display_name) pdf.line(p.business_name, { size: 9, x: col2 });
  if (p.address) pdf.paragraph(p.address, { size: 9, x: col2 });
  if (p.invoice_email || p.email) pdf.line(p.invoice_email || p.email, { size: 9, x: col2 });
  if (p.vat_number) pdf.line(`VAT No. ${p.vat_number}`, { size: 9, x: col2 });
  pdf.line(`Stripe account ${inv.partner_account_id}`, { size: 8, x: col2, color: "0.48 0.47 0.45" });
  pdf.y = Math.min(leftBottom, pdf.y) - 18;

  pdf.rect(M, pdf.y - 18, pdf.contentWidth, 18);
  pdf.textAt(M + 8, pdf.y - 13, "DESCRIPTION", { size: 8, bold: true, color: "0.48 0.47 0.45" });
  pdf.textRight(R - 8, pdf.y - 13, "NET", { size: 8, bold: true, color: "0.48 0.47 0.45" });
  pdf.space(26);
  const amtY = pdf.y - 10;
  pdf.line(`Platform fee: invoice ${inv.number} (${inv.service_name})`, { size: 10, bold: true, x: M + 8 });
  pdf.textRight(R - 8, amtY, gbp(inv.fee_net_pence), { size: 10 });
  pdf.paragraph(
    `Client ${inv.bill_to_business || inv.client_name || inv.client_email}${inv.property_address ? ` at ${inv.property_address}` : ""}. ` +
      `Gross invoice value ${gbp(inv.amount_pence)}, paid ${fmtDate(inv.paid_at, { withTime: true })}.`,
    { size: 9, x: M + 8, maxWidth: pdf.contentWidth - 120, color: "0.3 0.3 0.3" }
  );
  pdf.space(8);
  pdf.rule();
  pdf.space(14);
  const row = (label, value, bold = false) => {
    pdf.textAt(R - 220, pdf.y - 10, label, { size: 10, bold });
    pdf.textRight(R - 8, pdf.y - 10, value, { size: 10, bold });
    pdf.space(16);
  };
  row("Net", gbp(inv.fee_net_pence));
  row(`VAT at ${inv.fee_vat_rate}%`, gbp(inv.fee_vat_pence));
  row("Total", gbp(inv.application_fee_pence), true);
  pdf.space(12);

  pdf.rect(M, pdf.y - 44, pdf.contentWidth, 44, "0.93 0.97 0.94");
  pdf.textAt(M + 12, pdf.y - 18, "Settled: nothing further to pay.", { size: 11, bold: true, color: "0.1 0.45 0.2" });
  pdf.textAt(M + 12, pdf.y - 34, `Collected as a Stripe application fee${inv.stripe_application_fee_id ? ` (${inv.stripe_application_fee_id})` : ""} from the payment for ${inv.number}.`, { size: 9 });
  pdf.space(60);
  pdf.rule();
  pdf.space(10);
  pdf.paragraph(`${biz.legalName}, ${biz.address}. Registered in England, Company No. ${biz.companyNo}. VAT ${biz.vatNo}.`, { size: 7.5, color: "0.48 0.47 0.45" });
  return pdf.build({
    title: `VAT invoice ${inv.fee_invoice_number} — platform fee for ${inv.number}`,
    author: biz.legalName,
    subject: `Platform fee for invoice ${inv.number} (${inv.service_name})`,
  });
}

// ---------------------------------------------------------------- HTML page shell (client-facing)

export function page({ title, body, noindex = true, section = "Invoicing" }) {
  return `<!doctype html><html lang="en-GB"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
${noindex ? '<meta name="robots" content="noindex, nofollow" />' : ""}
<title>${esc(title)} · Dominic Bowkett</title>
<link rel="icon" href="/favicon.ico" sizes="any" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root{--paper:#fafaf8;--ink:#0c0c0c;--muted:#7a7873;--rule:#e2dfd8;--ok:#1b6b33;--bad:#8a2a2a}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.55}
main{max-width:640px;margin:0 auto;padding:40px 16px 64px}
.card{background:#fff;border:1px solid var(--rule);border-radius:6px;padding:clamp(24px,5vw,40px)}
h1{font-size:22px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}h2{font-size:14px;font-weight:600;margin:24px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
p{margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:13px}
.row{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--rule)}.row.total{font-weight:600;border-bottom:0;font-size:17px}
.btn{display:inline-block;background:var(--ink);color:#fff;text-decoration:none;padding:14px 22px;border-radius:4px;font-weight:600;border:0;font:inherit;cursor:pointer}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#eee}
.badge.paid{background:#e4f3e8;color:var(--ok)}.badge.bad{background:#f6e4e4;color:var(--bad)}
.brand{font-size:13px;color:var(--muted);margin-bottom:18px}.brand a{color:inherit;text-decoration:none;font-weight:600}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}
pre{white-space:pre-wrap;font:inherit;margin:0}
</style></head><body><main>
<div class="brand"><a href="https://www.dominicbowkett.com/">Dominic Bowkett</a> · ${esc(section)}</div>
${body}
</main></body></html>`;
}

export function invoiceSummaryHtml(inv) {
  const { net, vat } = splitGross(inv.amount_pence, inv.client_vat_rate || 0);
  const p = partnerOf(inv);
  const badge = inv.status === "paid" ? "paid" : ["failed", "void"].includes(inv.status) ? "bad" : "";
  return `
<p><span class="badge ${badge}">${esc(statusLabel(inv))}</span></p>
<h1>${esc(inv.service_name)}</h1>
<p class="muted small">Invoice ${esc(inv.number)} · issued ${esc(fmtDate(inv.issued_at || inv.created_at))}${inv.due_date && inv.status === "sent" ? ` · due ${esc(fmtDate(inv.due_date))}` : ""}</p>
<h2>Billed to</h2>
<p>${billTo(inv).map(esc).join("<br/>")}</p>
${inv.property_address ? `<h2>Property</h2><p>${esc(inv.property_address).replace(/\n/g, "<br/>")}</p>` : ""}
<h2>From</h2>
<p>${esc(supplierName(p))}${p.business_name && p.display_name && p.business_name !== p.display_name ? `<br/><span class="small">${esc(p.business_name)}</span>` : ""}${p.address ? `<br/><span class="muted small">${esc(p.address)}</span>` : ""}${p.invoice_email || p.email ? `<br/><span class="muted small">${esc(p.invoice_email || p.email)}</span>` : ""}${p.phone ? `<br/><span class="muted small">${esc(p.phone)}</span>` : ""}${inv.client_vat_rate && p.vat_number ? `<br/><span class="muted small">VAT No. ${esc(p.vat_number)}</span>` : ""}</p>
<h2>Details</h2>
${inv.description ? `<p class="small"><pre>${linkify(esc(inv.description))}</pre></p>` : ""}
<div class="row"><span>${esc(inv.service_name)}</span><span>${gbp(net)}</span></div>
${inv.client_vat_rate ? `<div class="row"><span>VAT at ${inv.client_vat_rate}%</span><span>${gbp(vat)}</span></div>` : ""}
<div class="row total"><span>${inv.status === "paid" ? "Total paid" : "Total due"}</span><span>${gbp(inv.amount_pence)}</span></div>
<p class="small" style="margin-top:14px;padding:10px 12px;background:var(--paper);border:1px solid var(--rule);border-radius:4px;"><strong>${esc(vatStatement(inv))}</strong></p>`;
}

// ---------------------------------------------------------------- emails

function emailShell(inner) {
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0c0c0c;line-height:1.6;max-width:600px;">${inner}
<p style="font-size:12px;color:#7a7873;margin-top:28px;border-top:1px solid #e2dfd8;padding-top:14px;">Dominic Bowkett · EMS-2 Ltd, 128 City Road, London, EC1V 2NX · Company No. 11235441 · info@dominicbowkett.com</p></div>`;
}

const btn = (href, label) =>
  `<p style="margin:22px 0;"><a href="${href}" style="background:#0c0c0c;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:600;display:inline-block;">${label}</a></p>`;

export function clientInvoiceEmail(inv, origin) {
  const L = links(origin, inv);
  const p = partnerOf(inv);
  const who = inv.client_name ? `Hello ${esc(inv.client_name.split(" ")[0])},` : "Hello,";
  return {
    subject: `Invoice ${inv.number} — ${inv.service_name} — ${gbp(inv.amount_pence)}`,
    html: emailShell(`
<p>${who}</p>
${inv.client_message ? `<p style="white-space:pre-wrap;">${linkify(esc(inv.client_message))}</p>` : ""}
<p>Please find your invoice for <strong>${esc(inv.service_name)}</strong>${inv.property_address ? ` at ${esc(inv.property_address)}` : ""}, carried out by ${esc(supplierName(p))}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:15px;">
<tr><td style="padding:4px 24px 4px 0;color:#7a7873;">Invoice</td><td>${esc(inv.number)}</td></tr>
<tr><td style="padding:4px 24px 4px 0;color:#7a7873;">Amount due</td><td><strong>${gbp(inv.amount_pence)}</strong></td></tr>
${inv.due_date ? `<tr><td style="padding:4px 24px 4px 0;color:#7a7873;">Due</td><td>${esc(fmtDate(inv.due_date))}</td></tr>` : ""}
<tr><td style="padding:4px 24px 4px 0;color:#7a7873;vertical-align:top;">Supplier</td><td>${esc(supplierName(p))}${p.address ? `<br/><span style="color:#7a7873;font-size:13px;">${esc(p.address)}</span>` : ""}</td></tr>
</table>
<p style="font-size:13px;"><strong>${esc(vatStatement(inv))}</strong></p>
${btn(L.pay, "Pay this invoice")}
<p style="font-size:13px;color:#7a7873;">You can view the invoice or download a PDF copy at any time: <a href="${L.view}" style="color:#0c0c0c;">${L.view}</a></p>
<p>Payment is taken securely by Stripe. If anything on the invoice looks wrong, reply to this email before paying.</p>
<p>Thank you,<br/>Dominic Bowkett</p>`),
  };
}

export function partnerCopyEmail(inv, origin) {
  const L = links(origin, inv);
  return {
    subject: `Copy: invoice ${inv.number} sent to ${inv.client_email} — ${gbp(inv.amount_pence)}`,
    text:
      `Copy of invoice sent on your behalf.\n\n` +
      `Invoice: ${inv.number}\nClient: ${inv.client_name || ""} <${inv.client_email}>\n` +
      (inv.bill_to_business ? `Billed to: ${inv.bill_to_business}\n` : "") +
      (inv.property_address ? `Property: ${inv.property_address}\n` : "") +
      `Service: ${inv.service_name}\nAmount: ${gbp(inv.amount_pence)}${inv.client_vat_rate ? ` (inc VAT at ${inv.client_vat_rate}%)` : ""}\n` +
      `Platform fee: ${gbp(inv.application_fee_pence)} inc VAT (${gbp(inv.fee_net_pence)} + VAT ${gbp(inv.fee_vat_pence)}), deducted from the payment; a VAT invoice follows once paid\n` +
      `You receive: ${gbp(inv.amount_pence - inv.application_fee_pence)} less Stripe's processing fee\n\n` +
      `View / PDF: ${L.view}\nPay link given to the client: ${L.pay}\n`,
  };
}

// Payment reminder n (1..REMINDER_MAX) to the client.
export const REMINDER_DAYS = 7;
export const REMINDER_MAX = 4;
export function clientReminderEmail(inv, origin, n) {
  const L = links(origin, inv);
  const p = partnerOf(inv);
  const who = inv.client_name ? `Hello ${esc(inv.client_name.split(" ")[0])},` : "Hello,";
  const final = n >= REMINDER_MAX;
  const overdue = inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
  return {
    subject: `${final ? "Final reminder" : "Reminder"}: invoice ${inv.number} — ${gbp(inv.amount_pence)} ${overdue ? "overdue" : "outstanding"}`,
    html: emailShell(`
<p>${who}</p>
<p>${final ? "This is a final reminder that" : "A quick reminder that"} invoice <strong>${esc(inv.number)}</strong> for <strong>${esc(inv.service_name)}</strong>${inv.property_address ? ` at ${esc(inv.property_address)}` : ""} (${esc(supplierName(p))}) is still outstanding.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:15px;">
<tr><td style="padding:4px 24px 4px 0;color:#7a7873;">Amount due</td><td><strong>${gbp(inv.amount_pence)}</strong></td></tr>
<tr><td style="padding:4px 24px 4px 0;color:#7a7873;">Invoice date</td><td>${esc(fmtDate(inv.issued_at || inv.created_at))}</td></tr>
${inv.due_date ? `<tr><td style="padding:4px 24px 4px 0;color:#7a7873;">${overdue ? "Was due" : "Due"}</td><td>${esc(fmtDate(inv.due_date))}</td></tr>` : ""}
</table>
${btn(L.pay, "Pay this invoice")}
<p style="font-size:13px;color:#7a7873;">View or download the invoice: <a href="${L.view}" style="color:#0c0c0c;">${L.view}</a></p>
${final ? `<p>If payment is not received within the next 7 days we will have to take further steps to recover the amount. If there is a problem with the invoice, please reply to this email so we can sort it out.</p>` : `<p>If you've already paid, thank you and please ignore this. If there's a problem with the invoice, just reply to this email.</p>`}
<p>Kind regards,<br/>Dominic Bowkett</p>`),
  };
}

export function clientPaidEmail(inv, origin, env) {
  const L = links(origin, inv);
  const biz = platform(env);
  const who = inv.client_name ? `Hello ${esc(inv.client_name.split(" ")[0])},` : "Hello,";
  return {
    subject: `Payment received — ${inv.number} — ${gbp(inv.amount_pence)}`,
    html: emailShell(`
<p>${who}</p>
<p>Thank you. We've received your payment of <strong>${gbp(inv.amount_pence)}</strong> for invoice ${esc(inv.number)} (${esc(inv.service_name)}${inv.property_address ? `, ${esc(inv.property_address)}` : ""}).</p>
<p>Everything is in place, so we'll proceed as arranged.</p>
${btn(L.pdf, "Download your receipted PDF invoice")}
${biz.reviewUrl ? `<p>If you have a moment, we'd be grateful for a quick rating of the service: <a href="${esc(biz.reviewUrl)}" style="color:#0c0c0c;">${esc(biz.reviewUrl)}</a></p>` : ""}
<p>Kind regards,<br/>Dominic Bowkett</p>`),
  };
}

export function partnerPaidEmail(inv, origin) {
  const L = links(origin, inv);
  return {
    subject: `Paid: ${inv.number} — ${gbp(inv.amount_pence)} — fee invoice ${inv.fee_invoice_number}`,
    text:
      `${inv.client_name || inv.client_email} has paid invoice ${inv.number} (${inv.service_name}${inv.property_address ? `, ${inv.property_address}` : ""}).\n\n` +
      `Paid: ${gbp(inv.amount_pence)} at ${fmtDate(inv.paid_at, { withTime: true })}\n` +
      `Platform fee (VAT invoice ${inv.fee_invoice_number}): ${gbp(inv.application_fee_pence)} inc VAT (${gbp(inv.fee_net_pence)} + VAT ${gbp(inv.fee_vat_pence)}), settled by deduction from this payment.\n` +
      `Your net before Stripe's processing fee: ${gbp(inv.amount_pence - inv.application_fee_pence)}\n\n` +
      `Fee VAT invoice PDF: ${L.feePdf}\nClient invoice PDF: ${L.pdf}\n\nYou can go ahead with the job.\n`,
  };
}

export function ownerNotice(inv, origin, headline) {
  const L = links(origin, inv);
  const p = partnerOf(inv);
  return {
    subject: `${headline} — ${inv.number} — ${gbp(inv.amount_pence)}`,
    text:
      `${headline}\n\nInvoice ${inv.number} · ${inv.service_name}\nClient: ${inv.client_name || ""} <${inv.client_email}>\n` +
      (inv.property_address ? `Property: ${inv.property_address}\n` : "") +
      `Partner: ${supplierName(p)} (${inv.partner_account_id})\n` +
      `Amount: ${gbp(inv.amount_pence)} · fee ${gbp(inv.application_fee_pence)} inc VAT\n` +
      (inv.last_error ? `Error: ${inv.last_error}\n` : "") +
      `\nAdmin: ${origin}/admin#inv/${inv.id}\nClient page: ${L.view}\n`,
  };
}
