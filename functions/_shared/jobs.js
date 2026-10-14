// Jobs: enquiries that get dispatched to partners, messaged, booked and then invoiced.
import { db, getPartner, randomToken, nextNumber, logEmail } from "./db.js";
import { sendViaResend, OWNER_TO } from "./email.js";
import { sendSms, e164 } from "./sms.js";
import { esc, linkify } from "./docs.js";
import { gbp, fmtDate } from "./money.js";
import { geocodePostcode, normalisePostcode } from "./register.js";
import { platform } from "./business.js";
import { offersService, parseServices } from "./services.js";

export class JobError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export const JOB_STATUSES = ["awaiting_address", "new", "offered", "accepted", "declined", "booked", "invoiced", "taken", "closed"];
export const OPEN = ["awaiting_address", "new", "offered", "accepted", "booked"];
export const STATUS_LABEL = {
  awaiting_address: "Waiting for address", new: "New", offered: "Offered to partner", accepted: "Accepted by partner", declined: "Declined",
  booked: "Booked", invoiced: "Invoiced", taken: "Taken by Dom", closed: "Closed",
};
const JOBS_INBOX = "in@jobs.dominicbowkett.com";
const ALLOWED_FORWARDERS = ["info@dominicbowkett.com", "dbowkett1@gmail.com", "dom@ukbrewerytours.com"];
// Dom's own numbers: never treat these as a customer's (they appear in his email signature and forwards).
const OWN_PHONES = ["+447946618203", "+447476394125", "+447973713747"];
const isOwnPhone = (p) => OWN_PHONES.includes(e164(p));
const POSTCODE_IN_TEXT = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function postcodeFrom(text) {
  const m = POSTCODE_IN_TEXT.exec(String(text || "").toUpperCase());
  return m ? `${m[1]} ${m[2]}` : null;
}

export function jobTag(job) { return `[${job.ref}]`; }
export const adminLink = (origin, job) => `${origin}/admin#job/${job.id}`;
export const portalLink = (origin, job) => `${origin}/partner/jobs/${job.id}`;

// ---------------------------------------------------------------- data

