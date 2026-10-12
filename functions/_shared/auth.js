// Admin session: password login -> HMAC-signed cookie.
// Secrets: ADMIN_PASSWORD (what Dom types), ADMIN_SECRET (signs the cookie).
import { safeEqual } from "./email.js";

const COOKIE = "dbk_admin";
const TTL_S = 30 * 24 * 60 * 60; // 30 days; renewed on every visit to /admin (see functions/admin/index.js)
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function isAdmin(request, env) {
  if (!env.ADMIN_SECRET) return false;
  const raw = parseCookies(request)[COOKIE];
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(env.ADMIN_SECRET, `admin:${exp}`);
  return safeEqual(expected, sig);
}

export async function checkPassword(env, password) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SECRET || !password) return false;
  const a = await hmac(env.ADMIN_SECRET, String(password));
  const b = await hmac(env.ADMIN_SECRET, String(env.ADMIN_PASSWORD));
  return safeEqual(a, b);
}

export async function sessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  const sig = await hmac(env.ADMIN_SECRET, `admin:${exp}`);
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_S}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Mutating admin API calls must come from our own page: fetch() sets this header, plain forms cannot,
// and the browser blocks cross-site pages from setting it.
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  const self = new URL(request.url).origin;
  if (origin && origin !== self) return false;
  return request.headers.get("x-requested-with") === "fetch";
}
