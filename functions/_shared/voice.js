// Calling customers and partners from the jobs board (PC or the Jobs app) through Twilio, 4 Nov 2026.
// Same idea as Ecoweald's To call page: the browser rings out with Twilio's Voice SDK from the office number
// (+44 7476 394125, the number texts already go from). Twilio asks /api/voice/twiml what to do; we <Dial> the
// number saved for that call on the job (never a number the browser makes up), record both sides from the
// answer, then transcribe and summarise the recording onto the job's timeline and the Calls tab.
//
// The number itself is answered by the ElevenLabs phone agent (its voice URL and status callback belong to
// ElevenLabs): nothing here changes the number. Calling out uses its own TwiML app and API key.
//
// Secrets (Pages project dominic-bowkett): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.
// Settings (D1 table settings): voice_key_sid / voice_key_secret (API key that signs the browser's access
// tokens), voice_app_sid (TwiML app "Dominic Bowkett jobs calls"), voice_caller, voice_in_since / voice_in_checked.
import { db } from "./db.js";
import { e164 } from "./sms.js";
import { digits, transcribe, summarise, partnersWithPhones } from "./calls.js";
import { getJob, OPEN } from "./jobs.js";

export const ORIGIN = "https://www.dominicbowkett.com";
export const OFFICE_NUMBER = "+447476394125";
export const TEST_NUMBER = "+447973713747";   // Dom's mobile: "Test call" on the Setup tab rings it (not recorded or logged)
const APP_NAME = "Dominic Bowkett jobs calls";

