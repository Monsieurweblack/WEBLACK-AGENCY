import { json } from "../../../lib/json.ts";
import { requireAdmin } from "../../../lib/adminSession.ts";
import { deletePhoto } from "../../../lib/photos.ts";
import { APPLICATION_STATUSES, type ApplicationRecord } from "../../../lib/applicationTypes.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

interface PhotoRow {
  id: string;
  role: string;
  content_type: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET);
  if (denied) return denied;

  const id = params.id as string;
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

  return json({ ok: true, application, photos: photoUrls }, 200);
};

interface PatchBody {
  status?: unknown;
  notes?: unknown;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET);
  if (denied) return denied;

  const id = params.id as string;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

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

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());

  const result = await env.DB.prepare(`UPDATE applications SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();

  if (result.meta.changes === 0) return json({ ok: false, reason: "not_found" }, 404);
  return json({ ok: true }, 200);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET);
  if (denied) return denied;

  const id = params.id as string;
  const { results: photos } = await env.DB.prepare(`SELECT id FROM application_photos WHERE application_id = ?`)
    .bind(id)
    .all<{ id: string }>();

  for (const photo of photos ?? []) await deletePhoto(env.PHOTOS, photo.id);

  await env.DB.prepare(`DELETE FROM application_photos WHERE application_id = ?`).bind(id).run();
  const result = await env.DB.prepare(`DELETE FROM applications WHERE id = ?`).bind(id).run();

  if (result.meta.changes === 0) return json({ ok: false, reason: "not_found" }, 404);
  return json({ ok: true }, 200);
};
