import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { demotePhoto, getPhoto, promotePhoto } from "../../lib/photos.ts";
import { parseApplication } from "../../lib/validation.ts";
import { fetchTalentApplicationSettings } from "../../lib/sanity.ts";
import { deliverOutbox, outboxInserts, referenceFor, type OutboxEnv } from "../../lib/talentOutbox.ts";
import type { ValidApplication } from "../../lib/applicationTypes.ts";

interface Env extends OutboxEnv {
  PHOTOS: KVNamespace;
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
}

/** Une candidature complète tient en quelques Ko (les photos passent par upload.ts) : au-delà, ce n'est pas un formulaire. */
const MAX_BODY_BYTES = 64 * 1024;

type ConfirmationState = "sent" | "pending";

/**
 * Service armé ? Sonde lue par le formulaire — jamais de secret dans la
 * réponse, même idiome que newsletter.ts.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await fetchTalentApplicationSettings(env);
  return json(
    {
      configured: Boolean(env.DB && env.PHOTOS),
      available: settings.available,
      open: settings.applicationsOpen,
      minorsAllowed: settings.minorsAllowed,
    },
    200,
  );
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const rate = await checkRateLimit(env.PHOTOS, request, "submit", 10, 60 * 60);
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

  // Leurre anti-robot : succès silencieux, même logique que newsletter.ts.
  if (typeof body === "object" && body !== null) {
    const honeypot = (body as Record<string, unknown>).honeypot;
    if (typeof honeypot === "string" && honeypot.trim() !== "") return json({ ok: true, reference: "0000000" }, 200);
  }

  // L'ouverture de la campagne ne se décide qu'ici, à partir de Sanity.
  const settings = await fetchTalentApplicationSettings(env);
  if (!settings.available) return json({ ok: false, reason: "unavailable" }, 503);
  if (!settings.applicationsOpen) return json({ ok: false, reason: "closed" }, 403);

  const parsed = parseApplication(body, settings.minorsAllowed);
  if (!parsed.ok) return json({ ok: false, reason: "validation", errors: parsed.errors }, 422);
  const app = parsed.value;

  // Double clic, reprise après coupure, requête rejouée : le dossier déjà
  // enregistré pour ce formulaire est renvoyé tel quel — ni second dossier,
  // ni second e-mail, et surtout aucune opération sur ses photos.
  if (app.submissionId) {
    const existing = await findBySubmissionId(env.DB, app.submissionId);
    if (existing) {
      return json({ ok: true, reference: referenceFor(existing), duplicate: true, confirmationEmail: await confirmationState(env.DB, existing) }, 200);
    }
  }

  // Une photo déjà rattachée à un dossier ne peut pas en rejoindre un autre.
  const alreadyLinked = await env.DB.prepare(`SELECT id FROM application_photos WHERE id IN (${app.photoIds.map(() => "?").join(", ")}) LIMIT 1`)
    .bind(...app.photoIds.map((p) => p.id))
    .first<{ id: string }>();
  if (alreadyLinked) return json({ ok: false, reason: "photo_already_used" }, 409);

  // Chaque photo référencée doit exister réellement — pas expirée, pas inventée.
  const contentTypes = new Map<string, string>();
  for (const { id } of app.photoIds) {
    const photo = await getPhoto(env.PHOTOS, id);
    if (!photo) return json({ ok: false, reason: "photo_missing_or_expired" }, 422);
    contentTypes.set(id, photo.contentType);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Ordre délibéré : promotion des photos AVANT l'écriture D1. Si la
  // promotion venait après et échouait, le dossier pointerait vers des
  // photos qui expirent dans deux heures.
  const promoted: string[] = [];
  try {
    for (const { id: photoId } of app.photoIds) {
      if (!(await promotePhoto(env.PHOTOS, photoId))) throw new Error("promotion");
      promoted.push(photoId);
    }
  } catch {
    await demoteIfUnlinked(env, promoted);
    return json({ ok: false, reason: "storage" }, 500);
  }

  try {
    // batch() = une transaction : le dossier, ses références photo et les
    // e-mails à envoyer sont écrits ensemble, ou pas du tout.
    await env.DB.batch([
      buildApplicationInsert(env.DB, id, now, app),
      ...buildPhotoInserts(env.DB, id, now, app, contentTypes),
      ...outboxInserts(env.DB, id, now),
    ]);
  } catch {
    // Deux envois simultanés du même formulaire : l'autre a gagné (index
    // unique sur submission_id). Ses photos sont les mêmes — surtout ne pas
    // les rétrograder ; on renvoie sa référence.
    if (app.submissionId) {
      const winner = await findBySubmissionId(env.DB, app.submissionId).catch(() => undefined);
      if (winner) return json({ ok: true, reference: referenceFor(winner), duplicate: true, confirmationEmail: "pending" }, 200);
    }
    await demoteIfUnlinked(env, promoted);
    return json({ ok: false, reason: "storage" }, 500);
  }

  // Le dossier est enregistré. Les e-mails sont tentés maintenant ; leur
  // échec éventuel reste consigné dans email_outbox, jamais renvoyé comme un
  // échec de candidature.
  let confirmationEmail: ConfirmationState = "pending";
  try {
    const report = await deliverOutbox(env, { applicationIds: [id], sanityNotifyEmail: settings.internalNotificationEmail });
    if (report.outcomes[`${id}:candidate_confirmation`] === "sent") confirmationEmail = "sent";
  } catch {
    // Lignes restées en attente : relancées plus tard.
  }

  // Au passage, quelques e-mails en retard d'autres dossiers (panne passée
  // du fournisseur) — après la réponse, sans la retarder.
  const backlog = deliverOutbox(env, { limit: 3, sanityNotifyEmail: settings.internalNotificationEmail }).catch(() => undefined);
  if (context.waitUntil) context.waitUntil(backlog);
  else await backlog;

  return json({ ok: true, reference: referenceFor(id), confirmationEmail }, 200);
};

async function findBySubmissionId(db: D1Database, submissionId: string): Promise<string | undefined> {
  const row = await db.prepare(`SELECT id FROM applications WHERE submission_id = ?`).bind(submissionId).first<{ id: string }>();
  return row?.id;
}

async function confirmationState(db: D1Database, applicationId: string): Promise<ConfirmationState> {
  const row = await db
    .prepare(`SELECT status FROM email_outbox WHERE application_id = ? AND kind = 'candidate_confirmation'`)
    .bind(applicationId)
    .first<{ status: string }>();
  return row?.status === "sent" ? "sent" : "pending";
}

/**
 * Rétrograde (TTL 2 h) les photos promues pour un dossier qui n'a pas été
 * écrit — UNIQUEMENT celles qu'aucun dossier ne référence. Si D1 ne répond
 * pas, on ne rétrograde rien : mieux vaut une photo orpheline permanente
 * qu'une photo d'un dossier réellement enregistré qui expire.
 */
