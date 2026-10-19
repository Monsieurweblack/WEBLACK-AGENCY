import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { APPLICATION_STATUSES, type ApplicationRecord } from "../../lib/applicationTypes.ts";

interface Env {
  DB: D1Database;
  ADMIN_SESSION_SECRET?: string;
}

/** Liste allégée pour l'écran principal de l'admin — jamais les mesures ni les textes longs, seulement ce qui permet de trier/filtrer un dossier avant de l'ouvrir. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET);
  if (denied) return denied;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  if (statusFilter && !APPLICATION_STATUSES.includes(statusFilter as ApplicationRecord["status"])) {
    return json({ ok: false, reason: "invalid_status" }, 400);
  }

  const query = statusFilter
    ? env.DB.prepare(
        `SELECT id, created_at, status, first_name, last_name, city, country, experience_level, is_minor FROM applications WHERE status = ? ORDER BY created_at DESC`,
      ).bind(statusFilter)
    : env.DB.prepare(
        `SELECT id, created_at, status, first_name, last_name, city, country, experience_level, is_minor FROM applications ORDER BY created_at DESC`,
      );

  const { results } = await query.all();
  return json({ ok: true, applications: results }, 200);
};
