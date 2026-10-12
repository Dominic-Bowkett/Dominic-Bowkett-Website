// GET /partner/register — registration form. POST — create the signup and send the verification email.
import { registerForm, startRegistration, checkEmailPage } from "../../_shared/register.js";
import { PortalError } from "../../_shared/portal.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function onRequestGet() {
  return new Response(registerForm(), { headers });
}

export async function onRequestPost({ request, env }) {
  const form = await request.formData().catch(() => new FormData());
  try {
    const values = await startRegistration(env, form, new URL(request.url).origin);
    return new Response(checkEmailPage(values.email), { headers });
  } catch (e) {
    const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    return new Response(registerForm({ error: e.message, values }), { status: e instanceof PortalError ? e.status : 500, headers });
  }
}
