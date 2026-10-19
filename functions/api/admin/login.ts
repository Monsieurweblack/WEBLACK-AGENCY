import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { createSessionCookie, secretsMatch } from "../../lib/adminSession.ts";

interface Env {
  PHOTOS: KVNamespace;
  /** Choisi par l'équipe WEBLACK, jamais par ce code — voir TALENT_APPLICATION.md. */
  ADMIN_PASSWORD?: string;
  /** Généré une fois à la mise en place, jamais saisi par un humain. */
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Budget volontairement bas : une équipe de quelques personnes ne tape
  // jamais 10 mots de passe faux par heure sur sa propre console.
  const rate = await checkRateLimit(env.PHOTOS, request, "admin-login", 10, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ ok: false, reason: "unconfigured" }, 503);
  }

  let payload: { password?: unknown };
  try {
    payload = (await request.json()) as { password?: unknown };
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const password = typeof payload.password === "string" ? payload.password.slice(0, 512) : "";
  if (!(await secretsMatch(password, env.ADMIN_PASSWORD))) {
    return json({ ok: false, reason: "invalid_credentials" }, 401);
  }

  const cookie = await createSessionCookie(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
};
