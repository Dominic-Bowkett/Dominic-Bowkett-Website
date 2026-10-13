// GET /admin/survey — list of properties prepared for on-site capture.
import { isAdmin, sessionCookie } from "../../_shared/auth.js";
import { surveyDb } from "../../_shared/survey.js";
import { headers, esc, page, loginPage } from "../../_shared/survey-page.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!(await isAdmin(request, env))) return new Response(loginPage(url, env), { status: 200, headers });
  let rows = [], error = "";
  try {
    const d = await surveyDb(env);
    rows = (await d.prepare(
      `SELECT p.id, p.title, p.address, p.visit,
         (SELECT COUNT(*) FROM survey_records r WHERE r.property_id = p.id AND r.deleted = 0) AS records,
         (SELECT COUNT(*) FROM survey_photos f WHERE f.property_id = p.id AND f.deleted = 0) AS photos,
         (SELECT MAX(r.updated_at) FROM survey_records r WHERE r.property_id = p.id) AS last_saved
       FROM survey_properties p WHERE p.archived = 0 ORDER BY p.created_at DESC`).all()).results || [];
  } catch (e) {
    error = e.message || String(e);
  }
  const cards = rows.map((p) => `<a class="pcard" href="/admin/survey/${encodeURIComponent(p.id)}">
  <h2>${esc(p.title)}</h2><div class="muted small">${esc(p.address || "")}</div>
  <div class="row"><span>Visit: ${esc(p.visit || "-")}</span><span>${p.records} recorded</span><span>${p.photos} photos</span>${p.last_saved ? `<span>Last saved ${esc(p.last_saved)} UTC</span>` : ""}</div>
  </a>`).join("");
  const html = page(`<div class="topnav"><span class="brand">Surveys</span><div class="right"><a class="btn secondary small" href="/admin">Invoicing admin</a></div></div>
<div class="list"><h1>Properties</h1>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}
${cards || '<p class="muted">No properties loaded yet.</p>'}
</div>`, { title: "Surveys" });
  return new Response(html, { status: 200, headers: { ...headers, "Set-Cookie": await sessionCookie(env) } });
}
