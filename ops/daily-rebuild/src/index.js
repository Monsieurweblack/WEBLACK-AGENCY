/**
 * weblack-daily-rebuild — reconstruit weblack.fr une fois par jour.
 *
 * Le site est généré statiquement : tout ce qui dépend de la date (Agenda
 * « à venir / en cours / archive », éléments datés de l'accueil) n'est
 * recalculé qu'à la construction. Sans publication Sanity ni commit, rien
 * ne déclenche de construction et ces états vieillissent (constaté le
 * 2026-11-23 : 3 événements terminés affichés « en cours » après 13 jours).
 *
 * Ce worker n'a qu'un rôle : appeler, chaque matin, le deploy hook
 * Cloudflare Pages dédié « daily-rebuild » (branche main). Cloudflare
 * reconstruit alors le dernier commit de production avec le contenu
 * Sanity publié du moment — aucun second pipeline, aucun code déployé.
 *
 * - Aucune route publique (workers_dev = false, pas de gestionnaire fetch).
 * - L'URL du deploy hook est un secret du worker (DEPLOY_HOOK_URL), jamais
 *   dans le code, jamais journalisée : seul le statut HTTP l'est.
 */
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(trigger(env));
  },
};

async function trigger(env) {
  if (!env.DEPLOY_HOOK_URL) {
    console.error("daily-rebuild: secret DEPLOY_HOOK_URL absent — aucune construction déclenchée");
    return;
  }
  const response = await fetch(env.DEPLOY_HOOK_URL, { method: "POST" });
  const body = await response.json().catch(() => null);
  if (response.ok && body?.success) console.log(`daily-rebuild: construction demandée (HTTP ${response.status})`);
  else console.error(`daily-rebuild: échec (HTTP ${response.status})`);
}
