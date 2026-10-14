// GET /partner — sign-in form, or the partner's invoice dashboard when signed in.
import { currentPartnerUser } from "../_shared/partner-auth.js";
import { portalPage, dashboardHtml } from "../_shared/portal.js";
import { refreshPartnerFromStripe } from "../_shared/register.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

const safeNext = (n) => (/^\/partner(\/[A-Za-z0-9_\/-]*)?$/.test(String(n || "")) ? String(n) : "");

export function loginForm({ error, info, email = "", next = "" } = {}) {
  const e = String(email).replace(/"/g, "&quot;");
  return portalPage({
    title: "Sign in",
    body: `<div class="card login"><h1>Partner sign in</h1>
${error ? `<p class="msg err">${error}</p>` : ""}${info ? `<p class="msg ok">${info}</p>` : ""}
<form method="post" action="/partner/login">
<input type="hidden" name="next" value="${safeNext(next)}" />
<label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required value="${e}" />
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required />
<p style="margin-top:18px"><button class="btn" type="submit">Sign in</button></p>
</form>
<div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--rule)">
<h2 style="font-size:14px">First time here, or forgotten your password?</h2>
<p class="small muted">Enter your email and we'll send you a link to set your password.</p>
<form method="post" action="/partner/forgot" style="display:flex;gap:8px;flex-wrap:wrap">
<input type="hidden" name="next" value="${safeNext(next)}" />
<input name="email" type="email" required placeholder="your@email" value="${e}" style="flex:1 1 220px" />
<button class="btn secondary" type="submit">Email me a link</button></form>
</div>
<p class="small muted" style="margin-top:14px">New partner? <a href="/partner/register">Register here</a>.</p>
</div>`,
  });
}

export async function onRequestGet({ request, env }) {
  const user = await currentPartnerUser(request, env);
  const url = new URL(request.url);
  if (!user) {
    const info = url.searchParams.get("reset") ? "If that email has an account, a link to set your password is on its way. Check your inbox (and spam)." : url.searchParams.get("out") ? "You're signed out." : url.searchParams.get("next") ? "Please sign in to see this job." : "";
    return new Response(loginForm({ error: url.searchParams.get("failed") ? "Wrong email or password. If you haven't set a password yet, use the form below to get a link." : "", info, next: url.searchParams.get("next") || "" }), { headers });
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
