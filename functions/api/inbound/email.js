// POST /api/inbound/email — called by the jobs-inbox Email Worker for mail to in@jobs.dominicbowkett.com.
// Body: { from, to, subject, text, html, messageId, inReplyTo }. Header: X-Relay-Key.
import { safeEqual } from "../../_shared/email.js";
import { inboundEmail } from "../../_shared/jobs.js";

export async function onRequestPost({ request, env }) {
  const key = request.headers.get("x-relay-key") || "";
  if (!env.RELAY_SECRET || !safeEqual(key, env.RELAY_SECRET)) return new Response(JSON.stringify({ ok: false, error: "Unauthorised" }), { status: 401, headers: { "content-type": "application/json" } });
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    const r = await inboundEmail(env, body, new URL(request.url).origin);
    return new Response(JSON.stringify({ ok: true, handled: !!r.handled, created: !!r.created, job: r.job?.ref || null, reason: r.reason || null }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("inbound email", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
