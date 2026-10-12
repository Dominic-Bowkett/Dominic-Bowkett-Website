// GET /partner/register/verify/:token — email verified: choose a password. POST — create the account and sign in.
import { getSignup, passwordForm, expiredPage, completeRegistration } from "../../../_shared/register.js";
import { partnerSessionCookie, getPartnerUser } from "../../../_shared/partner-auth.js";
import { PortalError } from "../../../_shared/portal.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function onRequestGet({ env, params }) {
  const s = await getSignup(env, params.token);
  if (!s) return new Response(expiredPage(), { status: 410, headers });
  return new Response(passwordForm(params.token, s), { headers });
}

export async function onRequestPost({ request, env, params }) {
  const s = await getSignup(env, params.token);
  if (!s) return new Response(expiredPage(), { status: 410, headers });
  const fd = await request.formData().catch(() => new FormData());
  const pw = String(fd.get("password") || ""), pw2 = String(fd.get("password2") || "");
  if (pw !== pw2) return new Response(passwordForm(params.token, s, { error: "The two passwords don't match." }), { status: 400, headers });
  try {
    const user = await completeRegistration(env, s, pw, new URL(request.url).origin);
    const full = await getPartnerUser(env, user.id);
    return new Response(null, { status: 303, headers: { Location: "/partner?welcome=1", "Set-Cookie": await partnerSessionCookie(env, full) } });
  } catch (e) {
    return new Response(passwordForm(params.token, s, { error: e.message }), { status: e instanceof PortalError ? e.status : 500, headers });
  }
}
