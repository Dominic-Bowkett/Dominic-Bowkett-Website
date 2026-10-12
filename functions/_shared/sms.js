// Outbound SMS from the office number, relayed through the ecoweald-call-agent Worker (which holds the Twilio keys).
// Secrets: RELAY_SECRET (shared). Var: SMS_RELAY_URL (defaults to the Worker's /send-sms).

export function e164(n) {
  let s = String(n || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("0")) return "+44" + s.slice(1);
  if (s.startsWith("44")) return "+" + s;
  return "+" + s;
}

export async function sendSms(env, to, body) {
  const url = env.SMS_RELAY_URL || "https://ecoweald-call-agent.silent-star-877f.workers.dev/send-sms";
  if (!env.RELAY_SECRET) throw new Error("RELAY_SECRET is not configured");
  const dest = e164(to);
  if (!/^\+44\d{10}$/.test(dest)) throw new Error(`Not a UK mobile: ${to}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-key": env.RELAY_SECRET },
    body: JSON.stringify({ to: dest, body: String(body).slice(0, 600) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`SMS failed: ${j.error || `HTTP ${res.status}`}`);
  return j.sid;
}
