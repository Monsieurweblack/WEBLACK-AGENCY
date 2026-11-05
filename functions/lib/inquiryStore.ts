/**
 * Demandes commerciales — écriture, notification interne et conservation.
 *
 * Même infrastructure que les candidatures : la base D1 (liaison DB), le
 * compte Resend de la newsletter (NEWSLETTER_API_KEY) et l'expéditeur
 * vérifié (RESEND_FROM). Aucun nouveau service, aucun CRM externe.
 *
 * La notification est un ACCUSÉ INTERNE, jamais une condition de la
 * réception : la demande est enregistrée d'abord, puis l'équipe est
 * prévenue ; un refus du fournisseur est consigné (notify_status/notify_error,
 * code technique seulement) et relançable depuis l'administration.
 */
import { CONTACT_EMAIL } from "../../src/lib/contact.ts";
import { sendEmail } from "./email.ts";
import { INQUIRY_RETENTION_DAYS, inquiryReference, type InquiryStatus } from "./inquiryOptions.ts";
import type { ValidInquiry } from "./inquiryValidation.ts";

export interface InquiryEnv {
  DB: D1Database;
  NEWSLETTER_API_KEY?: string;
  RESEND_FROM?: string;
  /** Destinataire des notifications ; à défaut, l'adresse de contact publique de l'agence. */
  BUSINESS_INQUIRY_NOTIFY_EMAIL?: string;
}

export interface InquiryRow {
  id: string;
  reference: string;
  created_at: string;
  updated_at: string;
  status: InquiryStatus;
  lang: string;
  division: string;
  service: string;
  full_name: string;
  email: string;
  organisation: string | null;
  country: string;
  description: string;
  timeline: string | null;
  budget: string | null;
  channel: string;
  entry_point: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  notify_status: string;
  notify_attempts: number;
  notify_error: string | null;
  notified_at: string | null;
}

export async function findBySubmission(db: D1Database, submissionId: string): Promise<{ id: string; reference: string } | null> {
  return db.prepare(`SELECT id, reference FROM business_inquiries WHERE submission_id = ?`).bind(submissionId).first();
}

/** Enregistre la demande. Renvoie la référence, ou celle déjà attribuée à ce même formulaire (double envoi). */
export async function insertInquiry(db: D1Database, inquiry: ValidInquiry, now = new Date()): Promise<{ id: string; reference: string; duplicate: boolean }> {
  const id = crypto.randomUUID();
  const reference = inquiryReference(id);
  const iso = now.toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO business_inquiries (id, reference, submission_id, created_at, updated_at, status, lang, division, service, full_name, email, organisation, country, description, timeline, budget, channel, entry_point, utm_medium, utm_campaign)
         VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        reference,
        inquiry.submissionId,
        iso,
        iso,
        inquiry.lang,
        inquiry.division,
        inquiry.service,
        inquiry.fullName,
        inquiry.email,
        inquiry.organisation,
        inquiry.country,
        inquiry.description,
        inquiry.timeline,
        inquiry.budget,
        inquiry.channel,
        inquiry.entryPoint,
        inquiry.utmMedium,
        inquiry.utmCampaign,
      )
      .run();
  } catch (error) {
    // Deux envois simultanés du même formulaire : l'index unique a tranché,
    // on renvoie la demande gagnante plutôt qu'une erreur.
    if (inquiry.submissionId) {
      const winner = await findBySubmission(db, inquiry.submissionId);
      if (winner) return { ...winner, duplicate: true };
    }
    throw error;
  }
  return { id, reference, duplicate: false };
}

const DIVISION_LABELS: Record<string, string> = {
  talent: "WEBLACK TALENTS",
  creative: "WEBLACK CRÉATIF",
  consulting: "WEBLACK CONSULTING",
  unsure: "À orienter",
};

export function notificationText(row: InquiryRow): string {
  return [
    `Nouvelle demande commerciale — ${row.reference}`,
    "",
    `Division : ${DIVISION_LABELS[row.division] ?? row.division}`,
    `Prestation : ${row.service}`,
    `Nom : ${row.full_name}`,
    `E-mail : ${row.email}`,
    row.organisation ? `Organisation : ${row.organisation}` : null,
    `Pays : ${row.country}`,
    row.timeline ? `Échéance indicative : ${row.timeline}` : null,
    row.budget ? `Budget indicatif : ${row.budget}` : null,
    `Origine : ${row.channel}${row.entry_point ? ` · entrée ${row.entry_point}` : ""}${row.utm_campaign ? ` · campagne ${row.utm_campaign}` : ""}`,
    `Reçue le : ${row.created_at}`,
    "",
    "Projet :",
    row.description,
    "",
    "Suivi et statut : https://weblack.fr/admin/demandes/",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export type NotifyOutcome = "sent" | "failed" | "not_configured" | "skipped";

/** Prévient l'équipe d'une demande. Idempotent côté Resend : une même demande ne produit qu'un e-mail. */
export async function notifyInquiry(env: InquiryEnv, id: string, { force = false } = {}): Promise<NotifyOutcome> {
  const row = await env.DB.prepare(`SELECT * FROM business_inquiries WHERE id = ?`).bind(id).first<InquiryRow>();
  if (!row) return "skipped";
  if (row.notify_status === "sent" && !force) return "skipped";
  const now = new Date().toISOString();

  if (!env.NEWSLETTER_API_KEY || !env.RESEND_FROM) {
    await env.DB.prepare(`UPDATE business_inquiries SET notify_status = 'not_configured', notify_error = NULL WHERE id = ? AND notify_status != 'sent'`)
      .bind(id)
      .run();
    return "not_configured";
  }

  const result = await sendEmail({
    apiKey: env.NEWSLETTER_API_KEY,
    from: env.RESEND_FROM,
    to: env.BUSINESS_INQUIRY_NOTIFY_EMAIL || CONTACT_EMAIL,
    replyTo: row.email,
    subject: `[WEBLACK] Demande ${row.reference} — ${DIVISION_LABELS[row.division] ?? row.division}`,
    text: notificationText(row),
    idempotencyKey: `inquiry-notify-${row.id}`,
  });

  if (result.ok) {
    await env.DB.prepare(
      `UPDATE business_inquiries SET notify_status = 'sent', notify_attempts = notify_attempts + 1, notify_error = NULL, notified_at = ? WHERE id = ?`,
    )
      .bind(now, id)
      .run();
    return "sent";
  }
  await env.DB.prepare(`UPDATE business_inquiries SET notify_status = 'failed', notify_attempts = notify_attempts + 1, notify_error = ? WHERE id = ?`)
    .bind(result.error.slice(0, 80), id)
    .run();
  return "failed";
}

/** Supprime les demandes sans activité depuis la durée de conservation annoncée. Renvoie le nombre supprimé. */
export async function purgeExpiredInquiries(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INQUIRY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.prepare(`DELETE FROM business_inquiries WHERE updated_at < ?`).bind(cutoff).run();
  return result.meta.changes;
}
