// Daily trigger for invoice payment reminders. All the logic lives in the Pages Function it calls.
async function run(env) {
  const res = await fetch(env.TARGET_URL, {
    method: "POST",
    headers: { "x-cron-key": env.CRON_SECRET, "content-type": "application/json", "user-agent": "dbk-invoice-reminders" },
    body: "{}",
  });
  const text = await res.text();
  console.log(`reminders run: HTTP ${res.status} ${text.slice(0, 500)}`);
  if (!res.ok) throw new Error(`Reminder run failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // GET /?key=<CRON_SECRET> lets you trigger a run by hand (e.g. to test the schedule end to end).
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.CRON_SECRET) return new Response("dbk-invoice-reminders", { status: 200 });
    try {
      return new Response(await run(env), { headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(e.message, { status: 502 });
    }
  },
};
