/**
 * Tableau de bord de direction — indicateurs calculés sur les données
 * réelles de la base D1, à l'instant de la requête (generatedAt). Aucune
 * estimation n'est présentée comme une mesure : la valeur du pipeline est
 * la somme des estimations saisies par l'équipe, et nommée comme telle.
 * La mesure d'audience (GA4) n'est pas reliée : aucun identifiant d'API.
 */
import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

type Count = { key: string | null; n: number };

/** Délai de la politique de confidentialité pour les candidatures non retenues ou archivées. */
const RETENTION_REVIEW_DAYS = 90;
const AWAITING_REVIEW_DAYS = 7;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const now = new Date();
  const iso = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  const all = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).all<Count>()).results ?? [];
  const one = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number | null }>())?.n ?? 0;

  const [appsByStatus, appsByCategory, appsTotal, apps30, awaitingReview, retentionDue] = await Promise.all([
    all(`SELECT status AS key, COUNT(*) AS n FROM applications GROUP BY status`),
    all(`SELECT talent_category AS key, COUNT(*) AS n FROM applications GROUP BY talent_category`),
    one(`SELECT COUNT(*) AS n FROM applications`),
    one(`SELECT COUNT(*) AS n FROM applications WHERE created_at >= ?`, iso(30)),
    one(`SELECT COUNT(*) AS n FROM applications WHERE status IN ('RECEIVED','REVIEWING') AND created_at < ?`, iso(AWAITING_REVIEW_DAYS)),
    one(`SELECT COUNT(*) AS n FROM applications WHERE status IN ('REJECTED','ARCHIVED') AND updated_at < ?`, iso(RETENTION_REVIEW_DAYS)),
  ]);

  const [leadsByStatus, leadsByDivision, leadsByChannel, leadsTotal, leads30, openValue, wonValue, unnotified] = await Promise.all([
    all(`SELECT status AS key, COUNT(*) AS n FROM business_inquiries GROUP BY status`),
    all(`SELECT division AS key, COUNT(*) AS n FROM business_inquiries GROUP BY division`),
    all(`SELECT channel AS key, COUNT(*) AS n FROM business_inquiries GROUP BY channel ORDER BY n DESC LIMIT 10`),
    one(`SELECT COUNT(*) AS n FROM business_inquiries`),
    one(`SELECT COUNT(*) AS n FROM business_inquiries WHERE created_at >= ?`, iso(30)),
    one(`SELECT SUM(estimated_value) AS n FROM business_inquiries WHERE status NOT IN ('WON','LOST')`),
    one(`SELECT SUM(estimated_value) AS n FROM business_inquiries WHERE status = 'WON'`),
    one(`SELECT COUNT(*) AS n FROM business_inquiries WHERE notify_status != 'sent'`),
  ]);
  const { results: followUps } = await env.DB.prepare(
    `SELECT id, reference, full_name, organisation, status, next_action, next_action_at FROM business_inquiries
     WHERE next_action_at IS NOT NULL AND next_action_at <= ? AND status NOT IN ('WON','LOST') ORDER BY next_action_at LIMIT 50`,
  )
    .bind(today)
    .all();
  const emailIssues = await one(`SELECT COUNT(*) AS n FROM email_outbox WHERE status IN ('failed','pending')`);

  const won = leadsByStatus.find((r) => r.key === "WON")?.n ?? 0;
  const lost = leadsByStatus.find((r) => r.key === "LOST")?.n ?? 0;

  return json(
    {
      ok: true,
      generatedAt: now.toISOString(),
      talent: { total: appsTotal, last30Days: apps30, byStatus: appsByStatus, byCategory: appsByCategory, awaitingReviewOver7Days: awaitingReview, retentionReviewDue: retentionDue },
      business: {
        total: leadsTotal,
        last30Days: leads30,
        byStatus: leadsByStatus,
        byDivision: leadsByDivision,
        byChannel: leadsByChannel,
        // Taux de transformation uniquement sur les demandes conclues (gagnées + perdues), et seulement s'il y en a.
        winRate: won + lost > 0 ? won / (won + lost) : null,
        closed: { won, lost },
        estimatedOpenPipelineEur: openValue,
        estimatedWonEur: wonValue,
        followUpsDue: followUps ?? [],
        unnotified,
      },
      operations: { applicationEmailsPendingOrFailed: emailIssues },
      notConnected: ["Mesure d'audience GA4 (visiteurs, sources) : aucun identifiant d'API configuré — consulter GA4 directement."],
    },
    200,
  );
};
