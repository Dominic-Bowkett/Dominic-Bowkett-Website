// On-site survey capture (admin only): a property plan with tappable windows, doors, rooms and evidence pins.
// Tables live in the same D1 database as invoicing (env.DB); photos go to R2 (env.SURVEY_FILES).
// A property's plan (floors, rooms, seeded openings, evidence checklist) is a JSON document in survey_properties.plan_json,
// loaded by a seed script. Everything recorded on site is a survey_records row keyed by (property_id, ref).

export const SURVEY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS survey_properties (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    address TEXT,
    visit TEXT,
    plan_json TEXT NOT NULL,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS survey_records (
    property_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    kind TEXT NOT NULL,
    floor TEXT,
    x REAL,
    y REAL,
    data_json TEXT NOT NULL DEFAULT '{}',
    deleted INTEGER DEFAULT 0,
    client_ts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (property_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS survey_photos (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    content_type TEXT,
    bytes INTEGER,
    file_name TEXT,
    deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS survey_photos_prop ON survey_photos(property_id, ref)`,
];

let ready = null;
export async function surveyDb(env) {
  if (!env.DB) throw new Error("DB (D1) binding is not configured");
  if (!ready) {
    ready = env.DB.batch(SURVEY_SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
      ready = null;
      throw e;
    });
  }
  await ready;
  return env.DB;
}

export const REF_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export const PHOTO_ID_RE = /^[a-z0-9-]{8,48}$/;
export const KINDS = new Set(["window", "door", "room", "evidence", "check"]);

export function recordOut(r) {
  let data = {};
  try { data = JSON.parse(r.data_json || "{}"); } catch { data = {}; }
  return { ref: r.ref, kind: r.kind, floor: r.floor, x: r.x, y: r.y, data, deleted: !!r.deleted, client_ts: r.client_ts, updated_at: r.updated_at };
}

export function photoOut(p) {
  return { id: p.id, ref: p.ref, content_type: p.content_type, bytes: p.bytes, file_name: p.file_name, created_at: p.created_at };
}
