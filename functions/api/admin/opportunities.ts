/** Administration — liste des annonces Opportunities et de leur statut. */
import { requireAdmin } from "../../lib/adminSession.ts";
import { adminList } from "../../lib/opportunities.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  return adminList(env.DB);
};