async function demoteIfUnlinked(env: Env, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  let linked: Set<string>;
  try {
    const { results } = await env.DB.prepare(`SELECT id FROM application_photos WHERE id IN (${photoIds.map(() => "?").join(", ")})`)
      .bind(...photoIds)
      .all<{ id: string }>();
    linked = new Set((results ?? []).map((r) => r.id));
  } catch {
    return;
  }
  for (const photoId of photoIds) if (!linked.has(photoId)) await demotePhoto(env.PHOTOS, photoId);
}

function buildApplicationInsert(db: D1Database, id: string, now: string, app: ValidApplication): D1PreparedStatement {
  const columns: [string, unknown][] = [
    ["id", id],
    ["created_at", now],
    ["updated_at", now],
    ["status", "RECEIVED"],
    ["first_name", app.firstName],
    ["last_name", app.lastName],
    ["birth_date", app.birthDate],
    ["city", app.city],
    ["country", app.country],
    ["email", app.email],
    ["phone", app.phone],
    ["instagram", app.instagram],
    ["languages", JSON.stringify(app.languages)],
    ["languages_other", app.languagesOther],
    ["is_minor", app.isMinor ? 1 : 0],
    ["legal_guardian_name", app.guardian?.name ?? null],
    ["legal_guardian_email", app.guardian?.email ?? null],
    ["legal_guardian_phone", app.guardian?.phone ?? null],
    ["height_cm", app.heightCm],
    ["chest_cm", app.chestCm],
    ["waist_cm", app.waistCm],
    ["hips_cm", app.hipsCm],
    ["inseam_cm", app.inseamCm],
    ["shoe_size", app.shoeSize === null ? null : String(app.shoeSize)],
    ["shoe_system", app.shoeSystem],
    ["clothing_size", app.clothingSize],
    ["hair_color", app.hairColor],
    ["eye_color", app.eyeColor],
    ["talent_category", app.category],
    ["talent_category_other", app.categoryOther],
    ["experience_level", app.experienceLevel],
    ["experience_duration", app.experienceDuration],
    ["current_agency", app.currentAgency],
    ["exclusivity", app.exclusivity],
    ["portfolio_links", app.portfolioLinks.length ? app.portfolioLinks.join("\n") : null],
    ["mobility", app.mobility],
    ["desired_projects", JSON.stringify(app.desiredProjects)],
    ["motivation", app.motivation],
    ["accuracy_confirmed", 1],
    ["privacy_notice_version", app.privacyNoticeVersion],
    ["submission_lang", app.lang],
    ["submission_id", app.submissionId],
  ];
  const names = columns.map(([name]) => name).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return db.prepare(`INSERT INTO applications (${names}) VALUES (${placeholders})`).bind(...columns.map(([, value]) => value));
}

function buildPhotoInserts(
  db: D1Database,
  applicationId: string,
  now: string,
  app: ValidApplication,
  contentTypes: Map<string, string>,
): D1PreparedStatement[] {
  // Type réel tel que vérifié par upload.ts (octets, pas en-tête déclaré)
  // et conservé dans les métadonnées KV — la référence D1 reste cohérente
  // avec le fichier stocké.
  return app.photoIds.map(({ role, id }) =>
    db
      .prepare(`INSERT INTO application_photos (id, application_id, role, content_type, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, applicationId, role, contentTypes.get(id) ?? "image/jpeg", now),
  );
}
