// GET /api/hub/sso?t=<pass> — sign-in handoff from Dom's hub (hub.dominicbowkett.com).
// The hub signs a pass with HUB_KEY: base64url({ s: "jobs", e: expiry ms, n: nonce, p: path })
// + "." + hex HMAC of "sso:" + payload. A pass lasts a minute and works once. The hub is on
// the same site (dominicbowkett.com), so the ordinary admin cookie works inside its frame.
import { sessionCookie } from "../../_shared/auth.js";
import { db } from "../../_shared/db.js";

const SITE = "jobs";

const enc = new TextEncoder();
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(String(s)))));
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}
const page = (msg, status) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in</title><p style="font:15px system-ui;padding:24px">${msg}</p>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });

export async function onRequestGet({ request, env }) {
  if (!env.HUB_KEY || !env.ADMIN_SECRET) return page("Hub sign-in is not set up.", 503);
  const [payload, sig] = String(new URL(request.url).searchParams.get("t") || "").split(".");
  if (!payload || !sig || !(await same(sig, await hmacHex(env.HUB_KEY, `sso:${payload}`)))) return page("That sign-in link is not valid.", 403);
  let pass;
  try { pass = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return page("That sign-in link is not valid.", 403); }
  const now = Date.now();
  if (pass.s !== SITE || !(pass.e > now) || pass.e > now + 120000 || !/^[a-f0-9]{16,64}$/.test(String(pass.n || ""))) {
    return page("That sign-in link has expired. Reopen the tab in the hub.", 403);
  }
  // Same-site paths only: never an open redirect.
  const path = typeof pass.p === "string" && /^\/(?![\/\\])/.test(pass.p) ? pass.p : "/admin";

  const d = await db(env);
  await d.prepare("CREATE TABLE IF NOT EXISTS hub_sso_used (n TEXT PRIMARY KEY, at INTEGER NOT NULL)").run();
  const used = await d.prepare("INSERT OR IGNORE INTO hub_sso_used (n, at) VALUES (?, ?)").bind(pass.n, now).run();
  if (!used.meta?.changes) return page("That sign-in link has already been used. Reopen the tab in the hub.", 403);
  await d.prepare("DELETE FROM hub_sso_used WHERE at < ?").bind(now - 86400000).run();

  return new Response(null, {
    status: 302,
    headers: { location: path, "set-cookie": await sessionCookie(env), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
