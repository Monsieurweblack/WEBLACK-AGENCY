/**
 * Espace membre — échange d'un lien de connexion contre une session.
 * Le jeton arrive en POST (lu dans le fragment d'URL par la page), est
 * consommé une seule fois, et seulement s'il n'a pas expiré.
 */
import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { audit } from "../../lib/audit.ts";
import { contactKey } from "../../lib/contacts.ts";
import { consumeLoginToken, createSession, sameOrigin, type MemberEnv } from "../../lib/member.ts";

interface Env extends MemberEnv {
  PHOTOS: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.PHOTOS || !env.ADMIN_SESSION_SECRET) return json({ ok: false, reason: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const rate = await checkRateLimit(env.PHOTOS, request, "member-verify", 20, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  let body: { token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const email = typeof body.token === "string" ? await consumeLoginToken(env.DB, body.token) : null;
  if (!email) return json({ ok: false, reason: "invalid_or_expired" }, 401);

  // La personne a pu être effacée entre la demande du lien et son usage.
  const known = await env.DB.prepare(`SELECT COUNT(*) AS n FROM applications WHERE lower(email) = ?`).bind(email).first<{ n: number }>();
  if (!known?.n) return json({ ok: false, reason: "invalid_or_expired" }, 401);

  const cookie = await createSession(env, email);
  await audit(env.DB, "member.login", "contact", await contactKey(email));
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
};
