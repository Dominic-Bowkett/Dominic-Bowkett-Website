/* On-site survey capture: plan with tappable windows, doors, rooms and evidence pins; autosave; photos to R2.
   Works offline: edits queue in localStorage, photos queue in IndexedDB, both flush when the connection returns. */
(() => {
  "use strict";
  const root = document.getElementById("survey");
  if (!root) return;
  const PID = root.dataset.id;
  const API = `/api/survey/properties/${encodeURIComponent(PID)}`;
  const QKEY = `dbk-survey-queue:${PID}`;
  const $ = (id) => document.getElementById(id);
  const svg = $("sv-plan"), stage = $("sv-stage"), sheet = $("sv-sheet"), statusEl = $("sv-status"), hintEl = $("sv-hint");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const COL = { todo: "#9a978f", part: "#c27c00", done: "#1b7a3a", absent: "#a12a2a", pin: "#1f4e9c" };
  const ROOMFILL = { todo: "#fbf8f0", part: "#fbefd6", done: "#e2f1e5" };

  // ---------- state ----------
  let plan = null, floorKey = null, selected = null, addMode = null, authLost = false, online = navigator.onLine;
  const records = new Map();   // ref -> {ref, kind, floor, x, y, data, deleted, client_ts}
  const photos = new Map();    // ref -> [server photo]
  const pending = new Map();   // ref -> [{id, blob, url, type, name, failed}]
  let queue = {};              // ref -> payload waiting for the server
  try { queue = JSON.parse(localStorage.getItem(QKEY) || "{}") || {}; } catch { queue = {}; }
  const view = { s: 30, tx: 0, ty: 0 };
  let hits = [];               // screen-space tap targets from the last render

  // ---------- helpers ----------
  const roomRef = (fk, key) => `room-${fk}-${key}`;
  const floorOf = (k) => plan.floors.find((f) => f.key === k);
  const curFloor = () => floorOf(floorKey);
  const centroid = (p) => { let A = 0, cx = 0, cy = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; const c = x1 * y2 - x2 * y1; A += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; } return A ? [cx / (3 * A), cy / (3 * A)] : p[0]; };
  const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const bbox = (pts) => ({ x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) });
  const hasData = (d) => Object.keys(d || {}).some((k) => d[k] !== "" && d[k] != null && d[k] !== false);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).toLowerCase();
  const compass8 = (b) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((b % 360) + 360) % 360) / 45) % 8];
  const compass16 = (b) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round((((b % 360) + 360) % 360) / 22.5) % 16];

  // every tappable thing: seeded items, rooms, checklist rows, and pins added on site
  function entity(ref) {
    const it = plan.items.find((i) => i.ref === ref);
    if (it) return { ...it, seeded: true };
    for (const f of plan.floors) for (const r of f.rooms) if (roomRef(f.key, r.key) === ref) return { ref, kind: "room", floor: f.key, room: r.key, label: r.name, roomObj: r, seeded: true };
    const c = (plan.checklist || []).find((i) => i.ref === ref);
    if (c) return { ...c, kind: "check", seeded: true };
    const rec = records.get(ref);
    if (rec) return { ref, kind: rec.kind, floor: rec.floor, x: rec.x, y: rec.y, room: rec.data.room, label: rec.data.title || (rec.kind === "window" ? "+W" : rec.kind === "door" ? "+D" : "Evidence"), seeded: false, category: rec.data.category };
    return null;
  }
  const posOf = (e) => { const r = records.get(e.ref); return r && r.x != null && r.y != null ? [r.x, r.y] : [e.x, e.y]; };
  const nPhotos = (ref) => (photos.get(ref) || []).length + (pending.get(ref) || []).length;
  function status(ref, kind) {
    const r = records.get(ref); const d = r && !r.deleted ? r.data : {}; const np = nPhotos(ref);
    if (d.absent) return "absent";
    if (kind === "window" || kind === "door") return d.width_mm && d.height_mm ? "done" : hasData(d) || np ? "part" : "todo";
    if (kind === "room") return d.length_m && d.width_m ? "done" : hasData(d) || np ? "part" : "todo";
    return np || (d.notes && String(d.notes).trim()) || d.state ? "done" : hasData(d) ? "part" : "todo";
  }
  function sitePins() {   // records created on site (not in the plan)
    const seeded = new Set(plan.items.map((i) => i.ref));
    return [...records.values()].filter((r) => !r.deleted && r.ref.startsWith("pin-") && !seeded.has(r.ref));
  }
  function floorItems(fk) {
    const out = plan.items.filter((i) => i.floor === fk).map((i) => ({ ...i, seeded: true }));
    for (const r of sitePins()) if (r.floor === fk) out.push(entity(r.ref));
    return out;
  }
  function facing(e) {   // outward bearing of the wall a window/door sits on
    const f = floorOf(e.floor); if (!f || e.angle == null || f.orient === false) return "";
    const room = f.rooms.find((r) => r.key === e.room); const [x, y] = [e.x, e.y];
    const a = (e.angle * Math.PI) / 180; let nx = Math.sin(a), ny = -Math.cos(a);   // right-hand normal
    if (room && inPoly(x + nx * 0.4, y + ny * 0.4, room.poly)) { nx = -nx; ny = -ny; }
    const pageAng = (Math.atan2(ny, nx) * 180) / Math.PI; const xb = 90 - (plan.north_cw || 0);
    return compass16(xb - pageAng);
  }

  // ---------- saving ----------
  function persistQueue() { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch {} }
  function ensureRec(ref) {
    let r = records.get(ref);
    if (!r) {
      const e = entity(ref) || {};
      r = { ref, kind: e.kind, floor: e.floor || null, x: e.x ?? null, y: e.y ?? null, data: {}, deleted: false, client_ts: 0 };
      records.set(ref, r);
    }
    return r;
  }
  function touch(r) {
    r.client_ts = Date.now();
    queue[r.ref] = { kind: r.kind, floor: r.floor, x: r.x, y: r.y, data: r.data, deleted: !!r.deleted, client_ts: r.client_ts };
    persistQueue(); scheduleFlush(); updateStatus();
  }
  function setField(ref, k, v) {
    const r = ensureRec(ref);
    if (v === "" || v === null || v === undefined || v === false) delete r.data[k]; else r.data[k] = v;
    touch(r); render();
  }
  let flushTimer = null, flushing = false;
  function scheduleFlush(ms = 700) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
  async function flush() {
    if (flushing || authLost) return;
    const refs = Object.keys(queue); if (!refs.length) { updateStatus(); return; }
    flushing = true; updateStatus(true);
    try {
      for (const ref of refs) {
        const body = queue[ref];
        const res = await fetch(`${API}/records/${encodeURIComponent(ref)}`, { method: "PUT", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify(body) });
        if (res.status === 401) { authLost = true; break; }
        if (!res.ok) { console.warn("save failed", ref, res.status); continue; }
        if (queue[ref] && queue[ref].client_ts === body.client_ts) delete queue[ref];
        online = true;
      }
    } catch (e) {
      online = false;
    } finally {
      flushing = false; persistQueue(); updateStatus();
      if (Object.keys(queue).length && !authLost) scheduleFlush(online ? 3000 : 8000);
    }
  }
  function updateStatus(busy) {
    const nq = Object.keys(queue).length, np = [...pending.values()].reduce((s, a) => s + a.length, 0);
    let cls = "", text = "All saved";
    if (authLost) { cls = "error"; text = "Signed out: tap"; }
    else if (nq || np) { if (!online) { cls = "queued"; text = `Offline · ${nq + np} waiting`; } else { cls = "saving"; text = busy || nq ? "Saving…" : `Uploading ${np}`; } }
    statusEl.className = `pill ${cls}`; statusEl.textContent = text;
  }
  statusEl.addEventListener("click", () => { if (authLost) location.reload(); else { scheduleFlush(0); retryPhotos(); } });
  window.addEventListener("online", () => { online = true; scheduleFlush(0); retryPhotos(); });
  window.addEventListener("offline", () => { online = false; updateStatus(); });
  window.addEventListener("beforeunload", (e) => { if (Object.keys(queue).length || [...pending.values()].some((a) => a.length)) { persistQueue(); e.preventDefault(); e.returnValue = ""; } });

  // ---------- photos (IndexedDB queue) ----------
  let idbP = null;
  const idb = () => idbP || (idbP = new Promise((res, rej) => { const r = indexedDB.open("dbk-survey", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const idbDo = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction("photos", mode); const st = t.objectStore("photos"); const req = fn(st); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
  const idbPut = (o) => idbDo("readwrite", (s) => s.put(o)).catch(() => null);
  const idbDel = (id) => idbDo("readwrite", (s) => s.delete(id)).catch(() => null);
  const idbAll = () => idbDo("readonly", (s) => s.getAll()).catch(() => []);
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type || "")) return file;
    try {
      let src;
      try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch { src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = URL.createObjectURL(file); }); }
      const w = src.width, h = src.height, sc = Math.min(1, 2560 / Math.max(w, h));
      if (sc === 1 && file.size < 2.5e6) return file;
      const c = document.createElement("canvas"); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.86));
      return b && b.size ? b : file;
    } catch { return file; }
  }
  async function addPhotos(ref, files) {
    const r = ensureRec(ref); if (!records.get(ref).client_ts) touch(r);   // make sure the record (pin position etc.) exists too
    for (const file of files) {
      const blob = await shrink(file);
      const o = { id: uid(), pid: PID, ref, blob, type: blob.type || file.type || "image/jpeg", name: file.name || "photo.jpg", ts: Date.now() };
      await idbPut(o);
      o.url = URL.createObjectURL(blob);
      if (!pending.has(ref)) pending.set(ref, []);
      pending.get(ref).push(o);
      upload(o);
    }
    refreshSheetPhotos(ref); render(); updateStatus();
  }
  async function upload(o) {
    if (o.busy || authLost) return; o.busy = true; updateStatus(true);
    try {
      const res = await fetch(`${API}/records/${encodeURIComponent(o.ref)}/photos`, { method: "POST", headers: { "content-type": o.type, "x-photo-id": o.id, "x-file-name": o.name, "x-requested-with": "fetch" }, body: o.blob });
      if (res.status === 401) { authLost = true; return; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { o.failed = j.error || `HTTP ${res.status}`; return; }
      online = true; o.failed = null;
      if (!photos.has(o.ref)) photos.set(o.ref, []);
      if (!photos.get(o.ref).some((p) => p.id === j.photo.id)) photos.get(o.ref).push(j.photo);
      pending.set(o.ref, (pending.get(o.ref) || []).filter((p) => p.id !== o.id));
      await idbDel(o.id); URL.revokeObjectURL(o.url);
      refreshSheetPhotos(o.ref); render();
    } catch { online = false; }
    finally { o.busy = false; updateStatus(); }
  }
  function retryPhotos() { for (const arr of pending.values()) for (const o of arr) upload(o); }
  setInterval(() => { if ([...pending.values()].some((a) => a.length)) retryPhotos(); if (Object.keys(queue).length) scheduleFlush(0); }, 20000);
  async function deletePhoto(ref, id) {
    if (!confirm("Remove this photo from the survey?")) return;
    const pend = (pending.get(ref) || []).find((p) => p.id === id);
    if (pend) { pending.set(ref, pending.get(ref).filter((p) => p.id !== id)); await idbDel(id); refreshSheetPhotos(ref); render(); updateStatus(); return; }
    try {
      const res = await fetch(`${API}/photos/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-requested-with": "fetch" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      photos.set(ref, (photos.get(ref) || []).filter((p) => p.id !== id)); refreshSheetPhotos(ref); render();
    } catch (e) { alert("Could not remove the photo (no connection?). Try again later."); }
  }

  // ---------- view / render ----------
  function fit() {
    const f = curFloor(); if (!f) return;
    const pts = [...(f.outline || []), ...f.rooms.flatMap((r) => r.poly)];
    const b = bbox(pts), W = stage.clientWidth, H = stage.clientHeight, pad = 28;
    view.s = Math.min((W - 2 * pad) / Math.max(1, b.x1 - b.x0), (H - 2 * pad - 30) / Math.max(1, b.y1 - b.y0));
    view.tx = W / 2 - ((b.x0 + b.x1) / 2) * view.s; view.ty = (H - 30) / 2 + ((b.y0 + b.y1) / 2) * view.s;
    render();
  }
  const S = ([x, y]) => [view.tx + x * view.s, view.ty - y * view.s];
  const W2 = (sx, sy) => [(sx - view.tx) / view.s, (view.ty - sy) / view.s];
  const P = (pts) => pts.map((p) => S(p).map((v) => v.toFixed(1)).join(",")).join(" ");
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    const f = curFloor(); if (!f) return;
    const W = stage.clientWidth, H = stage.clientHeight; svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let h = ""; hits = [];
    if (f.outline) h += `<polygon class="outline" points="${P(f.outline)}"/>`;
    for (const r of f.rooms) {
      const ref = roomRef(f.key, r.key), st = status(ref, "room");
      h += `<polygon class="room${selected === ref ? " hit" : ""}" fill="${ROOMFILL[st] || ROOMFILL.todo}" points="${P(r.poly)}"/>`;
    }
    for (const r of f.rooms) {
      const ref = roomRef(f.key, r.key), b = bbox(r.poly.map(S)), wpx = b.x1 - b.x0, hpx = b.y1 - b.y0;
      if (Math.min(wpx, hpx) < 34) continue;
      const [cx, cy] = S(centroid(r.poly)); const d = (records.get(ref) || {}).data || {};
      const name = r.name.replace(/\s*\(.*\)\s*$/, ""); const maxCh = Math.max(4, Math.floor(wpx / 7));
      h += `<text class="rlabel" x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" text-anchor="middle">${esc(name.length > maxCh ? name.slice(0, maxCh - 1) + "…" : name)}</text>`;
      if (d.length_m && d.width_m) h += `<text class="rmeas" x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}" text-anchor="middle">${esc(d.length_m)} × ${esc(d.width_m)} m</text>`;
      else if (r.listing && hpx > 50) h += `<text class="rsub" x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}" text-anchor="middle">${esc(r.listing)}</text>`;
    }
    const compact = view.s < 17;   // zoomed out: dots instead of labelled pills (the whole house on a phone is ~8 px/m)
    for (const e of floorItems(f.key)) {
      const [x, y] = posOf(e), [sx, sy] = S([x, y]), st = status(e.ref, e.kind), sel = selected === e.ref;
      const moved = ((records.get(e.ref) || {}).data || {}).moved;
      if (compact) {
        const isPin = !(e.kind === "window" || e.kind === "door"), c = isPin ? (st === "done" ? COL.done : COL.pin) : COL[st];
        h += e.kind === "door" ? `<rect x="${(sx - 5).toFixed(1)}" y="${(sy - 5).toFixed(1)}" width="10" height="10" fill="${c}" stroke="${sel ? "#1f4e9c" : "#fff"}" stroke-width="${sel ? 3 : 1.5}"/>`
          : `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${isPin ? 6 : 5}" fill="${c}" stroke="${sel ? "#1f4e9c" : "#fff"}" stroke-width="${sel ? 3 : 1.5}"/>`;
        hits.push({ ref: e.ref, x: sx, y: sy, r: 13 });
        continue;
      }
      if (e.kind === "window" || e.kind === "door") {
        if (e.angle != null && !moved) {
          const len = Math.max(14, (e.kind === "door" ? 0.9 : 1.1) * view.s) / 2, a = (-e.angle * Math.PI) / 180;
          h += `<line x1="${(sx - Math.cos(a) * len).toFixed(1)}" y1="${(sy - Math.sin(a) * len).toFixed(1)}" x2="${(sx + Math.cos(a) * len).toFixed(1)}" y2="${(sy + Math.sin(a) * len).toFixed(1)}" stroke="${COL[st]}" stroke-width="6" stroke-linecap="butt"${st === "absent" ? ' stroke-dasharray="3 3"' : ""}/>`;
        }
        const lab = e.label || (e.kind === "door" ? "D" : "W"), w = 10 + lab.length * 7;
        h += `<rect x="${(sx - w / 2).toFixed(1)}" y="${(sy - 9).toFixed(1)}" width="${w}" height="18" rx="${e.kind === "door" ? 3 : 9}" fill="${COL[st]}" stroke="${sel ? "#1f4e9c" : "#fff"}" stroke-width="${sel ? 3 : 1.5}"/>`;
        h += `<text class="mk-label" x="${sx.toFixed(1)}" y="${(sy + 4).toFixed(1)}" text-anchor="middle">${esc(lab)}</text>`;
        hits.push({ ref: e.ref, x: sx, y: sy, r: Math.max(16, w / 2 + 4) });
      } else {
        const done = st === "done";
        h += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="11" fill="${done ? COL.done : COL.pin}" stroke="${sel ? "#111" : "#fff"}" stroke-width="${sel ? 3 : 2}"/>`;
        h += `<text class="mk-label" x="${sx.toFixed(1)}" y="${(sy + 4).toFixed(1)}" text-anchor="middle">${done ? "✓" : "i"}</text>`;
        if (view.s > 22) h += `<text class="rsub" x="${sx.toFixed(1)}" y="${(sy + 24).toFixed(1)}" text-anchor="middle">${esc((e.label || "").slice(0, 26))}</text>`;
        hits.push({ ref: e.ref, x: sx, y: sy, r: 18 });
      }
    }
    // north arrow + scale bar (screen-fixed)
    const nx = W - 30, ny = 36;
    if (f.orient !== false) h += `<g transform="translate(${nx},${ny}) rotate(${plan.north_cw || 0})"><circle r="18" fill="rgba(255,255,255,.9)" stroke="#bbb"/><polygon points="0,-14 -6,4 0,0 6,4" fill="#111"/><text y="-20" text-anchor="middle" font-size="11" font-weight="700">N</text></g>`;
    const steps = [1, 2, 5, 10, 20]; const m = steps.find((v) => v * view.s >= 70) || 20; const bw = m * view.s;
    h += `<g transform="translate(${W - bw - 14},${H - 22})"><rect x="-6" y="-16" width="${bw + 12}" height="24" rx="5" fill="rgba(255,255,255,.88)"/><line x1="0" y1="0" x2="${bw}" y2="0" stroke="#111" stroke-width="3"/><text x="${bw / 2}" y="-5" text-anchor="middle" font-size="11">${m} m</text></g>`;
    if (f.note) {   // wrap the floor note into lines that fit the stage width
      const maxCh = Math.max(20, Math.floor((W - (f.orient !== false ? 70 : 20)) / 6)); const words = f.note.split(" "); const lines = []; let cur = "";
      for (const w of words) { if ((cur + " " + w).trim().length > maxCh) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
      if (cur) lines.push(cur);
      lines.slice(0, 3).forEach((ln, i) => { h += `<text x="10" y="${18 + i * 14}" font-size="11" fill="#6f6c66">${esc(ln)}</text>`; });
    }
    svg.innerHTML = h;
  }

  // ---------- gestures ----------
  const ptrs = new Map(); let g = null;
  const local = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, local(e));
    if (ptrs.size === 1) { const p = local(e); g = { type: "tap", x0: p.x, y0: p.y, tx: view.tx, ty: view.ty }; }
    else if (ptrs.size === 2) startPinch();
  });
  function startPinch() { const [a, b] = [...ptrs.values()]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; g = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: view.s, w: W2(mid.x, mid.y) }; }
  svg.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId) || !g) return; ptrs.set(e.pointerId, local(e));
    if (g.type === "pinch" && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.s = clamp((g.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, 4, 400);
      view.tx = mid.x - g.w[0] * view.s; view.ty = mid.y + g.w[1] * view.s; render(); return;
    }
    const p = local(e);
    if (g.type === "tap" && Math.hypot(p.x - g.x0, p.y - g.y0) > 7) g.type = "pan";
    if (g.type === "pan") { view.tx = g.tx + (p.x - g.x0); view.ty = g.ty + (p.y - g.y0); render(); }
  });
  const endPtr = (e) => {
    const wasTap = g && g.type === "tap" && ptrs.size === 1; const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (wasTap && e.type === "pointerup" && p) onTap(p.x, p.y);
    if (ptrs.size === 1) { const q = [...ptrs.values()][0]; g = { type: "pan", x0: q.x, y0: q.y, tx: view.tx, ty: view.ty }; }
    else if (!ptrs.size) g = null;
  };
  svg.addEventListener("pointerup", endPtr); svg.addEventListener("pointercancel", endPtr);
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const p = local(e); const w = W2(p.x, p.y); view.s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), 4, 400); view.tx = p.x - w[0] * view.s; view.ty = p.y + w[1] * view.s; render(); }, { passive: false });
  window.addEventListener("resize", render);

  function onTap(sx, sy) {
    const [wx, wy] = W2(sx, sy);
    if (addMode) {
      const mode = addMode; setAddMode(null);
      if (mode.type === "move") { const r = ensureRec(mode.ref); r.x = +wx.toFixed(3); r.y = +wy.toFixed(3); r.data.moved = true; touch(r); select(mode.ref); return; }
      const ref = `pin-${floorKey}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const r = { ref, kind: mode.type, floor: floorKey, x: +wx.toFixed(3), y: +wy.toFixed(3), data: {}, deleted: false, client_ts: 0 };
      const rm = curFloor().rooms.find((q) => inPoly(wx, wy, q.poly)); if (rm) r.data.room = rm.key;
      records.set(ref, r); touch(r); select(ref); return;
    }
    let best = null;
    for (const t of hits) { const d = Math.hypot(t.x - sx, t.y - sy); if (d <= t.r && (!best || d < best.d)) best = { ref: t.ref, d }; }
    if (best) { select(best.ref); return; }
    const rm = curFloor().rooms.find((r) => inPoly(wx, wy, r.poly));
    if (rm) { select(roomRef(floorKey, rm.key)); return; }
    closeSheet();
  }
  function setAddMode(m) {
    if (m && !sheet.hidden) closeSheet();   // the plan must be visible to tap the spot
    addMode = m;
    for (const [id, t] of [["sv-pin", "evidence"], ["sv-addwin", "window"]]) $(id).classList.toggle("on", !!m && m.type === t);
    hintEl.style.display = m ? "block" : "none";
    hintEl.textContent = !m ? "" : m.type === "move" ? "Tap the new position" : m.type === "evidence" ? "Tap where the evidence is" : "Tap where the window is";
  }
  $("sv-pin").onclick = () => setAddMode(addMode && addMode.type === "evidence" ? null : { type: "evidence" });
  $("sv-addwin").onclick = () => setAddMode(addMode && addMode.type === "window" ? null : { type: "window" });
  $("sv-fit").onclick = () => fit();
  $("sv-progress").onclick = () => openProgress();

  function setFloor(k) {
    floorKey = k; try { localStorage.setItem(`dbk-survey-floor:${PID}`, k); } catch {}
    document.querySelectorAll("#sv-floors button").forEach((b) => b.classList.toggle("on", b.dataset.k === k));
    fit();
  }

  // ---------- forms ----------
  const CATS = ["Heating", "Hot water", "Controls", "Secondary heating / flue", "Walls", "Roof / loft", "Floor", "Glazing", "Ventilation", "Electrics / meters", "Renewables", "Extensions / outbuildings", "Damp / defect", "Other"];
  const AGE = ["Pre-2002", "2002–2021", "2022 or later", "Unknown"], AGE_EV = ["FENSA", "CERTASS", "Date stamp", "Owner", "None"];
  const GLAZ = ["Single", "Double", "Triple", "Secondary", "Leaded (single)"], FRAME = ["uPVC", "Wood", "Metal", "Metal thermal break", "Composite"];
  const FORMS = {
    window: [{ k: "width_mm", l: "Width (mm)", t: "num", half: 1 }, { k: "height_mm", l: "Height (mm)", t: "num", half: 1 },
      { k: "type", l: "Type", t: "chips", o: ["Window", "Roof window", "Rooflight", "French doors", "Patio door", "Bay", "Curved"] },
      { k: "glazing", l: "Glazing", t: "chips", o: GLAZ }, { k: "frame", l: "Frame", t: "chips", o: FRAME },
      { k: "gap", l: "Glazing gap", t: "chips", o: ["6 mm", "12 mm", "16 mm+", "Unknown"] },
      { k: "installed", l: "Installed", t: "chips", o: AGE }, { k: "age_evidence", l: "Age evidence", t: "chips", o: AGE_EV },
      { k: "count", l: "Number of identical windows here", t: "num", ph: "1" }, { k: "notes", l: "Notes", t: "text" },
      { k: "absent", l: "Not here (the plan is wrong)", t: "bool" }],
    door: [{ k: "width_mm", l: "Width (mm)", t: "num", half: 1 }, { k: "height_mm", l: "Height (mm)", t: "num", half: 1 },
      { k: "type", l: "Type", t: "chips", o: ["Solid", "Half-glazed", "Glazed", "Insulated composite", "French doors", "Patio door"] },
      { k: "to", l: "Leads to", t: "chips", o: ["Outside", "Unheated space", "Heated space"] },
      { k: "glazing", l: "Glazing", t: "chips", o: GLAZ }, { k: "frame", l: "Frame", t: "chips", o: FRAME },
      { k: "installed", l: "Installed", t: "chips", o: AGE }, { k: "age_evidence", l: "Age evidence", t: "chips", o: AGE_EV },
      { k: "notes", l: "Notes", t: "text" }, { k: "absent", l: "Not here (the plan is wrong)", t: "bool" }],
    room: [{ k: "length_m", l: "Length (m)", t: "num", half: 1 }, { k: "width_m", l: "Width (m)", t: "num", half: 1 },
      { k: "ceiling_m", l: "Ceiling height (m)", t: "num", half: 1 }, { k: "storey", l: "Storey", t: "line", half: 1, ph: "e.g. room in roof" },
      { k: "heated", l: "Heated?", t: "chips", o: ["Heated", "Unheated"] },
      { k: "emitters", l: "Heat emitters", t: "chips", o: ["Radiators", "Underfloor", "Storage heater", "Electric panel", "None", "Other"] },
      { k: "notes", l: "Notes", t: "text" }],
    evidence: [{ k: "title", l: "Title", t: "line" }, { k: "category", l: "Category", t: "chips", o: CATS }, { k: "notes", l: "Notes", t: "text" }],
    check: [{ k: "state", l: "Status", t: "chips", o: ["Done", "Not applicable", "No access"] }, { k: "notes", l: "Notes", t: "text" }],
  };
  function fieldHtml(ref, f, d) {
    const v = d[f.k];
    if (f.t === "num" || f.t === "line") return `<div><label>${esc(f.l)}</label><input data-k="${f.k}" ${f.t === "num" ? 'inputmode="decimal" autocomplete="off"' : 'autocomplete="off"'} value="${esc(v ?? "")}" placeholder="${esc(f.ph || "")}"/></div>`;
    if (f.t === "text") return `<div><label>${esc(f.l)}</label><textarea data-k="${f.k}" placeholder="Type or dictate…">${esc(v ?? "")}</textarea></div>`;
    if (f.t === "bool") return `<label class="toggle"><input type="checkbox" data-k="${f.k}" ${v ? "checked" : ""}/> ${esc(f.l)}</label>`;
    return `<div><label>${esc(f.l)}</label><div class="chips" data-chips="${f.k}">${f.o.map((o) => `<button type="button" class="chip${v === o ? " on" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;
  }
  function photosHtml(ref) {
    const srv = (photos.get(ref) || []).map((p) => `<div class="ph"><a href="/api/survey/photo/${p.id}" target="_blank" rel="noopener"><img loading="lazy" src="/api/survey/photo/${p.id}" alt=""/></a><button class="del" data-del="${p.id}" aria-label="Remove">×</button></div>`);
    const pen = (pending.get(ref) || []).map((p) => `<div class="ph"><img src="${p.url}" alt=""/><span class="wait">${p.failed ? "retrying" : "uploading"}</span><button class="del" data-del="${p.id}" aria-label="Remove">×</button></div>`);
    return srv.concat(pen).join("") || '<span class="muted small">No photos yet.</span>';
  }
  function refreshSheetPhotos(ref) { if (selected === ref) { const el = sheet.querySelector(".photos"); if (el) el.innerHTML = photosHtml(ref); } }
  function select(ref) {
    const e = entity(ref); if (!e) return;
    if (e.floor && e.floor !== floorKey) setFloor(e.floor);
    selected = ref; openSheet(e); render();
    // zoom in if needed and keep the item visible (above the sheet on phones, left of it on wide screens)
    if (e.kind !== "check") {
      const xy = e.kind === "room" ? centroid(e.roomObj.poly) : posOf(e);
      const zoomIn = view.s < 17; if (zoomIn) view.s = 40;
      const [sx, sy] = S(xy); const phone = window.innerWidth < 900;
      const visBottom = phone ? window.innerHeight - sheet.offsetHeight - stage.getBoundingClientRect().top : stage.clientHeight;
      const visRight = phone ? stage.clientWidth : stage.clientWidth - sheet.offsetWidth;
      if (zoomIn || sy > visBottom - 30 || sy < 20 || sx < 20 || sx > visRight - 20) { view.tx += visRight / 2 - sx; view.ty += Math.max(50, visBottom / 2) - sy; }
      render();
    }
  }
  function openSheet(e) {
    const ref = e.ref, kind = e.kind, r = records.get(ref), d = r && !r.deleted ? r.data : {};
    const f = e.floor ? floorOf(e.floor) : null; const room = f && (e.roomObj || f.rooms.find((q) => q.key === (e.room || d.room)));
    let title = "", sub = "", hint = e.hint || "";
    if (kind === "window" || kind === "door") { title = `${e.label || (kind === "door" ? "Door" : "Window")} · ${room ? room.name : f ? f.name : ""}`; const fc = facing(e); sub = `${e.subtype || (kind === "door" ? "Door" : "Window")}${fc ? ` · faces ${fc}` : ""} · ${f ? f.name : ""}`; if (hint && e.seeded) hint = `Desk guess: ${hint}`; }
    else if (kind === "room") { title = e.label; sub = `${f.name}${room.listing ? ` · listing ${room.listing}` : ""}`; hint = room.note || ""; }
    else if (kind === "check") { title = e.label; sub = e.category || "Checklist"; }
    else { title = d.title || e.label || "Evidence"; sub = `${e.category || d.category || "Evidence"}${room ? ` · ${room.name}` : ""}${f ? ` · ${f.name}` : ""}`; }
    const form = FORMS[kind] || FORMS.evidence; let fields = "", halfOpen = false;
    for (const fd of form) {
      if (fd.half && !halfOpen) { fields += '<div class="two">'; halfOpen = true; }
      if (!fd.half && halfOpen) { fields += "</div>"; halfOpen = false; }
      fields += fieldHtml(ref, fd, d);
    }
    if (halfOpen) fields += "</div>";
    const canMove = kind === "window" || kind === "door" || kind === "evidence";
    sheet.innerHTML = `<div class="grab"></div><button class="x" type="button" data-act="close" aria-label="Close">×</button>
<h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div>${hint ? `<div class="hintbox">${esc(hint)}</div>` : ""}
<form autocomplete="off" onsubmit="return false">${fields}</form>
<label>Photos</label><div class="photos">${photosHtml(ref)}</div>
<div class="addphoto"><label class="btn" style="flex:1">📷 Take photo<input type="file" accept="image/*" capture="environment" multiple hidden data-photo="1"/></label><label class="btn secondary" style="flex:1;color:var(--ink)">Add from library<input type="file" accept="image/*" multiple hidden data-photo="1"/></label></div>
<div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">${canMove ? '<button class="btn secondary small" type="button" data-act="move">Move on plan</button>' : ""}${!e.seeded ? '<button class="btn danger small" type="button" data-act="delete">Delete this pin</button>' : ""}</div>`;
    sheet.hidden = false;
  }
  function closeSheet() { selected = null; sheet.hidden = true; sheet.innerHTML = ""; render(); }
  sheet.addEventListener("input", (ev) => {
    const t = ev.target; if (!selected || !t.dataset || !t.dataset.k) return;
    if (t.type === "checkbox") return;
    setField(selected, t.dataset.k, t.value.trim() === "" ? "" : t.value);
  });
  sheet.addEventListener("change", (ev) => {
    const t = ev.target; if (!selected) return;
    if (t.type === "checkbox" && t.dataset.k) setField(selected, t.dataset.k, t.checked);
    if (t.dataset && t.dataset.photo && t.files && t.files.length) { addPhotos(selected, [...t.files]); t.value = ""; }
  });
  sheet.addEventListener("click", (ev) => {
    const chip = ev.target.closest(".chip");
    if (chip && selected) {
      const wrap = chip.parentElement, k = wrap.dataset.chips, v = chip.dataset.v; const cur = ((records.get(selected) || {}).data || {})[k];
      const nv = cur === v ? "" : v; wrap.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.v === nv)); setField(selected, k, nv); return;
    }
    const del = ev.target.closest("[data-del]"); if (del && selected) { ev.preventDefault(); deletePhoto(selected, del.dataset.del); return; }
    const act = ev.target.closest("[data-act]"); if (!act) return;
    if (act.dataset.act === "close") closeSheet();
    else if (act.dataset.act === "move") { const ref = selected; closeSheet(); setAddMode({ type: "move", ref }); }
    else if (act.dataset.act === "delete") { if (confirm("Delete this pin and its notes?")) { const r = ensureRec(selected); r.deleted = true; touch(r); closeSheet(); } }
  });

  // ---------- progress ----------
  function openProgress() {
    selected = null; render();
    const rows = (list) => list.map((x) => `<div class="prow" data-ref="${esc(x.ref)}"><span class="dot ${x.st}"></span><div class="t">${esc(x.label)}<small>${esc(x.sub || "")}</small></div><span class="muted small">${x.np ? `📷${x.np}` : ""}</span></div>`).join("");
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
    const items = [...plan.items, ...sitePins().map((r) => entity(r.ref))];
    const wins = items.filter((i) => i.kind === "window"), doors = items.filter((i) => i.kind === "door");
    const rooms = plan.floors.flatMap((f) => f.rooms.map((r) => ({ ref: roomRef(f.key, r.key), label: r.name, sub: f.name, kind: "room" })));
    const evid = items.filter((i) => i.kind === "evidence");
    const tag = (x) => ({ ...x, st: status(x.ref, x.kind || "check"), np: nPhotos(x.ref) });
    const W = wins.map((i) => tag({ ...i, sub: `${floorOf(i.floor).name} · ${((floorOf(i.floor).rooms.find((r) => r.key === i.room)) || {}).name || ""}` }));
    const D = doors.map((i) => tag({ ...i, sub: `${floorOf(i.floor).name} · ${((floorOf(i.floor).rooms.find((r) => r.key === i.room)) || {}).name || ""}` }));
    const R = rooms.map(tag), E = evid.map((i) => tag({ ...i, sub: i.category || "" })), C = (plan.checklist || []).map((c) => tag({ ...c, kind: "check", sub: c.category }));
    const done = (a) => a.filter((x) => x.st === "done" || x.st === "absent").length;
    const bar = (lab, a) => `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between"><b>${lab}</b><span class="muted small">${done(a)} / ${a.length}</span></div><div class="bar"><i style="width:${pct(done(a), a.length)}%"></i></div></div>`;
    const todoFirst = (a) => a.slice().sort((x, y) => (x.st === "done" || x.st === "absent") - (y.st === "done" || y.st === "absent"));
    sheet.innerHTML = `<div class="grab"></div><button class="x" type="button" data-act="close" aria-label="Close">×</button><div class="prog">
<h2>Progress</h2><div class="sub">${esc(plan.address || "")}</div>
${bar("Windows", W)}${bar("External doors", D)}${bar("Rooms measured", R)}${bar("Evidence checklist", C)}${E.length ? bar("Evidence pins", E) : ""}
<p class="small muted">${esc(plan.note || "")}</p>
<p><a class="btn secondary small" href="${API}/export.csv">Download CSV</a></p>
<h3>Evidence checklist</h3>${rows(C)}
<h3>Windows</h3>${rows(todoFirst(W))}<h3>External doors</h3>${rows(todoFirst(D))}<h3>Rooms</h3>${rows(todoFirst(R))}${E.length ? `<h3>Evidence pins</h3>${rows(E)}` : ""}</div>`;
    sheet.hidden = false; sheet.scrollTop = 0;
  }
  sheet.addEventListener("click", (ev) => { const row = ev.target.closest(".prow"); if (row) select(row.dataset.ref); });

  // ---------- load ----------
  async function load() {
    let j;
    try {
      const res = await fetch(API, { headers: { accept: "application/json" } });
      if (res.status === 401) { location.reload(); return; }
      j = await res.json();
      if (!j.ok) throw new Error(j.error || "Load failed");
      try { localStorage.setItem(`dbk-survey-cache:${PID}`, JSON.stringify(j)); } catch {}
    } catch (e) {
      try { j = JSON.parse(localStorage.getItem(`dbk-survey-cache:${PID}`) || "null"); } catch { j = null; }
      if (!j) { statusEl.className = "pill error"; statusEl.textContent = "Can't load"; $("sv-name").textContent = String(e.message || e); return; }
      online = false;
    }
    plan = j.property.plan;
    $("sv-name").textContent = j.property.title || plan.title; $("sv-visit").textContent = [plan.visit, j.property.address].filter(Boolean).join(" · ");
    document.title = `${j.property.title} · Survey`;
    for (const r of j.records) records.set(r.ref, r);
    for (const p of j.photos) { if (!photos.has(p.ref)) photos.set(p.ref, []); photos.get(p.ref).push(p); }
    for (const [ref, q] of Object.entries(queue)) {   // local edits not yet on the server win
      const r = records.get(ref);
      if (!r || (q.client_ts || 0) > (r.client_ts || 0)) records.set(ref, { ref, ...q });
    }
    for (const o of await idbAll()) if (o.pid === PID) { o.url = URL.createObjectURL(o.blob); if (!pending.has(o.ref)) pending.set(o.ref, []); pending.get(o.ref).push(o); }
    $("sv-floors").innerHTML = plan.floors.map((f) => `<button type="button" data-k="${esc(f.key)}">${esc(f.name)}</button>`).join("");
    $("sv-floors").onclick = (ev) => { const b = ev.target.closest("button"); if (b) { closeSheet(); setFloor(b.dataset.k); } };
    let fk = null; try { fk = localStorage.getItem(`dbk-survey-floor:${PID}`); } catch {}
    setFloor(plan.floors.some((f) => f.key === fk) ? fk : plan.floors[0].key);
    if (!j.photos_enabled) alert("Photo storage is not configured on the server yet: notes and measurements will save, photos will wait on this phone.");
    updateStatus(); scheduleFlush(0); retryPhotos();
  }
  load();
})();
