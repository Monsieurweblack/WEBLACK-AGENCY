/**
 * Brief WEBLACK — réception d'une demande commerciale.
 *
 * GET  : la réception est-elle possible ici ? (booléen, jamais un secret)
 * POST : enregistre la demande et renvoie sa référence. Le navigateur
 *        n'affiche « demande reçue » — et n'émet business_inquiry_success —
 *        qu'avec ok:true ET une référence : jamais sur une simple absence
 *        d'erreur, jamais sur l'ouverture d'un client e-mail.
 *
 * Mêmes protections que la candidature Talent : garde-fou d'environnement
 * (aucune écriture de preview vers la base de production), limitation de
 * débit, taille maximale, leurre anti-robot, idempotence par submissionId.
 */
import { json } from "../lib/json.ts";
import { checkRateLimit } from "../lib/rateLimit.ts";
import { writesAllowed } from "../lib/environment.ts";
import { parseInquiry } from "../lib/inquiryValidation.ts";
import { findBySubmission, insertInquiry, notifyInquiry, retryPendingNotifications, type InquiryEnv } from "../lib/inquiryStore.ts";

interface Env extends InquiryEnv {
  PHOTOS: KVNamespace;
  APP_ENV?: string;
}

const MAX_BODY_BYTES = 16 * 1024;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) =>
  json({ configured: Boolean(env.DB && env.PHOTOS) && writesAllowed(env, request) }, 200);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!env.DB || !env.PHOTOS || !writesAllowed(env, request)) return json({ ok: false, reason: "not_configured" }, 503);

  const rate = await checkRateLimit(env.PHOTOS, request, "inquiry", 8, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, reason: "too_large" }, 413);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ ok: false, reason: "too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  // Leurre : succès apparent pour le robot, rien n'est écrit.
  if (typeof body === "object" && body !== null) {
    const honeypot = (body as Record<string, unknown>).website;
    if (typeof honeypot === "string" && honeypot.trim() !== "") return json({ ok: true, reference: "WBL-00000000" }, 200);
  }

  const parsed = parseInquiry(body);
  if (!parsed.ok) return json({ ok: false, reason: "validation", errors: parsed.errors }, 422);
  const inquiry = parsed.value;

  if (inquiry.submissionId) {
    const existing = await findBySubmission(env.DB, inquiry.submissionId);
    if (existing) return json({ ok: true, reference: existing.reference, duplicate: true }, 200);
  }

  let stored: { id: string; reference: string; duplicate: boolean };
  try {
    stored = await insertInquiry(env.DB, inquiry);
  } catch {
    return json({ ok: false, reason: "unavailable" }, 503);
  }

  if (!stored.duplicate) {
    // Après la réponse si possible : le visiteur n'attend jamais le fournisseur d'e-mail.
    // Puis reprise des notifications restées en souffrance (voir inquiryStore.ts).
    const notify = notifyInquiry(env, stored.id)
      .catch(() => "failed" as const)
      .then(() => retryPendingNotifications(env, { exceptId: stored.id }))
      .catch(() => 0);
    if (context.waitUntil) context.waitUntil(notify);
    else await notify;
  }

  return json({ ok: true, reference: stored.reference, ...(stored.duplicate ? { duplicate: true } : {}) }, 200);
};
