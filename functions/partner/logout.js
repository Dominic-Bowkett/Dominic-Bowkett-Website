// POST /partner/logout
import { clearPartnerCookie } from "../_shared/partner-auth.js";

export async function onRequestPost() {
  return new Response(null, { status: 303, headers: { Location: "/partner?out=1", "Set-Cookie": clearPartnerCookie() } });
}
