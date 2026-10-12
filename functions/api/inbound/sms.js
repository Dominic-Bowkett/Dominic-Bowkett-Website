// POST /api/inbound/sms — relayed by the ecoweald-call-agent Worker for every text to the office number.
// Body: { from, body, media[] }. Header: X-Relay-Key. Returns { handled, reply? }.
import { safeEqual } from "../../_shared/email.js";
import { inboundSms } from "../../_shared/jobs.js";

export async function onRequestPost({ request, env }) {
  const key = request.headers.get("x-relay-key") || "";
  if (!env.RELAY_SECRET || !safeEqual(key, env.RELAY_SECRET)) return new Response(JSON.stringify({ ok: false, error: "Unauthorised" }), { status: 401, headers: { "content-type": "application/json" } });
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    const r = await inboundSms(env, body, new URL(request.url).origin);
    return new Response(JSON.stringify({ ok: true, handled: !!r.handled, reply: r.reply || null, job: r.job?.ref || null }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("inbound sms", e);
    return new Response(JSON.stringify({ ok: false, handled: false, error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
