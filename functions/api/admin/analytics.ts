/**
 * Administration — audience GA4 (lecture seule, données agrégées).
 * Séparée des indicateurs CRM (/api/admin/metrics) : autre source, autre
 * nature (mesure d'audience échantillonnable et soumise au consentement,
 * pas un registre). Tant que l'accès n'est pas configuré, la réponse le dit
 * — aucun chiffre n'est jamais simulé.
 */
import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { fetchAudience, ga4Configured, Ga4Error, type Ga4Env } from "../../lib/ga4.ts";

interface Env extends Ga4Env {
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  if (!ga4Configured(env)) return json({ ok: true, configured: false }, 200);
  try {
    const report = await fetchAudience(env);
    return json({ ok: true, configured: true, fetchedAt: new Date().toISOString(), source: "Google Analytics 4 (Data API)", report }, 200);
  } catch (error) {
    // Code technique seulement : jamais le corps de réponse de Google ni la clé.
    return json({ ok: false, configured: true, reason: error instanceof Ga4Error ? error.code : "internal" }, 502);
  }
};
