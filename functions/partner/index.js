// GET /partner — sign-in form, or the partner's invoice dashboard when signed in.
import { currentPartnerUser } from "../_shared/partner-auth.js";
import { portalPage, dashboardHtml } from "../_shared/portal.js";
import { refreshPartnerFromStripe } from "../_shared/register.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

export function loginForm({ error, info, email = "" } = {}) {
  return portalPage({
    title: "Sign in",
    body: `<div class="card login"><h1>Partner sign in</h1>
${error ? `<p class="msg err">${error}</p>` : ""}${info ? `<p class="msg ok">${info}</p>` : ""}
<form method="post" action="/partner/login">
<label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required value="${email.replace(/"/g, "&quot;")}" />
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required />
<p style="margin-top:18px"><button class="btn" type="submit">Sign in</button></p>
</form>
<p class="small muted" style="margin-top:14px">New partner? <a href="/partner/register">Register here</a>.</p>
<form method="post" action="/partner/forgot" style="margin-top:8px"><input type="hidden" name="email" value="${email.replace(/"/g, "&quot;")}" /><button type="submit" class="small" style="background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px">Forgotten your password? Email me a reset link</button></form>
</div>`,
  });
}

export async function onRequestGet({ request, env }) {
  const user = await currentPartnerUser(request, env);
  const url = new URL(request.url);
  if (!user) {
    const info = url.searchParams.get("reset") ? "If that email has an account, a reset link is on its way." : url.searchParams.get("out") ? "You're signed out." : "";
    return new Response(loginForm({ error: url.searchParams.get("failed") ? "Wrong email or password." : "", info }), { headers });
  }
  // Returning from Stripe onboarding (or when not yet enabled): refresh the live status first.
  const stripeParam = url.searchParams.get("stripe");
  let stripeNote = "";
  if (stripeParam || !user.charges_enabled) {
    try { await refreshPartnerFromStripe(env, user.stripe_account_id); } catch (e) { stripeNote = stripeParam ? `We couldn't confirm your Stripe status yet (${e.message}). Try again in a minute.` : ""; }
    if (stripeParam === "refresh") stripeNote = "The Stripe link expired before you finished. Click the button to continue where you left off.";
  }
  return new Response(await dashboardHtml(env, user, url.origin, { welcome: !!url.searchParams.get("welcome"), stripeNote }), { headers });
}
