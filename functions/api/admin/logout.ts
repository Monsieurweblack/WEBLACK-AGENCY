import { json } from "../../lib/json.ts";
import { clearSessionCookie, revokeAdminSession } from "../../lib/adminSession.ts";

interface Env {
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

/** Ferme la session côté navigateur ET côté serveur : le jeton est révoqué, pas seulement effacé du cookie. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.ADMIN_SESSION_SECRET && env.PHOTOS) {
    try {
      await revokeAdminSession(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
    } catch {
      // KV indisponible : le cookie est tout de même effacé ci-dessous.
    }
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
};
