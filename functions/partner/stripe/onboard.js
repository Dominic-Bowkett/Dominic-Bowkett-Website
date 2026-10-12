// POST /partner/stripe/onboard — send the signed-in partner to Stripe's hosted onboarding for their account.
import { currentPartnerUser } from "../../_shared/partner-auth.js";
import { stripeOnboardingUrl } from "../../_shared/register.js";
import { portalPage } from "../../_shared/portal.js";

export async function onRequestPost({ request, env }) {
  const user = await currentPartnerUser(request, env);
  const origin = new URL(request.url).origin;
  if (!user) return Response.redirect(`${origin}/partner`, 303);
  try {
    const url = await stripeOnboardingUrl(env, user.stripe_account_id, origin);
    return Response.redirect(url, 303);
  } catch (e) {
    return new Response(portalPage({ title: "Stripe unavailable", user, body: `<div class="card login"><h1>Stripe is unavailable right now</h1><p>${e.message}</p><p><a class="btn secondary" href="/partner">Back</a></p></div>` }), {
      status: 502,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
