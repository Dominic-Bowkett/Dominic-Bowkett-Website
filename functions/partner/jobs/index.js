// GET /partner/jobs — the signed-in partner's jobs (offered, accepted, booked, history).
import { currentPartnerUser } from "../../_shared/partner-auth.js";
import { portalPage } from "../../_shared/portal.js";
import { listJobs, STATUS_LABEL } from "../../_shared/jobs.js";
import { esc } from "../../_shared/docs.js";
import { fmtDate, gbp } from "../../_shared/money.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function onRequestGet({ request, env }) {
  const user = await currentPartnerUser(request, env);
  if (!user) return Response.redirect(new URL("/partner", request.url).toString(), 303);
  const jobs = await listJobs(env, { partner: user.stripe_account_id });
  const row = (j) => `<tr><td class="mono">${esc(j.ref)}</td><td>${esc(j.service)}<br/><span class="muted small">${esc(j.property_address || j.postcode || "")}</span></td>
<td>${["accepted", "booked", "invoiced"].includes(j.status) ? esc(j.customer_name || "") : '<span class="muted small">after you accept</span>'}</td>
<td><span class="badge ${j.status === "booked" || j.status === "invoiced" ? "paid" : j.status === "offered" ? "sent" : j.status === "declined" ? "failed" : ""}">${esc(STATUS_LABEL[j.status] || j.status)}</span>${j.booked_date ? `<br/><span class="muted small">${esc(fmtDate(j.booked_date))}${j.booked_time ? ` ${esc(j.booked_time)}` : ""}</span>` : ""}</td>
<td class="num">${j.price_pence != null ? gbp(j.price_pence) : ""}</td><td><a class="btn secondary" style="padding:5px 10px;font-size:13px" href="/partner/jobs/${j.id}">${j.status === "offered" ? "Respond" : "Open"}</a></td></tr>`;
  const offered = jobs.filter((j) => j.status === "offered");
  const active = jobs.filter((j) => ["accepted", "booked"].includes(j.status));
  const past = jobs.filter((j) => !["offered", "accepted", "booked"].includes(j.status));
  const table = (list) => `<div style="overflow-x:auto"><table><thead><tr><th>Ref</th><th>Job</th><th>Customer</th><th>Status</th><th class="num">Price</th><th></th></tr></thead><tbody>${list.map(row).join("")}</tbody></table></div>`;
  const body = `
<p style="margin:0 0 16px"><a href="/partner">← Invoices</a></p>
${offered.length ? `<div class="card" style="border-color:#e0c36a;background:#fffaf0"><h1>Jobs waiting for your answer (${offered.length})</h1>${table(offered)}</div>` : ""}
<div class="card"><h1>Your jobs</h1>${active.length ? table(active) : `<p class="muted">No active jobs right now.</p>`}</div>
${past.length ? `<div class="card"><h2>Earlier jobs</h2>${table(past)}</div>` : ""}`;
  return new Response(portalPage({ title: "Jobs", body, user }), { headers });
}
