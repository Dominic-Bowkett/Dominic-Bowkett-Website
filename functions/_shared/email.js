// Shared email + unsubscribe helpers for Dominic Bowkett enquiry mail.
// Runs on the Cloudflare Pages Functions runtime (Web Crypto available).

const FROM_DEFAULT = "Dominic Bowkett <info@dominicbowkett.com>";
const OWNER_TO = "info@dominicbowkett.com";

const enc = new TextEncoder();

// ---- signed unsubscribe tokens (stateless, HMAC-SHA256 over the email) ----

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function signUnsub(secret, email) {
  return hmacHex(secret, normaliseEmail(email));
}

// Constant-time-ish comparison to blunt token guessing.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyUnsub(secret, email, token) {
  if (!secret || !email || !token) return false;
  const expected = await signUnsub(secret, email);
  return safeEqual(expected, String(token));
}

export function unsubscribeUrl(origin, email, token) {
  const q = new URLSearchParams({ e: normaliseEmail(email), t: token });
  return `${origin}/api/unsubscribe?${q.toString()}`;
}

// ---- suppression list (KV) ----

export async function isSuppressed(env, email) {
  if (!env.SUPPRESSED) return false;
  const hit = await env.SUPPRESSED.get(normaliseEmail(email));
  return hit !== null;
}

export async function suppress(env, email, meta = {}) {
  if (!env.SUPPRESSED) throw new Error("SUPPRESSED KV binding is not configured");
  await env.SUPPRESSED.put(
    normaliseEmail(email),
    JSON.stringify({ at: new Date().toISOString(), ...meta })
  );
}

// ---- HTML footer with the unsubscribe button ----

export function unsubscribeFooterHtml(unsubUrl) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #e2dfd8;">
      <tr><td style="padding-top:20px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7a7873;">
        <p style="margin:0 0 12px;">
          EMS-2 Ltd trading as Dominic Bowkett &middot; 128 City Road, London, EC1V 2NX &middot;
          Company No.&nbsp;11235441 &middot; ICO:&nbsp;ZB664140
        </p>
        <p style="margin:0;">
          You are receiving this because you contacted Dominic Bowkett about a survey or assessment.
          <br />
          <a href="${unsubUrl}" style="color:#0c0c0c;text-decoration:underline;font-weight:500;">Unsubscribe from these emails</a>
        </p>
      </td></tr>
    </table>`;
}

// ---- Resend send ----

export async function sendViaResend(env, { to, subject, html, replyTo, headers = {}, from }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from || env.MAIL_FROM || FROM_DEFAULT,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${body?.message || JSON.stringify(body)}`);
  }
  return body; // { id: ... }
}

// Build the List-Unsubscribe headers for a one-click compliant email.
export function unsubscribeHeaders(unsubUrl) {
  return {
    "List-Unsubscribe": `<${unsubUrl}>, <mailto:${OWNER_TO}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export { FROM_DEFAULT, OWNER_TO };
