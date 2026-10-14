// POST /api/cron/reminders — called daily by the invoice-reminders Worker (X-Cron-Key: CRON_SECRET).
// Also accepts a signed-in admin (used by the Setup page buttons).
import { isAdmin } from "../../_shared/auth.js";
import { safeEqual } from "../../_shared/email.js";
import { runReminders, UserError } from "../../_shared/invoicing.js";
import { taskDigest } from "../../_shared/tasks.js";

export async function onRequestPost({ request, env }) {
  const key = request.headers.get("x-cron-key") || "";
  const viaKey = !!env.CRON_SECRET && safeEqual(key, env.CRON_SECRET);
  if (!viaKey && !(await isAdmin(request, env))) return new Response(JSON.stringify({ ok: false, error: "Unauthorised" }), { status: 401, headers: { "content-type": "application/json" } });
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    const result = await runReminders(env, new URL(request.url).origin, { asOf: body.as_of || undefined, dryRun: !!body.dry_run });
    if (!body.dry_run) { try { result.tasks = await taskDigest(env, new URL(request.url).origin); } catch (e) { result.tasks = { error: e.message }; } }
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: e instanceof UserError ? e.status : 500, headers: { "content-type": "application/json" } });
  }
}
