/**
 * Administration — contacts dédupliqués (Relationship Engine v1).
 * Liste calculée à la volée depuis les candidatures et les demandes
 * (functions/lib/contacts.ts) ; recherche optionnelle ?q=.
 */
import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { listContacts } from "../../lib/contacts.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  const contacts = await listContacts(env.DB, q);
  return json({ ok: true, contacts }, 200);
};
