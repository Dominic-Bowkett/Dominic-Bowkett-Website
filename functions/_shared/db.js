// D1 access + self-initialising schema for the invoicing system.
// Binding: env.DB (see wrangler.toml [[d1_databases]]).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS partners (
    stripe_account_id TEXT PRIMARY KEY,
    display_name TEXT,
    business_name TEXT,
    email TEXT,
    invoice_email TEXT,
    address TEXT,
    vat_number TEXT,
    phone TEXT,
    charges_enabled INTEGER DEFAULT 0,
    payouts_enabled INTEGER DEFAULT 0,
    account_type TEXT,
    fees_payer TEXT,
    country TEXT,
    default_currency TEXT,
    copy_invoices INTEGER DEFAULT 1,
    hidden INTEGER DEFAULT 0,
    notes TEXT,
    stripe_json TEXT,
    synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    number TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft',
    partner_account_id TEXT NOT NULL,
    partner_snapshot TEXT,
    client_name TEXT,
    client_email TEXT NOT NULL,
    bill_to_business TEXT,
    bill_to_address TEXT,
    property_address TEXT,
    service_name TEXT NOT NULL,
    description TEXT,
    client_message TEXT,
    currency TEXT NOT NULL DEFAULT 'gbp',
    amount_pence INTEGER NOT NULL,
    client_vat_rate INTEGER DEFAULT 0,
    fee_net_pence INTEGER NOT NULL DEFAULT 0,
    fee_vat_rate INTEGER NOT NULL DEFAULT 20,
    fee_vat_pence INTEGER NOT NULL DEFAULT 0,
    application_fee_pence INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    issued_at TEXT,
    sent_at TEXT,
    paid_at TEXT,
    voided_at TEXT,
    stripe_checkout_session_id TEXT,
    stripe_checkout_url TEXT,
    stripe_checkout_expires_at INTEGER,
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,
    stripe_application_fee_id TEXT,
    payment_method TEXT,
    receipt_url TEXT,
    fee_invoice_number TEXT,
    fee_invoice_sent_at TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS invoices_status ON invoices(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS invoices_session ON invoices(stripe_checkout_session_id)`,
  `CREATE TABLE IF NOT EXISTS invoice_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT NOT NULL,
    at TEXT DEFAULT (datetime('now')),
    type TEXT NOT NULL,
    detail TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS invoice_events_inv ON invoice_events(invoice_id, id)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT,
    account TEXT,
    received_at TEXT DEFAULT (datetime('now')),
    outcome TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT,
    at TEXT DEFAULT (datetime('now')),
    kind TEXT,
    to_addr TEXT,
    subject TEXT,
    resend_id TEXT,
    error TEXT
  )`,
];

// Statuses: draft -> sent -> paid | failed | void | refunded

// Additive migrations for tables created by earlier versions. Each is safe to re-run.
const MIGRATIONS = [
  `ALTER TABLE partners ADD COLUMN hidden INTEGER DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN client_message TEXT`,
];
async function migrate(env) {
  for (const sql of MIGRATIONS) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column/i.test(e.message || "")) throw e;
    }
  }
}

let ready = null;
export function ensureSchema(env) {
  if (!env.DB) throw new Error("DB (D1) binding is not configured");
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)))
      .then(() => migrate(env))
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

export async function db(env) {
  await ensureSchema(env);
  return env.DB;
}

export async function nextNumber(env, name, prefix, width = 6) {
  const d = await db(env);
  await d
    .prepare(
      `INSERT INTO counters(name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1`
    )
    .bind(name)
    .run();
  const row = await d.prepare(`SELECT value FROM counters WHERE name = ?`).bind(name).first();
  return `${prefix}${String(row.value).padStart(width, "0")}`;
}

export function randomToken(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function logEvent(env, invoiceId, type, detail) {
  const d = await db(env);
  const text = detail == null ? null : typeof detail === "string" ? detail : JSON.stringify(detail);
  await d.prepare(`INSERT INTO invoice_events(invoice_id, type, detail) VALUES (?, ?, ?)`).bind(invoiceId, type, text).run();
}

export async function logEmail(env, { invoice_id, kind, to, subject, resend_id, error }) {
  const d = await db(env);
  await d
    .prepare(`INSERT INTO email_log(invoice_id, kind, to_addr, subject, resend_id, error) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(invoice_id || null, kind, Array.isArray(to) ? to.join(", ") : to, subject, resend_id || null, error || null)
    .run();
}

export async function getInvoice(env, id) {
  const d = await db(env);
  return d.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
}

export async function getPartner(env, accountId) {
  const d = await db(env);
  return d.prepare(`SELECT * FROM partners WHERE stripe_account_id = ?`).bind(accountId).first();
}

export async function updateInvoice(env, id, fields) {
  const d = await db(env);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  await d
    .prepare(`UPDATE invoices SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), id)
    .run();
}
