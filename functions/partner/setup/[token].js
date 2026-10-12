// GET/POST /partner/setup/:token — first-time password setup, also used for resets.
import { getPartnerUserByToken, validatePassword, setPassword, partnerSessionCookie, touchLogin } from "../../_shared/partner-auth.js";
import { portalPage } from "../../_shared/portal.js";
import { getPartner } from "../../_shared/db.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

function form(token, { error = "", name = "", email = "" } = {}) {
  return portalPage({
    title: "Choose a password",
    body: `<div class="card login"><h1>Choose your password</h1>
<p class="muted">Account: <strong>${name}</strong> · ${email}</p>
${error ? `<p class="msg err">${error}</p>` : ""}
<form method="post" action="/partner/setup/${token}">
<label for="pw">New password (at least 10 characters)</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="10" required autofocus />
<label for="pw2">Repeat it</label><input id="pw2" name="password2" type="password" autocomplete="new-password" minlength="10" required />
<p style="margin-top:18px"><button class="btn" type="submit">Save password and sign in</button></p>
</form></div>`,
  });
}

const expired = () =>
  portalPage({
    title: "Link expired",
    body: `<div class="card login"><h1>This link has expired</h1><p class="muted">Setup and reset links work for 72 hours. Go to <a href="/partner">the sign-in page</a> and use "Forgotten your password" to get a fresh one, or reply to the email you received.</p></div>`,
  });

export async function onRequestGet({ env, params }) {
  const user = await getPartnerUserByToken(env, params.token);
  if (!user) return new Response(expired(), { status: 410, headers });
  const p = await getPartner(env, user.stripe_account_id);
  return new Response(form(params.token, { name: p?.display_name || p?.business_name || "", email: user.email }), { headers });
}

export async function onRequestPost({ request, env, params }) {
  const user = await getPartnerUserByToken(env, params.token);
  if (!user) return new Response(expired(), { status: 410, headers });
  const p = await getPartner(env, user.stripe_account_id);
  const fd = await request.formData().catch(() => null);
  const pw = String(fd?.get("password") || ""), pw2 = String(fd?.get("password2") || "");
  const err = validatePassword(pw) || (pw !== pw2 ? "The two passwords don't match." : null);
  if (err) return new Response(form(params.token, { error: err, name: p?.display_name || p?.business_name || "", email: user.email }), { status: 400, headers });
  const full = await setPassword(env, user, pw);
  await touchLogin(env, full);
  return new Response(null, { status: 303, headers: { Location: "/partner", "Set-Cookie": await partnerSessionCookie(env, full) } });
}
