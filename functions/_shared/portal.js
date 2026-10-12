// Partner portal: account management (admin side), invite email, and the read-only dashboard HTML.
import { db, getPartner, randomToken, logEmail } from "./db.js";
import { sendViaResend, OWNER_TO } from "./email.js";
import { gbp, fmtDate } from "./money.js";
import { esc, statusLabel } from "./docs.js";
import { issueInvite, getPartnerUserByEmail } from "./partner-auth.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class PortalError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export async function portalStatus(env, accountId) {
  const d = await db(env);
  const r = await d.prepare(`SELECT id, email, activated_at, last_login_at, invite_expires, disabled, created_at FROM partner_users WHERE stripe_account_id = ? ORDER BY created_at`).bind(accountId).all();
  return (r.results || []).map((u) => ({
    ...u,
    state: u.disabled ? "disabled" : u.activated_at ? "active" : u.invite_expires && new Date(u.invite_expires) > new Date() ? "invited" : "invite expired",
  }));
}

// Create the user if needed, issue a fresh invite token and email the set-password link.
export async function invitePartnerUser(env, accountId, email, origin) {
  email = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new PortalError("A valid email address is required");
  const partner = await getPartner(env, accountId);
  if (!partner) throw new PortalError("Unknown connected account", 404);
  const d = await db(env);
  let user = await getPartnerUserByEmail(env, email);
  if (user && user.stripe_account_id !== accountId) throw new PortalError("That email already has access to a different connected account");
  if (!user) {
    const id = randomToken(12);
    await d.prepare(`INSERT INTO partner_users (id, stripe_account_id, email) VALUES (?, ?, ?)`).bind(id, accountId, email).run();
    user = await d.prepare(`SELECT * FROM partner_users WHERE id = ?`).bind(id).first();
  } else if (user.disabled) {
    await d.prepare(`UPDATE partner_users SET disabled = 0, updated_at = datetime('now') WHERE id = ?`).bind(user.id).run();
  }
  const token = await issueInvite(env, user);
  const name = partner.display_name || partner.business_name || "your business";
  const link = `${origin}/partner/setup/${token}`;
  const first = user.activated_at ? false : true;
  const msg = {
    to: email,
    replyTo: OWNER_TO,
    subject: first ? `Your invoicing account with Dominic Bowkett — set your password` : `Reset your Dominic Bowkett invoicing password`,
    html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0c0c0c;line-height:1.6;max-width:600px;">
<p>Hello,</p>
${first
  ? `<p>I've set up an account for <strong>${esc(name)}</strong> on my invoicing system. It lets you see every invoice I send to clients on your behalf, whether it has been paid, and the amount that comes to you after the platform fee.</p>
<p>To get started, choose a password using the link below (it works for 72 hours):</p>`
  : `<p>Use the link below to choose a new password for your invoicing account (it works for 72 hours):</p>`}
<p style="margin:22px 0;"><a href="${link}" style="background:#0c0c0c;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:600;display:inline-block;">${first ? "Set my password" : "Choose a new password"}</a></p>
<p style="font-size:13px;color:#7a7873;">Or copy this link into your browser: ${link}</p>
<p>After that, sign in any time at <a href="${origin}/partner" style="color:#0c0c0c;">${origin}/partner</a> with this email address.</p>
${first ? `<p>For now the account is view-only. Sending invoices yourself may come later.</p>` : ""}
<p>Any questions, just reply to this email.</p>
<p>Thanks,<br/>Dominic Bowkett</p>
<p style="font-size:12px;color:#7a7873;margin-top:28px;border-top:1px solid #e2dfd8;padding-top:14px;">Dominic Bowkett · EMS-2 Ltd, 128 City Road, London, EC1V 2NX · Company No. 11235441 · info@dominicbowkett.com</p></div>`,
  };
  try {
    const r = await sendViaResend(env, msg);
    await logEmail(env, { kind: first ? "partner_invite" : "partner_reset", to: email, subject: msg.subject, resend_id: r?.id });
  } catch (e) {
    await logEmail(env, { kind: first ? "partner_invite" : "partner_reset", to: email, subject: msg.subject, error: e.message });
    throw new PortalError(`The email could not be sent: ${e.message}`, 502);
  }
  return { user_id: user.id, email, first };
}

export async function revokePartnerUser(env, userId) {
  const d = await db(env);
  await d.prepare(`UPDATE partner_users SET disabled = 1, invite_token = NULL, invite_expires = NULL, updated_at = datetime('now') WHERE id = ?`).bind(userId).run();
}

// ---------------------------------------------------------------- portal pages

export function portalPage({ title, body, user }) {
  return `<!doctype html><html lang="en-GB"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex, nofollow" />
<title>${esc(title)} · Partner portal · Dominic Bowkett</title>
<link rel="icon" href="/favicon.ico" sizes="any" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
<style>
:root{--paper:#fafaf8;--ink:#0c0c0c;--muted:#7a7873;--rule:#e2dfd8;--ok:#1b6b33;--bad:#8a2a2a}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.5}
header.bar{display:flex;align-items:center;gap:16px;padding:14px 24px;background:#fff;border-bottom:1px solid var(--rule)}header.bar .brand{font-weight:600}header.bar .right{margin-left:auto;display:flex;gap:12px;align-items:center;color:var(--muted);font-size:13px}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}.card{background:#fff;border:1px solid var(--rule);border-radius:6px;padding:clamp(20px,4vw,32px);margin-bottom:20px}
h1{font-size:20px;margin:0 0 12px}h2{font-size:15px;margin:0 0 10px}p{margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:12px}.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:12px}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.05em}input{width:100%;padding:10px;border:1px solid var(--rule);border-radius:4px;font:inherit}
.btn{display:inline-block;background:var(--ink);color:#fff;border:1px solid var(--ink);padding:10px 18px;border-radius:4px;font-weight:600;cursor:pointer;text-decoration:none;font:inherit}.btn.secondary{background:#fff;color:var(--ink)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--rule);vertical-align:top}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}td.num,th.num{text-align:right;white-space:nowrap}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:#eee;white-space:nowrap}.badge.paid{background:#e4f3e8;color:var(--ok)}.badge.sent{background:#e8eef8;color:#2a4d8a}.badge.failed,.badge.void,.badge.refunded{background:#f6e4e4;color:var(--bad)}
.msg{padding:10px 12px;border-radius:4px;margin:0 0 14px}.msg.err{background:#f6e4e4;color:var(--bad)}.msg.ok{background:#e4f3e8;color:var(--ok)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}.tile{background:#fff;border:1px solid var(--rule);border-radius:6px;padding:14px 16px}.tile .v{font-size:20px;font-weight:600}.tile .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.login{max-width:420px;margin:8vh auto}
@media (max-width:700px){.hide-m{display:none}}
</style></head><body>
<header class="bar"><span class="brand">Dominic Bowkett · Partner portal</span>${user ? `<div class="right"><span>${esc(user.display_name || user.business_name || "")} · ${esc(user.email)}</span><form method="post" action="/partner/logout" style="margin:0"><button class="btn secondary" type="submit" style="padding:6px 12px;font-size:13px">Sign out</button></form></div>` : ""}</header>
<main>${body}</main></body></html>`;
}

export async function dashboardHtml(env, user, origin) {
  const d = await db(env);
  const r = await d.prepare(`SELECT * FROM invoices WHERE partner_account_id = ? AND status != 'draft' ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 500`).bind(user.stripe_account_id).all();
  const invoices = r.results || [];
  const sum = (f) => invoices.filter(f).reduce((a, i) => a + i.amount_pence, 0);
  const netOf = (i) => i.amount_pence - i.application_fee_pence;
  const paid = invoices.filter((i) => i.status === "paid");
  const outstanding = invoices.filter((i) => i.status === "sent" || i.status === "failed");
  const rows = invoices
    .map(
      (i) => `<tr><td class="mono">${esc(i.number)}</td><td>${esc(fmtDate(i.sent_at || i.created_at))}</td>
<td>${esc(i.bill_to_business || i.client_name || i.client_email)}${i.property_address ? `<br/><span class="muted small">${esc(i.property_address)}</span>` : ""}</td>
<td class="hide-m">${esc(i.service_name)}</td><td class="num">${gbp(i.amount_pence)}</td><td class="num hide-m">${gbp(i.application_fee_pence)}</td><td class="num"><strong>${gbp(netOf(i))}</strong></td>
<td><span class="badge ${esc(i.status)}">${esc(statusLabel(i))}</span>${i.paid_at ? `<br/><span class="muted small">${esc(fmtDate(i.paid_at))}</span>` : i.due_date && i.status === "sent" ? `<br/><span class="muted small">due ${esc(fmtDate(i.due_date))}</span>` : ""}</td>
<td class="small"><a href="/invoice/${i.id}/pdf" target="_blank">PDF</a>${i.fee_invoice_number ? ` · <a href="/fee-invoice/${i.id}/pdf" target="_blank">Fee invoice</a>` : ""}</td></tr>`
    )
    .join("");
  const body = `
<div class="tiles">
  <div class="tile"><div class="v">${invoices.length}</div><div class="k">Invoices sent</div></div>
  <div class="tile"><div class="v">${gbp(sum((i) => i.status === "paid"))}</div><div class="k">Paid (${paid.length})</div></div>
  <div class="tile"><div class="v">${gbp(sum((i) => i.status === "sent" || i.status === "failed"))}</div><div class="k">Awaiting payment (${outstanding.length})</div></div>
  <div class="tile"><div class="v">${gbp(paid.reduce((a, i) => a + netOf(i), 0))}</div><div class="k">Your share of paid invoices</div></div>
</div>
<div class="card"><h1>Invoices sent on behalf of ${esc(user.display_name || user.business_name || "you")}</h1>
<p class="muted small">"Your share" is the invoice amount less the platform fee (inc VAT); Stripe's processing fee is then deducted by Stripe in your own account. Every paid invoice has a VAT invoice for the fee.</p>
${invoices.length ? `<table><thead><tr><th>Number</th><th>Sent</th><th>Client</th><th class="hide-m">Service</th><th class="num">Amount</th><th class="num hide-m">Fee</th><th class="num">Your share</th><th>Status</th><th>Documents</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No invoices yet.</p>`}
</div>
<p class="muted small">This portal is view-only. Questions about an invoice: <a href="mailto:info@dominicbowkett.com">info@dominicbowkett.com</a>.</p>`;
  return portalPage({ title: "Your invoices", body, user });
}
