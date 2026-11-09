/**
 * Effacement (droit à l'effacement, RGPD art. 17) — un seul module pour la
 * suppression d'un dossier et l'effacement complet d'une personne.
 *
 * Ordre, pour une candidature :
 *  1. archive Google Drive → corbeille (récupérable 30 jours côté Google) ;
 *     si Drive refuse, RIEN n'est supprimé, l'administrateur réessaie ;
 *  2. D1 en une transaction (historique, fichiers Drive, suivi, e-mails,
 *     photos, dossier) ;
 *  3. photos KV, une fois le dossier réellement supprimé.
 *
 * L'effacement d'une personne enchaîne ces suppressions pour chacun de ses
 * dossiers et s'arrête au premier échec : ce qui a été supprimé l'est
 * proprement, le reste demeure intact et l'opération peut être relancée.
 * Le journal d'audit ne garde que l'empreinte du contact et des compteurs.
 */
import { audit } from "./audit.ts";
import { contactKey, normalizeEmail } from "./contacts.ts";
import { deletePhoto } from "./photos.ts";
import { DriveClient, DriveError, driveConfigured, type DriveEnv } from "./googleDrive.ts";

export interface ErasureEnv extends DriveEnv {
  DB: D1Database;
  PHOTOS: KVNamespace;
}

export type DeleteResult = { ok: true } | { ok: false; reason: string; code?: string; status: number };

export async function deleteApplicationRecord(env: ErasureEnv, id: string): Promise<DeleteResult> {
  const { results: photos } = await env.DB.prepare(`SELECT id FROM application_photos WHERE application_id = ?`).bind(id).all<{ id: string }>();

  const archived = await env.DB.prepare(`SELECT folder_id FROM drive_sync WHERE application_id = ?`).bind(id).first<{ folder_id: string | null }>();
  if (archived?.folder_id) {
    if (!driveConfigured(env)) return { ok: false, reason: "drive_not_configured", status: 409 };
    try {
      await new DriveClient(env).trash(archived.folder_id);
    } catch (error) {
      if (!(error instanceof DriveError && error.code === "drive_not_found")) {
        return { ok: false, reason: "drive_trash_failed", code: error instanceof DriveError ? error.code : "internal", status: 502 };
      }
    }
  }

  const results = await env.DB.batch([
    env.DB.prepare(`DELETE FROM application_events WHERE application_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM drive_files WHERE application_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM drive_sync WHERE application_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM email_outbox WHERE application_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM application_photos WHERE application_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM applications WHERE id = ?`).bind(id),
  ]);
  const deleted = results[results.length - 1];
  if (!deleted || deleted.meta.changes === 0) return { ok: false, reason: "not_found", status: 404 };

  for (const photo of photos ?? []) await deletePhoto(env.PHOTOS, photo.id);
  await audit(env.DB, "application.delete", "application", id);
  return { ok: true };
}

export async function deleteInquiryRecord(db: D1Database, id: string): Promise<DeleteResult> {
  const results = await db.batch([
    db.prepare(`DELETE FROM business_inquiry_events WHERE inquiry_id = ?`).bind(id),
    db.prepare(`DELETE FROM business_inquiries WHERE id = ?`).bind(id),
  ]);
  const deleted = results[results.length - 1];
  if (!deleted || deleted.meta.changes === 0) return { ok: false, reason: "not_found", status: 404 };
  await audit(db, "inquiry.delete", "inquiry", id);
  return { ok: true };
}

export interface ContactErasure {
  ok: boolean;
  applicationsDeleted: number;
  inquiriesDeleted: number;
  failed?: { kind: "application" | "inquiry"; reason: string; code?: string };
}

/** Efface tout ce que la base détient sur une adresse. Les tables de l'espace membre sont purgées aussi si elles existent. */
export async function eraseContact(env: ErasureEnv, email: string): Promise<ContactErasure> {
  const e = normalizeEmail(email);
  const out: ContactErasure = { ok: true, applicationsDeleted: 0, inquiriesDeleted: 0 };
  const { results: apps } = await env.DB.prepare(`SELECT id FROM applications WHERE lower(email) = ?`).bind(e).all<{ id: string }>();
  for (const a of apps ?? []) {
    const r = await deleteApplicationRecord(env, a.id);
    if (!r.ok) return { ...out, ok: false, failed: { kind: "application", reason: r.reason, code: r.code } };
    out.applicationsDeleted++;
  }
  const { results: inquiries } = await env.DB.prepare(`SELECT id FROM business_inquiries WHERE lower(email) = ?`).bind(e).all<{ id: string }>();
  for (const i of inquiries ?? []) {
    const r = await deleteInquiryRecord(env.DB, i.id);
    if (!r.ok) return { ...out, ok: false, failed: { kind: "inquiry", reason: r.reason } };
    out.inquiriesDeleted++;
  }
  const key = await contactKey(e);
  // Espace membre (migrations/0007) : jetons de connexion liés à cette empreinte.
  try {
    await env.DB.prepare(`DELETE FROM member_login_tokens WHERE email_key = ?`).bind(key).run();
  } catch {
    // Table absente (base non migrée) : rien à effacer.
  }
  await audit(env.DB, "contact.erase", "contact", key, `applications=${out.applicationsDeleted},inquiries=${out.inquiriesDeleted}`);
  return out;
}
