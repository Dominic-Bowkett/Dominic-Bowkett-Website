// POST /admin/login — form login; sets the signed session cookie.
import { checkPassword, sessionCookie } from "../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const ok = await checkPassword(env, password);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400)); // slow down guessing
    return Response.redirect(new URL("/admin?failed=1", request.url).toString(), 303);
  }
  return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": await sessionCookie(env) } });
}
