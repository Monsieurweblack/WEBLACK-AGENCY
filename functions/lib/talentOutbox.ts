/**
 * File d'envoi des e-mails de candidature (table email_outbox, voir
 * migrations/0003).
 *
 * Principe : l'e-mail à envoyer est écrit dans la MÊME transaction D1 que le
 * dossier (outboxInserts). Ensuite seulement on tente l'envoi. Ainsi :
 *  - pas de dossier enregistré sans e-mail prévu, ni d'e-mail sans dossier ;
 *  - un échec du fournisseur ne touche jamais au dossier : la ligne reste
 *    en échec, avec un code technique, et sera relancée ;
 *  - une même ligne ne part qu'une fois : réservation atomique (UPDATE …
 *    WHERE status …) avant l'envoi, et clé d'idempotence Resend = id de la
 *    ligne, si bien qu'un renvoi après une réponse perdue ne double pas le
 *    message chez le destinataire.
 *
 * Relances : à chaque nouvelle soumission (quelques lignes en retard au
 * passage) et depuis l'administration (bouton « Relancer les e-mails »).
 * Pas de tâche planifiée : les Pages Functions n'en disposent pas, et le
 * volume ne le justifie pas.
 */
import { CONTACT_EMAIL as CONTACT_REPLY_TO } from "../../src/lib/contact.ts";
import { sendEmail } from "./email.ts";
import { adminNotificationEmail, candidateConfirmationEmail } from "./talentEmails.ts";
import type { SubmissionLang } from "./applicationTypes.ts";

export type EmailKind = "candidate_confirmation" | "admin_notification";
export const EMAIL_KINDS: EmailKind[] = ["candidate_confirmation", "admin_notification"];
export const MAX_EMAIL_ATTEMPTS = 5;
/** Une ligne restée « sending » plus longtemps (fonction interrompue) redevient réservable. */
const STALE_SENDING_MS = 10 * 60 * 1000;
/** Délai minimal entre deux tentatives automatiques, multiplié par le nombre d'essais déjà faits. */
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

export interface OutboxEnv {
  DB: D1Database;
  /** Même clé Resend que la newsletter — pas un nouveau secret. */
  NEWSLETTER_API_KEY?: string;
  /** Adresse d'un domaine vérifié dans Resend (wrangler.toml [vars]). */
  RESEND_FROM?: string;
  /** Prioritaire sur l'adresse saisie dans Sanity, si définie. */
  TALENT_APPLICATION_NOTIFY_EMAIL?: string;
}

export type OutboxOutcome = "sent" | "failed" | "not_configured" | "no_recipient" | "skipped";

interface OutboxRow {
  id: string;
  application_id: string;
  kind: EmailKind;
  attempts: number;
}

interface ApplicationFacts {
  id: string;
  first_name: string;
  email: string;
  submission_lang: string | null;
  talent_category: string | null;
  country: string;
}

export function referenceFor(applicationId: string): string {
  return applicationId.slice(0, 8).toUpperCase();
}

/** Les deux e-mails d'un dossier, à inclure dans le batch qui écrit ce dossier. */
export function outboxInserts(db: D1Database, applicationId: string, now: string): D1PreparedStatement[] {
  return EMAIL_KINDS.map((kind) =>
    db
      .prepare(`INSERT INTO email_outbox (id, application_id, kind, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)`)
      .bind(crypto.randomUUID(), applicationId, kind, now, now),
  );
}

interface DeliverOptions {
  /** Restreindre aux e-mails de ces dossiers (soumission : le dossier qui vient d'être écrit). */
  applicationIds?: string[];
  /** Ignorer le délai entre tentatives (relance manuelle depuis l'administration). */
  force?: boolean;
  limit?: number;
  /** Adresse saisie dans Sanity (talentApplicationSettings.internalNotificationEmail). */
  sanityNotifyEmail?: string | null;
  now?: Date;
}

export interface DeliveryReport {
  /** Résultat par ligne traitée, indexé par `${applicationId}:${kind}`. */
  outcomes: Record<string, OutboxOutcome>;
}

