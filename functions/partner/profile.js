// GET/POST /partner/profile — the partner edits their own details: services offered, contact name, mobile, coverage postcode.
import { currentPartnerUser } from "../_shared/partner-auth.js";
import { portalPage } from "../_shared/portal.js";
import { getPartner, db } from "../_shared/db.js";
import { esc } from "../_shared/docs.js";
import { servicesCheckboxes, servicesJson, PARTNER_SERVICES } from "../_shared/services.js";
import { normalisePostcode, geocodePostcode } from "../_shared/register.js";
import { e164 } from "../_shared/sms.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

function form(user, p, { error = "", ok = "" } = {}) {
  return portalPage({
    title: "Your profile",
    user,
    body: `<div class="card" style="max-width:720px"><h1>Your profile</h1>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}${ok ? `<p class="msg ok">${esc(ok)}</p>` : ""}
<form method="post">
<label>Business name</label><input value="${esc(p.display_name || p.business_name || "")}" disabled /><p class="small muted">To change the business name or bank details, update your Stripe account or email info@dominicbowkett.com.</p>
<label>Services you offer</label>${servicesCheckboxes(p.services)}
<label for="cn">Your name</label><input id="cn" name="contact_name" value="${esc(p.contact_name || "")}" />
<label for="ph">Mobile (used for job texts)</label><input id="ph" name="phone" value="${esc(p.phone || "")}" />
<label for="pc">Coverage postcode (your home or the centre of the area you cover)</label><input id="pc" name="coverage_postcode" value="${esc(p.coverage_postcode || "")}" />
<p style="margin-top:18px"><button class="btn" type="submit">Save</button> <a class="btn secondary" href="/partner">Back</a></p>
</form></div>`,
  });
}

export async function onRequestGet({ request, env }) {
  const user = await currentPartnerUser(request, env);
  if (!user) return Response.redirect(new URL("/partner", request.url).toString(), 303);
  const p = await getPartner(env, user.stripe_account_id);
  return new Response(form(user, p), { headers });
}

export async function onRequestPost({ request, env }) {
  const user = await currentPartnerUser(request, env);
  if (!user) return Response.redirect(new URL("/partner", request.url).toString(), 303);
  const p = await getPartner(env, user.stripe_account_id);
  const fd = await request.formData().catch(() => new FormData());
  const services = fd.getAll("services").map(String).filter((s) => PARTNER_SERVICES.includes(s));
  const contact_name = String(fd.get("contact_name") || "").trim().slice(0, 120) || null;
  const phoneRaw = String(fd.get("phone") || "").trim();
  const phone = phoneRaw ? e164(phoneRaw) : null;
  if (phoneRaw && !/^\+44\d{10}$/.test(phone)) return new Response(form(user, { ...p, services: servicesJson(services), contact_name, phone: phoneRaw }, { error: "Please enter a UK mobile number." }), { status: 400, headers });
  const pcRaw = String(fd.get("coverage_postcode") || "").trim();
  const pc = pcRaw ? normalisePostcode(pcRaw) : null;
  if (pcRaw && !pc) return new Response(form(user, { ...p, services: servicesJson(services), contact_name, phone, coverage_postcode: pcRaw }, { error: "That doesn't look like a UK postcode." }), { status: 400, headers });
  const geo = pc && pc !== p.coverage_postcode ? await geocodePostcode(pc) : null;
  const d = await db(env);
  await d
    .prepare(`UPDATE partners SET services = ?, contact_name = ?, phone = ?, coverage_postcode = ?, coverage_lat = CASE WHEN ? THEN ? ELSE coverage_lat END, coverage_lng = CASE WHEN ? THEN ? ELSE coverage_lng END, updated_at = datetime('now') WHERE stripe_account_id = ?`)
    .bind(servicesJson(services), contact_name, phone, pc, geo ? 1 : 0, geo?.lat ?? null, geo ? 1 : 0, geo?.lng ?? null, user.stripe_account_id)
    .run();
  if (pc === null) await d.prepare(`UPDATE partners SET coverage_lat = NULL, coverage_lng = NULL WHERE stripe_account_id = ?`).bind(user.stripe_account_id).run();
  return new Response(form(user, await getPartner(env, user.stripe_account_id), { ok: "Saved." }), { headers });
}
