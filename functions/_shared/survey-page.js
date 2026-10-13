// HTML shells for /admin/survey pages (list + capture app). The app itself is /assets/survey.js.

export const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
:root{--paper:#f6f5f1;--ink:#111;--muted:#6f6c66;--rule:#dedbd3;--ok:#1b7a3a;--part:#c27c00;--todo:#9a978f;--bad:#a12a2a;--accent:#1f4e9c;--sheet:#fff}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.45}
a{color:var(--ink)}button,input,select,textarea{font:inherit;color:inherit}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--ink);color:#fff;border:1px solid var(--ink);padding:9px 14px;border-radius:8px;font-weight:600;cursor:pointer;text-decoration:none;min-height:40px}
.btn.secondary{background:#fff;color:var(--ink);border-color:var(--rule)}.btn.on{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.small{padding:6px 10px;min-height:34px;font-size:13px}.btn.danger{background:#fff;color:var(--bad);border-color:#e6c4c4}
.login{max-width:380px;margin:10vh auto;background:#fff;border:1px solid var(--rule);border-radius:10px;padding:28px}
.login h1{font-size:18px;margin:0 0 14px}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:14px 0 5px;text-transform:uppercase;letter-spacing:.05em}
input,select,textarea{width:100%;padding:10px 11px;border:1px solid var(--rule);border-radius:8px;background:#fff;font-size:16px}
textarea{min-height:84px;resize:vertical}
.msg{padding:10px 12px;border-radius:8px;margin:0 0 14px}.msg.err{background:#f6e4e4;color:var(--bad)}
.muted{color:var(--muted)}.small{font-size:12.5px}
.list{max-width:760px;margin:0 auto;padding:18px 14px 60px}
.list h1{font-size:20px;margin:6px 0 14px}
.pcard{display:block;background:#fff;border:1px solid var(--rule);border-radius:10px;padding:16px;margin-bottom:12px;text-decoration:none}
.pcard h2{font-size:16px;margin:0 0 4px}.pcard .row{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:13px;color:var(--muted)}
.topnav{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-bottom:1px solid var(--rule)}
.topnav .brand{font-weight:600}.topnav .right{margin-left:auto;display:flex;gap:8px}
`;

export function page(inner, { title = "Surveys", app = false, appCss = "" } = {}) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" /><meta name="theme-color" content="#ffffff" />
<title>${esc(title)} · Survey · Dominic Bowkett</title>
<link rel="icon" href="/favicon.ico" sizes="any" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>${CSS}${appCss}</style></head><body>${inner}${app ? '<script src="/assets/survey.js?v=2" defer></script>' : ""}</body></html>`;
}

export function loginPage(url, env) {
  const failed = url.searchParams.get("failed");
  const notConfigured = !env.ADMIN_PASSWORD || !env.ADMIN_SECRET;
  return page(`<form class="login" method="post" action="/admin/login">
  <h1>Survey sign in</h1>
  ${notConfigured ? '<p class="msg err">ADMIN_PASSWORD / ADMIN_SECRET are not set on this Pages project yet.</p>' : ""}
  ${failed ? '<p class="msg err">Wrong password.</p>' : ""}
  <input type="hidden" name="next" value="${esc(url.pathname)}" />
  <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
  <p style="margin-top:16px"><button class="btn" type="submit">Sign in</button></p>
</form>`, { title: "Sign in" });
}
