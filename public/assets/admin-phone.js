/* Calling from the jobs board: rings customers and partners from the office number through Twilio's Voice SDK
   (PC browser or the Jobs app), with a bar along the bottom while the call is on. The server keeps the number
   for each call, records both sides from the answer and puts the summary on the job (functions/_shared/voice.js).
   Used by admin.js through window.DBKPhone. */
(() => {
  const SDK = "/assets/vendor/twilio-voice-2.18.5.min.js";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const len = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const native = window.DBKApp || null;   // the Android app's bridge (speaker / keep the screen on)

  const P = { device: null, call: null, cur: null, phase: "idle", muted: false, speaker: false, timer: null };

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch("/api/admin/voice/" + path, {
      method, headers: { "x-requested-with": "fetch", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(data.error || "Request failed");
    return data;
  }
  function loadSdk() {
    if (window.Twilio && window.Twilio.Device) return Promise.resolve();
    return new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = SDK; s.onload = ok; s.onerror = () => bad(new Error("Could not load the phone"));
      document.head.appendChild(s);
    });
  }
  async function device() {
    if (P.device) return P.device;
    await loadSdk();
    const { token } = await api("token");
    const d = new window.Twilio.Device(token, { codecPreferences: ["opus", "pcmu"], closeProtection: "A call is still going on.", edge: ["dublin", "roaming"] });
    d.on("tokenWillExpire", () => api("token").then((r) => d.updateToken(r.token)).catch(() => {}));
    d.on("error", (e) => show(`Phone: ${(e && e.message) || "error"}`, true));
    P.device = d;
    return d;
  }

  /* ---------- the bar ---------- */
  function bar() {
    let b = document.getElementById("ph-bar");
    if (!b) { b = document.createElement("div"); b.id = "ph-bar"; document.body.appendChild(b); b.addEventListener("click", onBar); }
    return b;
  }
  function show(note, bad) { if (P.cur) { P.cur.note = note; P.cur.bad = !!bad; } render(); }
  function render() {
    const b = bar(), c = P.cur;
    if (!c) { b.className = ""; b.innerHTML = ""; document.body.classList.remove("ph-on"); return; }
    document.body.classList.add("ph-on");
    b.className = "on";
    const head = `<span class="ph-who"><strong>${esc(c.name)}</strong> · ${esc(c.nice)}${c.ref ? ` · <span class="muted">${esc(c.ref)}</span>` : ""}</span>`;
    let state, btns = "";
    if (P.phase === "connecting") state = "Connecting…";
    else if (P.phase === "ringing") state = "Ringing…";
    else if (P.phase === "live") state = `Connected <span id="ph-time">${len(Math.round((Date.now() - c.t0) / 1000))}</span>${c.test ? "" : " · recording"}`;
    else state = c.said || "Call ended";
    if (P.phase === "connecting" || P.phase === "ringing" || P.phase === "live") {
      btns = (P.phase === "live" ? `<button type="button" class="btn secondary small" data-ph="mute">${P.muted ? "Unmute" : "Mute"}</button>` : "") +
        (native && native.speaker ? `<button type="button" class="btn secondary small" data-ph="speaker">${P.speaker ? "Earpiece" : "Speaker"}</button>` : "") +
        (P.phase === "live" ? `<button type="button" class="btn secondary small" data-ph="keys">Keypad</button>` : "") +
        `<button type="button" class="btn small ph-end" data-ph="hang">Hang up</button>`;
    } else {
      btns = (c.jobId ? `<a class="btn secondary small" href="#job/${esc(c.jobId)}" data-ph="open">Open the job</a>` : "") +
        `<button type="button" class="btn small" data-ph="close">Done</button>`;
    }
    const keys = c.keys && P.phase === "live" ? `<div class="ph-keys">${"123456789*0#".split("").map((k) => `<button type="button" class="btn secondary small" data-key="${k}">${k}</button>`).join("")}</div>` : "";
    b.innerHTML = `<div class="ph-in">${head}<span class="ph-state">${state}</span><span class="ph-btns">${btns}</span></div>${keys}${c.note ? `<div class="ph-note${c.bad ? " bad" : ""}">${esc(c.note)}</div>` : ""}`;
  }
  function onBar(e) {
    const k = e.target.closest("[data-key]");
    if (k && P.call) { P.call.sendDigits(k.dataset.key); return; }
    const t = e.target.closest("[data-ph]");
    if (!t) return;
    const a = t.dataset.ph;
    if (a === "hang") { if (P.call) P.call.disconnect(); else ended("Cancelled"); }
    if (a === "mute" && P.call) { P.muted = !P.muted; P.call.mute(P.muted); render(); }
    if (a === "speaker" && native) { P.speaker = !P.speaker; try { native.speaker(P.speaker); } catch {} render(); }
    if (a === "keys" && P.cur) { P.cur.keys = !P.cur.keys; render(); }
    if (a === "close" || a === "open") { P.cur = null; render(); }
  }
  function tick() {
    clearInterval(P.timer);
    P.timer = setInterval(() => { const t = document.getElementById("ph-time"); if (t && P.cur && P.cur.t0) t.textContent = len(Math.round((Date.now() - P.cur.t0) / 1000)); }, 1000);
  }
  function ended(said) {
    clearInterval(P.timer);
    const c = P.cur;
    P.call = null; P.muted = false;
    if (native && native.keepAwake) try { native.keepAwake(false); } catch {}
    if (c) {
      const secs = c.t0 ? Math.round((Date.now() - c.t0) / 1000) : 0;
      c.said = said || (c.t0 ? `Call ended · ${len(secs)}` : "Not answered");
      if (!c.test && c.t0) c.note = "The recording is being transcribed; the summary goes on the job's timeline in a minute or so.";
    }
    P.phase = "ended";
    render();
    if (c && c.jobId) {
      /* the server's "no answer" lands at once, the summary a little later */
      const tell = () => window.dispatchEvent(new CustomEvent("dbk-call", { detail: { jobId: c.jobId } }));
      setTimeout(tell, 1500); setTimeout(tell, 30000); setTimeout(tell, 75000);
    }
  }
  function wire(call) {
    P.call = call;
    P.phase = "ringing"; render();
    call.on("accept", () => {
      P.phase = "live"; P.cur.t0 = Date.now(); tick(); render();
      if (native && native.speaker) try { native.speaker(P.speaker); } catch {}   // the app starts on the earpiece
    });
    call.on("disconnect", () => ended());
    call.on("cancel", () => ended("Cancelled"));
    call.on("reject", () => ended("Rejected"));
    call.on("error", (e) => { show(micHint(e), true); ended("Call failed"); });
  }
  function busyNow() { return P.phase === "connecting" || P.phase === "ringing" || P.phase === "live"; }

  /* ring the customer (who = "customer") or the partner (who = "partner") of a job */
  async function call(jobId, who) {
    if (busyNow()) { show("Finish the call that is on first.", true); return; }
    P.cur = { jobId, name: "…", nice: "", ref: "" }; P.phase = "connecting"; P.speaker = false; render();
    try {
      const d = await device();
      const s = await api("start", { method: "POST", body: { job_id: jobId, who } });
      Object.assign(P.cur, { mid: s.mid, name: s.name, nice: s.number.replace(/^\+44/, "0").replace(/^(\d{5})(\d+)$/, "$1 $2"), ref: s.job_ref });
      render();
      if (P.phase !== "connecting") return;   // hung up while it was still connecting
      if (native && native.keepAwake) try { native.keepAwake(true); } catch {}
      const c = await d.connect({ params: { mid: String(s.mid) } });
      if (P.phase !== "connecting") { c.disconnect(); return; }
      wire(c);
    } catch (e) {
      if (P.cur && P.cur.mid && !P.call) api("cancel", { method: "POST", body: { mid: P.cur.mid } }).catch(() => {});
      P.phase = "ended"; P.cur.said = "Not rung"; show(micHint(e), true);
    }
  }
  const micHint = (e) => /permission|notallowed|31402|31208|getUserMedia|microphone/i.test(`${e && e.name} ${e && e.message} ${e && e.code}`)
    ? "The microphone is blocked. Allow it for this site (the padlock by the address, or the app's permissions) and try again." : (e && e.message) || "Could not ring";
  /* ring Dom's own mobile, to check sound and microphone (not recorded or logged) */
  async function test() {
    if (busyNow()) return;
    P.cur = { test: true, name: "Test call", nice: "your mobile", ref: "" }; P.phase = "connecting"; render();
    try { const d = await device(); wire(await d.connect({ params: { mid: "test" } })); }
    catch (e) { P.phase = "ended"; P.cur.said = "Not rung"; show(micHint(e), true); }
  }
  async function status() { return api("status"); }
  async function setup() { return api("setup", { method: "POST", body: {} }); }

  window.DBKPhone = { call, test, status, setup, busy: busyNow };
})();
