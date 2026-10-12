/* Invoicing admin — vanilla JS, talks to /api/admin/*. Served only behind the admin login. */
(() => {
  const app = document.getElementById("app");
  // Services offered in the New invoice dropdown. Edit this list to add or remove options; "Other" always allows free text.
  const SERVICES = [
    "Domestic EPC",
    "Home Insight Survey",
    "HomeBuyer Survey (Level 2)",
    "Building Survey (Level 3)",
    "Buy-to-Let Survey",
    "Drone Roof Survey",
    "Retrofit Assessment",
    "Ventilation Assessment",
  ];
  const DUE_DAYS = 7; // default payment terms for a new invoice (editable on the form)
  const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const gbp = (p) => "£" + ((p || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (v) => {
    if (!v) return "";
    const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? new Date(v.replace(" ", "T") + "Z") : new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const day = (v) => (v ? (/^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : v) : "");
  const badge = (s) => `<span class="badge ${esc(s)}">${esc({ draft: "Draft", sent: "Awaiting payment", paid: "Paid", failed: "Payment failed", void: "Void", refunded: "Refunded" }[s] || s)}</span>`;

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch("/api/admin/" + path, {
      method,
      headers: { "x-requested-with": "fetch", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { location.href = "/admin"; throw new Error("Signed out"); }
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!data.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  let partners = null;
  async function getPartners(force) {
    if (!partners || force) partners = (await api("partners")).partners;
    return partners;
  }
  const pname = (p) => p.display_name || p.business_name || p.stripe_account_id;

  function setNav(name) {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === name));
  }
  function busy(btn, on) { if (btn) { btn.disabled = on; btn.dataset.label ??= btn.textContent; btn.textContent = on ? "Working…" : btn.dataset.label; } }
  const flash = (el, text, kind = "ok") => { el.innerHTML = `<p class="msg ${kind}">${esc(text)}</p>`; };

  // ------------------------------------------------------------ invoices list
  async function viewInvoices() {
    setNav("invoices");
    const status = sessionStorage.getItem("inv.status") || "all";
    const q = sessionStorage.getItem("inv.q") || "";
    app.innerHTML = `<div class="card"><div class="toolbar">
      <select id="f-status">${["all", "draft", "sent", "paid", "failed", "void", "refunded"].map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s === "all" ? "All statuses" : s}</option>`).join("")}</select>
      <input id="f-q" placeholder="Search number, client, property, service…" value="${esc(q)}" />
      <a class="btn small" href="#new">New invoice</a></div>
      <div id="list"><p class="muted">Loading…</p></div></div>`;
    const load = async () => {
      const s = document.getElementById("f-status").value, qq = document.getElementById("f-q").value.trim();
      sessionStorage.setItem("inv.status", s); sessionStorage.setItem("inv.q", qq);
      const { invoices } = await api(`invoices?status=${encodeURIComponent(s)}&q=${encodeURIComponent(qq)}`);
      const list = document.getElementById("list");
      if (!invoices.length) { list.innerHTML = `<p class="muted">No invoices yet.</p>`; return; }
      const sum = invoices.reduce((a, i) => a + (i.status === "paid" ? i.amount_pence : 0), 0);
      const fees = invoices.reduce((a, i) => a + (i.status === "paid" ? i.application_fee_pence : 0), 0);
      list.innerHTML = `<table><thead><tr><th>Number</th><th>Issued</th><th>Client</th><th>Partner</th><th>Service</th><th class="num">Amount</th><th class="num">Fee inc VAT</th><th>Status</th></tr></thead><tbody>
        ${invoices.map((i) => `<tr class="click" data-id="${i.id}"><td class="mono">${esc(i.number)}</td><td>${day(i.issued_at || i.created_at)}</td>
          <td>${esc(i.bill_to_business || i.client_name || "")}<br/><span class="muted small">${esc(i.client_email)}</span></td><td>${esc(i.partner_name)}</td>
          <td>${esc(i.service_name)}${i.property_address ? `<br/><span class="muted small">${esc(i.property_address)}</span>` : ""}</td>
          <td class="num">${gbp(i.amount_pence)}</td><td class="num">${gbp(i.application_fee_pence)}</td><td>${badge(i.status)}${i.reminders_sent ? `<br/><span class="small muted">${i.reminders_sent} reminder${i.reminders_sent === 1 ? "" : "s"} sent</span>` : ""}${i.last_error ? `<br/><span class="small" style="color:#8a2a2a">${esc(i.last_error)}</span>` : ""}</td></tr>`).join("")}
        </tbody></table><p class="muted small" style="margin:10px 0 0">${invoices.length} shown · paid in this view ${gbp(sum)} · platform fees ${gbp(fees)}</p>`;
      list.querySelectorAll("tr.click").forEach((tr) => tr.addEventListener("click", () => (location.hash = "#inv/" + tr.dataset.id)));
    };
    document.getElementById("f-status").addEventListener("change", load);
    let t; document.getElementById("f-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
    await load();
  }

  // ------------------------------------------------------------ new / edit form
  async function viewForm(editId) {
    setNav("new");
    const ps = await getPartners();
    let inv = null;
    if (editId) inv = (await api("invoices/" + editId)).invoice;
    const v = (k) => esc(inv?.[k] ?? "");
    app.innerHTML = `<div class="card"><h1>${inv ? `Edit draft ${esc(inv.number)}` : "New invoice"}</h1><div id="form-msg"></div>
    <form id="inv-form">
      <div class="grid">
        <div>
          <label>Connected account (who does the work)</label>
          <select name="partner_account_id" required>${ps.length ? "" : '<option value="">No connected accounts synced yet</option>'}
            ${ps.filter((p) => !p.hidden || inv?.partner_account_id === p.stripe_account_id).map((p) => `<option value="${esc(p.stripe_account_id)}" ${inv?.partner_account_id === p.stripe_account_id ? "selected" : ""} ${p.charges_enabled ? "" : "disabled"}>${esc(pname(p))}${p.charges_enabled ? "" : " (cannot take payments yet)"}</option>`).join("")}</select>
          <label>Client email</label><input name="client_email" type="email" required value="${v("client_email")}" />
          <label>Client name</label><input name="client_name" value="${v("client_name")}" placeholder="Jane Smith" />
          <div class="check"><input type="checkbox" id="is-biz" ${inv?.bill_to_business || inv?.bill_to_address ? "checked" : ""} /><label for="is-biz" style="margin:0;text-transform:none;letter-spacing:0">Bill to a business / different address</label></div>
          <div id="biz-fields" style="display:${inv?.bill_to_business || inv?.bill_to_address ? "block" : "none"}">
            <label>Business name</label><input name="bill_to_business" value="${v("bill_to_business")}" />
            <label>Billing address</label><textarea name="bill_to_address">${v("bill_to_address")}</textarea>
          </div>
          <label>Property address</label><textarea name="property_address" placeholder="12 Example Road, Tunbridge Wells, TN1 1AA">${v("property_address")}</textarea>
        </div>
        <div>
          <label>Service</label>
          <select id="svc-select">${SERVICES.map((n) => `<option value="${esc(n)}" ${(inv ? inv.service_name === n : n === "Domestic EPC") ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="__other" ${inv && !SERVICES.includes(inv.service_name) ? "selected" : ""}>Other (type below)</option></select>
          <input name="service_name" required value="${v("service_name") || "Domestic EPC"}" placeholder="Describe the service" style="margin-top:6px;display:${inv && !SERVICES.includes(inv.service_name) ? "block" : "none"}" />
          <label>Description (optional, shown on the invoice)</label><textarea name="description">${v("description")}</textarea>
          <label>Message to the client (optional, in the email only)</label><textarea name="client_message" placeholder="e.g. Thanks for booking — Matt will be with you on Thursday at 10am.">${v("client_message")}</textarea>
          <label>Amount charged to the client (£)</label><input name="amount" inputmode="decimal" required value="${inv ? (inv.amount_pence / 100).toFixed(2) : ""}" placeholder="100.00" />
          <div class="check"><input type="checkbox" name="client_vat_inclusive" id="cvat" ${inv?.client_vat_rate ? "checked" : ""} /><label for="cvat" style="margin:0;text-transform:none;letter-spacing:0">Amount includes VAT at 20% <span id="cvat-note" class="muted"></span></label></div>
          <label>Your platform fee, inc VAT (£) <span id="fee-note" class="muted" style="text-transform:none;letter-spacing:0"></span></label><input name="fee" inputmode="decimal" value="${inv ? (inv.application_fee_pence / 100).toFixed(2) : ""}" placeholder="10.00" />
          <label>Due date (defaults to ${DUE_DAYS} days)</label><input name="due_date" type="date" value="${inv ? v("due_date") : plusDays(DUE_DAYS)}" />
          <div class="totals" id="totals"></div>
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" type="submit" data-send="0">Save draft</button>
        <button class="btn secondary" type="button" id="btn-preview">Preview</button>
        <button class="btn" type="submit" data-send="1">Save & send to client</button>
        <span id="autosave" class="muted small" style="align-self:center"></span>
      </div>
    </form></div>`;
    const form = document.getElementById("inv-form");
    const totals = document.getElementById("totals");
    const recalc = () => {
      const amt = Math.round(parseFloat(form.amount.value || "0") * 100) || 0;
      const fee = Math.round(parseFloat(form.fee.value || "0") * 100) || 0;
      const net = Math.round((fee * 100) / 120), vat = fee - net, total = fee;
      const vatInc = form.client_vat_inclusive.checked;
      const cnet = vatInc ? Math.round((amt * 100) / 120) : amt;
      totals.innerHTML = `
        ${vatInc ? `<div><span>Client net</span><span>${gbp(cnet)}</span></div><div><span>Client VAT 20%</span><span>${gbp(amt - cnet)}</span></div>` : ""}
        <div class="big"><span>Client pays</span><span>${gbp(amt)}</span></div>
        <div><span>Your fee taken from payment (inc VAT)</span><span>${gbp(total)}</span></div>
        <div class="small muted"><span>of which net</span><span>${gbp(net)}</span></div>
        <div class="small muted"><span>of which VAT 20%</span><span>${gbp(vat)}</span></div>
        <div class="big"><span>Partner receives (before Stripe's fee)</span><span>${gbp(amt - total)}</span></div>
        ${total >= amt && amt ? `<div style="color:#8a2a2a">Fee must be less than the amount.</div>` : ""}`;
    };
    let feeTouched = !!inv;
    form.fee.addEventListener("input", () => { feeTouched = true; });
    const defaultFee = () => {
      if (feeTouched) return;
      const p = ps.find((x) => x.stripe_account_id === form.partner_account_id.value);
      const pct = Number(p?.commission_pct ?? 10);
      const amt = Math.round(parseFloat(form.amount.value || "0") * 100) || 0;
      if (amt > 0) { form.fee.value = (Math.round((amt * pct) / 100) / 100).toFixed(2); document.getElementById("fee-note").textContent = `(${pct}% of the amount, this partner's rate; edit to override)`; recalc(); }
    };
    form.amount.addEventListener("input", defaultFee);
    form.partner_account_id.addEventListener("change", () => { feeTouched = false; defaultFee(); });
    const syncVat = () => {
      const p = ps.find((x) => x.stripe_account_id === form.partner_account_id.value);
      const hasVat = !!(p && String(p.vat_number || "").trim());
      form.client_vat_inclusive.disabled = !hasVat;
      if (!hasVat) form.client_vat_inclusive.checked = false;
      document.getElementById("cvat-note").textContent = p ? (hasVat ? `(VAT No. ${p.vat_number})` : "(no VAT number on file for this partner, so no VAT is charged)") : "";
      recalc();
    };
    form.partner_account_id.addEventListener("change", syncVat);
    form.addEventListener("input", recalc); recalc(); syncVat();
    const svcSel = document.getElementById("svc-select"), svcInput = form.service_name;
    svcSel.addEventListener("change", () => {
      if (svcSel.value === "__other") { svcInput.style.display = "block"; if (SERVICES.includes(svcInput.value)) svcInput.value = ""; svcInput.focus(); }
      else { svcInput.style.display = "none"; svcInput.value = svcSel.value; }
    });
    document.getElementById("is-biz").addEventListener("change", (e) => (document.getElementById("biz-fields").style.display = e.target.checked ? "block" : "none"));
    // ---- autosave: the form is saved as a draft on the server as soon as it is complete enough, then on every change.
    const LS_KEY = "inv.new.unsaved";
    let draftId = inv?.id || null, lastSaved = "", saveTimer = null, saving = null;
    const status = document.getElementById("autosave");
    const payload = () => {
      const body = Object.fromEntries(new FormData(form).entries());
      body.client_vat_inclusive = form.client_vat_inclusive.checked;
      if (!document.getElementById("is-biz").checked) { body.bill_to_business = ""; body.bill_to_address = ""; }
      return body;
    };
    const complete = (b) => b.partner_account_id && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.client_email || "") && (b.service_name || "").trim() && Math.round(parseFloat(b.amount || "0") * 100) >= 100;
    const saveNow = async () => {
      if (saving) return saving;
      const body = payload();
      const key = JSON.stringify(body);
      if (!complete(body)) { try { localStorage.setItem(LS_KEY, key); } catch {} return null; }
      if (key === lastSaved) return draftId;
      saving = (async () => {
        try {
          status.textContent = "Saving…";
          let r;
          if (draftId) r = await api("invoices/" + draftId, { method: "PUT", body });
          else { r = await api("invoices", { method: "POST", body }); draftId = r.invoice.id; history.replaceState(null, "", "#edit/" + draftId); }
          lastSaved = key;
          try { localStorage.removeItem(LS_KEY); } catch {}
          status.textContent = `Saved as draft ${r.invoice.number} · ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
          return draftId;
        } catch (err) { status.textContent = "Not saved: " + err.message; return null; }
        finally { saving = null; }
      })();
      return saving;
    };
    const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200); };
    form.addEventListener("input", scheduleSave);
    form.addEventListener("change", scheduleSave);
    if (!inv) {
      try {
        const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
        if (saved) { for (const [k, v] of Object.entries(saved)) { const el = form.elements[k]; if (!el || k === "client_vat_inclusive") continue; el.value = v; } if (saved.bill_to_business || saved.bill_to_address) { document.getElementById("is-biz").checked = true; document.getElementById("biz-fields").style.display = "block"; } if (!SERVICES.includes(saved.service_name)) { svcSel.value = "__other"; svcInput.style.display = "block"; } else svcSel.value = saved.service_name; recalc(); syncVat(); status.textContent = "Restored what you were typing"; }
      } catch {}
    } else { lastSaved = JSON.stringify(payload()); }
    document.getElementById("btn-preview").addEventListener("click", async (e) => {
      busy(e.target, true);
      const id = await saveNow() || draftId;
      busy(e.target, false);
      if (!id) { flash(document.getElementById("form-msg"), "Fill in the partner, client email, service and amount first, then preview.", "err"); window.scrollTo(0, 0); return; }
      window.open("/admin/preview/" + id, "_blank");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter; const send = btn?.dataset.send === "1";
      const body = payload();
      if (!complete(body)) { flash(document.getElementById("form-msg"), "Fill in the partner, client email, service and an amount of at least £1.", "err"); window.scrollTo(0, 0); return; }
      if (send && !confirm(`Send invoice for ${gbp(Math.round(parseFloat(body.amount || "0") * 100))} to ${body.client_email}?`)) return;
      busy(btn, true);
      clearTimeout(saveTimer);
      try {
        if (saving) await saving;
        let r;
        if (draftId) { r = await api("invoices/" + draftId, { method: "PUT", body }); if (send) r = await api(`invoices/${draftId}/send`, { method: "POST" }); }
        else r = await api("invoices", { method: "POST", body: { ...body, send } });
        try { localStorage.removeItem(LS_KEY); } catch {}
        location.hash = "#inv/" + r.invoice.id;
      } catch (err) { flash(document.getElementById("form-msg"), err.message, "err"); window.scrollTo(0, 0); }
      finally { busy(btn, false); }
    });
  }

  // ------------------------------------------------------------ invoice detail
  async function viewInvoice(id) {
    setNav("invoices");
    app.innerHTML = `<p class="muted">Loading…</p>`;
    const { invoice: i, events, emails, links } = await api("invoices/" + id);
    const act = (label, action, cls = "secondary", confirmText) => `<button class="btn ${cls}" data-action="${action}" ${confirmText ? `data-confirm="${esc(confirmText)}"` : ""}>${label}</button>`;
    let actions = "";
    const preview = `<a class="btn secondary" href="/admin/preview/${i.id}" target="_blank">Preview</a>`;
    if (i.status === "draft") actions = `<a class="btn secondary" href="#edit/${i.id}">Edit</a>${preview}${act("Send to client", "send", "", `Send ${i.number} for ${gbp(i.amount_pence)} to ${i.client_email}?`)}${act("Void", "void", "danger", "Void this draft?")}`;
    else if (i.status === "sent" || i.status === "failed") actions = `${preview}${act("Resend invoice email", "resend", "secondary", `Resend ${i.number} to ${i.client_email}?`)}${act("Check Stripe status", "reconcile")}${act("Void invoice", "void", "danger", "Void this invoice? The pay link will stop working.")}`;
    else if (i.status === "paid") actions = `${act("Resend paid confirmation + fee invoice", "resend-paid-emails", "secondary", "Resend the paid confirmation to the client and the fee invoice to the partner?")}${act("Check Stripe status", "reconcile")}`;
    else actions = act("Check Stripe status", "reconcile");

    app.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <h1 style="margin:0">${esc(i.number)} ${badge(i.status)}</h1><a href="#invoices" class="muted small">← All invoices</a></div>
      <div id="msg" style="margin-top:12px">${i.last_error ? `<p class="msg warn">${esc(i.last_error)}</p>` : ""}</div>
      <div class="grid" style="margin-top:12px">
        <dl class="kv">
          <dt>Client</dt><dd>${esc(i.client_name || "")} &lt;${esc(i.client_email)}&gt;</dd>
          ${i.bill_to_business ? `<dt>Billed to</dt><dd>${esc(i.bill_to_business)}${i.bill_to_address ? `<br/><span class="small muted">${esc(i.bill_to_address).replace(/\n/g, "<br/>")}</span>` : ""}</dd>` : ""}
          ${i.property_address ? `<dt>Property</dt><dd>${esc(i.property_address).replace(/\n/g, "<br/>")}</dd>` : ""}
          <dt>Service</dt><dd>${esc(i.service_name)}${i.description ? `<br/><span class="small muted">${esc(i.description).replace(/\n/g, "<br/>")}</span>` : ""}</dd>
          ${i.client_message ? `<dt>Message to client</dt><dd class="small">${esc(i.client_message).replace(/\n/g, "<br/>")}</dd>` : ""}
          <dt>Partner</dt><dd>${esc(i.partner_name)} <span class="mono muted">${esc(i.partner_account_id)}</span></dd>
          <dt>Issued / due</dt><dd>${day(i.issued_at)}${i.due_date ? ` / due ${day(i.due_date)}` : ""}</dd>
          ${i.sent_at ? `<dt>Sent</dt><dd>${when(i.sent_at)}</dd>` : ""}
          ${i.paid_at ? `<dt>Paid</dt><dd>${when(i.paid_at)}${i.payment_method ? ` · ${esc(i.payment_method)}` : ""}</dd>` : ""}
          ${i.reminders_sent ? `<dt>Reminders</dt><dd>${i.reminders_sent} of 4 sent, last ${when(i.last_reminder_at)}${i.reminders_sent >= 4 ? " · <strong>further action needed</strong>" : ""}</dd>` : (i.status === "sent" || i.status === "failed") && i.sent_at ? `<dt>Reminders</dt><dd class="muted">automatic at 7, 14, 21 and 28 days unpaid</dd>` : ""}
        </dl>
        <div><div class="totals">
          <div class="big"><span>Client pays</span><span>${gbp(i.amount_pence)}</span></div>
          ${i.client_vat_rate ? `<div class="small muted"><span>includes VAT at ${i.client_vat_rate}%</span><span></span></div>` : ""}
          <div><span>Your fee (inc VAT)</span><span>${gbp(i.application_fee_pence)}</span></div>
          <div class="small muted"><span>of which net</span><span>${gbp(i.fee_net_pence)}</span></div>
          <div class="small muted"><span>of which VAT ${i.fee_vat_rate}%</span><span>${gbp(i.fee_vat_pence)}</span></div>
          <div class="big"><span>Partner (before Stripe fee)</span><span>${gbp(i.amount_pence - i.application_fee_pence)}</span></div>
          ${i.fee_invoice_number ? `<div><span>Fee VAT invoice</span><span class="mono">${esc(i.fee_invoice_number)}</span></div>` : ""}
        </div>
        <p class="small" style="margin-top:12px">
          ${i.status !== "draft" ? `<a href="${links.view}" target="_blank">Client page</a> · <a href="${links.pdf}" target="_blank">Invoice PDF</a> · <a href="${links.pay}" target="_blank">Pay link</a> <button class="btn secondary small" data-copy="${links.pay}">Copy</button>` : "Links appear once sent."}
          ${i.fee_invoice_number ? ` · <a href="${links.feePdf}" target="_blank">Fee invoice PDF</a>` : ""}
          ${i.receipt_url ? ` · <a href="${esc(i.receipt_url)}" target="_blank">Stripe receipt</a>` : ""}
        </p>
        ${i.stripe_payment_intent_id ? `<p class="small mono muted">PI ${esc(i.stripe_payment_intent_id)}${i.stripe_charge_id ? ` · ${esc(i.stripe_charge_id)}` : ""}${i.stripe_checkout_session_id ? `<br/>CS ${esc(i.stripe_checkout_session_id)}` : ""}</p>` : i.stripe_checkout_session_id ? `<p class="small mono muted">CS ${esc(i.stripe_checkout_session_id)}</p>` : ""}
        </div>
      </div>
      <div class="actions">${actions}</div>
    </div>
    <div class="card"><h2>Timeline</h2><ul class="timeline">${events.map((e) => `<li><span class="muted small">${when(e.at)}</span> &nbsp; <strong>${esc(e.type)}</strong> ${e.detail ? `<span class="small muted mono">${esc(e.detail)}</span>` : ""}</li>`).join("") || "<li class='muted'>Nothing yet</li>"}</ul></div>
    <div class="card"><h2>Emails</h2>${emails.length ? `<table><thead><tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Result</th></tr></thead><tbody>${emails.map((m) => `<tr><td>${when(m.at)}</td><td>${esc(m.kind)}</td><td>${esc(m.to_addr)}</td><td>${esc(m.subject)}</td><td>${m.error ? `<span style="color:#8a2a2a">${esc(m.error)}</span>` : `<span style="color:#1b6b33">sent</span> <span class="mono muted small">${esc(m.resend_id || "")}</span>`}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>None yet</p>"}</div>`;

    app.querySelectorAll("[data-action]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
        busy(b, true);
        try { await api(`invoices/${id}/${b.dataset.action}`, { method: "POST", body: {} }); await viewInvoice(id); }
        catch (err) { flash(document.getElementById("msg"), err.message, "err"); busy(b, false); }
      })
    );
    app.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; }));
  }

  // ------------------------------------------------------------ partners
  let showHidden = false;
  async function viewPartners() {
    setNav("partners");
    const all = await getPartners();
    const hiddenCount = all.filter((p) => p.hidden).length;
    const ps = showHidden ? all : all.filter((p) => !p.hidden);
    app.innerHTML = `<div class="card"><div class="toolbar"><h1 style="margin:0">Connected accounts</h1><button class="btn secondary small" id="sync">Sync from Stripe</button></div><div id="msg"></div>
      <p class="muted small">Pulled from your Stripe Connect platform. Edit the invoice details here: the supplier name and address printed on client invoices, where the partner's copies and fee invoices go, and their VAT number (shown when an invoice is marked VAT-inclusive).</p>
      ${[...ps.filter((p) => !p.hidden), ...ps.filter((p) => p.hidden)].map((p) => `<details style="border-top:1px solid var(--rule);padding:10px 0;${p.hidden ? "opacity:.55" : ""}"><summary style="cursor:pointer"><strong>${esc(pname(p))}</strong> <span class="mono muted small">${esc(p.stripe_account_id)}</span> ${p.hidden ? '<span class="badge">hidden</span> ' : ""}· ${p.charges_enabled ? '<span class="badge paid">can take payments</span>' : '<span class="badge failed">cannot take payments yet</span>'} <span class="muted small">${esc(p.account_type || "")}${p.fees_payer ? ` · Stripe fees paid by ${p.fees_payer === "account" ? "the partner" : p.fees_payer}` : ""} · ${esc(String(p.commission_pct ?? 10))}%${p.coverage_postcode ? ` · ${esc(p.coverage_postcode)}` : ""}${p.registered_at ? " · self-registered" : ""}</span></summary>
        <form data-id="${esc(p.stripe_account_id)}" class="grid" style="margin-top:8px">
          <div><label>Display name (on invoices)</label><input name="display_name" value="${esc(p.display_name || "")}" placeholder="${esc(p.business_name || "")}" />
          <label>Invoice / copy email</label><input name="invoice_email" type="email" value="${esc(p.invoice_email || "")}" placeholder="${esc(p.email || "")}" />
          <label>Phone</label><input name="phone" value="${esc(p.phone || "")}" />
          <label>Contact name</label><input name="contact_name" value="${esc(p.contact_name || "")}" />
          <label>Commission % (inc VAT, default for new invoices)</label><input name="commission_pct" inputmode="decimal" value="${esc(p.commission_pct ?? 10)}" />
          <label>Coverage postcode (home or centre of area)</label><input name="coverage_postcode" value="${esc(p.coverage_postcode || "")}" placeholder="TN2 5HB" />
          <div class="check"><input type="checkbox" name="copy_invoices" id="cp-${esc(p.stripe_account_id)}" ${p.copy_invoices ? "checked" : ""} /><label for="cp-${esc(p.stripe_account_id)}" style="margin:0;text-transform:none;letter-spacing:0">Email them a copy of each invoice sent</label></div>
          <div class="check"><input type="checkbox" name="hidden" id="hd-${esc(p.stripe_account_id)}" ${p.hidden ? "checked" : ""} /><label for="hd-${esc(p.stripe_account_id)}" style="margin:0;text-transform:none;letter-spacing:0">Hide this account (not offered on new invoices)</label></div></div>
          <div><label>Address (on invoices)</label><textarea name="address">${esc(p.address || "")}</textarea>
          <label>VAT number</label><input name="vat_number" value="${esc(p.vat_number || "")}" />
          <label>Notes</label><textarea name="notes">${esc(p.notes || "")}</textarea>
          <p><button class="btn small" type="submit">Save</button></p></div>
        </form>
        <div class="portal" data-acct="${esc(p.stripe_account_id)}" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--rule)"><h2 style="font-size:13px">Portal access <span class="muted small">(view-only login at /partner)</span></h2><div class="portal-users muted small">Loading…</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"><input class="portal-email" type="email" placeholder="${esc(p.invoice_email || p.email || "email")}" value="${esc(p.invoice_email || p.email || "")}" style="max-width:320px" /><button class="btn small portal-invite" type="button">Create account & send setup email</button></div></div>
        </details>`).join("") || "<p class='muted'>No connected accounts found. Check STRIPE_SECRET_KEY, then sync.</p>"}
      ${hiddenCount ? `<p class="small muted" style="margin-top:12px"><a href="#" id="toggle-hidden">${showHidden ? "Hide" : "Show"} ${hiddenCount} hidden account${hiddenCount === 1 ? "" : "s"}</a></p>` : ""}</div>`;
    document.getElementById("toggle-hidden")?.addEventListener("click", (e) => { e.preventDefault(); showHidden = !showHidden; viewPartners(); });
    const loadPortal = async (box) => {
      const acct = box.dataset.acct;
      try {
        const { users } = await api(`partners/${acct}/portal`);
        const el = box.querySelector(".portal-users");
        el.innerHTML = users.length
          ? users.map((u) => `<div>${esc(u.email)} · <strong>${esc(u.state)}</strong>${u.last_login_at ? ` · last sign-in ${when(u.last_login_at)}` : u.activated_at ? "" : u.invite_expires ? ` · link valid until ${when(u.invite_expires)}` : ""} ${u.state !== "disabled" ? `<button class="btn secondary small" data-portal-resend="${esc(u.email)}">${u.activated_at ? "Send password reset" : "Resend setup email"}</button> <button class="btn danger small" data-portal-revoke="${esc(u.id)}">Remove access</button>` : `<button class="btn secondary small" data-portal-resend="${esc(u.email)}">Re-enable & send setup email</button>`}</div>`).join("")
          : "No portal account yet.";
        el.querySelectorAll("[data-portal-resend]").forEach((b) => b.addEventListener("click", async () => { busy(b, true); try { await api(`partners/${acct}/portal`, { method: "POST", body: { action: "invite", email: b.dataset.portalResend } }); flash(document.getElementById("msg"), `Email sent to ${b.dataset.portalResend}.`); await loadPortal(box); } catch (err) { flash(document.getElementById("msg"), err.message, "err"); busy(b, false); } }));
        el.querySelectorAll("[data-portal-revoke]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Remove this person's portal access?")) return; busy(b, true); try { await api(`partners/${acct}/portal`, { method: "POST", body: { action: "revoke", user_id: b.dataset.portalRevoke } }); await loadPortal(box); } catch (err) { flash(document.getElementById("msg"), err.message, "err"); busy(b, false); } }));
      } catch (err) { box.querySelector(".portal-users").textContent = err.message; }
    };
    app.querySelectorAll(".portal").forEach((box) => {
      loadPortal(box);
      box.querySelector(".portal-invite").addEventListener("click", async (e) => {
        const email = box.querySelector(".portal-email").value.trim();
        if (!email) { flash(document.getElementById("msg"), "Enter the email address for the login.", "err"); return; }
        if (!confirm(`Create a portal login for ${email} and email them a set-password link?`)) return;
        busy(e.target, true);
        try { await api(`partners/${box.dataset.acct}/portal`, { method: "POST", body: { action: "invite", email } }); flash(document.getElementById("msg"), `Setup email sent to ${email}.`); await loadPortal(box); }
        catch (err) { flash(document.getElementById("msg"), err.message, "err"); }
        finally { busy(e.target, false); }
      });
    });
    document.getElementById("sync").addEventListener("click", async (e) => {
      busy(e.target, true);
      try { const r = await api("partners/sync", { method: "POST", body: {} }); partners = r.partners; await viewPartners(); flash(document.getElementById("msg"), `Synced ${r.synced} account(s).`); }
      catch (err) { flash(document.getElementById("msg"), err.message, "err"); busy(e.target, false); }
    });
    app.querySelectorAll("form[data-id]").forEach((f) =>
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f).entries());
        body.copy_invoices = f.copy_invoices.checked;
        body.hidden = f.hidden.checked;
        const btn = f.querySelector("button"); busy(btn, true);
        try { const r = await api("partners/" + f.dataset.id, { method: "PATCH", body }); partners = r.partners; flash(document.getElementById("msg"), "Saved."); }
        catch (err) { flash(document.getElementById("msg"), err.message, "err"); }
        finally { busy(btn, false); }
      })
    );
  }

  // ------------------------------------------------------------ setup / status
  async function viewSetup() {
    setNav("setup");
    const s = await api("status");
    const row = (k, ok) => `<tr><td class="mono">${esc(k)}</td><td>${ok ? '<span class="badge paid">set</span>' : '<span class="badge failed">missing</span>'}</td></tr>`;
    app.innerHTML = `<div class="card"><h1>Setup</h1>
      <table><tbody>${Object.entries(s.checks).filter(([k]) => k !== "live_mode").map(([k, v]) => row(k, v)).join("")}
      <tr><td class="mono">Stripe mode</td><td>${s.checks.STRIPE_SECRET_KEY ? (s.checks.live_mode ? '<span class="badge paid">live</span>' : '<span class="badge sent">test</span>') : "—"}</td></tr>
      <tr><td class="mono">D1 database</td><td>${s.dbOk ? '<span class="badge paid">ok</span>' : '<span class="badge failed">not bound</span>'}</td></tr></tbody></table>
      <h2 style="margin-top:20px">Stripe webhook</h2>
      <p class="small">In Stripe → Developers → Webhooks, add an endpoint for <strong>connected accounts</strong> ("Listen to events on Connected accounts") pointing at:</p>
      <p class="mono">${esc(s.webhook_url)}</p>
      <p class="small">Events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, payment_intent.payment_failed, charge.refunded, charge.dispute.created. Put the signing secret in STRIPE_WEBHOOK_SECRET.</p>
      <h2 style="margin-top:20px">Payment reminders</h2>
      <p class="small">Unpaid invoices get a reminder email at 7, 14, 21 and 28 days after sending, with an alert to info@dominicbowkett.com each time; after the fourth the invoice is flagged for further action. A scheduled Worker runs this every morning. <button class="btn secondary small" id="run-reminders">Run now</button> <button class="btn secondary small" id="dry-reminders">Preview (dry run)</button></p>
      <pre id="reminders-out" class="small mono" style="white-space:pre-wrap"></pre>
      <h2 style="margin-top:20px">Counts</h2>
      <table><tbody>${Object.entries(s.counts).map(([k, v]) => `<tr><td>${badge(k)}</td><td>${v.n}</td><td class="num">${gbp(v.total)}</td></tr>`).join("") || "<tr><td class='muted'>No invoices yet</td></tr>"}</tbody></table>
    </div>`;
    for (const [id, dry] of [["run-reminders", false], ["dry-reminders", true]]) {
      document.getElementById(id).addEventListener("click", async (e) => {
        if (!dry && !confirm("Send any reminders that are due right now?")) return;
        busy(e.target, true);
        try { const r = await api("reminders", { method: "POST", body: { dry_run: dry } }); document.getElementById("reminders-out").textContent = `${dry ? "Would send" : "Sent"}: ${r.sent.length ? r.sent.map((x) => `${x.number} (reminder ${x.reminder}, ${x.days} days${x.final ? ", final" : ""})`).join("; ") : "nothing due"}. Checked ${r.checked} unpaid invoice(s).`; }
        catch (err) { document.getElementById("reminders-out").textContent = err.message; }
        finally { busy(e.target, false); }
      });
    }
  }

  async function route() {
    const h = location.hash.replace(/^#/, "") || "invoices";
    try {
      if (h === "invoices") await viewInvoices();
      else if (h === "new") await viewForm();
      else if (h.startsWith("edit/")) await viewForm(h.slice(5));
      else if (h.startsWith("inv/")) await viewInvoice(h.slice(4));
      else if (h === "partners") await viewPartners();
      else if (h === "setup") await viewSetup();
      else await viewInvoices();
    } catch (err) {
      app.innerHTML = `<div class="card"><p class="msg err">${esc(err.message)}</p><p><a href="#setup">Check setup</a></p></div>`;
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
