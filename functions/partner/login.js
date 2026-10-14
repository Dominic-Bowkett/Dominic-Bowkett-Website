// POST /partner/login
import { getPartnerUserByEmail, verifyPassword, partnerSessionCookie, touchLogin, getPartnerUser } from "../_shared/partner-auth.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData().catch(() => null);
  const email = String(form?.get("email") || "").trim().toLowerCase();
  const password = String(form?.get("password") || "");
  const nextRaw = String(form?.get("next") || "");
  const next = /^\/partner(\/[A-Za-z0-9_\/-]*)?$/.test(nextRaw) ? nextRaw : "/partner";
  const user = await getPartnerUserByEmail(env, email);
  const ok = user && !user.disabled && user.password_hash && (await verifyPassword(password, user.password_salt, user.password_hash));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    return Response.redirect(new URL(`/partner?failed=1${next !== "/partner" ? `&next=${encodeURIComponent(next)}` : ""}`, request.url).toString(), 303);
  }
  await touchLogin(env, user);
  const full = await getPartnerUser(env, user.id);
  return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": await partnerSessionCookie(env, full) } });
}