export async function getJob(env, id) {
  const d = await db(env);
  return d.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
}
export async function getJobByRef(env, ref) {
  const d = await db(env);
  return d.prepare(`SELECT * FROM jobs WHERE ref = ?`).bind(ref).first();
}
export async function updateJob(env, id, fields) {
  const d = await db(env);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await d.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now'), last_activity_at = datetime('now') WHERE id = ?`).bind(...keys.map((k) => fields[k]), id).run();
}
export async function addMessage(env, jobId, { direction, channel, party, counterpart, subject, body, provider_id, meta }) {
  const d = await db(env);
  await d
    .prepare(`INSERT INTO job_messages (job_id, direction, channel, party, counterpart, subject, body, provider_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(jobId, direction, channel, party, counterpart || null, subject || null, body || "", provider_id || null, meta ? JSON.stringify(meta) : null)
    .run();
  await d.prepare(`UPDATE jobs SET last_activity_at = datetime('now') WHERE id = ?`).bind(jobId).run();
}
export async function jobMessages(env, jobId) {
  const d = await db(env);
  return (await d.prepare(`SELECT * FROM job_messages WHERE job_id = ? ORDER BY id`).bind(jobId).all()).results || [];
}
export async function listJobs(env, { status, q, partner } = {}) {
  const d = await db(env);
  const where = [], binds = [];
  if (status && status !== "all") { if (status === "open") where.push(`status IN (${OPEN.map(() => "?").join(",")})`), binds.push(...OPEN); else where.push("status = ?"), binds.push(status); }
  if (partner) { where.push("partner_account_id = ?"); binds.push(partner); }
  if (q) { where.push("(ref LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ? OR property_address LIKE ? OR service LIKE ?)"); for (let i = 0; i < 6; i++) binds.push(`%${q}%`); }
  const r = await d.prepare(`SELECT * FROM jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY last_activity_at DESC LIMIT 300`).bind(...binds).all();
  return r.results || [];
}

function clean(s, max = 2000) { return String(s || "").replace(/\r/g, "").trim().slice(0, max) || null; }

export async function createJob(env, data, origin, { notify = true, ack } = {}) {
  const d = await db(env);
  const id = randomToken(12);
  const ref = await nextNumber(env, "job", "DB-JOB-", 6);
  const address = clean(data.property_address, 400);
  const postcode = normalisePostcode(data.postcode) || postcodeFrom(address) || null;
  const geo = postcode ? await geocodePostcode(postcode) : null;
  const job = {
    id, ref,
    status: address ? "new" : "awaiting_address",
    source: clean(data.source, 40) || "manual",
    source_ref: clean(data.source_ref, 120),
    customer_name: clean(data.customer_name, 120),
    customer_email: (clean(data.customer_email, 200) || "").toLowerCase() || null,
    customer_phone: data.customer_phone && !isOwnPhone(data.customer_phone) ? e164(data.customer_phone) : null,
    property_address: address,
    postcode,
    lat: geo?.lat ?? null, lng: geo?.lng ?? null,
    service: clean(data.service, 120) || "Domestic EPC",
    details: clean(data.details, 4000),
    requested_times: clean(data.requested_times, 400),
    internal_notes: clean(data.internal_notes, 4000),
    raw_text: clean(data.raw_text, 20000),
  };
  const cols = Object.keys(job);
  await d.prepare(`INSERT INTO jobs (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((k) => job[k])).run();
  await addMessage(env, id, { direction: "in", channel: "system", party: "system", body: `Job created from ${job.source}${job.source_ref ? ` (${job.source_ref})` : ""}.` });
  let full = await getJob(env, id);
  if (notify) await notifyDom(env, full, origin, address ? "New job" : "New job — address needed");
  // Acknowledge the customer. Checkatrade leads are skipped: the watcher has already emailed and texted them.
  if (ack ?? job.source !== "checkatrade") { await sendAck(env, full); full = await getJob(env, id); }
  if (full.property_address && full.lat != null) {
    const near = (await partnersForJob(env, full)).find((p) => p.dispatch_mode === "auto" && p.miles != null && p.miles <= 25 && p.offers !== false);
    if (near) { try { full = await offerJob(env, id, near.stripe_account_id, origin, { by: "system" }); } catch (e) { await addMessage(env, id, { direction: "out", channel: "system", party: "system", body: `Auto-dispatch failed: ${e.message}` }); } }
  }
  return full;
}

const JOB_EDITABLE = ["customer_name", "customer_email", "customer_phone", "property_address", "postcode", "service", "details", "requested_times", "internal_notes"];
export async function editJob(env, id, data) {
  const job = await getJob(env, id);
  if (!job) throw new JobError("Job not found", 404);
  const fields = {};
  for (const k of JOB_EDITABLE) if (k in data) fields[k] = k === "customer_phone" ? (data[k] ? e164(data[k]) : null) : k === "customer_email" ? (clean(data[k], 200) || "").toLowerCase() || null : clean(data[k], k === "details" || k === "internal_notes" ? 4000 : 400);
  if ("property_address" in fields || "postcode" in fields) {
    const pc = normalisePostcode(fields.postcode ?? job.postcode) || postcodeFrom(fields.property_address ?? job.property_address);
    fields.postcode = pc;
    const geo = pc ? await geocodePostcode(pc) : null;
    fields.lat = geo?.lat ?? null; fields.lng = geo?.lng ?? null;
    if (job.status === "awaiting_address" && (fields.property_address ?? job.property_address)) fields.status = "new";
  }
  await updateJob(env, id, fields);
  return getJob(env, id);
}

// ---------------------------------------------------------------- partners near a job

const toRad = (x) => (x * Math.PI) / 180;
export function milesBetween(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  const R = 3958.8, dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export async function partnersForJob(env, job) {
  const d = await db(env);
  const ps = (await d.prepare(`SELECT * FROM partners WHERE COALESCE(hidden, 0) = 0`).all()).results || [];
  return ps
    .map((p) => ({ ...p, miles: milesBetween(job, { lat: p.coverage_lat, lng: p.coverage_lng }), offers: offersService(p.services, job.service), service_list: parseServices(p.services) }))
    .sort((a, b) => (a.miles ?? 9999) - (b.miles ?? 9999));
}

// ---------------------------------------------------------------- notifications

function emailShell(inner) {
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0c0c0c;line-height:1.6;max-width:600px;">${inner}
<p style="font-size:12px;color:#7a7873;margin-top:28px;border-top:1px solid #e2dfd8;padding-top:14px;">Dominic Bowkett · EMS-2 Ltd, 128 City Road, London, EC1V 2NX · info@dominicbowkett.com</p></div>`;
}
const btn = (href, label) => `<p style="margin:22px 0;"><a href="${href}" style="background:#0c0c0c;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:600;display:inline-block;">${label}</a></p>`;

async function mail(env, jobId, kind, msg) {
  try {
    const r = await sendViaResend(env, msg);
    await logEmail(env, { invoice_id: null, kind: `job_${kind}`, to: msg.to, subject: msg.subject, resend_id: r?.id });
    return r?.id || null;
  } catch (e) {
    await logEmail(env, { invoice_id: null, kind: `job_${kind}`, to: msg.to, subject: msg.subject, error: e.message });
    await addMessage(env, jobId, { direction: "out", channel: "system", party: "system", body: `Email (${kind}) to ${msg.to} failed: ${e.message}` });
    return null;
  }
}

export function jobSummaryText(job, { contact = true } = {}) {
  return [
    `Service: ${job.service}`,
    job.property_address ? `Property: ${job.property_address}` : `Property: (address not yet confirmed${job.postcode ? `, postcode ${job.postcode}` : ""})`,
    job.requested_times ? `Timing requested: ${job.requested_times}` : null,
    contact ? `Customer: ${job.customer_name || "?"}${job.customer_phone ? ` ${job.customer_phone}` : ""}${job.customer_email ? ` <${job.customer_email}>` : ""}` : `Customer: ${job.customer_name || "?"}`,
    job.details ? `\nWhat they said:\n${job.details}` : null,
  ].filter(Boolean).join("\n");
}

export async function notifyDom(env, job, origin, headline) {
  const text = `${headline} — ${job.ref}\n\n${jobSummaryText(job)}\nSource: ${job.source}${job.source_ref ? ` ${job.source_ref}` : ""}\nStatus: ${STATUS_LABEL[job.status] || job.status}${job.partner_account_id ? ` · partner ${job.partner_account_id}` : ""}\n\nOpen in admin: ${adminLink(origin, job)}\n`;
  return mail(env, job.id, "owner", { to: OWNER_TO, subject: `${headline} — ${job.ref} — ${job.service}${job.property_address ? ` — ${job.property_address}` : job.postcode ? ` — ${job.postcode}` : ""}`, text });
}

// ---------------------------------------------------------------- dispatch

const firstName = (job) => (job.customer_name ? job.customer_name.trim().split(/\s+/)[0] : "");

// Email the customer if we have an address, otherwise text them. Returns true if something was sent.
async function tellCustomer(env, job, { kind, subject, text }) {
  if (job.customer_email) {
    const hi = firstName(job) ? `Hello ${esc(firstName(job))},` : "Hello,";
    const id = await mail(env, job.id, kind, {
      to: job.customer_email, replyTo: JOBS_INBOX, subject: `${jobTag(job)} ${subject}`,
      html: emailShell(`<p>${hi}</p><p>${esc(text)}</p><p>Kind regards,<br/>Dominic Bowkett</p>`),
    });
    if (id) { await addMessage(env, job.id, { direction: "out", channel: "email", party: "system", counterpart: "customer", subject, body: text, provider_id: id }); return true; }
  }
  if (job.customer_phone) {
    const sms = `Hi${firstName(job) ? " " + firstName(job) : ""}, it's Dom Bowkett. ${text}`;
    try {
      const sid = await sendSms(env, job.customer_phone, sms);
      await addMessage(env, job.id, { direction: "out", channel: "sms", party: "system", counterpart: "customer", body: sms, provider_id: sid });
      return true;
    } catch (e) { await addMessage(env, job.id, { direction: "out", channel: "system", party: "system", body: `Text to customer failed: ${e.message}` }); }
  }
  return false;
}

export async function sendAck(env, job) {
  if (job.ack_sent_at) return false;
  const what = job.service ? `${job.service} request` : "request";
  const ok = await tellCustomer(env, job, { kind: "ack", subject: "Thank you, we've received your request", text: `Thank you. We've received your ${what}${job.property_address ? ` for ${job.property_address}` : ""} and will be in touch shortly.` });
  if (ok) await updateJob(env, job.id, { ack_sent_at: new Date().toISOString() });
  return ok;
}

// First time a job goes to a partner, let the customer know someone nearby is being lined up.
async function sendChecking(env, job) {
  if (job.checking_sent_at) return false;
  const ok = await tellCustomer(env, job, { kind: "checking", subject: `Your ${job.service || "enquiry"}`, text: `I'm just checking with my team, as I'm unable to do this one myself, but we may have an assessor nearby who can help. I'll be back in touch shortly.` });
  if (ok) await updateJob(env, job.id, { checking_sent_at: new Date().toISOString() });
  return ok;
}

export async function offerJob(env, jobId, partnerId, origin, { by = "admin" } = {}) {
  const job = await getJob(env, jobId);
  if (!job) throw new JobError("Job not found", 404);
  if (!job.property_address) throw new JobError("Confirm the property address before sending the job out");
  if (!["new", "declined", "offered", "awaiting_address"].includes(job.status)) throw new JobError(`Job is ${STATUS_LABEL[job.status]}; it cannot be offered`);
  const p = await getPartner(env, partnerId);
  if (!p) throw new JobError("Unknown partner");
  const name = p.display_name || p.business_name;
  const link = portalLink(origin, job);
  const text = jobSummaryText(job, { contact: false });
  await updateJob(env, jobId, { status: "offered", partner_account_id: partnerId, offered_at: new Date().toISOString(), partner_response: null, responded_at: null });
  const subject = `${jobTag(job)} New ${job.service} job — ${job.property_address}`;
  await mail(env, jobId, "offer", {
    to: p.invoice_email || p.email,
    replyTo: JOBS_INBOX,
    subject,
    html: emailShell(`<p>Hello ${esc((p.contact_name || name).split(" ")[0])},</p>
<p>A new job has come in that's near you. Would you like it?</p>
<pre style="white-space:pre-wrap;font:inherit;background:#fafaf8;border:1px solid #e2dfd8;border-radius:4px;padding:12px;">${esc(text)}</pre>
<p>Price to the customer and your share are agreed once it's booked; the platform commission is ${esc(String(p.commission_pct ?? 10))}% inc VAT. The customer's contact details are released as soon as you accept.</p>
${btn(link, "View job and accept or decline")}
<p style="font-size:13px;color:#7a7873;">You can also reply YES or NO to the text, or reply to this email. If the requested time doesn't suit, reply with the times you can do.</p>`),
  });
  await addMessage(env, jobId, { direction: "out", channel: "email", party: by, counterpart: "partner", subject, body: `Offered to ${name}.\n\n${text}` });
  if (p.phone) {
    const sms = `Dominic Bowkett: new ${job.service} job at ${job.property_address}${job.requested_times ? ` (${job.requested_times})` : ""}. Interested? Reply YES or NO. Details: ${link}`;
    try {
      const sid = await sendSms(env, p.phone, sms);
      await addMessage(env, jobId, { direction: "out", channel: "sms", party: by, counterpart: "partner", body: sms, provider_id: sid });
    } catch (e) {
      await addMessage(env, jobId, { direction: "out", channel: "system", party: "system", body: `Text to partner failed: ${e.message}` });
    }
  }
  await sendChecking(env, await getJob(env, jobId));
  if (by !== "admin") await notifyDom(env, await getJob(env, jobId), origin, `Job offered automatically to ${name}`);
  return getJob(env, jobId);
}

export async function partnerResponds(env, jobId, accepted, origin, { via = "portal", note = "" } = {}) {
  const job = await getJob(env, jobId);
  if (!job) throw new JobError("Job not found", 404);
  if (job.status !== "offered") throw new JobError(`This job is ${STATUS_LABEL[job.status]}, so it can no longer be ${accepted ? "accepted" : "declined"}`);
  const p = await getPartner(env, job.partner_account_id);
  const name = p?.display_name || p?.business_name || "the partner";
  await updateJob(env, jobId, { status: accepted ? "accepted" : "declined", partner_response: accepted ? "yes" : "no", responded_at: new Date().toISOString() });
  await addMessage(env, jobId, { direction: "in", channel: via === "sms" ? "sms" : via === "email" ? "email" : "system", party: "partner", counterpart: "admin", body: `${accepted ? "Accepted" : "Declined"} by ${name} via ${via}${note ? `: ${note}` : ""}` });
  const fresh = await getJob(env, jobId);
  if (accepted) {
    // Partner gets the customer's contact details; customer is told who is coming.
    const details = jobSummaryText(fresh);
    await mail(env, jobId, "accepted_partner", {
      to: p.invoice_email || p.email,
      replyTo: JOBS_INBOX,
      subject: `${jobTag(fresh)} You have the job — ${fresh.property_address}`,
      html: emailShell(`<p>Thanks for accepting. Here are the customer's details; please contact them to arrange a date and time, then confirm the booking (date, time and price) in the portal so Dom can keep track.</p>
<pre style="white-space:pre-wrap;font:inherit;background:#fafaf8;border:1px solid #e2dfd8;border-radius:4px;padding:12px;">${esc(details)}</pre>
${btn(portalLink(origin, fresh), "Open the job")}
<p style="font-size:13px;color:#7a7873;">You can message the customer by text or email from the job page; everything is kept on the job.</p>`),
    });
    if (p?.phone) {
      try {
        const sid = await sendSms(env, p.phone, `Dominic Bowkett: thanks, the ${fresh.service} at ${fresh.property_address} is yours. Customer ${fresh.customer_name || ""} ${fresh.customer_phone || ""}. Please arrange a time and confirm the booking at ${portalLink(origin, fresh)}`);
        await addMessage(env, jobId, { direction: "out", channel: "sms", party: "system", counterpart: "partner", body: "Customer details texted to partner.", provider_id: sid });
      } catch (e) { await addMessage(env, jobId, { direction: "out", channel: "system", party: "system", body: `Text to partner failed: ${e.message}` }); }
    }
    if (fresh.customer_email) {
      const who = fresh.customer_name ? `Hello ${esc(fresh.customer_name.split(" ")[0])},` : "Hello,";
      const subject = `${jobTag(fresh)} Your ${fresh.service} — who will be in touch`;
      await mail(env, jobId, "accepted_customer", {
        to: fresh.customer_email,
        replyTo: JOBS_INBOX,
        subject,
        html: emailShell(`<p>${who}</p>
<p>Thank you for your enquiry. <strong>${esc(p?.contact_name || name)}</strong> from ${esc(name)}, an accredited assessor who works with me, will carry out the ${esc(fresh.service)} at ${esc(fresh.property_address)} and will be in touch shortly to arrange a convenient date and time.</p>
<p>If you have any questions in the meantime, just reply to this email.</p>
<p>Kind regards,<br/>Dominic Bowkett</p>`),
      });
      await addMessage(env, jobId, { direction: "out", channel: "email", party: "system", counterpart: "customer", subject, body: `Customer told that ${p?.contact_name || name} will be in touch.` });
    }
    if (fresh.customer_phone) {
      try {
        const sid = await sendSms(env, fresh.customer_phone, `Hi ${fresh.customer_name ? fresh.customer_name.split(" ")[0] : "there"}, it's Dom Bowkett. ${p?.contact_name || name} (${name}) will be in touch shortly to arrange your ${fresh.service} at ${fresh.property_address}. Thanks.`);
        await addMessage(env, jobId, { direction: "out", channel: "sms", party: "system", counterpart: "customer", body: "Customer texted who will be in touch.", provider_id: sid });
      } catch (e) { await addMessage(env, jobId, { direction: "out", channel: "system", party: "system", body: `Text to customer failed: ${e.message}` }); }
    }
  }
  await notifyDom(env, fresh, origin, `${name} ${accepted ? "accepted" : "declined"} the job${note ? `: "${note.slice(0, 120)}"` : ""}`);
  return fresh;
}

// Customer <-> partner/Dom messaging, always through the system so it is logged and oversight is kept.
export async function sendMessage(env, jobId, { to, channel, body, party = "admin", origin }) {
  const job = await getJob(env, jobId);
  if (!job) throw new JobError("Job not found", 404);
  body = clean(body, 3000);
  if (!body) throw new JobError("Message is empty");
  const p = job.partner_account_id ? await getPartner(env, job.partner_account_id) : null;
  const senderName = party === "partner" ? `${p?.contact_name || p?.display_name || p?.business_name}` : "Dominic Bowkett";
  let dest, destName;
  if (to === "customer") { dest = channel === "sms" ? job.customer_phone : job.customer_email; destName = job.customer_name || "the customer"; }
  else if (to === "partner") { if (!p) throw new JobError("No partner on this job"); dest = channel === "sms" ? p.phone : p.invoice_email || p.email; destName = p.display_name || p.business_name; }
  else throw new JobError("Unknown recipient");
  if (!dest) throw new JobError(`No ${channel === "sms" ? "mobile number" : "email address"} on file for ${destName}`);
  let provider_id = null;
  if (channel === "sms") {
    provider_id = await sendSms(env, dest, party === "partner" ? `${body} — ${senderName} (via Dominic Bowkett)` : body);
  } else {
    const subject = `${jobTag(job)} ${job.service}${job.property_address ? ` — ${job.property_address}` : ""}`;
    provider_id = await mail(env, jobId, "message", {
      to: dest,
      replyTo: JOBS_INBOX,
      subject,
      html: emailShell(`<p style="white-space:pre-wrap;">${linkify(esc(body))}</p><p>${esc(senderName)}${party === "partner" ? ` · via Dominic Bowkett` : ""}</p><p style="font-size:13px;color:#7a7873;">Reply to this email and it will reach ${party === "partner" ? "them" : "me"}.</p>`),
    });
    if (!provider_id) throw new JobError("The email could not be sent", 502);
  }
  await addMessage(env, jobId, { direction: "out", channel, party, counterpart: to, body, provider_id });
  // keep the other side in the loop
  if (party === "partner") await notifyDom(env, job, origin, `${senderName} messaged ${destName}`);
  return getJob(env, jobId);
}

// Partner writes to Dom about a job (question, different times, etc). Logged on the job; Dom emailed with the full text.
export async function partnerToDom(env, jobId, body, origin) {
  const job = await getJob(env, jobId);
  if (!job) throw new JobError("Job not found", 404);
  body = clean(body, 3000);
  if (!body) throw new JobError("Message is empty");
  const p = job.partner_account_id ? await getPartner(env, job.partner_account_id) : null;
  const name = p?.contact_name || p?.display_name || p?.business_name || "Partner";
  await addMessage(env, jobId, { direction: "in", channel: "portal", party: "partner", counterpart: "admin", body });
  const text = `${name} wrote about ${job.ref} (${job.service}${job.property_address ? `, ${job.property_address}` : ""}):\n\n"${body}"\n\nStatus: ${STATUS_LABEL[job.status]}\nReply to them from the job page (Send a message, To: ${p?.display_name || p?.business_name || "partner"}): ${adminLink(origin, job)}\n`;
  await mail(env, jobId, "owner", { to: OWNER_TO, subject: `Message from ${name} — ${job.ref} — ${job.property_address || job.service}`, text });
  return getJob(env, jobId);
}

export async function askForAddress(env, jobId, origin, { party = "admin" } = {}) {
  const job = await getJob(env, jobId);
  if (!job) throw new JobError("Job not found", 404);
  const first = job.customer_name ? job.customer_name.split(" ")[0] : "there";
  const text = `Hi ${first}, it's Dom Bowkett. To get your ${job.service} booked in, could you reply with the full property address including the postcode? Thanks.`;
  let sentAny = false;
  if (job.customer_phone) { try { const sid = await sendSms(env, job.customer_phone, text); await addMessage(env, jobId, { direction: "out", channel: "sms", party, counterpart: "customer", body: text, provider_id: sid }); sentAny = true; } catch (e) { await addMessage(env, jobId, { direction: "out", channel: "system", party: "system", body: `Text failed: ${e.message}` }); } }
  if (job.customer_email) {
    const subject = `${jobTag(job)} Your ${job.service} — property address needed`;
    const id = await mail(env, jobId, "ask_address", { to: job.customer_email, replyTo: JOBS_INBOX, subject, html: emailShell(`<p>${esc(text)}</p><p>Kind regards,<br/>Dominic Bowkett</p>`) });
    if (id) { await addMessage(env, jobId, { direction: "out", channel: "email", party, counterpart: "customer", subject, body: text, provider_id: id }); sentAny = true; }
  }
  if (!sentAny) throw new JobError("No phone number or email on file to ask");
  await updateJob(env, jobId, { status: "awaiting_address" });
  return getJob(env, jobId);
}

export async function confirmBooking(env, jobId, { booked_date, booked_time, price, party = "admin" }, origin) {
  const job = await getJob(env, jobId);
  if (!job) throw new JobError("Job not found", 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booked_date || "")) throw new JobError("Enter the booking date");
  const time = clean(booked_time, 40);
  const pricePence = price === "" || price == null ? null : Math.round(Number(String(price).replace(/[£,\s]/g, "")) * 100);
  if (pricePence != null && !(pricePence >= 0)) throw new JobError("Price must be a number");
  await updateJob(env, jobId, { status: "booked", booked_date, booked_time: time, price_pence: pricePence, booked_at: new Date().toISOString(), booked_by: party });
  await addMessage(env, jobId, { direction: "in", channel: "system", party, body: `Booked for ${fmtDate(booked_date)}${time ? ` at ${time}` : ""}${pricePence != null ? `, price ${gbp(pricePence)}` : ""}.` });
  const fresh = await getJob(env, jobId);
  const p = fresh.partner_account_id ? await getPartner(env, fresh.partner_account_id) : null;
  if (fresh.customer_email) {
    const subject = `${jobTag(fresh)} Your ${fresh.service} is booked — ${fmtDate(booked_date)}${time ? ` at ${time}` : ""}`;
    await mail(env, jobId, "booked_customer", {
      to: fresh.customer_email, replyTo: JOBS_INBOX, subject,
      html: emailShell(`<p>${fresh.customer_name ? `Hello ${esc(fresh.customer_name.split(" ")[0])},` : "Hello,"}</p>
<p>Your ${esc(fresh.service)} at <strong>${esc(fresh.property_address || "")}</strong> is booked for <strong>${esc(fmtDate(booked_date))}${time ? ` at ${esc(time)}` : ""}</strong>${p ? ` with ${esc(p.contact_name || p.display_name || p.business_name)}` : ""}.${pricePence != null ? ` The agreed price is ${gbp(pricePence)}; an invoice with a secure payment link will follow.` : ""}</p>
<p>If anything changes, just reply to this email.</p><p>Kind regards,<br/>Dominic Bowkett</p>`),
    });
    await addMessage(env, jobId, { direction: "out", channel: "email", party: "system", counterpart: "customer", subject, body: "Booking confirmation sent to customer." });
  }
  await notifyDom(env, fresh, origin, `Booked: ${fmtDate(booked_date)}${time ? ` ${time}` : ""}${pricePence != null ? ` ${gbp(pricePence)}` : ""}`);
  return fresh;
}

