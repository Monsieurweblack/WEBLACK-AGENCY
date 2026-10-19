import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { demotePhoto, getPhoto, promotePhoto } from "../../lib/photos.ts";
import { parseApplication } from "../../lib/validation.ts";
import { fetchTalentApplicationSettings } from "../../lib/sanity.ts";
import { sendEmail } from "../../lib/email.ts";
import type { ValidApplication } from "../../lib/applicationTypes.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
  /** Même clé Resend que la newsletter (functions/api/newsletter.ts) — pas un nouveau secret. */
  NEWSLETTER_API_KEY?: string;
  /** Expéditeur déjà vérifié dans Resend. Sans lui, aucun e-mail n'est tenté. */
  RESEND_FROM?: string;
  /** Destinataire de la notification interne. */
  TALENT_APPLICATION_NOTIFY_EMAIL?: string;
}

/** Une candidature complète tient en quelques Ko (les photos passent par upload.ts) : au-delà, ce n'est pas un formulaire. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Service armé ? Sonde lue par le formulaire — jamais de secret dans la
 * réponse, même idiome que newsletter.ts.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await fetchTalentApplicationSettings(env);
  return json({ configured: Boolean(env.DB && env.PHOTOS), open: settings.applicationsOpen, minorsAllowed: settings.minorsAllowed }, 200);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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

  const settings = await fetchTalentApplicationSettings(env);
  if (!settings.applicationsOpen) return json({ ok: false, reason: "closed" }, 403);

  const parsed = parseApplication(body, settings.minorsAllowed);
  if (!parsed.ok) return json({ ok: false, reason: "validation", errors: parsed.errors }, 422);
  const app = parsed.value;

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
  // photos qui expirent dans deux heures. Si c'est l'écriture D1 qui échoue,
  // les photos sont rétrogradées : elles expirent d'elles-mêmes.
  const promoted: string[] = [];
  try {
    for (const { id: photoId } of app.photoIds) {
      if (!(await promotePhoto(env.PHOTOS, photoId))) throw new Error("promotion");
      promoted.push(photoId);
    }
  } catch {
    for (const photoId of promoted) await demotePhoto(env.PHOTOS, photoId);
    return json({ ok: false, reason: "storage" }, 500);
  }

  try {
    // batch() = une transaction : le dossier et ses références photo sont
    // écrits ensemble, ou pas du tout.
    await env.DB.batch([buildApplicationInsert(env.DB, id, now, app), ...buildPhotoInserts(env.DB, id, now, app, contentTypes)]);
  } catch {
    for (const photoId of promoted) await demotePhoto(env.PHOTOS, photoId);
    return json({ ok: false, reason: "storage" }, 500);
  }

  const reference = id.slice(0, 8).toUpperCase();

  // E-mails : au mieux. Le dossier est déjà enregistré ; un échec d'envoi
  // ne transforme jamais une candidature réussie en échec.
  if (env.NEWSLETTER_API_KEY && env.RESEND_FROM) {
    const candidate = candidateEmail(app, reference);
    await sendEmail({ apiKey: env.NEWSLETTER_API_KEY, from: env.RESEND_FROM, to: app.email, ...candidate });
    if (env.TALENT_APPLICATION_NOTIFY_EMAIL) {
      await sendEmail({
        apiKey: env.NEWSLETTER_API_KEY,
        from: env.RESEND_FROM,
        to: env.TALENT_APPLICATION_NOTIFY_EMAIL,
        subject: `Nouvelle candidature Talent — ${app.firstName} ${app.lastName} (${reference})`,
        text: [
          "Nouvelle candidature reçue.",
          "",
          `Référence : ${reference}`,
          `Nom : ${app.firstName} ${app.lastName}`,
          `Ville : ${app.city} (${app.country})`,
          `Catégorie : ${app.category}${app.categoryOther ? ` — ${app.categoryOther}` : ""}`,
          `Niveau : ${app.experienceLevel} · Expérience : ${app.experienceDuration}`,
          "",
          "Dossier complet et photos dans l'administration : /admin/candidatures",
        ].join("\n"),
      });
    }
  }

  return json({ ok: true, reference }, 200);
};

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

function candidateEmail(app: ValidApplication, reference: string): { subject: string; text: string } {
  if (app.lang === "en") {
    return {
      subject: "WEBLACK Talent — Your application has been received",
      text: `Hello ${app.firstName},\n\nYour application has been received. Reference: ${reference}.\nOur team reviews every application and will get back to you if your profile matches our current searches.\n\nWEBLACK Talent`,
    };
  }
  return {
    subject: "WEBLACK Talent — Votre candidature a été reçue",
    text: `Bonjour ${app.firstName},\n\nVotre candidature a été reçue. Référence : ${reference}.\nNotre équipe examine chaque candidature et revient vers vous si votre profil correspond à nos recherches actuelles.\n\nWEBLACK Talent`,
  };
}
