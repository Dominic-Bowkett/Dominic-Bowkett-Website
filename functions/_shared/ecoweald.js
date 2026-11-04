// Ecoweald households (Town and Country tenants on Dom's retrofit round). Ecoweald rings them from the same office
// number as the jobs board (+44 7476 394125), so when they ring or text back they are Ecoweald's, not job board
// customers: never filed as a job, never sent the jobs board's texts. Read only, from Ecoweald's D1 (binding EW_DB).
// The phone agent Worker (ecoweald-call-agent) makes the same check before texting or filing a call.
const ukDigits = (n) => {
  let d = String(n || "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 12) d = "0" + d.slice(2);
  return d;
};

let cache = null; // { at, nums: Map(digits -> household) } for a minute per isolate
async function households(env) {
  if (!env.EW_DB) return new Map();
  if (cache && Date.now() - cache.at < 60000) return cache.nums;
  const nums = new Map();
  try {
    const { results } = await env.EW_DB.prepare("SELECT tenant, address, postcode, phones FROM properties WHERE phones IS NOT NULL AND phones != '[]'").all();
    for (const p of results || []) {
      let list = [];
      try { list = JSON.parse(p.phones || "[]"); } catch { list = []; }
      for (const n of list) { const d = ukDigits(n); if (d.length >= 9) nums.set(d, p); }
    }
  } catch (e) {
    console.log("ecoweald lookup failed", String(e));
    return new Map();
  }
  cache = { at: Date.now(), nums };
  return nums;
}

/* the household with this number, or null */
export async function ecowealdHousehold(env, number) {
  const d = ukDigits(number);
  return d.length >= 9 ? (await households(env)).get(d) || null : null;
}
