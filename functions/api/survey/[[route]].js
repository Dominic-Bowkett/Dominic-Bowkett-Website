// /api/survey/* — JSON API for the on-site survey pages (admin login required).
//   GET    /api/survey/properties                              list
//   GET    /api/survey/properties/:pid                         plan + records + photos
//   PUT    /api/survey/properties/:pid/records/:ref            upsert one record (autosave; last client_ts wins)
//   POST   /api/survey/properties/:pid/records/:ref/photos     raw image body -> R2 (x-photo-id header makes retries idempotent)
//   DELETE /api/survey/properties/:pid/photos/:photoId         hide a photo (the R2 object is kept)
//   GET    /api/survey/properties/:pid/export.csv              windows, doors, rooms and evidence as CSV
//   GET    /api/survey/photo/:photoId                          the image itself
//   GET    /api/survey/doc/:docId[?dl=1]                       a property document (PDF etc.), inline or as a download
import { isAdmin, sameOrigin } from "../../_shared/auth.js";
import { surveyDb, REF_RE, PHOTO_ID_RE, KINDS, recordOut, photoOut, docOut, INLINE_TYPES } from "../../_shared/survey.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const MAX_PHOTO = 25 * 1024 * 1024;

export async function onRequest({ request, env, params }) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: "Not signed in" }, 401);
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return json({ ok: false, error: "Bad origin" }, 403);
  const parts = Array.isArray(params.route) ? params.route : params.route ? [params.route] : [];
  const [head, pid, sub, ref, sub2] = parts;

  try {
    const d = await surveyDb(env);

    if (head === "photo" && pid && method === "GET") {
      if (!PHOTO_ID_RE.test(pid)) return json({ ok: false, error: "Bad id" }, 400);
      const row = await d.prepare(`SELECT * FROM survey_photos WHERE id = ?`).bind(pid).first();
      if (!row || !env.SURVEY_FILES) return json({ ok: false, error: "Not found" }, 404);
      const obj = await env.SURVEY_FILES.get(row.r2_key);
      if (!obj) return json({ ok: false, error: "Not found" }, 404);
      return new Response(obj.body, { headers: { "content-type": row.content_type || "image/jpeg", "cache-control": "private, max-age=604800, immutable" } });
    }

    if (head === "doc" && pid && method === "GET") {
      if (!PHOTO_ID_RE.test(pid)) return json({ ok: false, error: "Bad id" }, 400);
      const row = await d.prepare(`SELECT * FROM survey_docs WHERE id = ? AND deleted = 0`).bind(pid).first();
      if (!row || !env.SURVEY_FILES) return json({ ok: false, error: "Not found" }, 404);
      const obj = await env.SURVEY_FILES.get(row.r2_key);
      if (!obj) return json({ ok: false, error: "Not found" }, 404);
      const type = String(row.content_type || "application/octet-stream").toLowerCase();
      const name = String(row.file_name || "document").replace(/[\r\n"\\]/g, "");
      const ascii = name.replace(/[^\x20-\x7e]/g, "_");
      const inline = INLINE_TYPES.has(type) && new URL(request.url).searchParams.get("dl") !== "1";
      return new Response(obj.body, { headers: {
        "content-type": INLINE_TYPES.has(type) ? type : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "private, no-store",
      } });
    }

    if (head !== "properties") return json({ ok: false, error: "Unknown endpoint" }, 404);

    if (!pid && method === "GET") {
      const r = await d.prepare(
        `SELECT p.id, p.title, p.address, p.visit, p.updated_at,
           (SELECT COUNT(*) FROM survey_records r WHERE r.property_id = p.id AND r.deleted = 0) AS records,
           (SELECT COUNT(*) FROM survey_photos f WHERE f.property_id = p.id AND f.deleted = 0) AS photos,
           (SELECT MAX(r.updated_at) FROM survey_records r WHERE r.property_id = p.id) AS last_saved
         FROM survey_properties p WHERE p.archived = 0 ORDER BY p.created_at DESC`).all();
      return json({ ok: true, properties: r.results || [] });
    }

    if (!pid || !REF_RE.test(pid)) return json({ ok: false, error: "Bad property id" }, 400);
    const prop = await d.prepare(`SELECT * FROM survey_properties WHERE id = ?`).bind(pid).first();
    if (!prop) return json({ ok: false, error: "Property not found" }, 404);

    if (!sub && method === "GET") {
      const recs = await d.prepare(`SELECT * FROM survey_records WHERE property_id = ?`).bind(pid).all();
      const photos = await d.prepare(`SELECT * FROM survey_photos WHERE property_id = ? AND deleted = 0 ORDER BY created_at`).bind(pid).all();
      const docs = await d.prepare(`SELECT * FROM survey_docs WHERE property_id = ? AND deleted = 0 ORDER BY sort, created_at`).bind(pid).all();
      return json({
        ok: true,
        property: { id: prop.id, title: prop.title, address: prop.address, visit: prop.visit, plan: JSON.parse(prop.plan_json) },
        records: (recs.results || []).map(recordOut),
        photos: (photos.results || []).map(photoOut),
        docs: (docs.results || []).map(docOut),
        photos_enabled: !!env.SURVEY_FILES,
      });
    }

    if (sub === "records" && ref && !sub2 && method === "PUT") {
      if (!REF_RE.test(ref)) return json({ ok: false, error: "Bad ref" }, 400);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ ok: false, error: "Bad body" }, 400);
      const kind = String(body.kind || "");
      if (!KINDS.has(kind)) return json({ ok: false, error: "Bad kind" }, 400);
      const data = body.data && typeof body.data === "object" ? body.data : {};
      const dataJson = JSON.stringify(data);
      if (dataJson.length > 20000) return json({ ok: false, error: "Too much data" }, 413);
      const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
      const ts = Number.isFinite(Number(body.client_ts)) ? Math.floor(Number(body.client_ts)) : Date.now();
      await d.prepare(
        `INSERT INTO survey_records (property_id, ref, kind, floor, x, y, data_json, deleted, client_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(property_id, ref) DO UPDATE SET kind = excluded.kind, floor = excluded.floor, x = excluded.x, y = excluded.y,
           data_json = excluded.data_json, deleted = excluded.deleted, client_ts = excluded.client_ts, updated_at = datetime('now')
         WHERE excluded.client_ts >= survey_records.client_ts`)
        .bind(pid, ref, kind, body.floor ? String(body.floor).slice(0, 20) : null, num(body.x), num(body.y), dataJson, body.deleted ? 1 : 0, ts)
        .run();
      const row = await d.prepare(`SELECT * FROM survey_records WHERE property_id = ? AND ref = ?`).bind(pid, ref).first();
      return json({ ok: true, record: recordOut(row) });
    }

    if (sub === "records" && ref && sub2 === "photos" && method === "POST") {
      if (!REF_RE.test(ref)) return json({ ok: false, error: "Bad ref" }, 400);
      if (!env.SURVEY_FILES) return json({ ok: false, error: "Photo storage (R2 binding SURVEY_FILES) is not configured" }, 503);
      const id = String(request.headers.get("x-photo-id") || "").toLowerCase();
      if (!PHOTO_ID_RE.test(id)) return json({ ok: false, error: "Bad photo id" }, 400);
      const existing = await d.prepare(`SELECT * FROM survey_photos WHERE id = ?`).bind(id).first();
      if (existing) return json({ ok: true, photo: photoOut(existing), duplicate: true });
      const type = (request.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/.test(type)) return json({ ok: false, error: "Not an image" }, 415);
      const buf = await request.arrayBuffer();
      if (!buf.byteLength) return json({ ok: false, error: "Empty upload" }, 400);
      if (buf.byteLength > MAX_PHOTO) return json({ ok: false, error: "Photo too large" }, 413);
      const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" }[type];
      const key = `survey/${pid}/${ref}/${id}.${ext}`;
      const name = String(request.headers.get("x-file-name") || "").replace(/[^\w .()-]/g, "").slice(0, 120) || null;
      await env.SURVEY_FILES.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { property: pid, ref } });
      await d.prepare(`INSERT OR IGNORE INTO survey_photos (id, property_id, ref, r2_key, content_type, bytes, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, pid, ref, key, type, buf.byteLength, name).run();
      const row = await d.prepare(`SELECT * FROM survey_photos WHERE id = ?`).bind(id).first();
      return json({ ok: true, photo: photoOut(row) });
    }

    if (sub === "photos" && ref && method === "DELETE") {
      if (!PHOTO_ID_RE.test(ref)) return json({ ok: false, error: "Bad photo id" }, 400);
      await d.prepare(`UPDATE survey_photos SET deleted = 1 WHERE id = ? AND property_id = ?`).bind(ref, pid).run();
      return json({ ok: true });
    }

    if (sub === "export.csv" && method === "GET") {
      const plan = JSON.parse(prop.plan_json);
      const recs = Object.fromEntries(((await d.prepare(`SELECT * FROM survey_records WHERE property_id = ?`).bind(pid).all()).results || []).map((r) => [r.ref, recordOut(r)]));
      const counts = {};
      for (const p of (await d.prepare(`SELECT ref FROM survey_photos WHERE property_id = ? AND deleted = 0`).bind(pid).all()).results || []) counts[p.ref] = (counts[p.ref] || 0) + 1;
      const floors = Object.fromEntries((plan.floors || []).map((f) => [f.key, f]));
      const roomName = (fk, key) => ((floors[fk]?.rooms || []).find((r) => r.key === key) || {}).name || key || "";
      const rows = [];
      const seen = new Set();
      for (const f of plan.floors || []) for (const r of f.rooms || []) { rows.push({ ref: `room-${f.key}-${r.key}`, kind: "room", floor: f.key, label: r.name, room: r.name, plan: r }); }
      for (const it of plan.items || []) rows.push({ ref: it.ref, kind: it.kind, floor: it.floor, label: it.label, room: roomName(it.floor, it.room), plan: it });
      for (const c of plan.checklist || []) rows.push({ ref: c.ref, kind: "check", floor: "", label: c.label, room: c.category, plan: c });
      for (const r of rows) seen.add(r.ref);
      for (const r of Object.values(recs)) if (!seen.has(r.ref) && !r.deleted) rows.push({ ref: r.ref, kind: r.kind, floor: r.floor, label: r.data.title || r.data.label || r.ref, room: roomName(r.floor, r.data.room), plan: {} });
      const cols = ["floor", "ref", "kind", "label", "room_or_category", "status", "width_mm", "height_mm", "count", "type", "glazing", "frame", "gap", "installed", "age_evidence", "length_m", "width_m", "ceiling_m", "notes", "photos", "x", "y"];
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [cols.join(",")];
      for (const r of rows) {
        const rec = recs[r.ref]; if (rec && rec.deleted) continue;
        const own = rec ? rec.data : {}; const dd = { ...own };
        if (r.plan.prefill && !own._pf) for (const [k, v] of Object.entries(r.plan.prefill)) if (dd[k] === undefined) dd[k] = `${v} (pre-filled, not confirmed)`;
        const status = dd.absent ? "not present" : Object.keys(own).length || counts[r.ref] ? "recorded" : "";
        lines.push([r.floor, r.ref, r.kind, r.label, r.room, status, dd.width_mm, dd.height_mm, dd.count, dd.type, dd.glazing, dd.frame, dd.gap, dd.installed, dd.age_evidence,
          dd.length_m, dd.width_m, dd.ceiling_m, dd.notes, counts[r.ref] || 0, rec?.x ?? r.plan.x ?? "", rec?.y ?? r.plan.y ?? ""].map(cell).join(","));
      }
      return new Response(lines.join("\r\n"), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="survey-${pid}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
      });
    }

    return json({ ok: false, error: "Unknown endpoint" }, 404);
  } catch (e) {
    console.error("survey api error", e);
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}
