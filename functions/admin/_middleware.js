// Every /admin page may be shown inside Dom's hub (hub.dominicbowkett.com), and nowhere else.
// The jobs board rings customers from the browser (Twilio, see functions/_shared/voice.js), so the microphone is
// allowed for this site's own admin pages; pages that set their own policy (the survey) keep theirs.
export async function onRequest(context) {
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", "frame-ancestors 'self' https://hub.dominicbowkett.com");
  if (!out.headers.has("permissions-policy")) out.headers.set("Permissions-Policy", "geolocation=(), microphone=(self), camera=(), interest-cohort=()");
  return out;
}
