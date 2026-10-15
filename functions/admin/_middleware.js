// Every /admin page may be shown inside Dom's hub (hub.dominicbowkett.com), and nowhere else.
export async function onRequest(context) {
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", "frame-ancestors 'self' https://hub.dominicbowkett.com");
  return out;
}
