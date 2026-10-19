import { json } from "../../lib/json.ts";
import { requireAdmin, UUID_RE } from "../../lib/adminSession.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { DriveClient, DriveError, driveConfigured } from "../../lib/googleDrive.ts";
import { MAX_DRIVE_ATTEMPTS, syncDrive, type DriveSyncEnv } from "../../lib/driveSync.ts";

interface Env extends DriveSyncEnv {
  ADMIN_SESSION_SECRET?: string;
}

/**
 * État de l'archivage Google Drive pour l'administration — authentification
 * vérifiée côté serveur à chaque appel. `?check=1` teste réellement la
 * connexion (renouvellement du jeton + requête Drive) sans rien écrire.
 * Jamais de jeton, d'identifiant client ni de nom de candidat dans la réponse.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT status, last_error, COUNT(*) AS count, MAX(last_synced_at) AS last_synced_at FROM drive_sync GROUP BY status, last_error ORDER BY status`,
  ).all();

  let connection: { ok: boolean; code?: string } | undefined;
  if (new URL(request.url).searchParams.get("check") === "1" && driveConfigured(env)) {
    try {
      await new DriveClient(env).findByProperty("weblackPath", "root");
      connection = { ok: true };
    } catch (error) {
      connection = { ok: false, code: error instanceof DriveError ? error.code : "internal" };
    }
  }

  return json({ ok: true, configured: driveConfigured(env), maxAttempts: MAX_DRIVE_ATTEMPTS, summary: results ?? [], connection }, 200);
};

/** Relance manuelle : tous les dossiers en attente/en échec, ou un seul (`{"applicationId": "<uuid>"}`). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const rate = await checkRateLimit(env.PHOTOS, request, "admin-drive-retry", 30, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  let applicationId: string | undefined;
  const text = await request.text();
  if (text) {
    try {
      const body = JSON.parse(text) as { applicationId?: unknown };
      if (body.applicationId !== undefined) {
        if (typeof body.applicationId !== "string" || !UUID_RE.test(body.applicationId)) return json({ ok: false, reason: "invalid_id" }, 400);
        applicationId = body.applicationId;
      }
    } catch {
      return json({ ok: false, reason: "invalid" }, 400);
    }
  }

  const outcomes = await syncDrive(env, { force: true, limit: applicationId ? 1 : 3, applicationIds: applicationId ? [applicationId] : undefined });
  const counts: Record<string, number> = {};
  for (const outcome of Object.values(outcomes)) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return json({ ok: true, processed: Object.keys(outcomes).length, outcomes: counts }, 200);
};
