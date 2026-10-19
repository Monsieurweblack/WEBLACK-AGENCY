import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { fetchTalentApplicationSettings } from "../../lib/sanity.ts";
import { deliverOutbox, MAX_EMAIL_ATTEMPTS, type OutboxEnv } from "../../lib/talentOutbox.ts";

interface Env extends OutboxEnv {
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
}

/**
 * Suivi des e-mails de candidature pour l'administration : combien sont
 * partis, combien attendent, combien ont échoué — et pourquoi (code
 * technique seulement). Aucune adresse ni nom dans la réponse.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT kind, status, last_error, COUNT(*) AS count FROM email_outbox GROUP BY kind, status, last_error ORDER BY kind, status`,
  ).all();
  return json(
    {
      ok: true,
      configured: Boolean(env.NEWSLETTER_API_KEY && env.RESEND_FROM),
      maxAttempts: MAX_EMAIL_ATTEMPTS,
      summary: results ?? [],
    },
    200,
  );
};

/** Relance manuelle des e-mails en attente ou en échec (sans attendre le délai entre tentatives). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const rate = await checkRateLimit(env.PHOTOS, request, "admin-email-retry", 30, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  const settings = await fetchTalentApplicationSettings(env);
  const report = await deliverOutbox(env, { force: true, limit: 20, sanityNotifyEmail: settings.internalNotificationEmail });
  const counts: Record<string, number> = {};
  for (const outcome of Object.values(report.outcomes)) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return json({ ok: true, processed: Object.keys(report.outcomes).length, outcomes: counts }, 200);
};