// ---------------------------------------------------------------- inbound matching

async function partnerByPhone(env, phone) {
  const d = await db(env);
  const ps = (await d.prepare(`SELECT * FROM partners WHERE phone IS NOT NULL AND phone != ''`).all()).results || [];
  return ps.find((p) => e164(p.phone) === phone) || null;
}
async function openJobsWhere(env, sql, binds) {
  const d = await db(env);
  return (await d.prepare(`SELECT * FROM jobs WHERE status IN (${OPEN.map(() => "?").join(",")}) AND ${sql} ORDER BY last_activity_at DESC`).bind(...OPEN, ...binds).all()).results || [];
}

// Inbound text from the office number. Returns { handled, job } — when not handled the caller falls back to its old behaviour.
export async function inboundSms(env, { from, body, media = [] }, origin) {
  from = e164(from);
  body = clean(body, 2000) || "";
  const partner = await partnerByPhone(env, from);
  if (partner) {
    const jobs = await openJobsWhere(env, "partner_account_id = ?", [partner.stripe_account_id]);
    const offered = jobs.find((j) => j.status === "offered");
    const word = body.trim().toUpperCase().replace(/[^A-Z]/g, " ").trim().split(/\s+/)[0];
    if (offered && (word === "YES" || word === "Y" || word === "NO" || word === "N")) {
      const job = await partnerResponds(env, offered.id, word.startsWith("Y"), origin, { via: "sms", note: body });
      return { handled: true, job, reply: word.startsWith("Y") ? `Thanks — the job is yours. Customer details are on their way by text and email.` : `No problem, thanks for letting us know.` };
    }
    const job = jobs[0];
    if (job) {
      await addMessage(env, job.id, { direction: "in", channel: "sms", party: "partner", counterpart: "admin", body, meta: media.length ? { media } : null });
      await notifyDom(env, job, origin, `Text from ${partner.display_name || partner.business_name}: "${body.slice(0, 80)}"`);
      return { handled: true, job };
    }
    return { handled: false };
  }
  const jobs = await openJobsWhere(env, "customer_phone = ?", [from]);
  const job = jobs[0];
  if (!job) return { handled: false };
  await addMessage(env, job.id, { direction: "in", channel: "sms", party: "customer", counterpart: job.partner_account_id ? "partner" : "admin", body, meta: media.length ? { media } : null });
  let headline = `Text from customer: "${body.slice(0, 80)}"`;
  if (job.status === "awaiting_address") {
    const extracted = await extractAddress(env, body, job);
    if (extracted?.property_address) {
      await editJob(env, job.id, { property_address: extracted.property_address, postcode: extracted.postcode || "" });
      headline = `Address received: ${extracted.property_address}`;
    }
  }
  const fresh = await getJob(env, job.id);
  await notifyDom(env, fresh, origin, headline);
  if (fresh.partner_account_id && ["accepted", "booked"].includes(fresh.status)) {
    const p = await getPartner(env, fresh.partner_account_id);
    if (p?.phone) { try { await sendSms(env, p.phone, `Dominic Bowkett: message from ${fresh.customer_name || "the customer"} about ${fresh.property_address}: "${body.slice(0, 300)}". Reply at ${portalLink(origin, fresh)}`); } catch {} }
  }
  return { handled: true, job: fresh };
}

