// Dom's to-do list: free-standing tasks or tasks attached to a job. Due-today digest goes out with the daily cron.
import { db, randomToken } from "./db.js";
import { sendViaResend, OWNER_TO } from "./email.js";

export class TaskError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const clean = (s, max) => String(s ?? "").trim().slice(0, max) || null;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD

export async function listTasks(env, { status = "open", job } = {}) {
  const d = await db(env);
  const where = [], binds = [];
  if (status === "open") where.push("t.done_at IS NULL");
  else if (status === "done") where.push("t.done_at IS NOT NULL");
  if (job) { where.push("t.job_id = ?"); binds.push(job); }
  const order = status === "done" ? "t.done_at DESC" : "CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.created_at";
  const r = await d
    .prepare(`SELECT t.*, j.ref AS job_ref, j.customer_name AS job_customer, j.property_address AS job_address
              FROM tasks t LEFT JOIN jobs j ON j.id = t.job_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT 500`)
    .bind(...binds)
    .all();
  return r.results || [];
}

export async function createTask(env, { title, due_date, job_id, notes }) {
  title = clean(title, 300);
  if (!title) throw new TaskError("Say what the task is");
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw new TaskError("Due date must be a date");
  const d = await db(env);
  if (job_id && !(await d.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(job_id).first())) throw new TaskError("That job doesn't exist");
  const id = randomToken(10);
  await d.prepare(`INSERT INTO tasks (id, title, due_date, job_id, notes) VALUES (?, ?, ?, ?, ?)`).bind(id, title, due_date || null, job_id || null, clean(notes, 2000)).run();
  if (job_id) await d.prepare(`INSERT INTO job_messages (job_id, direction, channel, party, body) VALUES (?, 'in', 'note', 'admin', ?)`).bind(job_id, `Task added: ${title}${due_date ? ` (due ${due_date})` : ""}`).run();
  return d.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
}

export async function updateTask(env, id, fields) {
  const d = await db(env);
  const t = await d.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  if (!t) throw new TaskError("Task not found", 404);
  const set = {};
  if ("title" in fields) { set.title = clean(fields.title, 300); if (!set.title) throw new TaskError("Task can't be empty"); }
  if ("due_date" in fields) { if (fields.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.due_date)) throw new TaskError("Due date must be a date"); set.due_date = fields.due_date || null; }
  if ("notes" in fields) set.notes = clean(fields.notes, 2000);
  if ("done" in fields) set.done_at = fields.done ? new Date().toISOString() : null;
  const keys = Object.keys(set);
  if (keys.length) await d.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...keys.map((k) => set[k]), id).run();
  if ("done" in fields && fields.done && t.job_id) await d.prepare(`INSERT INTO job_messages (job_id, direction, channel, party, body) VALUES (?, 'in', 'note', 'admin', ?)`).bind(t.job_id, `Task done: ${t.title}`).run();
  return d.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
}

export async function deleteTask(env, id) {
  const d = await db(env);
  await d.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id).run();
}

// One plain-text email a day listing overdue and due-today tasks. Safe to call more than once a day.
export async function taskDigest(env, origin, { force = false } = {}) {
  const d = await db(env);
  const day = today();
  if (!force) {
    const last = await d.prepare(`SELECT value FROM counters WHERE name = 'task_digest_day'`).first();
    if (last && String(last.value) === day.replace(/-/g, "")) return { sent: false, reason: "already sent today" };
  }
  const due = (await d.prepare(`SELECT t.*, j.ref AS job_ref, j.customer_name AS job_customer FROM tasks t LEFT JOIN jobs j ON j.id = t.job_id WHERE t.done_at IS NULL AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY t.due_date`).bind(day).all()).results || [];
  await d.prepare(`INSERT INTO counters(name, value) VALUES ('task_digest_day', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`).bind(Number(day.replace(/-/g, ""))).run();
  if (!due.length) return { sent: false, reason: "nothing due" };
  const line = (t) => `- ${t.title}${t.due_date < day ? ` (overdue, was due ${t.due_date})` : ""}${t.job_ref ? ` [${t.job_ref}${t.job_customer ? `, ${t.job_customer}` : ""}]` : ""}`;
  const text = `Tasks due today: ${due.length}\n\n${due.map(line).join("\n")}\n\nTick them off: ${origin}/admin#tasks\n`;
  await sendViaResend(env, { to: OWNER_TO, subject: `Tasks for today (${due.length})`, text });
  return { sent: true, count: due.length };
}
