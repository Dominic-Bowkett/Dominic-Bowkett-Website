// Partner portal accounts: password hashing (PBKDF2), invite/reset tokens and the session cookie.
import { db, randomToken } from "./db.js";
import { safeEqual } from "./email.js";

const COOKIE = "dbk_partner";
const TTL_S = 7 * 24 * 60 * 60; // a week
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function pbkdf2(password, saltHex, iterations = 100000) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return hex(bits);
}

export async function hashPassword(password) {
  const salt = randomToken(16);
  return { salt, hash: await pbkdf2(password, salt) };
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  return safeEqual(await pbkdf2(password, salt), hash);
}

export function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}

// ---- session cookie: id.exp.sig

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export async function partnerSessionCookie(env, user) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  const sig = await hmac(env.ADMIN_SECRET, `partner:${user.id}:${exp}:${user.password_hash}`);
  return `${COOKIE}=${user.id}.${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_S}`;
}

export function clearPartnerCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Returns the partner_users row (joined with the partner) for a valid session, else null.
export async function currentPartnerUser(request, env) {
  if (!env.ADMIN_SECRET) return null;
  const m = /(?:^|;\s*)dbk_partner=([^;]+)/.exec(request.headers.get("cookie") || "");
  if (!m) return null;
  const [id, exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const user = await getPartnerUser(env, id);
  if (!user || user.disabled) return null;
  // The hash is part of the signature so a password change logs every other session out.
  const expected = await hmac(env.ADMIN_SECRET, `partner:${user.id}:${exp}:${user.password_hash}`);
  return safeEqual(expected, sig) ? user : null;
}

export async function getPartnerUser(env, id) {
  const d = await db(env);
  return d
    .prepare(
      `SELECT u.*, p.display_name, p.business_name, p.vat_number, p.address AS partner_address, p.charges_enabled
       FROM partner_users u JOIN partners p ON p.stripe_account_id = u.stripe_account_id WHERE u.id = ?`
    )
    .bind(id)
    .first();
}

export async function getPartnerUserByEmail(env, email) {
  const d = await db(env);
  return d.prepare(`SELECT * FROM partner_users WHERE email = ?`).bind(String(email || "").trim().toLowerCase()).first();
}

export async function getPartnerUserByToken(env, token) {
  if (!token) return null;
  const d = await db(env);
  const u = await d.prepare(`SELECT * FROM partner_users WHERE invite_token = ?`).bind(token).first();
  if (!u || !u.invite_expires || new Date(u.invite_expires) < new Date()) return null;
  return u;
}

// Create (or refresh) the invite token for a partner's user; returns the token.
export async function issueInvite(env, user, hours = 72) {
  const d = await db(env);
  const token = randomToken(24);
  const expires = new Date(Date.now() + hours * 3600000).toISOString();
  await d.prepare(`UPDATE partner_users SET invite_token = ?, invite_expires = ?, updated_at = datetime('now') WHERE id = ?`).bind(token, expires, user.id).run();
  return token;
}

export async function setPassword(env, user, password) {
  const d = await db(env);
  const { salt, hash } = await hashPassword(password);
  await d
    .prepare(`UPDATE partner_users SET password_salt = ?, password_hash = ?, invite_token = NULL, invite_expires = NULL, activated_at = COALESCE(activated_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`)
    .bind(salt, hash, user.id)
    .run();
  return getPartnerUser(env, user.id);
}

export async function touchLogin(env, user) {
  const d = await db(env);
  await d.prepare(`UPDATE partner_users SET last_login_at = datetime('now') WHERE id = ?`).bind(user.id).run();
}