// Inbound email to in@jobs.dominicbowkett.com (forwarded enquiries and replies).
export async function inboundEmail(env, { from, subject = "", text = "", html = "", messageId }, origin) {
  from = String(from || "").toLowerCase().replace(/.*<([^>]+)>.*/, "$1").trim();
  const bodyText = clean(text || htmlToText(html), 20000) || "";
  const tag = /DB-JOB-\d{6}/.exec(subject || "")?.[0] || /DB-JOB-\d{6}/.exec(bodyText)?.[0];
  let job = tag ? await getJobByRef(env, tag) : null;
  const isForwarder = ALLOWED_FORWARDERS.includes(from);
  if (!job && !isForwarder) {
    const byEmail = await openJobsWhere(env, "customer_email = ?", [from]);
    job = byEmail[0] || null;
    if (!job) {
      const d = await db(env);
      const p = await d.prepare(`SELECT * FROM partners WHERE lower(email) = ? OR lower(invoice_email) = ?`).bind(from, from).first();
      if (p) job = (await openJobsWhere(env, "partner_account_id = ?", [p.stripe_account_id]))[0] || null;
      if (job) {
        const reply = stripQuoted(bodyText);
        const yn = reply.trim().toUpperCase().split(/\s+/)[0];
        if (job.status === "offered" && (yn === "YES" || yn === "NO")) { await partnerResponds(env, job.id, yn === "YES", origin, { via: "email", note: reply.slice(0, 200) }); return { handled: true, job }; }
        await addMessage(env, job.id, { direction: "in", channel: "email", party: "partner", counterpart: "admin", subject, body: reply, provider_id: messageId });
        await notifyDom(env, job, origin, `Email from partner: "${reply.slice(0, 80)}"`);
        return { handled: true, job };
      }
    }
  }
  if (job && !isForwarder) {
    const reply = stripQuoted(bodyText);
    await addMessage(env, job.id, { direction: "in", channel: "email", party: "customer", counterpart: job.partner_account_id ? "partner" : "admin", subject, body: reply, provider_id: messageId });
    let headline = `Email from customer: "${reply.slice(0, 80)}"`;
    if (job.status === "awaiting_address") {
      const ex = await extractAddress(env, reply, job);
      if (ex?.property_address) { await editJob(env, job.id, { property_address: ex.property_address, postcode: ex.postcode || "" }); headline = `Address received: ${ex.property_address}`; }
    }
    const fresh = await getJob(env, job.id);
    await notifyDom(env, fresh, origin, headline);
    if (fresh.partner_account_id && ["accepted", "booked"].includes(fresh.status)) {
      const p = await getPartner(env, fresh.partner_account_id);
      if (p) await mail(env, fresh.id, "relay_partner", { to: p.invoice_email || p.email, replyTo: JOBS_INBOX, subject: `${jobTag(fresh)} Message from ${fresh.customer_name || "the customer"}`, html: emailShell(`<p style="white-space:pre-wrap;">${esc(reply)}</p><p style="font-size:13px;color:#7a7873;">Reply here or at ${portalLink(origin, fresh)}</p>`) });
    }
    return { handled: true, job: fresh };
  }
  if (job && isForwarder) {
    // Dom replying on a tagged thread from his own inbox: treat as a message to the customer.
    const reply = stripQuoted(bodyText);
    if (reply) await sendMessage(env, job.id, { to: "customer", channel: "email", body: reply, party: "admin", origin });
    return { handled: true, job };
  }
  if (!isForwarder) return { handled: false, reason: "unknown sender" };
  // A forwarded enquiry from Dom: extract the job.
  const ex = await extractEnquiry(env, bodyText, subject);
  const data = {
    source: "email", source_ref: messageId || null,
    customer_name: ex.customer_name, customer_email: ex.customer_email, customer_phone: ex.customer_phone,
    property_address: ex.property_address, postcode: ex.postcode, service: ex.service || "Domestic EPC",
    details: ex.summary, requested_times: ex.requested_times, raw_text: bodyText.slice(0, 20000),
  };
  const created = await createJob(env, data, origin);
  return { handled: true, job: created, created: true };
}

