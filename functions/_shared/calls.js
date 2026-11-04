// Call recordings from the phone (QACR app -> Google Drive), sent here by the Apps Script
// "QACR recordings" in Dom's Google account. A recording is transcribed with Workers AI,
// summarised in a line or two, and attached to the job whose customer (or partner) has that
// number as a 'call' entry on the job's timeline. Calls that match nothing wait in the Calls
// tab to be attached to a job or made into one. Personal calls never leave Drive: the script
// only sends numbers that /api/calls/numbers lists. The phone's location is never sent.
import { db } from "./db.js";
import { e164 } from "./sms.js";
import { addMessage, createJob, getJob, OPEN } from "./jobs.js";

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const SUMMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const RECENT_DAYS = 60;   // closed or invoiced jobs stay matchable for this long after their last activity

export class CallError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

/* digits only, UK national form: 07729 449699, +447729449699 and 447729449699 all -> 07729449699 */
export const digits = (n) => {
  let d = String(n || "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 12) d = "0" + d.slice(2);
  return d;
};

async function matchableJobs(env) {
  const d = await db(env);
  const marks = OPEN.map(() => "?").join(",");
  return (await d.prepare(
    `SELECT id, ref, status, customer_name, customer_phone, partner_account_id, property_address, service, last_activity_at FROM jobs
     WHERE status IN (${marks}, 'taken') OR last_activity_at >= datetime('now', ?)
     ORDER BY last_activity_at DESC`
  ).bind(...OPEN, `-${RECENT_DAYS} days`).all()).results || [];
}

export async function partnersWithPhones(env) {
  const d = await db(env);
  return ((await d.prepare(`SELECT stripe_account_id, display_name, business_name, phone FROM partners WHERE phone IS NOT NULL AND phone != ''`).all()).results || [])
    .map((p) => ({ ...p, num: digits(p.phone), name: p.display_name || p.business_name || "partner" }));
}

/* the numbers the Apps Script may send calls for (digits only) */
export async function callNumbers(env) {
  const jobs = await matchableJobs(env);
  const partners = await partnersWithPhones(env);
  const nums = new Set();
  for (const j of jobs) { const n = digits(j.customer_phone); if (n.length >= 9) nums.add(n); }
  for (const p of partners) if (p.num.length >= 9) nums.add(p.num);
  return [...nums];
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function transcribe(env, audioB64) {
  if (!env.AI || !audioB64) return "";
  try {
    const r = await env.AI.run(WHISPER, {
      audio: audioB64, language: "en", vad_filter: true,
      initial_prompt: "Dominic Bowkett, EPC, energy performance certificate, retrofit assessment, building survey, HomeBuyer survey, assessor, surveyor, booking, quote, invoice.",
    });
    return String((r && r.text) || "").trim();
  } catch (e) {
    try {
      const r = await env.AI.run("@cf/openai/whisper", { audio: [...b64ToBytes(audioB64)] });
      return String((r && r.text) || "").trim();
    } catch (e2) {
      console.log("transcribe failed", String(e), String(e2));
      return "";
    }
  }
}

export async function summarise(env, transcript, who, direction) {
  if (!env.AI || transcript.length < 40) return "";
  try {
    const r = await env.AI.run(SUMMARY_MODEL, {
      messages: [
        { role: "system", content:
          "You summarise phone calls for Dom, a surveyor and energy assessor who arranges EPCs, retrofit assessments and building surveys, " +
          "sometimes through partner assessors. Write one or two short plain sentences in British English saying what happened and anything agreed: " +
          "dates or times, prices or quotes, addresses, access arrangements, who is doing the job, reasons for not going ahead, things to follow up. " +
          "If nobody answered or it was a voicemail, say so. No preamble, no bullet points, no names other than those said in the call." },
        { role: "user", content: (direction === "in" ? `${who} rang Dom.` : `Dom rang ${who}.`) + "\n\nTranscript:\n" + transcript.slice(0, 12000) },
      ],
      max_tokens: 160,
    });
    return String((r && (r.response || r.result || "")) || "").trim().replace(/^summary:\s*/i, "");
  } catch (e) {
    console.log("summary failed", String(e));
    return "";
  }
}

const mins = (s) => (s ? (s < 60 ? `${s} sec` : `${Math.round(s / 60)} min`) : "");

/* the timeline entry for a recording on a job */
async function attachToJob(env, rec, job, { party, who, note }) {
  const line = rec.summary || (rec.transcript ? rec.transcript.slice(0, 300) : (rec.direction === "in" ? "Incoming call (no transcript)" : "Call (no transcript)"));
  await addMessage(env, job.id, {
    direction: rec.direction, channel: "call", party: rec.direction === "in" ? party : "admin", counterpart: rec.direction === "in" ? "admin" : party,
    subject: `${rec.direction === "in" ? "Call from" : "Call to"} ${who}${rec.duration_s ? ` · ${mins(rec.duration_s)}` : ""}${note ? ` · ${note}` : ""}`,
    body: line,
    meta: { recording_id: rec.id, url: rec.url, duration_s: rec.duration_s, transcript: rec.transcript || null, matched: party },
  });
}

/* one recording from the script: transcribe, summarise, match, store */
export async function ingestRecording(env, b) {
  const d = await db(env);
  /* dry run: transcribe and summarise only, nothing stored (for testing the script) */
  if (b.dry) {
    const words = await transcribe(env, String(b.audio_b64 || ""));
    return { ok: true, dry: true, ai: !!env.AI, transcript: words, summary: await summarise(env, words, "a test caller", "out") };
  }
  const driveId = String(b.drive_id || "").slice(0, 120);
  const raw = String(b.number || "").trim();
  const num = digits(raw);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2})[-:](\d{2})(?:[-:](\d{2}))?$/.exec(String(b.started || "").trim());
  if (!driveId || num.length < 9 || !m) throw new CallError("bad_input");

  const dup = await d.prepare(`SELECT id, job_id FROM call_recordings WHERE drive_id = ?`).bind(driveId).first();
  if (dup) return { ok: true, duplicate: true, id: dup.id, job_id: dup.job_id };

  /* QACR names files in London time; store as that local time with the zone worked out by Date */
  const local = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4] || "00"}`);
  const londonOffsetMin = (() => {
    const utc = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));
    const lon = new Date(local.toLocaleString("en-US", { timeZone: "Europe/London" }));
    return (lon - utc) / 60000;
  })();
  const startIso = new Date(local.getTime() - londonOffsetMin * 60000).toISOString();
  const direction = /^in/i.test(String(b.direction || "")) || b.direction === "↙" ? "in" : "out";
  const durationS = Math.max(0, Math.round(Number(b.duration_ms || 0) / 1000)) || null;

  const jobs = await matchableJobs(env);
  const partners = await partnersWithPhones(env);
  let job = jobs.find((j) => digits(j.customer_phone) === num) || null;
  let party = job ? "customer" : null;
  let partner = null;
  if (!job) {
    partner = partners.find((p) => p.num === num) || null;
    if (partner) { job = jobs.find((j) => j.partner_account_id === partner.stripe_account_id) || null; party = job ? "partner" : null; }
  }
  const who = party === "customer" ? (job.customer_name || "the customer") : partner ? partner.name : "the caller";

  const transcript = await transcribe(env, String(b.audio_b64 || ""));
  const summary = await summarise(env, transcript, who, direction);
  const id = crypto.randomUUID().slice(0, 12);
  const now = new Date().toISOString();
  const rec = {
    id, drive_id: driveId, job_id: job ? job.id : null, partner_account_id: partner ? partner.stripe_account_id : null, matched: party,
    number: e164(raw) || raw.slice(0, 40), direction, started_at: startIso, duration_s: durationS,
    url: String(b.url || `https://drive.google.com/file/d/${driveId}/view`).slice(0, 300), file_name: String(b.name || "").slice(0, 200),
    transcript: transcript || null, summary: summary || null, status: transcript ? "done" : "no_transcript", created_at: now,
  };
  await d.prepare(
    `INSERT INTO call_recordings (id, drive_id, job_id, partner_account_id, matched, number, direction, started_at, duration_s, url, file_name, transcript, summary, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(rec.id, rec.drive_id, rec.job_id, rec.partner_account_id, rec.matched, rec.number, rec.direction, rec.started_at, rec.duration_s, rec.url, rec.file_name, rec.transcript, rec.summary, rec.status, rec.created_at).run();
  if (job) await attachToJob(env, rec, job, { party, who, note: party === "partner" ? "matched by the partner's number – move it if it was about another job" : "" });
  return { ok: true, id, job_id: rec.job_id, job_ref: job ? job.ref : null, matched: party, transcript_chars: transcript.length, summary };
}

export async function listRecordings(env, { only } = {}) {
  const d = await db(env);
  const where = only === "unmatched" ? "WHERE r.job_id IS NULL" : "";
  return (await d.prepare(
    `SELECT r.id, r.job_id, r.matched, r.number, r.direction, r.started_at, r.duration_s, r.url, r.summary, r.status, r.created_at,
            (r.transcript IS NOT NULL) AS has_transcript, j.ref AS job_ref, j.customer_name, j.property_address, p.display_name AS partner_name
     FROM call_recordings r LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN partners p ON p.stripe_account_id = r.partner_account_id
     ${where} ORDER BY r.started_at DESC LIMIT 200`
  ).all()).results || [];
}

export async function getRecording(env, id) {
  const d = await db(env);
  return d.prepare(`SELECT * FROM call_recordings WHERE id = ?`).bind(id).first();
}

/* attach (or move) a recording to a job by hand */
export async function attachRecording(env, id, jobId) {
  const d = await db(env);
  const rec = await getRecording(env, id);
  if (!rec) throw new CallError("Recording not found", 404);
  const job = await getJob(env, jobId);
  if (!job) throw new CallError("Job not found", 404);
  if (rec.job_id) await d.prepare(`DELETE FROM job_messages WHERE job_id = ? AND channel = 'call' AND meta LIKE ?`).bind(rec.job_id, `%"recording_id":"${rec.id}"%`).run();
  const party = rec.partner_account_id && job.partner_account_id === rec.partner_account_id ? "partner" : "customer";
  const who = party === "customer" ? (job.customer_name || "the customer") : "the partner";
  await d.prepare(`UPDATE call_recordings SET job_id = ?, matched = ? WHERE id = ?`).bind(job.id, party, rec.id).run();
  await attachToJob(env, { ...rec, job_id: job.id }, job, { party, who, note: "attached by hand" });
  return { ...rec, job_id: job.id, matched: party };
}

/* a new job from an unmatched call: the number and the summary are all we know */
export async function jobFromRecording(env, id, origin) {
  const rec = await getRecording(env, id);
  if (!rec) throw new CallError("Recording not found", 404);
  const job = await createJob(env, {
    source: "call", source_ref: rec.id, customer_phone: rec.number,
    details: rec.summary ? `From a call on ${rec.started_at.slice(0, 10)}: ${rec.summary}` : `From a call on ${rec.started_at.slice(0, 10)}.`,
  }, origin, { notify: false, ack: false });
  await attachRecording(env, id, job.id);
  return job;
}
