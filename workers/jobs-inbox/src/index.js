// Email Worker: parses mail sent to in@jobs.dominicbowkett.com and hands it to the site's /api/inbound/email.
import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await new PostalMime().parse(raw);
    const payload = {
      from: parsed.from?.address || message.from,
      fromName: parsed.from?.name || "",
      to: message.to,
      subject: parsed.subject || "",
      text: parsed.text || "",
      html: parsed.text ? "" : (parsed.html || "").slice(0, 200000),
      messageId: parsed.messageId || message.headers.get("message-id") || "",
      inReplyTo: parsed.inReplyTo || "",
      attachments: (parsed.attachments || []).map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.content?.byteLength || 0 })),
    };
    const res = await fetch(env.TARGET_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-key": env.RELAY_SECRET },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log(`inbound email from ${payload.from} "${payload.subject}" -> HTTP ${res.status} ${text.slice(0, 300)}`);
    if (!res.ok) {
      // Make the failure visible: bounce back to the sender with the reason (Dom is the usual sender).
      message.setReject(`Could not file this email as a job (HTTP ${res.status}). Please try again later.`);
    }
  },
  async fetch() {
    return new Response("dbk-jobs-inbox", { status: 200 });
  },
};
