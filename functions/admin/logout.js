// POST /admin/logout
import { clearCookie } from "../_shared/auth.js";

export async function onRequestPost() {
  return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": clearCookie() } });
}
