// /api/survey/* — JSON API for the on-site survey pages (admin login required).
//   GET    /api/survey/properties                              list
//   GET    /api/survey/properties/:pid                         plan + records + photos
//   PUT    /api/survey/properties/:pid/records/:ref            upsert one record (autosave; last client_ts wins)
//   POST   /api/survey/properties/:pid/records/:ref/photos     raw image body -> R2 (x-photo-id header makes retries idempotent)
//   DELETE /api/survey/properties/:pid/photos/:photoId         hide a photo (the R2 object is kept)
//   POST   /api/survey/properties/:pid/photos/:photoId/restore un-hide it again (undo)
//   GET    /api/survey/properties/:pid/export.csv              windows, doors, rooms and evidence as CSV
//   GET    /api/survey/properties/:pid/photos.csv              photo log: item, time taken, GPS, link (one row per photo)
//   GET    /api/survey/photo/:photoId                          the image itself
//   GET    /api/survey/doc/:docId[?dl=1]                       a property document (PDF etc.), inline or as a download
//   POST   /api/survey/vision                                  raw photo of a laser measurer's screen -> the distances on it
//                                                              (Claude vision; needs the ANTHROPIC_API_KEY secret, optional CLAUDE_VISION_MODEL)
import { isAdmin, sameOrigin } from "../../_shared/auth.js";
import { surveyDb, REF_RE, PHOTO_ID_RE, KINDS, recordOut, photoOut, docOut, INLINE_TYPES } from "../../_shared/survey.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const MAX_PHOTO = 25 * 1024 * 1024;
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VISION_PROMPT = `This photo shows the screen of a laser distance measurer used by a building surveyor.
List every DISTANCE reading visible on the screen: the main (large) reading and any smaller lines such as previous measurements or
the separate lengths of an area/volume measurement. Skip area (m², ft²) and volume (m³) results, angles, battery and mode icons.
For each distance give the text exactly as shown (with its unit) and the value in metres (convert mm, cm, feet and inches).
Order them as they appear from top to bottom. If the screen is unreadable, return no readings and say why in the note.`;
// structured outputs (Opus 5.5 rejects forced tool_choice; thinking is always on, so max_tokens covers thinking + JSON)
const VISION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["readings", "note"],
  properties: {
    readings: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "metres", "role"], properties: {
      text: { type: "string", description: "the reading exactly as displayed, with its unit" },
      metres: { type: "number", description: "the value in metres" },
      role: { type: "string", description: "main, previous, side of an area/volume measurement, or other" },
    } } },
    note: { type: "string", description: "anything the surveyor should know, e.g. glare or a cut-off digit; empty if none" },
  },
};
function b64(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const m2 = (m) => (Math.round(m * 100) / 100).toFixed(2);
async function readLaser(request, env) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!VISION_TYPES.has(type)) return json({ ok: false, error: "Use a JPEG or PNG photo for the laser reading" }, 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ ok: false, error: "Empty photo" }, 400);
  if (buf.byteLength > 4.5 * 1024 * 1024) return json({ ok: false, error: "Photo too large for reading (max 4.5 MB)" }, 413);
  let out;
  if (env.VISION_STUB === "1") {   // local tests only: no API call
    out = { readings: [{ text: "3.457 m", metres: 3.457, role: "main" }, { text: "1.212 m", metres: 1.212, role: "previous" }, { text: "2 m²", metres: 0, role: "other" }], note: "stub" };
  } else {
    if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Laser reading is not set up yet: the ANTHROPIC_API_KEY secret needs adding in Cloudflare (Pages > dominic-bowkett > Settings > Variables and secrets). The photo is saved; enter the numbers by hand." }, 503);
    const model = env.CLAUDE_VISION_MODEL || "claude-opus-5-5";
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
    let res;
    try {
      res = await fetch(`${env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {   // base URL override for local tests only
        method: "POST", signal: ctl.signal,
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: 4000,
          output_config: { ...(/^claude-(opus|sonnet|fable)-5/.test(model) ? { effort: "low" } : {}), format: { type: "json_schema", schema: VISION_SCHEMA } },
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: type, data: b64(buf) } },
            { type: "text", text: VISION_PROMPT },
          ] }],
        }),
      });
    } catch (e) { return json({ ok: false, error: e.name === "AbortError" ? "Reading timed out: try again or enter the numbers by hand" : "Could not reach the reading service" }, 502); }
    finally { clearTimeout(timer); }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) { console.error("vision error", res.status, j && j.error); return json({ ok: false, error: `Reading service error (${res.status})${j && j.error && j.error.message ? `: ${j.error.message}` : ""}` }, 502); }
    if (j.stop_reason === "refusal") return json({ ok: false, error: "The reading service declined this photo: enter the numbers by hand" }, 502);
    if (j.stop_reason === "max_tokens") return json({ ok: false, error: "The reading was cut short: try again" }, 502);
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    try { out = JSON.parse(text); } catch { console.error("vision: not JSON", text.slice(0, 200)); return json({ ok: false, error: "Could not understand the reading: try again" }, 502); }
  }
  const readings = (Array.isArray(out.readings) ? out.readings : [])
    .map((r) => ({ text: String(r.text || "").slice(0, 40), metres: Number(r.metres), role: String(r.role || "").slice(0, 40) }))
    .filter((r) => Number.isFinite(r.metres) && r.metres > 0.005 && r.metres < 300)
    .slice(0, 8).map((r) => ({ ...r, m2: m2(r.metres) }));
  return json({ ok: true, readings, note: String(out.note || "").slice(0, 200) });
}

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

    if (head === "vision" && !pid && method === "POST") return await readLaser(request, env);

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
      // stamp metadata from the phone (time taken, GPS); anything out of range is dropped rather than stored
      const hdr = (k) => String(request.headers.get(k) || "").trim();
      const inRange = (v, lo, hi) => { if (v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
      const oneOf = (v, opts) => (opts.includes(v) ? v : null);
      const tk = Date.parse(hdr("x-taken-at"));
      const takenAt = Number.isFinite(tk) && tk > Date.UTC(1995, 0, 1) && tk < Date.now() + 864e5 ? new Date(tk).toISOString() : null;
      let lat = inRange(hdr("x-lat"), -90, 90), lng = inRange(hdr("x-lng"), -180, 180);
      if (lat === null || lng === null) { lat = null; lng = null; }
      const acc = lat === null ? null : inRange(hdr("x-acc"), 0, 1e6);
      const geoSource = lat === null ? (hdr("x-geo-source") === "none" ? "none" : null) : oneOf(hdr("x-geo-source"), ["device", "exif"]);
      const timeSource = takenAt ? oneOf(hdr("x-time-source"), ["device", "exif", "file", "added"]) : null;
      const kind = oneOf(hdr("x-photo-kind"), ["photo", "laser"]) || "photo";
      await env.SURVEY_FILES.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { property: pid, ref } });
      await d.prepare(`INSERT OR IGNORE INTO survey_photos (id, property_id, ref, r2_key, content_type, bytes, file_name, taken_at, lat, lng, accuracy_m, time_source, geo_source, stamped, photo_kind)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, pid, ref, key, type, buf.byteLength, name, takenAt, lat, lng, acc, timeSource, geoSource, hdr("x-stamped") === "1" ? 1 : 0, kind).run();
      const row = await d.prepare(`SELECT * FROM survey_photos WHERE id = ?`).bind(id).first();
      return json({ ok: true, photo: photoOut(row) });
    }

    if (sub === "photos" && ref && sub2 === "restore" && method === "POST") {
      if (!PHOTO_ID_RE.test(ref)) return json({ ok: false, error: "Bad photo id" }, 400);
      await d.prepare(`UPDATE survey_photos SET deleted = 0 WHERE id = ? AND property_id = ?`).bind(ref, pid).run();
      const row = await d.prepare(`SELECT * FROM survey_photos WHERE id = ? AND property_id = ?`).bind(ref, pid).first();
      return row ? json({ ok: true, photo: photoOut(row) }) : json({ ok: false, error: "Not found" }, 404);
    }

    if (sub === "photos" && ref && !sub2 && method === "DELETE") {
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
      for (const r of Object.values(recs)) if (!seen.has(r.ref) && (!r.deleted || (r.data && r.data._cleared))) rows.push({ ref: r.ref, kind: r.kind, floor: r.floor, label: r.data.title || r.data.label || r.ref, room: roomName(r.floor, r.data.room), plan: {} });
      // windows/doors: width_m x height_m (older mm entries converted); rooms: length_m x width_m and room_height_m
      const cols = ["floor", "ref", "kind", "label", "room_or_category", "status", "width_m", "height_m", "length_m", "room_height_m", "building_part", "count", "type", "glazing", "frame", "gap", "installed", "age_evidence", "notes", "photos", "x", "y"];
      const normM = (v) => { const t = String(v ?? "").trim(); if (t === "") return ""; let n = Number(t.replace(",", ".")); if (!Number.isFinite(n) || n <= 0) return t; if (n >= 100) n /= 1000; return n.toFixed(2); };   // as the form does: 2 dp, 100+ = mm
      const metres = (m, mm) => (m !== undefined && m !== "" ? normM(m) : mm !== undefined && mm !== "" ? (Number.isFinite(Number(mm)) ? (Number(mm) / 1000).toFixed(2) : `${mm} mm`) : "");
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [cols.join(",")];
      for (const r of rows) {
        const rec = recs[r.ref];
        const own = rec ? rec.data || {} : {}; const dd = { ...own };
        const removed = !!(rec && rec.deleted); if (removed && !seen.has(r.ref) && !own._cleared) continue;   // a pin removed on its own is gone; a removed plan item stays listed
        // the app's own bookkeeping (_pf, _cleared) and an opening's label / room / moved flag are not survey data
        const meta = r.kind === "window" || r.kind === "door" ? ["title", "room", "moved"] : [];
        const recorded = Object.keys(own).some((k) => !k.startsWith("_") && !meta.includes(k)) || !!counts[r.ref];
        if (removed && own._cleared && !recorded) continue;   // cleared by "Start again" with nothing recorded: just a desk guess, leave it out
        if (r.plan.prefill && !own._pf) for (const [k, v] of Object.entries(r.plan.prefill)) if (dd[k] === undefined) dd[k] = `${v} (pre-filled, not confirmed)`;
        const status = removed ? (own._cleared ? "cleared by Start again (recorded data kept)" : "removed from plan (not present)") : dd.absent ? "not present" : recorded ? "recorded" : "";
        const isRoom = r.kind === "room";
        lines.push([r.floor, r.ref, r.kind, r.label, r.room, status, isRoom ? normM(dd.width_m) : metres(dd.width_m, dd.width_mm), isRoom ? "" : metres(dd.height_m, dd.height_mm),
          isRoom ? normM(dd.length_m) : "", isRoom ? normM(dd.ceiling_m) : "", isRoom ? dd.part || "" : "", dd.count, dd.type, dd.glazing, dd.frame, dd.gap, dd.installed, dd.age_evidence,
          dd.notes, counts[r.ref] || 0, rec?.x ?? r.plan.x ?? "", rec?.y ?? r.plan.y ?? ""].map(cell).join(","));
      }
      return new Response(lines.join("\r\n"), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="survey-${pid}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
      });
    }

    if (sub === "photos.csv" && method === "GET") {   // evidence log: one row per photo, with when and where it was taken
      const plan = JSON.parse(prop.plan_json);
      const recs = Object.fromEntries(((await d.prepare(`SELECT * FROM survey_records WHERE property_id = ?`).bind(pid).all()).results || []).map((r) => [r.ref, recordOut(r)]));
      const items = Object.fromEntries((plan.items || []).map((i) => [i.ref, i]));
      const checks = Object.fromEntries((plan.checklist || []).map((c) => [c.ref, c]));
      const floors = Object.fromEntries((plan.floors || []).map((f) => [f.key, f]));
      const rooms = {}; for (const f of plan.floors || []) for (const r of f.rooms || []) rooms[`room-${f.key}-${r.key}`] = { name: r.name, floor: f.key };
      const what = (ref) => {
        const it = items[ref], rec = recs[ref], rm = rooms[ref], ck = checks[ref];
        if (it) return [it.label || ref, it.kind, it.floor];
        if (rm) return [rm.name, "room", rm.floor];
        if (ck) return [ck.label || ref, "check", ""];
        if (rec) return [(rec.data && (rec.data.title || rec.data.label)) || ref, rec.kind, rec.floor];
        return [ref, "", ""];
      };
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      const origin = new URL(request.url).origin;
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const cols = ["floor", "ref", "item", "kind", "photo_kind", "taken_uk_time", "taken_at_utc", "time_source", "lat", "lng", "accuracy_m", "geo_source", "stamped", "file_name", "uploaded_at_utc", "link"];
      const lines = [cols.join(",")];
      for (const p of (await d.prepare(`SELECT * FROM survey_photos WHERE property_id = ? AND deleted = 0 ORDER BY julianday(COALESCE(taken_at, created_at)), created_at, id`).bind(pid).all()).results || []) {
        const [label, kind, floor] = what(p.ref);
        lines.push([floors[floor] ? floors[floor].name : floor, p.ref, label, kind, p.photo_kind || "photo", p.taken_at ? local.format(new Date(p.taken_at)).replace(",", "") : "",
          p.taken_at || "", p.time_source || "", p.lat ?? "", p.lng ?? "", p.accuracy_m != null ? Math.round(p.accuracy_m) : "", p.geo_source || "", p.stamped ? "yes" : "no",
          p.file_name || "", p.created_at || "", `${origin}/api/survey/photo/${p.id}`].map(cell).join(","));
      }
      return new Response(lines.join("\r\n"), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="photos-${pid}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
      });
    }

    return json({ ok: false, error: "Unknown endpoint" }, 404);
  } catch (e) {
    console.error("survey api error", e);
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}
