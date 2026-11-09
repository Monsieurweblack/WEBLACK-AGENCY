import { json } from "../../../lib/json.ts";
import { requireAdmin, UUID_RE } from "../../../lib/adminSession.ts";
import { APPLICATION_STATUSES, type ApplicationRecord } from "../../../lib/applicationTypes.ts";
import { auditStatement } from "../../../lib/audit.ts";
import { deleteApplicationRecord } from "../../../lib/erasure.ts";
import { folderUrl, type DriveEnv } from "../../../lib/googleDrive.ts";

interface Env extends DriveEnv {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

interface PhotoRow {
  id: string;
  role: string;
  content_type: string;
}

/** Identifiant de dossier : un UUID, rien d'autre — refusé avant toute requête D1. */
function applicationId(params: Record<string, string | string[]>): string | undefined {
  const id = params.id;
  return typeof id === "string" && UUID_RE.test(id) ? id : undefined;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const id = applicationId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);
  const application = await env.DB.prepare(`SELECT * FROM applications WHERE id = ?`).bind(id).first<ApplicationRecord>();
  if (!application) return json({ ok: false, reason: "not_found" }, 404);

  const { results: photos } = await env.DB.prepare(
    `SELECT id, role, content_type FROM application_photos WHERE application_id = ? ORDER BY role`,
  )
    .bind(id)
    .all<PhotoRow>();

  // Jamais l'URL KV ni une URL publique : seulement le chemin de l'API
  // admin, qui revérifie la session à chaque appel (voir photo/[photoId].ts).
  const photoUrls = (photos ?? []).map((p) => ({ role: p.role, url: `/api/admin/photo/${p.id}`, contentType: p.content_type }));

  // État des e-mails de ce dossier : « enregistré » et « e-mail envoyé »
  // sont deux faits distincts, l'équipe doit voir les deux.
  const { results: emails } = await env.DB.prepare(
    `SELECT kind, status, attempts, last_error, sent_at FROM email_outbox WHERE application_id = ? ORDER BY kind`,
  )
    .bind(id)
    .all();

  // Archivage Drive : le lien du dossier n'existe que dans cette réponse
  // authentifiée — jamais dans une page publique ni dans le formulaire.
  const drive = await env.DB.prepare(
    `SELECT status, attempts, last_error, last_synced_at, folder_id, (SELECT COUNT(*) FROM drive_files f WHERE f.application_id = s.application_id) AS files
     FROM drive_sync s WHERE application_id = ?`,
  )
    .bind(id)
    .first<{ status: string; attempts: number; last_error: string | null; last_synced_at: string | null; folder_id: string | null; files: number }>();
  const driveInfo = drive
    ? {
        status: drive.status,
        attempts: drive.attempts,
        lastError: drive.last_error,
        lastSyncedAt: drive.last_synced_at,
        files: drive.files,
        folderUrl: drive.folder_id ? folderUrl(drive.folder_id) : null,
      }
    : null;

  // Historique du dossier (statuts et notes), du plus récent au plus ancien.
  const { results: events } = await env.DB.prepare(
    `SELECT created_at, kind, from_status, to_status, note FROM application_events WHERE application_id = ? ORDER BY created_at DESC`,
  )
    .bind(id)
    .all();

  return json({ ok: true, application, photos: photoUrls, emails: emails ?? [], drive: driveInfo, events: events ?? [] }, 200);
};

interface PatchBody {
  status?: unknown;
  notes?: unknown;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const id = applicationId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  if (typeof body !== "object" || body === null) return json({ ok: false, reason: "invalid" }, 400);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !APPLICATION_STATUSES.includes(body.status as ApplicationRecord["status"])) {
      return json({ ok: false, reason: "invalid_status" }, 400);
    }
    updates.push("status = ?");
    values.push(body.status);
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 4000) {
      return json({ ok: false, reason: "invalid_notes" }, 400);
    }
    updates.push("notes = ?");
    values.push(body.notes);
  }
  if (updates.length === 0) return json({ ok: false, reason: "no_changes" }, 400);

  // État courant lu APRÈS la validation : une requête invalide reste un 400, quel que soit le dossier visé.
  const current = await env.DB.prepare(`SELECT status, notes FROM applications WHERE id = ?`).bind(id).first<{ status: string; notes: string | null }>();
  if (!current) return json({ ok: false, reason: "not_found" }, 404);

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  values.push(now);

  // Mise à jour et historique dans la même transaction : un changement de
  // statut n'existe jamais sans sa trace, et inversement.
  const statements: D1PreparedStatement[] = [env.DB.prepare(`UPDATE applications SET ${updates.join(", ")} WHERE id = ?`).bind(...values, id)];
  if (typeof body.status === "string" && body.status !== current.status) {
    statements.push(
      env.DB.prepare(`INSERT INTO application_events (id, application_id, created_at, kind, from_status, to_status) VALUES (?, ?, ?, 'status', ?, ?)`).bind(
        crypto.randomUUID(),
        id,
        now,
        current.status,
        body.status,
      ),
      auditStatement(env.DB, "application.status", "application", id, `${current.status} → ${body.status}`),
    );
  }
  if (typeof body.notes === "string" && body.notes.trim() !== (current.notes ?? "").trim() && body.notes.trim() !== "") {
    statements.push(
      env.DB.prepare(`INSERT INTO application_events (id, application_id, created_at, kind, note) VALUES (?, ?, ?, 'note', ?)`).bind(
        crypto.randomUUID(),
        id,
        now,
        body.notes.trim().slice(0, 4000),
      ),
    );
  }
  await env.DB.batch(statements);
  return json({ ok: true }, 200);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const id = applicationId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);
  // Ordre et garanties : voir functions/lib/erasure.ts (Drive → D1 → photos).
  const result = await deleteApplicationRecord(env, id);
  if (!result.ok) return json({ ok: false, reason: result.reason, ...(result.code ? { code: result.code } : {}) }, result.status);
  return json({ ok: true }, 200);
};
