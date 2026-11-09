/**
 * Administration — une demande commerciale : lecture, statut et notes
 * (journal horodaté), relance de la notification, suppression.
 */
import { json } from "../../../lib/json.ts";
import { requireAdmin, UUID_RE } from "../../../lib/adminSession.ts";
import { INQUIRY_LIMITS, isInquiryStatus } from "../../../lib/inquiryOptions.ts";
import { audit, auditStatement } from "../../../lib/audit.ts";
import { notifyInquiry, type InquiryEnv, type InquiryRow } from "../../../lib/inquiryStore.ts";

interface Env extends InquiryEnv {
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

function inquiryId(params: Record<string, string | string[]>): string | undefined {
  const id = params.id;
  return typeof id === "string" && UUID_RE.test(id) ? id : undefined;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  const id = inquiryId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);

  const inquiry = await env.DB.prepare(`SELECT * FROM business_inquiries WHERE id = ?`).bind(id).first<InquiryRow>();
  if (!inquiry) return json({ ok: false, reason: "not_found" }, 404);
  const { results: events } = await env.DB.prepare(
    `SELECT created_at, kind, from_status, to_status, note FROM business_inquiry_events WHERE inquiry_id = ? ORDER BY created_at DESC`,
  )
    .bind(id)
    .all();
  return json({ ok: true, inquiry, events: events ?? [] }, 200);
};

interface PatchBody {
  status?: unknown;
  note?: unknown;
  nextAction?: unknown;
  nextActionAt?: unknown;
  estimatedValue?: unknown;
  sector?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Champs de pilotage commercial : null efface, absent ne change rien. Renvoie la raison d'un refus. */
function pipelineFields(body: PatchBody): { sets: string[]; values: unknown[]; error?: string } {
  const sets: string[] = [];
  const values: unknown[] = [];
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max) : "");
  if (body.nextAction !== undefined) {
    if (body.nextAction !== null && typeof body.nextAction !== "string") return { sets, values, error: "invalid_next_action" };
    sets.push("next_action = ?");
    values.push(body.nextAction === null ? null : text(body.nextAction, INQUIRY_LIMITS.nextAction) || null);
  }
  if (body.nextActionAt !== undefined) {
    if (body.nextActionAt !== null && (typeof body.nextActionAt !== "string" || !DATE_RE.test(body.nextActionAt) || Number.isNaN(Date.parse(body.nextActionAt)))) {
      return { sets, values, error: "invalid_next_action_at" };
    }
    sets.push("next_action_at = ?");
    values.push(body.nextActionAt);
  }
  if (body.estimatedValue !== undefined) {
    const v = body.estimatedValue;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > INQUIRY_LIMITS.estimatedValueMax)) {
      return { sets, values, error: "invalid_estimated_value" };
    }
    sets.push("estimated_value = ?");
    values.push(v);
  }
  if (body.sector !== undefined) {
    if (body.sector !== null && typeof body.sector !== "string") return { sets, values, error: "invalid_sector" };
    sets.push("sector = ?");
    values.push(body.sector === null ? null : text(body.sector, INQUIRY_LIMITS.sector) || null);
  }
  return { sets, values };
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  const id = inquiryId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  if (typeof body !== "object" || body === null) return json({ ok: false, reason: "invalid" }, 400);
  if (body.status !== undefined && !isInquiryStatus(body.status)) return json({ ok: false, reason: "invalid_status" }, 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (body.note !== undefined && (typeof body.note !== "string" || note.length > INQUIRY_LIMITS.note)) {
    return json({ ok: false, reason: "invalid_note" }, 400);
  }

  const current = await env.DB.prepare(`SELECT status FROM business_inquiries WHERE id = ?`).bind(id).first<{ status: string }>();
  if (!current) return json({ ok: false, reason: "not_found" }, 404);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const statusChanged = typeof body.status === "string" && body.status !== current.status;
  if (statusChanged) {
    statements.push(
      env.DB.prepare(`INSERT INTO business_inquiry_events (id, inquiry_id, created_at, kind, from_status, to_status) VALUES (?, ?, ?, 'status', ?, ?)`).bind(
        crypto.randomUUID(),
        id,
        now,
        current.status,
        body.status,
      ),
    );
  }
  if (note) {
    statements.push(
      env.DB.prepare(`INSERT INTO business_inquiry_events (id, inquiry_id, created_at, kind, note) VALUES (?, ?, ?, 'note', ?)`).bind(crypto.randomUUID(), id, now, note),
    );
  }
  const pipeline = pipelineFields(body);
  if (pipeline.error) return json({ ok: false, reason: pipeline.error }, 400);
  if (statements.length === 0 && pipeline.sets.length === 0) return json({ ok: false, reason: "no_changes" }, 400);

  const sets = [...pipeline.sets, "updated_at = ?"];
  const values = [...pipeline.values, now];
  if (statusChanged) {
    sets.unshift("status = ?");
    values.unshift(body.status);
    statements.push(auditStatement(env.DB, "inquiry.status", "inquiry", id, `${current.status} → ${body.status}`));
  }
  if (pipeline.sets.length) statements.push(auditStatement(env.DB, "inquiry.pipeline", "inquiry", id, pipeline.sets.map((s) => s.split(" ")[0]).join(",")));
  statements.unshift(env.DB.prepare(`UPDATE business_inquiries SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id));
  await env.DB.batch(statements);
  return json({ ok: true }, 200);
};

/** POST : relance la notification interne (après un échec ou une configuration tardive). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  const id = inquiryId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);
  const outcome = await notifyInquiry(env, id);
  return json({ ok: true, outcome }, 200);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;
  const id = inquiryId(params);
  if (!id) return json({ ok: false, reason: "invalid_id" }, 400);
  const [, deleted] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM business_inquiry_events WHERE inquiry_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM business_inquiries WHERE id = ?`).bind(id),
  ]);
  if (!deleted || deleted.meta.changes === 0) return json({ ok: false, reason: "not_found" }, 404);
  await audit(env.DB, "inquiry.delete", "inquiry", id);
  return json({ ok: true }, 200);
};
