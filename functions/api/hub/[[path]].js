// /api/hub/* — the Jobs feed for Dom's hub (hub.dominicbowkett.com).
// Server-to-server: X-Hub-Key must equal the HUB_KEY secret. Replies go through
// sendMessage(), the same path as the admin's Message box, so email comes from
// this site's own sender and SMS from the office number via the call-agent relay.
//
//   GET  /api/hub/items              open jobs where a customer or partner wrote last
//   GET  /api/hub/items/:id          one job and its messages
//   POST /api/hub/items/:id/reply    { body, channel: email|sms, to: customer|partner }
import { safeEqual } from "../../_shared/email.js";
import { getJob, jobMessages, sendMessage, OPEN, STATUS_LABEL, JobError } from "../../_shared/jobs.js";
import { db } from "../../_shared/db.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const iso = (s) => (s ? String(s).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z") : null);
const ADMIN = "https://www.dominicbowkett.com/admin";
const link = (id) => `${ADMIN}#job/${id}`;
// Messages that someone outside wrote to us, as opposed to our own sends and system lines.
const THEIRS = "direction = 'in' AND party IN ('customer','partner') AND channel IN ('email','sms','portal')";
const OURS = "direction = 'out' AND channel IN ('email','sms')";

function canReply(job) {
  return { email: !!job.customer_email, sms: !!job.customer_phone };
}

export async function onRequest({ request, env, params }) {
  const key = request.headers.get("x-hub-key") || "";
  if (!env.HUB_KEY || !key || !safeEqual(key, env.HUB_KEY)) return json({ ok: false, error: "Unauthorised" }, 401);
  const [head, id, action] = [].concat(params.path || []);
  if (head !== "items") return json({ ok: false, error: "Not found" }, 404);
  const origin = new URL(request.url).origin;

  try {
    if (!id && request.method === "GET") {
      const d = await db(env);
      const r = await d.prepare(
        `SELECT j.*, t.their_id, t.at AS their_at, t.party AS their_party, t.channel AS their_channel, substr(t.body, 1, 200) AS their_body,
                (SELECT MAX(id) FROM job_messages o WHERE o.job_id = j.id AND ${OURS}) AS our_id
           FROM jobs j
           JOIN (SELECT id AS their_id, job_id, party, channel, body, at,
                        ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id DESC) AS rn
                   FROM job_messages WHERE ${THEIRS}) t ON t.job_id = j.id AND t.rn = 1
          WHERE j.status IN (${OPEN.map(() => "?").join(",")})
          ORDER BY t.at DESC LIMIT 200`
      ).bind(...OPEN).all();
      const items = (r.results || [])
        .filter((j) => !j.our_id || j.their_id > j.our_id)
        .map((j) => ({
          id: j.id,
          name: j.their_party === "partner" ? `Partner on ${j.ref}` : j.customer_name || j.customer_email || j.customer_phone || j.ref,
          contact: j.their_party === "partner" ? "partner" : j.customer_email || j.customer_phone || "",
          subject: `${j.ref} · ${j.service || "Job"}${j.postcode ? ` · ${j.postcode}` : ""}`,
          preview: j.their_body || "",
          waiting_since: iso(j.their_at),
          unread: true,
          status: STATUS_LABEL[j.status] || j.status,
          group: j.source === "checkatrade" ? "Checkatrade" : "Jobs",
          reply_to: j.their_party,
          reply_channel: j.their_channel === "sms" ? "sms" : "email",
          can_reply: canReply(j),
          link: link(j.id),
        }));
      return json({ ok: true, admin_url: `${ADMIN}#jobs`, team: [], items });
    }

    if (id && !action && request.method === "GET") {
      const job = await getJob(env, id);
      if (!job) return json({ ok: false, error: "Not found" }, 404);
      const msgs = await jobMessages(env, id);
      const last = [...msgs].reverse().find((m) => m.direction === "in" && ["customer", "partner"].includes(m.party));
      return json({
        ok: true,
        item: {
          id: job.id, name: job.customer_name || job.ref, contact: job.customer_email || job.customer_phone || "",
          email: job.customer_email, phone: job.customer_phone,
          subject: `${job.ref} · ${job.service || "Job"}${job.property_address ? ` · ${job.property_address}` : job.postcode ? ` · ${job.postcode}` : ""}`,
          group: job.source === "checkatrade" ? "Checkatrade" : "Jobs",
          status: STATUS_LABEL[job.status] || job.status,
          reply_to: last?.party === "partner" ? "partner" : "customer",
          reply_channel: last?.channel === "sms" ? "sms" : "email",
          can_reply: canReply(job),
          sender: "Dominic Bowkett (this site's email / office SMS number)",
          link: link(job.id),
        },
        messages: msgs.map((m) => ({
          dir: m.channel === "note" || m.channel === "system" ? "note" : m.direction === "out" ? "out" : "in",
          channel: m.channel, body: m.body || "", at: iso(m.at),
          who: m.direction === "out" ? m.party : m.party === "partner" ? "partner" : m.party,
        })),
      });
    }

    if (id && action === "reply" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch {}
      const channel = b.channel === "sms" ? "sms" : "email";
      const to = b.to === "partner" ? "partner" : "customer";
      await sendMessage(env, id, { to, channel, body: b.body, party: "admin", origin });
      return json({ ok: true, sent_from: channel === "sms" ? "office SMS number" : "dominicbowkett.com" });
    }
  } catch (e) {
    if (e instanceof JobError) return json({ ok: false, error: e.message }, e.status || 400);
    console.error("hub", e);
    return json({ ok: false, error: "Server error" }, 500);
  }
  return json({ ok: false, error: "Not found" }, 404);
}
