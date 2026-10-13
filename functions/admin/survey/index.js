// GET /admin/survey — list of properties prepared for on-site capture.
import { isAdmin, sessionCookie } from "../../_shared/auth.js";
import { surveyDb } from "../../_shared/survey.js";
import { headers, esc, page, loginPage } from "../../_shared/survey-page.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!(await isAdmin(request, env))) return new Response(loginPage(url, env), { status: 200, headers });
  let rows = [], docs = [], error = "";
  try {
    const d = await surveyDb(env);
    rows = (await d.prepare(
      `SELECT p.id, p.title, p.address, p.visit,
         (SELECT COUNT(*) FROM survey_records r WHERE r.property_id = p.id AND r.deleted = 0) AS records,
         (SELECT COUNT(*) FROM survey_photos f WHERE f.property_id = p.id AND f.deleted = 0) AS photos,
         (SELECT MAX(r.updated_at) FROM survey_records r WHERE r.property_id = p.id) AS last_saved
       FROM survey_properties p WHERE p.archived = 0 ORDER BY p.created_at DESC`).all()).results || [];
    docs = (await d.prepare(`SELECT id, property_id, title, bytes FROM survey_docs WHERE deleted = 0 ORDER BY sort, created_at`).all()).results || [];
  } catch (e) {
    error = e.message || String(e);
  }
  const mb = (b) => (b ? `${(b / 1048576).toFixed(b < 1048576 ? 2 : 1)} MB` : "");
  const cards = rows.map((p) => {
    const pd = docs.filter((x) => x.property_id === p.id);
    const docList = pd.length ? `<div class="docs"><div class="dh">Documents</div>${pd.map((x) => `<div class="doc"><a href="/api/survey/doc/${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="muted small">${mb(x.bytes)}</span><a download class="btn secondary small" href="/api/survey/doc/${encodeURIComponent(x.id)}?dl=1">Download</a></div>`).join("")}</div>` : "";
    return `<div class="pcard"><a class="open" href="/admin/survey/${encodeURIComponent(p.id)}">
  <h2>${esc(p.title)}</h2><div class="muted small">${esc(p.address || "")}</div>
  <div class="row"><span>Visit: ${esc(p.visit || "-")}</span><span>${p.records} recorded</span><span>${p.photos} photos</span>${p.last_saved ? `<span>Last saved ${esc(p.last_saved)} UTC</span>` : ""}</div>
  <span class="btn small" style="margin-top:10px">Open survey</span></a>${docList}</div>`;
  }).join("");
  const html = page(`<div class="topnav"><span class="brand">Surveys</span><div class="right"><a class="btn secondary small" href="/admin">Invoicing admin</a></div></div>
<div class="list"><h1>Properties</h1>
${error ? `<p class="msg err">${esc(error)}</p>` : ""}
${cards || '<p class="muted">No properties loaded yet.</p>'}
</div>`, { title: "Surveys" });
  return new Response(html, { status: 200, headers: { ...headers, "Set-Cookie": await sessionCookie(env) } });
}