export function stripQuoted(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const l of lines) {
    if (/^On .{5,120} wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: .+@/i.test(l) || /^>+/.test(l) || /^_{5,}|^-{5,}$/.test(l) || /^Sent from my/i.test(l)) break;
    out.push(l);
  }
  let s = out.join("\n").trim();
  // signature: cut at a lone "--" or at a line that is just Dom's sign-off
  s = s.replace(/\n--\s*\n[\s\S]*$/, "").replace(/\n(Dominic Bowkett|Dom Bowkett|Thanks,?|Kind regards,?|Regards,?)\s*\n[\s\S]*$/i, "").trim();
  return s;
}
export function htmlToText(html) {
  return String(html || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- AI extraction (Workers AI), with a regex fallback

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
async function aiJson(env, system, user) {
  if (!env.AI) return null;
  try {
    const r = await env.AI.run(MODEL, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 600, temperature: 0 });
    const txt = typeof r === "string" ? r : r.response || "";
    const m = /\{[\s\S]*\}/.exec(txt);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.warn("AI extraction failed", e.message);
    return null;
  }
}

export async function extractEnquiry(env, text, subject = "") {
  const fallback = {
    customer_name: null, customer_email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text)?.[0] || null,
    customer_phone: [...text.matchAll(/(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}/g)].map((m) => m[0]).find((p) => !isOwnPhone(p)) || null,
    property_address: null, postcode: postcodeFrom(text), service: /survey/i.test(text + subject) && !/epc|energy performance/i.test(text + subject) ? "Home survey" : "Domestic EPC",
    requested_times: null, summary: stripQuoted(text).slice(0, 1500),
  };
  const ai = await aiJson(
    env,
    `You extract a property-services enquiry from a forwarded email. Ignore email signatures, legal footers, quoted headers and the forwarder's own words; focus on the customer and the job. The forwarder is Dominic Bowkett (phones 07946 618203, 07476 394125, 07973 713747; emails @dominicbowkett.com): never return his details as the customer's. Reply with ONLY a JSON object with keys: customer_name, customer_email, customer_phone, property_address (full postal address if given, else null), postcode (UK postcode or null), service (e.g. "Domestic EPC", "Home survey", "Retrofit assessment"), requested_times (any dates/times/urgency the customer mentioned, else null), summary (2-3 plain sentences of what the customer wants, no signature). Use null when unknown. Never invent details.`,
    `Subject: ${subject}\n\n${text.slice(0, 12000)}`
  );
  if (!ai) return fallback;
  const out = { ...fallback };
  for (const k of Object.keys(fallback)) if (ai[k] != null && String(ai[k]).trim() && String(ai[k]).toLowerCase() !== "null") out[k] = String(ai[k]).trim();
  if (out.customer_email && !/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(out.customer_email)) out.customer_email = fallback.customer_email;
  if (ALLOWED_FORWARDERS.includes(String(out.customer_email || "").toLowerCase())) out.customer_email = null;
  if (out.customer_phone && isOwnPhone(out.customer_phone)) out.customer_phone = fallback.customer_phone;
  out.postcode = normalisePostcode(out.postcode) || postcodeFrom(out.property_address) || fallback.postcode;
  // Use the service names the admin dropdown uses, so jobs and invoices line up.
  const svc = String(out.service || "").toLowerCase();
  if (/epc|energy performance/.test(svc) && !/commercial/.test(svc)) out.service = "Domestic EPC";
  else if (/level 3|building survey|full structural/.test(svc)) out.service = "Building Survey (Level 3)";
  else if (/level 2|homebuyer/.test(svc)) out.service = "HomeBuyer Survey (Level 2)";
  else if (/retrofit/.test(svc)) out.service = "Retrofit Assessment";
  else if (/ventilation/.test(svc)) out.service = "Ventilation Assessment";
  else if (/survey/.test(svc)) out.service = "Home Insight Survey";
  return out;
}

