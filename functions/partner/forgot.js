// POST /partner/forgot — emails a reset link if the address has an account. Always responds the same way.
import { getPartnerUserByEmail } from "../_shared/partner-auth.js";
import { invitePartnerUser } from "../_shared/portal.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData().catch(() => null);
  const email = String(form?.get("email") || "").trim().toLowerCase();
  const user = email ? await getPartnerUserByEmail(env, email) : null;
  if (user && !user.disabled) {
    try { await invitePartnerUser(env, user.stripe_account_id, email, new URL(request.url).origin); } catch (e) { console.error("reset email failed", e.message); }
  } else {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
  }
  return Response.redirect(new URL("/partner?reset=1", request.url).toString(), 303);
}
