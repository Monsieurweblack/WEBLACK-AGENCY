import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { APPLICATION_STATUSES, type ApplicationRecord } from "../../lib/applicationTypes.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

/** Liste allégée pour l'écran principal de l'admin — jamais les mesures ni les textes longs, seulement ce qui permet de trier/filtrer un dossier avant de l'ouvrir. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  if (statusFilter && !APPLICATION_STATUSES.includes(statusFilter as ApplicationRecord["status"])) {
    return json({ ok: false, reason: "invalid_status" }, 400);
  }

  // Recherche multicritère côté serveur : statut, catégorie, pays, texte
  // (nom, prénom, ville, e-mail). Paramètres liés, jamais concaténés.
  const where: string[] = [];
  const binds: unknown[] = [];
  if (statusFilter) {
    where.push("status = ?");
    binds.push(statusFilter);
  }
  const category = url.searchParams.get("category");
  if (category && /^[a-z_]{1,40}$/.test(category)) {
    where.push("talent_category = ?");
    binds.push(category);
  }
  const country = url.searchParams.get("country");
  if (country && /^[A-Z]{2}$/.test(country)) {
    where.push("country = ?");
    binds.push(country);
  }
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  if (q) {
    where.push("(lower(first_name) LIKE ? OR lower(last_name) LIKE ? OR lower(city) LIKE ? OR lower(email) LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    binds.push(like, like, like, like);
  }
  const query = env.DB.prepare(
    `SELECT id, created_at, status, first_name, last_name, city, country, experience_level, talent_category, is_minor FROM applications${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 500`,
  ).bind(...binds);

  const { results } = await query.all();
  return json({ ok: true, applications: results }, 200);
};