export async function extractAddress(env, text, job) {
  const pc = postcodeFrom(text);
  const ai = await aiJson(
    env,
    `A customer was asked for the full address of a property. From their message, reply with ONLY a JSON object: {"property_address": "<full address including postcode, or null if no address is given>", "postcode": "<UK postcode or null>"}. Never invent an address.`,
    `Message: ${text.slice(0, 2000)}${job?.postcode ? `\n(The enquiry postcode on file is ${job.postcode}.)` : ""}`
  );
  const addr = ai?.property_address && String(ai.property_address).toLowerCase() !== "null" ? String(ai.property_address).trim() : null;
  if (addr) return { property_address: addr, postcode: normalisePostcode(ai.postcode) || postcodeFrom(addr) || pc };
  // fallback: a message with a postcode and a house number/name is probably the address
  if (pc && /\d/.test(text) && text.length < 200) return { property_address: text.trim(), postcode: pc };
  return null;
}

// ---------------------------------------------------------------- invoice from a booked job

export function invoiceDraftFromJob(job, partner) {
  const pct = Number(partner?.commission_pct ?? 10);
  const amount = job.price_pence != null ? (job.price_pence / 100).toFixed(2) : "";
  const fee = job.price_pence != null ? (Math.round((job.price_pence * pct) / 100) / 100).toFixed(2) : "";
  return {
    partner_account_id: job.partner_account_id, client_email: job.customer_email || "", client_name: job.customer_name || "",
    property_address: job.property_address || "", service_name: job.service, amount, fee, client_vat_inclusive: false,
    description: job.booked_date ? `Carried out ${fmtDate(job.booked_date)}${job.booked_time ? ` at ${job.booked_time}` : ""}.` : "",
  };
}

export { JOBS_INBOX, ALLOWED_FORWARDERS };