export class VoiceError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export async function twilio(env, path, form) {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function voiceSettings(env) {
  const d = await db(env);
  const { results } = await d.prepare("SELECT key, value FROM settings WHERE key LIKE 'voice_%'").all();
  const s = {};
  for (const r of results || []) s[r.key] = r.value;
  return s;
}
async function setSetting(env, key, value) {
  const d = await db(env);
  await d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export const twilioSet = (env) => !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
export const voiceReady = (vs) => !!(vs.voice_key_sid && vs.voice_key_secret && vs.voice_app_sid && vs.voice_caller);

/* ---------- one-off setup: an API key for access tokens and a TwiML app pointing at /api/voice/twiml ---------- */
export async function setupVoice(env) {
  if (!twilioSet(env)) throw new VoiceError("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set on this Pages project yet", 409);
  const vs = await voiceSettings(env);
  const nums = await twilio(env, "/IncomingPhoneNumbers.json?PageSize=50");
  if (nums.status >= 300) throw new VoiceError(`Twilio said: ${nums.body.message || nums.status}`, 502);
  const voiceNums = (nums.body.incoming_phone_numbers || []).filter((n) => n.capabilities && n.capabilities.voice);
  const caller = (voiceNums.find((n) => n.phone_number === (env.VOICE_CALLER || OFFICE_NUMBER)) || {}).phone_number;
  if (!caller) throw new VoiceError(`${env.VOICE_CALLER || OFFICE_NUMBER} is not a voice number on this Twilio account`, 409);
  await setSetting(env, "voice_caller", caller);
  if (!vs.voice_key_sid || !vs.voice_key_secret) {
    const k = await twilio(env, "/Keys.json", { FriendlyName: APP_NAME });
    if (k.status >= 300 || !k.body.sid) throw new VoiceError(`Could not make an API key: ${k.body.message || k.status}`, 502);
    await setSetting(env, "voice_key_sid", k.body.sid);
    await setSetting(env, "voice_key_secret", k.body.secret);
  }
  const spec = { FriendlyName: APP_NAME, VoiceUrl: ORIGIN + "/api/voice/twiml", VoiceMethod: "POST", StatusCallback: ORIGIN + "/api/voice/status", StatusCallbackMethod: "POST" };
  const a = vs.voice_app_sid ? await twilio(env, `/Applications/${vs.voice_app_sid}.json`, spec) : await twilio(env, "/Applications.json", spec);
  if (a.status >= 300 || !a.body.sid) throw new VoiceError(`Could not make the TwiML app: ${a.body.message || a.status}`, 502);
  await setSetting(env, "voice_app_sid", a.body.sid);
  /* callbacks are logged from now on, not from before */
  if (!vs.voice_in_since) await setSetting(env, "voice_in_since", new Date().toISOString().slice(0, 10));
  return { caller, app_sid: a.body.sid };
}

/* ---------- the access token the browser's Twilio Device uses ---------- */
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

export async function accessToken(env, vs, identity = "dom", ttl = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${vs.voice_key_sid}-${now}`, iss: vs.voice_key_sid, sub: env.TWILIO_ACCOUNT_SID,
    iat: now, nbf: now - 5, exp: now + ttl,
    grants: { identity, voice: { outgoing: { application_sid: vs.voice_app_sid }, incoming: { allow: false } } },
  };
  const data = b64urlStr(JSON.stringify(header)) + "." + b64urlStr(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(vs.voice_key_secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return data + "." + b64url(sig);
}

/* ---------- requests from Twilio carry X-Twilio-Signature ---------- */
export async function fromTwilio(request, env, params) {
  const got = request.headers.get("x-twilio-signature") || "";
  if (!got || !env.TWILIO_AUTH_TOKEN) return false;
  let s = request.url;
  for (const k of Object.keys(params).sort()) s += k + params[k];
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s)));
  const want = btoa(String.fromCharCode(...sig));
  if (want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export const xmlEsc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
export const twiml = (inner) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "content-type": "text/xml; charset=utf-8" } });

const nice = (n) => digits(n).replace(/^(\d{5})(\d+)$/, "$1 $2");
const len = (s) => (s ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : "");
const parseMeta = (m) => { try { return JSON.parse(m || "{}") || {}; } catch { return {}; } };

async function message(env, mid) {
  const d = await db(env);
  const m = await d.prepare("SELECT * FROM job_messages WHERE id = ? AND channel = 'call'").bind(Number(mid) || 0).first();
  return m ? { ...m, meta: parseMeta(m.meta) } : null;
}
async function saveMessage(env, m, fields) {
  const d = await db(env);
  const meta = { ...m.meta, ...(fields.meta || {}) };
  await d.prepare("UPDATE job_messages SET subject = ?, body = ?, meta = ?, provider_id = COALESCE(?, provider_id) WHERE id = ?")
    .bind(fields.subject ?? m.subject, fields.body ?? m.body, JSON.stringify(meta), fields.provider_id || null, m.id).run();
}

/* ---------- a call starts: the browser asks to ring the customer (or partner) of a job ----------
   The timeline entry is made first and the number to dial is saved on it; Twilio's request then carries only
   the entry's id, so the browser can never get the office number to ring anything else. */
export async function startCall(env, jobId, who) {
  if (!twilioSet(env) || !voiceReady(await voiceSettings(env))) throw new VoiceError("Calling is not set up yet (Setup tab)", 409);
  const job = await getJob(env, jobId);
  if (!job) throw new VoiceError("Job not found", 404);
  let number = "", name = "", party = who === "partner" ? "partner" : "customer";
  if (party === "partner") {
    const d = await db(env);
    const p = job.partner_account_id ? await d.prepare("SELECT display_name, business_name, contact_name, phone FROM partners WHERE stripe_account_id = ?").bind(job.partner_account_id).first() : null;
    if (!p || !p.phone) throw new VoiceError("No phone number for this job's partner");
    number = e164(p.phone); name = p.contact_name || p.display_name || p.business_name || "the partner";
  } else {
    if (!job.customer_phone) throw new VoiceError("No phone number for this customer");
    number = e164(job.customer_phone); name = job.customer_name || "the customer";
  }
  if (!/^\+44\d{9,10}$/.test(number)) throw new VoiceError(`Only UK numbers can be rung from here (${number || "no number"})`);
  const d = await db(env);
  const meta = { pc: 1, number, name, state: "ringing", started: new Date().toISOString() };
  const r = await d.prepare(`INSERT INTO job_messages (job_id, direction, channel, party, counterpart, subject, body, meta) VALUES (?, 'out', 'call', 'admin', ?, ?, ?, ?)`)
    .bind(job.id, party, `Call to ${name}`, `Rang ${nice(number)} from the office number.`, JSON.stringify(meta)).run();
  await d.prepare(`UPDATE jobs SET last_activity_at = datetime('now') WHERE id = ?`).bind(job.id).run();
  return { mid: r.meta.last_row_id, number, name, party, job_ref: job.ref };
}

/* the browser could not place the call after all: drop its entry if Twilio never dialled it */
export async function cancelCall(env, mid) {
  const m = await message(env, mid);
  if (!m || !m.meta.pc || m.meta.dialled) return false;
  const d = await db(env);
  await d.prepare("DELETE FROM job_messages WHERE id = ?").bind(m.id).run();
  return true;
}

/* Twilio: the browser's call has arrived; dial the number saved on the timeline entry */
export async function dialTwiml(env, form) {
  const vs = await voiceSettings(env);
  if (!vs.voice_caller) return twiml(`<Say voice="Polly.Amy">Calling is not set up yet.</Say><Hangup/>`);
  const hook = (p, mid) => `${ORIGIN}/api/voice/${p}${mid ? `?mid=${encodeURIComponent(mid)}` : ""}`;
  if (form.mid === "test") {
    return twiml(`<Dial callerId="${xmlEsc(vs.voice_caller)}" answerOnBridge="true" timeout="45" ringTone="uk"><Number>${xmlEsc(TEST_NUMBER)}</Number></Dial>`);
  }
  const m = form.mid ? await message(env, form.mid) : null;
  const fresh = m && m.meta.pc && !m.meta.dialled && Date.now() - Date.parse(m.meta.started || 0) < 10 * 60000;
  if (!fresh || !m.meta.number) return twiml(`<Say voice="Polly.Amy">That call has expired. Press call again.</Say><Hangup/>`);
  await saveMessage(env, m, { provider_id: form.CallSid, meta: { dialled: 1, call_sid: form.CallSid } });
  return twiml(
    `<Dial callerId="${xmlEsc(vs.voice_caller)}" answerOnBridge="true" timeout="45" ringTone="uk" action="${xmlEsc(hook("done", m.id))}" method="POST"` +
    ` record="record-from-answer-dual" recordingStatusCallback="${xmlEsc(hook("recording", m.id))}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed">` +
    `<Number>${xmlEsc(m.meta.number)}</Number></Dial>`
  );
}

/* Twilio: the dial finished (answered and ended, no answer, engaged, failed) */
export async function dialDone(env, mid, form) {
  const m = await message(env, mid);
  if (!m) return;
  const st = String(form.DialCallStatus || ""), secs = Number(form.DialCallDuration || 0);
  const to = `Call to ${m.meta.name || "them"}`, num = nice(m.meta.number);
  const out =
    st === "completed" && secs ? { subject: `${to} · ${len(secs)}`, body: `Rang ${num} from the office number (${len(secs)}). The summary appears here once the recording has been transcribed.`, meta: { state: "answered", duration_s: secs } }
    : st === "busy" ? { subject: `${to} · engaged`, body: `Rang ${num} from the office number: engaged.`, meta: { state: "busy" } }
    : st === "failed" ? { subject: `${to} · did not connect`, body: `Rang ${num} from the office number but the call did not go through. Check the number.`, meta: { state: "failed" } }
    : { subject: `${to} · no answer`, body: `Rang ${num} from the office number, no answer.`, meta: { state: "noanswer" } };
  await saveMessage(env, m, out);
}

/* Twilio: the PC's call ended (the TwiML app's status callback). Catches calls hung up before they answered,
   when the dial's own callback never comes. */
export async function callEnded(env, form) {
  if (form.CallStatus !== "completed" && form.CallStatus !== "canceled" && form.CallStatus !== "failed" && form.CallStatus !== "no-answer" && form.CallStatus !== "busy") return;
  const d = await db(env);
  const row = form.CallSid ? await d.prepare("SELECT id FROM job_messages WHERE provider_id = ? AND channel = 'call'").bind(form.CallSid).first() : null;
  const m = row ? await message(env, row.id) : null;
  if (!m || m.meta.state !== "ringing") return;
  await saveMessage(env, m, { subject: `Call to ${m.meta.name || "them"} · hung up before they answered`, body: `Rang ${nice(m.meta.number)} from the office number and hung up before it was answered.`, meta: { state: "cancelled" } });
}

/* ---------- the recording: kept in R2, transcribed, summarised, joined to the timeline entry ---------- */
const bytesToB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const recKey = (sid) => `calls/rec-${sid}.mp3`;

export async function saveRecording(env, { mid, sid, url, secs }) {
  if (!/^RE[0-9a-f]{32}$/.test(sid || "")) return;
  const d = await db(env);
  const driveId = "twilio:" + sid;
  if (await d.prepare("SELECT 1 AS x FROM call_recordings WHERE drive_id = ?").bind(driveId).first()) return;
  const m = await message(env, mid);
  if (!m) return;
  const job = await getJob(env, m.job_id);

  const acc = env.TWILIO_ACCOUNT_SID;
  const res = await fetch(`${url || `https://api.twilio.com/2010-04-01/Accounts/${acc}/Recordings/${sid}`}.mp3`, {
    headers: { Authorization: "Basic " + btoa(`${acc}:${env.TWILIO_AUTH_TOKEN}`) },
  });
  if (!res.ok) { console.log("recording fetch", res.status); return; }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (env.SURVEY_FILES) await env.SURVEY_FILES.put(recKey(sid), bytes, { httpMetadata: { contentType: "audio/mpeg" } });

  /* the row first, so the audio is on the job even if transcribing fails */
  const id = crypto.randomUUID().slice(0, 12);
  const listen = `/api/admin/voice/rec/${sid}`;
  const started = m.meta.started || new Date().toISOString();
  await d.prepare(
    `INSERT INTO call_recordings (id, drive_id, job_id, partner_account_id, matched, number, direction, started_at, duration_s, url, file_name, transcript, summary, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'out', ?, ?, ?, ?, NULL, NULL, 'transcribing', ?)`
  ).bind(id, driveId, m.job_id, m.counterpart === "partner" ? (job && job.partner_account_id) || null : null, m.counterpart, m.meta.number || null,
         started, secs || m.meta.duration_s || null, listen, `Office call ${started.slice(0, 16).replace("T", " ")}.mp3`, new Date().toISOString()).run();
  await saveMessage(env, m, { meta: { recording_id: id, url: listen, duration_s: secs || m.meta.duration_s || null } });

  const words = await transcribe(env, bytesToB64(bytes));
  const summary = await summarise(env, words, m.meta.name || "the customer", "out");
  await d.prepare("UPDATE call_recordings SET transcript = ?, summary = ?, status = ? WHERE id = ?").bind(words || null, summary || null, words ? "done" : "no_transcript", id).run();
  const fresh = await message(env, mid);
  await saveMessage(env, fresh, {
    body: summary || (words ? words.slice(0, 300) : `${fresh.body.replace(/ The summary appears here.*$/, "")} No words in the recording (voicemail or silence).`),
    meta: { transcript: words || null },
  });
}

/* ---------- customers and partners ringing the office number back ----------
   The ElevenLabs agent answers the number (and emails its notes), so we read Twilio's call log instead: every
   finished call to the number from a job's customer or partner becomes an entry on that job's timeline. Other
   callers are left alone. Runs when the jobs board loads, at most once a minute. */
export async function syncIncoming(env, { force = false } = {}) {
  if (!twilioSet(env)) return { skipped: "no_twilio" };
  const vs = await voiceSettings(env);
  if (!vs.voice_caller || !vs.voice_in_since) return { skipped: "not_set_up" };
  const now = Date.now();
  if (!force && vs.voice_in_checked && now - Date.parse(vs.voice_in_checked) < 60000) return { skipped: "recent" };
  await setSetting(env, "voice_in_checked", new Date(now).toISOString());

  const r = await twilio(env, `/Calls.json?To=${encodeURIComponent(vs.voice_caller)}&StartTime%3E=${vs.voice_in_since}&PageSize=100`);
  const calls = (r.body.calls || []).filter((c) => /^inbound/.test(c.direction) && !["queued", "ringing", "in-progress"].includes(c.status));
  if (!calls.length) return { ok: true, logged: 0 };

  const d = await db(env);
  const jobs = (await d.prepare("SELECT id, status, customer_name, customer_phone, partner_account_id FROM jobs ORDER BY last_activity_at DESC").all()).results || [];
  const partners = await partnersWithPhones(env);
  const isOpen = (j) => OPEN.includes(j.status) || j.status === "taken";
  let logged = 0;
  for (const c of calls) {
    const from = digits(c.from);
    if (from.length < 9) continue;
    if (await d.prepare("SELECT 1 AS x FROM job_messages WHERE provider_id = ?").bind(c.sid).first()) continue;
    const mine = jobs.filter((j) => digits(j.customer_phone) === from);
    let job = mine.find(isOpen) || mine[0] || null, party = "customer", who = job ? job.customer_name || "The customer" : "";
    if (!job) {
      const p = partners.find((x) => x.num === from);
      job = p ? jobs.find((j) => j.partner_account_id === p.stripe_account_id && isOpen(j)) || jobs.find((j) => j.partner_account_id === p.stripe_account_id) : null;
      party = "partner"; who = p ? p.name : "";
    }
    if (!job) continue;
    const secs = Number(c.duration || 0), missed = c.status !== "completed" || secs < 5;
    await d.prepare(`INSERT INTO job_messages (job_id, at, direction, channel, party, counterpart, subject, body, provider_id, meta) VALUES (?, ?, 'in', 'call', ?, 'admin', ?, ?, ?, ?)`)
      .bind(job.id, new Date(c.start_time || c.date_created || now).toISOString().replace("T", " ").slice(0, 19), party,
        missed ? `${who} rang the office number · missed` : `${who} rang the office number · ${len(secs)}`,
        missed ? `${who} rang from ${nice(from)} but the call did not connect. Ring them back.`
               : `${who} rang from ${nice(from)} (${len(secs)}). The phone agent took the call; its notes are in the "Dominic Bowkett Calls" email.`,
        c.sid, JSON.stringify({ callback: 1, number: e164(from), matched: party })).run();
    await d.prepare(`UPDATE jobs SET last_activity_at = datetime('now') WHERE id = ?`).bind(job.id).run();
    logged++;
  }
  return { ok: true, logged };
}
