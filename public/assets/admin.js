/* Invoicing admin — vanilla JS, talks to /api/admin/*. Served only behind the admin login. */
(() => {
  const app = document.getElementById("app");
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
          <td class="num">${gbp(i.amount_pence)}</td><td class="num">${gbp(i.application_fee_pence)}</td><td>${badge(i.status)}${i.last_error ? `<br/><span class="small" style="color:#8a2a2a">${esc(i.last_error)}</span>` : ""}</td></tr>`).join("")}
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
            ${ps.map((p) => `<option value="${esc(p.stripe_account_id)}" ${inv?.partner_account_id === p.stripe_account_id ? "selected" : ""} ${p.charges_enabled ? "" : "disabled"}>${esc(pname(p))}${p.charges_enabled ? "" : " (cannot take payments yet)"}</option>`).join("")}</select>
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
          <label>Service</label><input name="service_name" required value="${v("service_name")}" placeholder="Domestic EPC" />
          <label>Description (optional, shown on the invoice)</label><textarea name="description">${v("description")}</textarea>
          <label>Amount charged to the client (£)</label><input name="amount" inputmode="decimal" required value="${inv ? (inv.amount_pence / 100).toFixed(2) : ""}" placeholder="100.00" />
          <div class="check"><input type="checkbox" name="client_vat_inclusive" id="cvat" ${inv?.client_vat_rate ? "checked" : ""} /><label for="cvat" style="margin:0;text-transform:none;letter-spacing:0">Amount includes VAT at 20% (partner is VAT registered)</label></div>
          <label>Your platform fee, inc VAT (£)</label><input name="fee" inputmode="decimal" value="${inv ? (inv.application_fee_pence / 100).toFixed(2) : ""}" placeholder="10.00" />
          <label>Due date (optional)</label><input name="due_date" type="date" value="${v("due_date")}" />
          <div class="totals" id="totals"></div>
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" type="submit" data-send="0">${inv ? "Save draft" : "Save as draft"}</button>
        <button class="btn" type="submit" data-send="1">${inv ? "Save & send" : "Save & send to client"}</button>
        ${inv ? `<a class="btn secondary" href="#inv/${inv.id}">Cancel</a>` : ""}
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
    form.addEventListener("input", recalc); recalc();
    document.getElementById("is-biz").addEventListener("change", (e) => (document.getElementById("biz-fields").style.display = e.target.checked ? "block" : "none"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter; const send = btn?.dataset.send === "1";
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      body.client_vat_inclusive = form.client_vat_inclusive.checked;
      if (!document.getElementById("is-biz").checked) { body.bill_to_business = ""; body.bill_to_address = ""; }
      if (send && !confirm(`Send invoice for ${gbp(Math.round(parseFloat(body.amount || "0") * 100))} to ${body.client_email}?`)) return;
      busy(btn, true);
      try {
        let r;
        if (inv) { r = await api("invoices/" + inv.id, { method: "PUT", body }); if (send) r = await api(`invoices/${inv.id}/send`, { method: "POST" }); }
        else r = await api("invoices", { method: "POST", body: { ...body, send } });
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
    if (i.status === "draft") actions = `<a class="btn secondary" href="#edit/${i.id}">Edit</a>${act("Send to client", "send", "", `Send ${i.number} for ${gbp(i.amount_pence)} to ${i.client_email}?`)}${act("Void", "void", "danger", "Void this draft?")}`;
    else if (i.status === "sent" || i.status === "failed") actions = `${act("Resend invoice email", "resend", "secondary", `Resend ${i.number} to ${i.client_email}?`)}${act("Check Stripe status", "reconcile")}${act("Void invoice", "void", "danger", "Void this invoice? The pay link will stop working.")}`;
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
          <dt>Partner</dt><dd>${esc(i.partner_name)} <span class="mono muted">${esc(i.partner_account_id)}</span></dd>
          <dt>Issued / due</dt><dd>${day(i.issued_at)}${i.due_date ? ` / due ${day(i.due_date)}` : ""}</dd>
          ${i.sent_at ? `<dt>Sent</dt><dd>${when(i.sent_at)}</dd>` : ""}
          ${i.paid_at ? `<dt>Paid</dt><dd>${when(i.paid_at)}${i.payment_method ? ` · ${esc(i.payment_method)}` : ""}</dd>` : ""}
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
  async function viewPartners() {
    setNav("partners");
    const ps = await getPartners();
    app.innerHTML = `<div class="card"><div class="toolbar"><h1 style="margin:0">Connected accounts</h1><button class="btn secondary small" id="sync">Sync from Stripe</button></div><div id="msg"></div>
      <p class="muted small">Pulled from your Stripe Connect platform. Edit the invoice details here: the supplier name and address printed on client invoices, where the partner's copies and fee invoices go, and their VAT number (shown when an invoice is marked VAT-inclusive).</p>
      ${ps.map((p) => `<details style="border-top:1px solid var(--rule);padding:10px 0"><summary style="cursor:pointer"><strong>${esc(pname(p))}</strong> <span class="mono muted small">${esc(p.stripe_account_id)}</span> · ${p.charges_enabled ? '<span class="badge paid">can take payments</span>' : '<span class="badge failed">cannot take payments yet</span>'} <span class="muted small">${esc(p.account_type || "")}${p.fees_payer ? ` · Stripe fees paid by ${p.fees_payer === "account" ? "the partner" : p.fees_payer}` : ""}</span></summary>
        <form data-id="${esc(p.stripe_account_id)}" class="grid" style="margin-top:8px">
          <div><label>Display name (on invoices)</label><input name="display_name" value="${esc(p.display_name || "")}" placeholder="${esc(p.business_name || "")}" />
          <label>Invoice / copy email</label><input name="invoice_email" type="email" value="${esc(p.invoice_email || "")}" placeholder="${esc(p.email || "")}" />
          <label>Phone</label><input name="phone" value="${esc(p.phone || "")}" />
          <div class="check"><input type="checkbox" name="copy_invoices" id="cp-${esc(p.stripe_account_id)}" ${p.copy_invoices ? "checked" : ""} /><label for="cp-${esc(p.stripe_account_id)}" style="margin:0;text-transform:none;letter-spacing:0">Email them a copy of each invoice sent</label></div></div>
          <div><label>Address (on invoices)</label><textarea name="address">${esc(p.address || "")}</textarea>
          <label>VAT number</label><input name="vat_number" value="${esc(p.vat_number || "")}" />
          <label>Notes</label><textarea name="notes">${esc(p.notes || "")}</textarea>
          <p><button class="btn small" type="submit">Save</button></p></div>
        </form></details>`).join("") || "<p class='muted'>No connected accounts found. Check STRIPE_SECRET_KEY, then sync.</p>"}</div>`;
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
      <h2 style="margin-top:20px">Counts</h2>
      <table><tbody>${Object.entries(s.counts).map(([k, v]) => `<tr><td>${badge(k)}</td><td>${v.n}</td><td class="num">${gbp(v.total)}</td></tr>`).join("") || "<tr><td class='muted'>No invoices yet</td></tr>"}</tbody></table>
    </div>`;
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
