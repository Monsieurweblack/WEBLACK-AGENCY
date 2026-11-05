/**
 * Administration — liste des demandes commerciales (même session que les
 * candidatures). Ne renvoie que ce qui sert à trier un pipeline : jamais la
 * description complète ni l'e-mail dans la liste.
 *
 * Chaque consultation applique aussi la durée de conservation annoncée
 * (purgeExpiredInquiries) : pas de tâche planifiée à maintenir.
 */
import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { isInquiryStatus } from "../../lib/inquiryOptions.ts";
import { purgeExpiredInquiries } from "../../lib/inquiryStore.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

const LIST_COLUMNS = `id, reference, created_at, updated_at, status, division, service, full_name, organisation, country, budget, timeline, channel, entry_point, notify_status`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  if (status && !isInquiryStatus(status)) return json({ ok: false, reason: "invalid_status" }, 400);

  const purged = await purgeExpiredInquiries(env.DB);

  const query = status
    ? env.DB.prepare(`SELECT ${LIST_COLUMNS} FROM business_inquiries WHERE status = ? ORDER BY created_at DESC LIMIT 500`).bind(status)
    : env.DB.prepare(`SELECT ${LIST_COLUMNS} FROM business_inquiries ORDER BY created_at DESC LIMIT 500`);
  const { results } = await query.all();

  const { results: counts } = await env.DB.prepare(`SELECT status, COUNT(*) AS count FROM business_inquiries GROUP BY status`).all();
  // Demandes dont l'équipe n'a pas (encore) été prévenue : signalées en tête de liste.
  const unnotified = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_inquiries WHERE notify_status != 'sent'`).first<{ n: number }>();
  return json({ ok: true, inquiries: results, counts, purged, unnotified: unnotified?.n ?? 0 }, 200);
};
