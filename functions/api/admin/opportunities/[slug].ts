/**
 * Administration — statut d'une annonce (brouillon, vérification, publiée,
 * clôturée) et confirmation de l'organisateur. Chaque changement est
 * journalisé (admin_audit), sans donnée personnelle.
 */
import { json } from "../../../lib/json.ts";
import { requireAdmin } from "../../../lib/adminSession.ts";
import { auditStatement } from "../../../lib/audit.ts";
import { isKnownOpportunity, isOpportunityStatus, type OpportunityRow } from "../../../lib/opportunities.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  const slug = params.slug;
  if (!isKnownOpportunity(slug)) return json({ ok: false, reason: "not_found" }, 404);

  let body: { status?: unknown; organizerVerified?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  if (typeof body !== "object" || body === null) return json({ ok: false, reason: "invalid" }, 400);
  if (body.status !== undefined && !isOpportunityStatus(body.status)) return json({ ok: false, reason: "invalid_status" }, 400);
  if (body.organizerVerified !== undefined && typeof body.organizerVerified !== "boolean") return json({ ok: false, reason: "invalid_verified" }, 400);
  if (body.status === undefined && body.organizerVerified === undefined) return json({ ok: false, reason: "no_changes" }, 400);

  const current = await env.DB.prepare(`SELECT slug, status, organizer_verified, updated_at FROM opportunities WHERE slug = ?`).bind(slug).first<OpportunityRow>();
  const status = (body.status as string | undefined) ?? current?.status ?? "draft";
  const verified = body.organizerVerified === undefined ? (current?.organizer_verified ?? 0) : body.organizerVerified ? 1 : 0;
  const now = new Date().toISOString();
  const changes = [
    current?.status !== status ? `status ${current?.status ?? "none"} → ${status}` : "",
    (current?.organizer_verified ?? 0) !== verified ? `organizer_verified → ${verified}` : "",
  ].filter(Boolean);
  if (changes.length === 0) return json({ ok: true, unchanged: true }, 200);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO opportunities (slug, status, organizer_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET status = excluded.status, organizer_verified = excluded.organizer_verified, updated_at = excluded.updated_at`,
    ).bind(slug, status, verified, now, now),
    auditStatement(env.DB, "opportunity.update", "opportunity", slug, changes.join("; ")),
  ]);
  return json({ ok: true }, 200);
};
