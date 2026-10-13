// GET /admin/survey/:id — the on-site capture app for one property (plan, tap points, autosave). App: /assets/survey.js.
import { isAdmin, sessionCookie } from "../../_shared/auth.js";
import { REF_RE } from "../../_shared/survey.js";
import { headers, esc, page, loginPage } from "../../_shared/survey-page.js";

const APP_CSS = `
html,body{overflow:hidden;overscroll-behavior:none}
#survey{position:fixed;inset:0;display:flex;flex-direction:column}
.sv-top{display:flex;align-items:center;gap:10px;padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top));background:#fff;border-bottom:1px solid var(--rule)}
.sv-back{font-size:24px;line-height:1;text-decoration:none;padding:4px 8px 6px;border-radius:8px}
.sv-title{min-width:0;flex:1;display:flex;flex-direction:column}.sv-title b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sv-title span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill{font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;background:#e9f4ec;color:var(--ok);white-space:nowrap}
.pill.saving{background:#eef2fa;color:var(--accent)}.pill.queued{background:#fbf1d8;color:#8a5a00}.pill.error{background:#f6e4e4;color:var(--bad)}
.sv-bar{display:flex;gap:8px;align-items:center;padding:8px 10px;background:#fff;border-bottom:1px solid var(--rule);overflow-x:auto;scrollbar-width:none}
.sv-bar::-webkit-scrollbar{display:none}
.seg{display:flex;border:1px solid var(--rule);border-radius:9px;overflow:hidden;flex:none}
.seg button{border:0;background:#fff;padding:8px 12px;font-weight:600;font-size:13.5px;white-space:nowrap}.seg button.on{background:var(--ink);color:#fff}
.sv-tools{display:flex;gap:6px;flex:none;margin-left:auto}
#sv-stage{position:relative;flex:1;min-height:0;background:#eceae4}
#sv-plan{position:absolute;inset:0;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none}
#sv-hint{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 14px;border-radius:999px;font-size:13.5px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.18);display:none;white-space:nowrap}
#sv-legend{position:absolute;left:8px;bottom:8px;background:rgba(255,255,255,.92);border:1px solid var(--rule);border-radius:8px;padding:6px 9px;font-size:11.5px;display:flex;gap:10px;flex-wrap:wrap;max-width:calc(100% - 16px)}
#sv-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.room{stroke:#2b2b2b;stroke-width:1.6;stroke-linejoin:round}
.room.hit{stroke:var(--accent);stroke-width:3}
.outline{fill:#fff;stroke:#a9a59b;stroke-width:1;stroke-dasharray:5 4}
.rlabel{font-size:12px;font-weight:600;fill:#222;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
.rsub{font-size:10.5px;fill:#555;paint-order:stroke;stroke:#fff;stroke-width:3px}
.rmeas{font-size:10.5px;fill:var(--ok);font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:3px}
.mk-label{font-size:10.5px;font-weight:700;fill:#fff;pointer-events:none}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:64vh;background:var(--sheet);border-radius:16px 16px 0 0;box-shadow:0 -6px 28px rgba(0,0,0,.2);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 16px calc(24px + env(safe-area-inset-bottom));z-index:10}
.sheet .grab{width:44px;height:5px;border-radius:3px;background:#d4d1ca;margin:4px auto 8px}
.sheet h2{font-size:17px;margin:2px 0 2px;padding-right:40px}.sheet .sub{color:var(--muted);font-size:13px;margin-bottom:6px}
.sheet .x{position:absolute;right:10px;top:10px;border:0;background:#f0eee9;border-radius:50%;width:34px;height:34px;font-size:18px;line-height:1}
@media (min-width:900px){.sheet{left:auto;top:0;width:430px;max-height:none;border-radius:0;box-shadow:-6px 0 28px rgba(0,0,0,.15);padding-top:12px}.sheet .grab{display:none}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--rule);background:#fff;border-radius:999px;padding:7px 12px;font-size:14px}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.hintbox{background:#f6f5f1;border-radius:8px;padding:8px 10px;font-size:13px;color:#444;margin:8px 0}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;margin-top:8px}
.ph{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#eee}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.ph .del{position:absolute;right:4px;top:4px;border:0;background:rgba(0,0,0,.6);color:#fff;border-radius:50%;width:26px;height:26px;font-size:14px}
.ph .wait{position:absolute;left:0;right:0;bottom:0;background:rgba(194,124,0,.9);color:#fff;font-size:11px;text-align:center;padding:2px}
.addphoto{display:flex;gap:8px;margin-top:10px}
.addphoto label{margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:#fff}
.toggle{display:flex;align-items:center;gap:10px;margin:14px 0;font-size:14.5px;text-transform:none;letter-spacing:0;color:var(--ink);font-weight:500}.toggle input{width:22px;height:22px}
.prog h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 6px}
.prow{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #eeece6;cursor:pointer}
.prow .dot{width:12px;height:12px;border-radius:50%;flex:none;background:var(--todo)}
.prow .dot.part{background:var(--part)}.prow .dot.done{background:var(--ok)}.prow .dot.absent{background:var(--bad)}
.prow .t{flex:1;min-width:0}.prow .t small{display:block;color:var(--muted)}
.bar{height:8px;background:#e7e4dd;border-radius:4px;overflow:hidden;margin:4px 0 2px}.bar i{display:block;height:100%;background:var(--ok)}
`;

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  if (!(await isAdmin(request, env))) return new Response(loginPage(url, env), { status: 200, headers });
  const id = String(params.id || "");
  if (!REF_RE.test(id)) return new Response("Not found", { status: 404 });
  const html = page(`<div id="survey" data-id="${esc(id)}">
<header class="sv-top"><a class="sv-back" href="/admin/survey" aria-label="All surveys">&#8249;</a>
<div class="sv-title"><b id="sv-name">Loading…</b><span class="muted small" id="sv-visit"></span></div>
<span id="sv-status" class="pill">Loading</span></header>
<div class="sv-bar"><div id="sv-floors" class="seg"></div>
<div class="sv-tools"><button class="btn secondary small" id="sv-pin" type="button">+ Pin</button><button class="btn secondary small" id="sv-addwin" type="button">+ Window</button><button class="btn secondary small" id="sv-progress" type="button">Progress</button><button class="btn secondary small" id="sv-fit" type="button">Fit</button></div></div>
<div id="sv-stage"><svg id="sv-plan" xmlns="http://www.w3.org/2000/svg"></svg><div id="sv-hint"></div>
<div id="sv-legend"><span><i style="background:#9a978f"></i>to do</span><span><i style="background:#c27c00"></i>started</span><span><i style="background:#1b7a3a"></i>done</span><span><i style="background:#1f4e9c"></i>pin</span></div></div>
<aside id="sv-sheet" class="sheet" hidden></aside>
</div>`, { title: "Survey", app: true, appCss: APP_CSS });
  return new Response(html, { status: 200, headers: { ...headers, "Set-Cookie": await sessionCookie(env) } });
}
