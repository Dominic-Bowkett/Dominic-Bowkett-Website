// GET  /api/unsubscribe?e=<email>&t=<token>  -> confirmation landing page + record opt-out
// POST /api/unsubscribe?e=<email>&t=<token>  -> RFC 8058 one-click unsubscribe (no body needed)
import { normaliseEmail, verifyUnsub, suppress } from "../_shared/email.js";

function page({ title, body }) {
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · Dominic Bowkett</title>
  <style>
    :root{--paper:#fafaf8;--ink:#0c0c0c;--muted:#7a7873;--rule:#e2dfd8}
    *{box-sizing:border-box}
    body{margin:0;background:var(--paper);color:var(--ink);
      font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;width:100%;background:#fff;border:1px solid var(--rule);
      border-radius:4px;padding:clamp(32px,6vw,56px)}
    h1{font-size:22px;font-weight:600;margin:0 0 12px;letter-spacing:-0.01em}
    p{color:var(--muted);line-height:1.65;margin:0 0 16px;font-size:15px}
    a{color:var(--ink)}
    .home{display:inline-block;margin-top:8px;font-size:14px;text-decoration:underline}
  </style></head>
  <body><main class="card">${body}
    <a class="home" href="/">Return to dominicbowkett.com</a>
  </main></body></html>`;
}

async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = normaliseEmail(url.searchParams.get("e"));
  const token = url.searchParams.get("t");

  const ok = await verifyUnsub(env.UNSUB_SECRET, email, token);
  if (!ok) {
    return new Response(
      page({
        title: "Link expired",
        body: `<h1>This unsubscribe link isn't valid</h1>
          <p>The link may have been copied incompletely, or it's from an old email.
          To be removed, reply to any of our emails with “unsubscribe” and we'll take care of it.</p>`,
      }),
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  await suppress(env, email, { source: request.method === "POST" ? "one-click" : "link" });

  // One-click (RFC 8058): mail clients POST here and expect a bare 200.
  if (request.method === "POST") {
    return new Response("Unsubscribed", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(
    page({
      title: "Unsubscribed",
      body: `<h1>You're unsubscribed</h1>
        <p><strong>${email}</strong> has been removed and won't receive further enquiry emails from Dominic Bowkett.</p>
        <p>If this was a mistake, just email
        <a href="mailto:info@dominicbowkett.com">info@dominicbowkett.com</a> and we'll add you back.</p>`,
    }),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export const onRequestGet = handle;
export const onRequestPost = handle;
