/**
 * Export RGPD d'un contact (droit d'accès / portabilité). POST + corps JSON :
 * l'adresse ne transite jamais dans une URL (journaux, historique). Chaque
 * export est inscrit au journal d'audit, sous l'empreinte du contact.
 */
import { json } from "../../../lib/json.ts";
import { requireAdmin } from "../../../lib/adminSession.ts";
import { audit } from "../../../lib/audit.ts";
import { contactKey, exportContact } from "../../../lib/contacts.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ ok: false, reason: "invalid_email" }, 400);
  const data = await exportContact(env.DB, email);
  if (!data.applications.length && !data.businessInquiries.length) return json({ ok: false, reason: "not_found" }, 404);
  await audit(env.DB, "contact.export", "contact", await contactKey(email));
  return json({ ok: true, export: data }, 200, { "Content-Disposition": `attachment; filename="weblack-export-${await contactKey(email)}.json"` });
};
