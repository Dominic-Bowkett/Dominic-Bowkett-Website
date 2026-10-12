// Money helpers. All amounts are integer pence.

export function toPence(v) {
  if (v == null || v === "") return NaN;
  const n = Number(String(v).replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function gbp(pence) {
  const neg = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence || 0));
  const pounds = Math.floor(abs / 100);
  const pp = String(abs % 100).padStart(2, "0");
  return `${neg}£${pounds.toLocaleString("en-GB")}.${pp}`;
}

// VAT at `rate` percent on a net amount, rounded to the nearest penny.
export function vatOn(netPence, rate) {
  return Math.round((netPence * rate) / 100);
}

// Split a gross amount that includes VAT at `rate` percent.
export function splitGross(grossPence, rate) {
  if (!rate) return { net: grossPence, vat: 0 };
  const net = Math.round((grossPence * 100) / (100 + rate));
  return { net, vat: grossPence - net };
}

export function computeFees({ amount_pence, fee_net_pence, fee_vat_rate = 20 }) {
  const fee_vat_pence = vatOn(fee_net_pence, fee_vat_rate);
  const application_fee_pence = fee_net_pence + fee_vat_pence;
  return {
    fee_vat_pence,
    application_fee_pence,
    partner_before_stripe_fee: amount_pence - application_fee_pence,
  };
}

// D1 stores datetime('now') as "YYYY-MM-DD HH:MM:SS" (UTC). Also accepts ISO strings and YYYY-MM-DD.
export function fmtDate(value, { withTime = false } = {}) {
  if (!value) return "";
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) d = new Date(value + "T12:00:00Z");
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) d = new Date(value.replace(" ", "T") + "Z");
  else d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const opts = { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("en-GB", opts);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