export async function deliverOutbox(env: OutboxEnv, options: DeliverOptions = {}): Promise<DeliveryReport> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS).toISOString();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const outcomes: Record<string, OutboxOutcome> = {};

  const filters: string[] = [];
  const values: unknown[] = [];
  if (options.applicationIds?.length) {
    filters.push(`application_id IN (${options.applicationIds.map(() => "?").join(", ")})`);
    values.push(...options.applicationIds);
  }
  const rows = await env.DB.prepare(
    `SELECT id, application_id, kind, attempts, status, updated_at FROM email_outbox
     WHERE ((status IN ('pending', 'failed') AND attempts < ?) OR (status = 'sending' AND updated_at < ?))
     ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
     ORDER BY created_at LIMIT ?`,
  )
    .bind(MAX_EMAIL_ATTEMPTS, staleBefore, ...values, limit)
    .all<OutboxRow & { status: string; updated_at: string }>();

  const configured = Boolean(env.NEWSLETTER_API_KEY && env.RESEND_FROM);
  const notifyEmail = env.TALENT_APPLICATION_NOTIFY_EMAIL || options.sanityNotifyEmail || null;

  for (const row of rows.results ?? []) {
    const key = `${row.application_id}:${row.kind}`;

    // Attente entre deux tentatives automatiques, pour ne pas marteler un
    // fournisseur en panne. Une première tentative n'attend jamais.
    if (!options.force && row.status === "failed" && row.attempts > 0) {
      const due = new Date(row.updated_at).getTime() + RETRY_BACKOFF_MS * row.attempts;
      if (due > now.getTime()) {
        outcomes[key] = "skipped";
        continue;
      }
    }

    // Configuration absente : la ligne reste en attente SANS consommer de
    // tentative — elle partira dès que la configuration sera complétée.
    if (!configured || (row.kind === "admin_notification" && !notifyEmail)) {
      const reason = configured ? "no_recipient" : "not_configured";
      await env.DB.prepare(`UPDATE email_outbox SET last_error = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'failed')`)
        .bind(reason, nowIso, row.id)
        .run();
      outcomes[key] = reason;
      continue;
    }

    // Réservation atomique : si deux exécutions visent la même ligne, une
    // seule obtient changes === 1 et envoie.
    const claim = await env.DB.prepare(
      `UPDATE email_outbox SET status = 'sending', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND ((status IN ('pending', 'failed') AND attempts < ?) OR (status = 'sending' AND updated_at < ?))`,
    )
      .bind(nowIso, row.id, MAX_EMAIL_ATTEMPTS, staleBefore)
      .run();
    if (claim.meta.changes !== 1) {
      outcomes[key] = "skipped";
      continue;
    }

    const application = await env.DB.prepare(
      `SELECT id, first_name, email, submission_lang, talent_category, country FROM applications WHERE id = ?`,
    )
      .bind(row.application_id)
      .first<ApplicationFacts>();

    if (!application) {
      await markFailed(env.DB, row.id, "application_missing", nowIso);
      outcomes[key] = "failed";
      continue;
    }

    const reference = referenceFor(application.id);
    const lang: SubmissionLang = application.submission_lang === "en" ? "en" : "fr";
    let to: string;
    let rendered;
    if (row.kind === "candidate_confirmation") {
      to = application.email;
      rendered = candidateConfirmationEmail(lang, application.first_name, reference);
    } else {
      to = notifyEmail!;
      const photos = await env.DB.prepare(`SELECT COUNT(*) AS n FROM application_photos WHERE application_id = ?`)
        .bind(application.id)
        .first<{ n: number }>();
      rendered = adminNotificationEmail({
        reference,
        applicationId: application.id,
        category: application.talent_category ?? "—",
        country: application.country,
        lang,
        photoCount: photos?.n ?? 0,
      });
    }

    const result = await sendEmail({
      apiKey: env.NEWSLETTER_API_KEY!,
      from: env.RESEND_FROM!,
      to,
      // Les réponses du candidat arrivent à l'adresse de contact réelle,
      // pas à l'adresse d'expédition (le domaine n'a pas de boîte de réception).
      replyTo: row.kind === "candidate_confirmation" ? CONTACT_REPLY_TO : undefined,
      idempotencyKey: row.id,
      ...rendered,
    });

    if (result.ok) {
      await env.DB.prepare(
        `UPDATE email_outbox SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL, provider_message_id = ? WHERE id = ?`,
      )
        .bind(nowIso, nowIso, result.providerId, row.id)
        .run();
      outcomes[key] = "sent";
    } else {
      await markFailed(env.DB, row.id, result.error, nowIso);
      outcomes[key] = "failed";
    }
  }

  return { outcomes };
}

async function markFailed(db: D1Database, id: string, error: string, nowIso: string): Promise<void> {
  await db.prepare(`UPDATE email_outbox SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`).bind(error.slice(0, 80), nowIso, id).run();
}
