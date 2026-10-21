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
    contact_name TEXT,
    coverage_postcode TEXT,
    coverage_lat REAL,
    coverage_lng REAL,
    commission_pct REAL DEFAULT 10,
    registered_at TEXT,
    dispatch_mode TEXT DEFAULT 'hold',
    services TEXT,
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
    reminders_sent INTEGER DEFAULT 0,
    last_reminder_at TEXT,
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
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    ref TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'new',
    source TEXT,
    source_ref TEXT,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    property_address TEXT,
    postcode TEXT,
    lat REAL,
    lng REAL,
    service TEXT,
    details TEXT,
    requested_times TEXT,
    internal_notes TEXT,
    raw_text TEXT,
    partner_account_id TEXT,
    offered_at TEXT,
    responded_at TEXT,
    partner_response TEXT,
    booked_date TEXT,
    booked_time TEXT,
    booked_at TEXT,
    booked_by TEXT,
    price_pence INTEGER,
    invoice_id TEXT,
    ack_sent_at TEXT,
    checking_sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_activity_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, last_activity_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_partner ON jobs(partner_account_id, status)`,
  `CREATE INDEX IF NOT EXISTS jobs_phone ON jobs(customer_phone)`,
  `CREATE TABLE IF NOT EXISTS job_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    at TEXT DEFAULT (datetime('now')),
    direction TEXT,
    channel TEXT,
    party TEXT,
    counterpart TEXT,
    subject TEXT,
    body TEXT,
    provider_id TEXT,
    meta TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS job_messages_job ON job_messages(job_id, id)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    due_date TEXT,
    job_id TEXT,
    done_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_open ON tasks(done_at, due_date)`,
  `CREATE INDEX IF NOT EXISTS tasks_job ON tasks(job_id)`,
  `CREATE TABLE IF NOT EXISTS partner_signups (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    business_name TEXT,
    contact_name TEXT,
    phone TEXT,
    coverage_postcode TEXT,
    services TEXT,
    expires_at TEXT,
    completed_at TEXT,
    stripe_account_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS partner_users (
    id TEXT PRIMARY KEY,
    stripe_account_id TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT,
    password_hash TEXT,
    invite_token TEXT,
    invite_expires TEXT,
    activated_at TEXT,
    last_login_at TEXT,
    disabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS partner_users_acct ON partner_users(stripe_account_id)`,
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
  `ALTER TABLE invoices ADD COLUMN reminders_sent INTEGER DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN last_reminder_at TEXT`,
  `ALTER TABLE partners ADD COLUMN contact_name TEXT`,
  `ALTER TABLE partners ADD COLUMN coverage_postcode TEXT`,
  `ALTER TABLE partners ADD COLUMN coverage_lat REAL`,
  `ALTER TABLE partners ADD COLUMN coverage_lng REAL`,
  `ALTER TABLE partners ADD COLUMN commission_pct REAL DEFAULT 10`,
  `ALTER TABLE partners ADD COLUMN registered_at TEXT`,
  `ALTER TABLE partners ADD COLUMN dispatch_mode TEXT DEFAULT 'hold'`,
  `ALTER TABLE partners ADD COLUMN services TEXT`,
  `ALTER TABLE partner_signups ADD COLUMN services TEXT`,
  `ALTER TABLE jobs ADD COLUMN ack_sent_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN checking_sent_at TEXT`,
  // partner quotes (16 Oct 2026): the partner quotes a price, the customer accepts by link or by replying YES
  `ALTER TABLE jobs ADD COLUMN quote_pence INTEGER`,
  `ALTER TABLE jobs ADD COLUMN quote_message TEXT`,
  `ALTER TABLE jobs ADD COLUMN quote_token TEXT`,
  `ALTER TABLE jobs ADD COLUMN quote_sent_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN quote_accepted_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN quote_declined_at TEXT`,
  // per-partner auto-dispatch radius (21 Oct 2026); null = the default 25 miles
  `ALTER TABLE partners ADD COLUMN dispatch_radius_miles REAL`,
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
