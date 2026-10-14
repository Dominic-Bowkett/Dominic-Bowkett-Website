// POST /api/inbound/lead — the Checkatrade watcher (or anything else) pushes a new enquiry in.
// Body: { source, source_ref, customer_name, customer_email, customer_phone, postcode, property_address, service, details, requested_times }.
import { safeEqual } from "../../_shared/email.js";
import { createJob } from "../../_shared/jobs.js";
import { db as database } from "../../_shared/db.js";

export async function onRequestPost({ request, env }) {
  const key = request.headers.get("x-relay-key") || "";
  if (!env.RELAY_SECRET || !safeEqual(key, env.RELAY_SECRET)) return new Response(JSON.stringify({ ok: false, error: "Unauthorised" }), { status: 401, headers: { "content-type": "application/json" } });
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    // One job per source reference.
    if (body.source && body.source_ref) {
      const d = await database(env);
      const dup = await d.prepare(`SELECT id, ref FROM jobs WHERE source = ? AND source_ref = ?`).bind(String(body.source), String(body.source_ref)).first();
      if (dup) return new Response(JSON.stringify({ ok: true, duplicate: true, job: dup.ref, id: dup.id }), { headers: { "content-type": "application/json" } });
    }
    // Calls: the spoken address is only trusted as the property address if it includes a postcode.
    if (body.source === "call" && body.property_address && !/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(body.property_address)) body.property_address = null;
    const job = await createJob(env, body, new URL(request.url).origin);
    return new Response(JSON.stringify({ ok: true, job: job.ref, id: job.id, status: job.status }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("inbound lead", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
