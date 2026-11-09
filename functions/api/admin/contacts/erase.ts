/**
 * Effacement complet d'une personne (droit à l'effacement). POST + corps
 * JSON { email, confirm } : `confirm` doit reprendre l'adresse à l'identique
 * — un clic isolé ne peut jamais effacer quelqu'un. L'adresse ne transite
 * jamais dans une URL. Voir functions/lib/erasure.ts pour l'ordre et les
 * garanties (Drive → D1 → photos, arrêt au premier échec).
 */
import { json } from "../../../lib/json.ts";
import { requireAdmin } from "../../../lib/adminSession.ts";
import { eraseContact, type ErasureEnv } from "../../../lib/erasure.ts";
import { normalizeEmail } from "../../../lib/contacts.ts";

interface Env extends ErasureEnv {
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  let body: { email?: unknown; confirm?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; confirm?: unknown };
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ ok: false, reason: "invalid_email" }, 400);
  if (typeof body.confirm !== "string" || normalizeEmail(body.confirm) !== email) return json({ ok: false, reason: "confirmation_mismatch" }, 400);

  const result = await eraseContact(env, email);
  if (!result.ok) {
    return json({ ok: false, reason: "partial", applicationsDeleted: result.applicationsDeleted, inquiriesDeleted: result.inquiriesDeleted, failed: result.failed }, 502);
  }
  if (result.applicationsDeleted + result.inquiriesDeleted === 0) return json({ ok: false, reason: "not_found" }, 404);
  return json({ ...result }, 200);
};
