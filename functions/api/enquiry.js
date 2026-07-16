// POST /api/enquiry
// Body: { "name": "...", "email": "...", "message": "...", "phone"?: "..." }
// Sends a notification to the owner and a confirmation to the enquirer.
// The confirmation carries an unsubscribe button + List-Unsubscribe headers,
// and is suppressed for anyone who has opted out.
import {
  normaliseEmail,
  signUnsub,
  unsubscribeUrl,
  unsubscribeHeaders,
  unsubscribeFooterHtml,
  isSuppressed,
  sendViaResend,
  OWNER_TO,
} from "../_shared/email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const name = String(data.name || "").trim();
  const email = normaliseEmail(data.email);
  const phone = String(data.phone || "").trim();
  const message = String(data.message || "").trim();

  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "A valid email is required" }, 400);
  if (!message) return json({ ok: false, error: "A message is required" }, 400);

  // 1) Owner notification — always send.
  try {
    await sendViaResend(env, {
      to: OWNER_TO,
      replyTo: email,
      subject: `Enquiry — ${name || email}`,
      html: `
        <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0c0c0c;line-height:1.6;">
          <p><strong>New enquiry</strong></p>
          <p><strong>Name:</strong> ${esc(name) || "—"}<br/>
             <strong>Email:</strong> ${esc(email)}<br/>
             <strong>Phone:</strong> ${esc(phone) || "—"}</p>
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap;">${esc(message)}</p>
        </div>`,
    });
  } catch (err) {
    return json({ ok: false, error: `Failed to send: ${err.message}` }, 502);
  }

  // 2) Confirmation to the enquirer — skip if they've unsubscribed.
  let confirmationSent = false;
  if (!(await isSuppressed(env, email))) {
    const token = await signUnsub(env.UNSUB_SECRET, email);
    const unsubUrl = unsubscribeUrl(origin, email, token);
    try {
      await sendViaResend(env, {
        to: email,
        subject: "Thanks — I've got your enquiry",
        headers: unsubscribeHeaders(unsubUrl),
        html: `
          <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0c0c0c;line-height:1.65;max-width:560px;">
            <p>Hi ${esc(name) || "there"},</p>
            <p>Thanks for getting in touch. I've received your enquiry and aim to come back
               with a fixed fee and a date inside one working day.</p>
            <p>If anything's urgent in the meantime, call
               <a href="tel:+447946618203" style="color:#0c0c0c;">07946&nbsp;618203</a>.</p>
            <p>— Dominic Bowkett<br/>
               <span style="color:#7a7873;">Building Surveyor · Energy &amp; Retrofit Assessor · Hartfield, East Sussex</span></p>
            ${unsubscribeFooterHtml(unsubUrl)}
          </div>`,
      });
      confirmationSent = true;
    } catch (err) {
      // Owner mail already went out; don't fail the whole request on the auto-reply.
      return json({ ok: true, confirmationSent: false, warning: err.message });
    }
  }

  return json({ ok: true, confirmationSent });
}
