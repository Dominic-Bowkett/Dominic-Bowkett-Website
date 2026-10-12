// GET /admin — login form or the invoicing admin app shell (the app itself is /assets/admin.js).
import { isAdmin, sessionCookie } from "../_shared/auth.js";

const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

const CSS = `
:root{--paper:#fafaf8;--ink:#0c0c0c;--muted:#7a7873;--rule:#e2dfd8;--ok:#1b6b33;--bad:#8a2a2a;--warn:#8a6a1a}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.5}
a{color:var(--ink)}button,input,select,textarea{font:inherit}
.login{max-width:380px;margin:12vh auto;background:#fff;border:1px solid var(--rule);border-radius:6px;padding:32px}
.login h1{font-size:18px;margin:0 0 16px}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.05em}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--rule);border-radius:4px;background:#fff}
textarea{min-height:64px}
.btn{display:inline-block;background:var(--ink);color:#fff;border:1px solid var(--ink);padding:9px 16px;border-radius:4px;font-weight:600;cursor:pointer;text-decoration:none}
.btn.secondary{background:#fff;color:var(--ink)}.btn.danger{background:#fff;color:var(--bad);border-color:var(--bad)}.btn:disabled{opacity:.5;cursor:default}
.btn.small{padding:5px 10px;font-size:13px}
header.bar{display:flex;align-items:center;gap:20px;padding:14px 24px;background:#fff;border-bottom:1px solid var(--rule);position:sticky;top:0;z-index:2}
header.bar .brand{font-weight:600}header.bar nav a{margin-right:14px;text-decoration:none;color:var(--muted);font-weight:500}header.bar nav a.on{color:var(--ink)}
header.bar .right{margin-left:auto;display:flex;gap:10px;align-items:center}
main{max-width:1100px;margin:0 auto;padding:24px 16px 80px}
.card{background:#fff;border:1px solid var(--rule);border-radius:6px;padding:20px;margin-bottom:20px}
h1{font-size:20px;margin:0 0 14px}h2{font-size:15px;margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 20px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--rule);vertical-align:top}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
tr.click{cursor:pointer}tr.click:hover{background:var(--paper)}td.num,th.num{text-align:right;white-space:nowrap}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:#eee;white-space:nowrap}
.badge.paid{background:#e4f3e8;color:var(--ok)}.badge.sent{background:#e8eef8;color:#2a4d8a}.badge.failed,.badge.void,.badge.refunded{background:#f6e4e4;color:var(--bad)}.badge.draft{background:#f0eeea;color:var(--muted)}
.muted{color:var(--muted)}.small{font-size:12px}.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:12px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.toolbar input,.toolbar select{width:auto}
.msg{padding:10px 12px;border-radius:4px;margin:0 0 14px}.msg.err{background:#f6e4e4;color:var(--bad)}.msg.ok{background:#e4f3e8;color:var(--ok)}.msg.warn{background:#fbf1d8;color:var(--warn)}
.totals{background:var(--paper);border:1px solid var(--rule);border-radius:4px;padding:12px 14px;margin-top:10px}
.totals div{display:flex;justify-content:space-between;padding:3px 0}.totals .big{font-weight:600;font-size:15px;border-top:1px solid var(--rule);margin-top:6px;padding-top:8px}
.timeline li{padding:6px 0;border-bottom:1px solid var(--rule);list-style:none}.timeline{padding:0;margin:0}
.kv{display:grid;grid-template-columns:160px 1fr;gap:4px 12px}.kv dt{color:var(--muted)}.kv dd{margin:0}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.check{display:flex;align-items:center;gap:8px;margin:10px 0}.check input{width:auto}
.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px}.hide-d{display:none}
@media (max-width:760px){.hide-d{display:inline}}
header.bar nav{display:flex;gap:2px;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;scrollbar-width:none}header.bar nav::-webkit-scrollbar{display:none}
@media (max-width:760px){
  body{font-size:15px}
  header.bar{padding:10px 12px;gap:10px;flex-wrap:wrap}header.bar .brand{font-size:15px}header.bar nav{order:3;flex-basis:100%;margin:0 -12px;padding:0 12px}header.bar nav a{margin-right:16px;padding:6px 0;display:inline-block}
  header.bar .right{margin-left:auto}header.bar .right .btn.small{padding:6px 9px;font-size:12px}
  main{padding:12px 10px 90px}.card{padding:14px 12px;margin-bottom:12px;border-radius:5px}
  h1{font-size:18px}h2{font-size:14px}
  .grid{grid-template-columns:1fr;gap:0}
  .kv{grid-template-columns:1fr;gap:2px 0}.kv dt{margin-top:8px}
  .hide-m{display:none!important}
  table{font-size:13px}th,td{padding:7px 5px}th{font-size:11px}td br+span.small{display:block}
  .toolbar{gap:8px}.toolbar input,.toolbar select{width:100%;flex:1 1 100%}.toolbar .btn{flex:1 1 auto;text-align:center}
  .actions{gap:8px}.actions .btn{flex:1 1 calc(50% - 8px);text-align:center;padding:11px 10px}.actions select{flex:1 1 100%;width:100%!important;max-width:100%}
  .badge{white-space:normal;line-height:1.3}td{word-break:break-word}td .mono{white-space:nowrap}
  select{max-width:100%}
  .totals{padding:10px 12px}.totals div{font-size:14px}
  .timeline li{font-size:13px}.timeline .mono{word-break:break-all}
  .login{margin:6vh 12px;padding:22px 18px}
  .msgform{grid-template-columns:1fr!important}
  input,select,textarea{font-size:16px}
}
`;

function shell(inner, { title = "Invoicing", app = false } = {}) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>${title} · Admin · Dominic Bowkett</title>
<link rel="icon" href="/favicon.ico" sizes="any" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
<style>${CSS}</style></head><body>${inner}${app ? '<script src="/assets/admin.js?v=14" defer></script>' : ""}</body></html>`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!(await isAdmin(request, env))) {
    const failed = url.searchParams.get("failed");
    const notConfigured = !env.ADMIN_PASSWORD || !env.ADMIN_SECRET;
    return new Response(
      shell(`<form class="login" method="post" action="/admin/login">
  <h1>Invoicing admin</h1>
  ${notConfigured ? '<p class="msg err">ADMIN_PASSWORD / ADMIN_SECRET are not set on this Pages project yet.</p>' : ""}
  ${failed ? '<p class="msg err">Wrong password.</p>' : ""}
  <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
  <p style="margin-top:16px"><button class="btn" type="submit">Sign in</button></p>
</form>`, { title: "Sign in" }),
      { status: 200, headers }
    );
  }
  // Sliding session: every visit issues a fresh 30-day cookie.
  const renewed = { ...headers, "Set-Cookie": await sessionCookie(env) };
  return new Response(
    shell(`<header class="bar"><span class="brand">Invoicing</span>
<nav><a href="#jobs" data-nav="jobs">Jobs</a><a href="#invoices" data-nav="invoices">Invoices</a><a href="#new" data-nav="new">New invoice</a><a href="#partners" data-nav="partners">Partners</a><a href="#setup" data-nav="setup">Setup</a></nav>
<div class="right"><a class="btn secondary small" href="/api/admin/export.csv">Export CSV</a><form method="post" action="/admin/logout"><button class="btn secondary small" type="submit">Sign out</button></form></div></header>
<main id="app"><p class="muted">Loading…</p></main>`, { app: true }),
    { status: 200, headers: renewed }
  );
}
