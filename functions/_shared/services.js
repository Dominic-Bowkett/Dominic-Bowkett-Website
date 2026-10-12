// The services a partner can offer. Keep in step with SERVICES in public/assets/admin.js (the invoice dropdown).
export const PARTNER_SERVICES = [
  "Domestic EPC",
  "Commercial EPC",
  "Retrofit Assessment",
  "Home Insight Survey",
  "HomeBuyer Survey (Level 2)",
  "Building Survey (Level 3)",
  "Drone Roof Survey",
  "Ventilation Assessment",
];

export function parseServices(value) {
  if (!value) return [];
  let list = value;
  if (typeof value === "string") {
    try { list = JSON.parse(value); } catch { list = value.split(/[,\n]/); }
  }
  if (!Array.isArray(list)) return [];
  return PARTNER_SERVICES.filter((s) => list.map((x) => String(x).trim()).includes(s));
}

export function servicesJson(list) {
  return JSON.stringify(parseServices(list));
}

// Does a partner's list cover a job's service name? Loose match so "EPC" or "Domestic EPC — 3 bed" still count.
export function offersService(partnerServices, service) {
  const list = parseServices(partnerServices);
  if (!list.length) return null; // unknown
  const s = String(service || "").toLowerCase();
  return list.some((p) => {
    const q = p.toLowerCase();
    if (q === s) return true;
    if (/epc/.test(s) && /epc/.test(q) && (/commercial/.test(s) === /commercial/.test(q))) return true;
    if (/retrofit/.test(s) && /retrofit/.test(q)) return true;
    if (/level 3|building survey/.test(s) && /level 3/.test(q)) return true;
    if (/level 2|homebuyer/.test(s) && /level 2/.test(q)) return true;
    if (/insight/.test(s) && /insight/.test(q)) return true;
    if (/drone|roof/.test(s) && /drone/.test(q)) return true;
    if (/ventilation/.test(s) && /ventilation/.test(q)) return true;
    return false;
  });
}

export function servicesCheckboxes(selected, { name = "services" } = {}) {
  const sel = new Set(parseServices(selected));
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 12px;margin:6px 0 4px">${PARTNER_SERVICES.map(
    (s) => `<label style="display:flex;align-items:center;gap:8px;margin:0;text-transform:none;letter-spacing:0;font-weight:400;font-size:14px;color:inherit"><input type="checkbox" name="${name}" value="${s}" ${sel.has(s) ? "checked" : ""} style="width:auto" /> ${s}</label>`
  ).join("")}</div>`;
}
