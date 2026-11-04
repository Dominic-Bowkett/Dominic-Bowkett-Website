// /api/voice/* — Twilio's side of calling from the jobs board (see functions/_shared/voice.js).
//   POST /api/voice/twiml            the browser started a call: dial the number saved on its timeline entry
//   POST /api/voice/done?mid=        the dial ended: answered (with its length), no answer, engaged or failed
//   POST /api/voice/recording?mid=   the recording is ready: kept, transcribed and summarised onto the job
//   POST /api/voice/status           the browser's call ended (TwiML app status callback): hung up before an answer
// Every request must carry a valid X-Twilio-Signature (signed with TWILIO_AUTH_TOKEN).
import { fromTwilio, dialTwiml, dialDone, callEnded, saveRecording, twiml } from "../../_shared/voice.js";

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  const path = [].concat(params.path || []).join("/");
  const form = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
  if (!(await fromTwilio(request, env, form))) return new Response("Forbidden", { status: 403 });
  if (form.AccountSid && form.AccountSid !== env.TWILIO_ACCOUNT_SID) return new Response("Forbidden", { status: 403 });
  const mid = new URL(request.url).searchParams.get("mid");
  try {
    if (path === "twiml") return await dialTwiml(env, form);
    if (path === "done") { await dialDone(env, mid, form); return twiml("<Hangup/>"); }
    if (path === "status") { await callEnded(env, form); return new Response("", { status: 204 }); }
    if (path === "recording") {
      if (form.RecordingStatus === "completed" && form.RecordingSid) {
        /* transcribing takes a while: answer Twilio now and carry on afterwards */
        ctx.waitUntil(saveRecording(env, { mid, sid: form.RecordingSid, url: form.RecordingUrl, secs: Number(form.RecordingDuration || 0) })
          .catch((e) => console.log("recording failed", String(e))));
      }
      return new Response("", { status: 204 });
    }
  } catch (e) {
    console.error("voice hook", path, e);
    if (path === "twiml") return twiml(`<Say voice="Polly.Amy">Sorry, something went wrong placing that call.</Say><Hangup/>`);
    return new Response("error", { status: 500 });
  }
  return new Response("Not found", { status: 404 });
}
