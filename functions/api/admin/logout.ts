import { json } from "../../lib/json.ts";
import { clearSessionCookie } from "../../lib/adminSession.ts";

export const onRequestPost: PagesFunction = async () => json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
