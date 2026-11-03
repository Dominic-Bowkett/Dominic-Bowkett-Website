// /api/calls/* — call recordings from the phone, sent by the Apps Script in Dom's Google account.
//   GET  /api/calls/numbers  the numbers worth sending (customers of live jobs, partners), digits only;
//                            the script keeps every other call in Drive and never sends it here.
//   POST /api/calls/ingest   one recording: Drive id and link, number, direction, start, length, audio.
// Both need x-calls-key = the CALLS_KEY Pages secret. See functions/_shared/calls.js.
import { safeEqual } from "../../_shared/email.js";
import { callNumbers, ingestRecording, CallError } from "../../_shared/calls.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function onRequest({ request, env, params }) {
  const key = request.headers.get("x-calls-key") || "";
  if (!env.CALLS_KEY || !key || !safeEqual(key, env.CALLS_KEY)) return json({ ok: false, error: "Unauthorised" }, 401);
  if (!env.DB) return json({ ok: false, error: "no_database" }, 500);
  const path = [].concat(params.path || []).join("/");
  try {
    if (request.method === "GET" && path === "numbers") return json({ ok: true, numbers: await callNumbers(env) });
    if (request.method === "POST" && path === "ingest") {
      let b;
      try { b = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
      return json(await ingestRecording(env, b));
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof CallError) return json({ ok: false, error: e.message }, e.status);
    console.error("calls api", e);
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}
