import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { getPhoto, promotePhoto } from "../../lib/photos.ts";
import { validateApplication, computeAge } from "../../lib/validation.ts";
import { fetchTalentApplicationSettings } from "../../lib/sanity.ts";
import { sendEmail } from "../../lib/email.ts";
import { REQUIRED_PHOTO_ROLES, type ApplicationPayload, type PhotoRole } from "../../lib/applicationTypes.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
  /** Même clé Resend que la newsletter (functions/api/newsletter.ts) — pas un nouveau secret. */
  NEWSLETTER_API_KEY?: string;
  /** Expéditeur déjà vérifié dans Resend. À définir côté Cloudflare Pages ; sans lui, aucun e-mail n'est tenté. */
  RESEND_FROM?: string;
  /** Destinataire de la notification interne — weblackconsulting@gmail.com par défaut, voir fiche de livraison. */
  TALENT_APPLICATION_NOTIFY_EMAIL?: string;
}

/**
 * Service armé ? Lu par le formulaire avant d'afficher quoi que ce soit —
 * jamais de formulaire actif qui échouerait silencieusement à la soumission.
 * Reprend l'idiome déjà établi par newsletter.ts (onRequestGet = sonde,
 * aucun secret dans la réponse).
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await fetchTalentApplicationSettings(env);
  return json({ configured: Boolean(env.DB && env.PHOTOS), open: settings.applicationsOpen, minorsAllowed: settings.minorsAllowed }, 200);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rate = await checkRateLimit(env.PHOTOS, request, "submit", 5, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  let payload: ApplicationPayload;
  try {
    payload = (await request.json()) as ApplicationPayload;
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  // Leurre anti-robot : traité comme un succès silencieux, même logique que newsletter.ts.
  if (typeof payload.honeypot === "string" && payload.honeypot.trim() !== "") {
    return json({ ok: true, reference: "0000000" }, 200);
  }

  const settings = await fetchTalentApplicationSettings(env);
  if (!settings.applicationsOpen) return json({ ok: false, reason: "closed" }, 403);

  const errors = validateApplication(payload, settings.minorsAllowed);
  if (errors.length > 0) return json({ ok: false, reason: "validation", errors }, 422);

  // Chaque photoId référencé doit réellement exister (pas expiré, pas
  // inventé côté client) — vérifié ici, pas seulement dans validateApplication
  // qui ne regarde que la forme du payload.
  const allPhotoIds: { role: PhotoRole; id: string }[] = [];
  for (const role of REQUIRED_PHOTO_ROLES) {
    allPhotoIds.push({ role, id: payload.photoIds[role]![0]! });
  }
  for (const id of payload.photoIds.extra ?? []) allPhotoIds.push({ role: "extra", id });

  for (const { id } of allPhotoIds) {
    const existing = await getPhoto(env.PHOTOS, id);
    if (!existing) return json({ ok: false, reason: "photo_missing_or_expired" }, 422);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const age = computeAge(payload.birthDate);
  const isMinor = typeof age === "number" && age < 18;

  await env.DB.prepare(
    `INSERT INTO applications (
      id, created_at, updated_at, status,
      first_name, last_name, birth_date, city, country, email, phone, instagram, languages,
      is_minor, legal_guardian_name, legal_guardian_email, legal_guardian_phone,
      height_cm, chest_cm, waist_cm, hips_cm, shoe_size, shoe_system, clothing_size, inseam_cm, hair_color, eye_color,
      experience_level, past_missions, projects_json, current_agency, exclusivity, portfolio_links, skills, training,
      availability, mobility, desired_projects, motivation,
      accuracy_confirmed, privacy_notice_version
    ) VALUES (?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?, ?,?)`,
  )
    .bind(
      id,
      now,
      now,
      "RECEIVED",
      payload.firstName,
      payload.lastName,
      payload.birthDate,
      payload.city,
      payload.country,
      payload.email,
      payload.phone,
      payload.instagram ?? null,
      payload.languages ?? null,
      isMinor ? 1 : 0,
      payload.legalGuardianName ?? null,
      payload.legalGuardianEmail ?? null,
      payload.legalGuardianPhone ?? null,
      payload.heightCm ?? null,
      payload.chestCm ?? null,
      payload.waistCm ?? null,
      payload.hipsCm ?? null,
      payload.shoeSize ?? null,
      payload.shoeSystem ?? null,
      payload.clothingSize ?? null,
      payload.inseamCm ?? null,
      payload.hairColor ?? null,
      payload.eyeColor ?? null,
      payload.experienceLevel,
      payload.pastMissions ?? null,
      payload.projects ? JSON.stringify(payload.projects) : null,
      payload.currentAgency ?? null,
      payload.exclusivity ?? null,
      payload.portfolioLinks ?? null,
      payload.skills ?? null,
      payload.training ?? null,
      payload.availability ?? null,
      payload.mobility ?? null,
      payload.desiredProjects ?? null,
      payload.motivation ?? null,
      payload.accuracyConfirmed ? 1 : 0,
      payload.privacyNoticeVersion,
    )
    .run();

  for (const { role, id: photoId } of allPhotoIds) {
    const existing = await getPhoto(env.PHOTOS, photoId);
    await env.DB.prepare(
      `INSERT INTO application_photos (id, application_id, role, content_type, created_at) VALUES (?,?,?,?,?)`,
    )
      .bind(photoId, id, role, existing?.contentType ?? "application/octet-stream", now)
      .run();
    await promotePhoto(env.PHOTOS, photoId);
  }

  const reference = id.slice(0, 8).toUpperCase();

  if (env.NEWSLETTER_API_KEY && env.RESEND_FROM) {
    await sendEmail({
      apiKey: env.NEWSLETTER_API_KEY,
      from: env.RESEND_FROM,
      to: payload.email,
      subject: "WEBLACK Talent — Votre candidature a été reçue",
      text: `Bonjour ${payload.firstName},\n\nVotre candidature a été reçue. Référence : ${reference}.\nNotre équipe l'examine ; nous revenons vers vous si elle correspond à nos recherches actuelles.\n\nWEBLACK Talent`,
    });
    if (env.TALENT_APPLICATION_NOTIFY_EMAIL) {
      await sendEmail({
        apiKey: env.NEWSLETTER_API_KEY,
        from: env.RESEND_FROM,
        to: env.TALENT_APPLICATION_NOTIFY_EMAIL,
        subject: `Nouvelle candidature Talent — ${payload.firstName} ${payload.lastName} (${reference})`,
        text: `Nouvelle candidature reçue.\n\nRéférence : ${reference}\nNom : ${payload.firstName} ${payload.lastName}\nVille : ${payload.city}, ${payload.country}\nNiveau d'expérience : ${payload.experienceLevel}\n\nConsulter le dossier complet dans l'administration des candidatures (/admin/candidatures).`,
      });
    }
  }

  return json({ ok: true, reference }, 200);
};
