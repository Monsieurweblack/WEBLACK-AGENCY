/**
 * Garde-fou d'environnement des écritures publiques (candidature : upload
 * et dépôt).
 *
 * Les previews Cloudflare Pages ont leurs propres D1/KV ([env.preview] de
 * wrangler.toml, APP_ENV = "preview"). Si cette séparation venait à manquer
 * — section ignorée, liaison recopiée par erreur — une preview retomberait
 * sur les liaisons de production (APP_ENV = "production") : on refuse alors
 * toute écriture qui n'arrive pas par le domaine public. Une candidature de
 * test déposée sur une URL *.weblack.pages.dev ne peut ainsi jamais
 * atteindre la base de production.
 *
 * localhost reste permis : `wrangler pages dev` lit les liaisons de premier
 * niveau mais les sert en local (simulation sur disque), jamais distantes.
 */
export interface EnvironmentEnv {
  APP_ENV?: string;
}

const PRODUCTION_HOSTS = new Set(["weblack.fr", "www.weblack.fr"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function writesAllowed(env: EnvironmentEnv, request: Request): boolean {
  if (env.APP_ENV === "preview") return true;
  let host: string;
  try {
    host = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return PRODUCTION_HOSTS.has(host) || LOCAL_HOSTS.has(host);
}
