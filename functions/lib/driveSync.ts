/**
 * Archivage Google Drive des dossiers de candidature.
 *
 * D1 (dossier) + KV (photos) restent la source de vérité. Drive est une
 * archive, écrite APRÈS l'enregistrement durable :
 *
 *   WEBLACK TALENTS / <année> / Candidatures / <RÉFÉRENCE> /
 *       <RÉF>-recapitulatif.txt
 *       <RÉF>-portrait.jpg, <RÉF>-profil.jpg, <RÉF>-en-pied.jpg, <RÉF>-complementaire-N.jpg
 *
 * Aucun nom, aucune adresse dans les noms de dossiers ou de fichiers : la
 * référence seule. Chaque élément porte des propriétés d'application
 * (appProperties) qui le relient au dossier D1 — c'est par elles, pas par
 * leur nom, qu'une reprise retrouve ce qui existe déjà :
 *   - dossier commun   : weblackPath = root | 2026 | 2026/Candidatures
 *   - dossier candidat : weblackApplicationId = <uuid>
 *   - fichier          : weblackApplicationId + weblackSourceId (id photo | summary)
 *
 * Fiabilité :
 *   - la ligne drive_sync (pending_sync) est écrite dans la transaction du
 *     dossier : aucun dossier n'échappe à l'archivage ;
 *   - réservation atomique avant traitement (pas deux synchronisations
 *     simultanées du même dossier) ;
 *   - un fichier n'est marqué archivé qu'après relecture du dossier Drive
 *     (présence + taille), jamais sur la seule réponse du téléversement ;
 *   - reprise : dossier et fichiers retrouvés par leurs propriétés, rien
 *     n'est recréé ni téléversé deux fois ;
 *   - contrôle d'absence de partage public sur le dossier et ses fichiers ;
 *   - échec = statut sync_failed + code technique, le dossier D1 et les
 *     photos KV ne sont jamais touchés.
 */
import { DriveClient, DriveError, driveConfigured, type DriveEnv, type DriveFile } from "./googleDrive.ts";
import { getPhoto } from "./photos.ts";
import { referenceFor } from "./talentOutbox.ts";
import { formatApplicationField } from "../../src/lib/talent-application-display.ts";
import { ui } from "../../src/i18n/ui.ts";
import type { ApplicationRecord } from "./applicationTypes.ts";

export interface DriveSyncEnv extends DriveEnv {
  DB: D1Database;
  PHOTOS: KVNamespace;
}

export type DriveStatus = "pending_sync" | "syncing" | "synced" | "sync_failed";
export type DriveOutcome = "synced" | "failed" | "not_configured" | "skipped";

/** Tentatives automatiques ; au-delà, seule une relance manuelle (administration) retente. */
export const MAX_DRIVE_ATTEMPTS = 6;
const STALE_SYNCING_MS = 15 * 60 * 1000;
const RETRY_BACKOFF_MS = 5 * 60 * 1000;
const ROOT_NAME = "WEBLACK TALENTS";

export function driveSyncInsert(db: D1Database, applicationId: string, now: string): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO drive_sync (application_id, status, attempts, created_at, updated_at) VALUES (?, 'pending_sync', 0, ?, ?)`)
    .bind(applicationId, now, now);
}

interface SyncRow {
  application_id: string;
  status: DriveStatus;
  attempts: number;
  folder_id: string | null;
  updated_at: string;
}

interface Options {
  applicationIds?: string[];
  /** Relance manuelle : ignore le délai entre tentatives et le plafond automatique. */
  force?: boolean;
  limit?: number;
  now?: Date;
}

export async function syncDrive(env: DriveSyncEnv, options: Options = {}): Promise<Record<string, DriveOutcome>> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_SYNCING_MS).toISOString();
  const limit = Math.min(Math.max(options.limit ?? 1, 1), 10);
  const outcomes: Record<string, DriveOutcome> = {};

  const filters: string[] = [];
  const values: unknown[] = [staleBefore];
  if (!options.force) {
    filters.push("attempts < ?");
    values.push(MAX_DRIVE_ATTEMPTS);
  }
  if (options.applicationIds?.length) {
    filters.push(`application_id IN (${options.applicationIds.map(() => "?").join(", ")})`);
    values.push(...options.applicationIds);
  }
  const { results } = await env.DB.prepare(
    `SELECT application_id, status, attempts, folder_id, updated_at FROM drive_sync
     WHERE (status IN ('pending_sync', 'sync_failed') OR (status = 'syncing' AND updated_at < ?))
     ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
     ORDER BY created_at LIMIT ?`,
  )
    .bind(...values, limit)
    .all<SyncRow>();

  for (const row of results ?? []) {
    const id = row.application_id;

    if (!driveConfigured(env)) {
      // Rien n'est tenté, aucune tentative consommée : l'archivage partira dès l'autorisation donnée.
      await env.DB.prepare(`UPDATE drive_sync SET last_error = 'not_configured', updated_at = ? WHERE application_id = ? AND status IN ('pending_sync', 'sync_failed')`)
        .bind(nowIso, id)
        .run();
      outcomes[id] = "not_configured";
      continue;
    }

    if (!options.force && row.status === "sync_failed" && new Date(row.updated_at).getTime() + RETRY_BACKOFF_MS * row.attempts > now.getTime()) {
      outcomes[id] = "skipped";
      continue;
    }

    const claim = await env.DB.prepare(
      `UPDATE drive_sync SET status = 'syncing', attempts = attempts + 1, updated_at = ?
       WHERE application_id = ? AND (status IN ('pending_sync', 'sync_failed') OR (status = 'syncing' AND updated_at < ?))`,
    )
      .bind(nowIso, id, staleBefore)
      .run();
    if (claim.meta.changes !== 1) {
      outcomes[id] = "skipped";
      continue;
    }

    try {
      await archiveApplication(env, new DriveClient(env), id, row.folder_id, nowIso);
      await env.DB.prepare(`UPDATE drive_sync SET status = 'synced', last_error = NULL, last_synced_at = ?, updated_at = ? WHERE application_id = ?`)
        .bind(nowIso, nowIso, id)
        .run();
      outcomes[id] = "synced";
    } catch (error) {
      const code = error instanceof DriveError ? error.code : "internal";
      // Erreur qui ne se corrigera pas seule (autorisation révoquée…) : plus de relance automatique.
      const exhaust = error instanceof DriveError && !error.retryable;
      await env.DB.prepare(
        `UPDATE drive_sync SET status = 'sync_failed', last_error = ?, updated_at = ?${exhaust ? ", attempts = MAX(attempts, ?)" : ""} WHERE application_id = ?`,
      )
        .bind(...(exhaust ? [code.slice(0, 80), nowIso, MAX_DRIVE_ATTEMPTS, id] : [code.slice(0, 80), nowIso, id]))
        .run();
      outcomes[id] = "failed";
    }
  }
  return outcomes;
}

// --- Un dossier -------------------------------------------------------------------

interface PhotoRow {
  id: string;
  role: string;
  content_type: string;
}

interface Source {
  sourceId: string;
  name: string;
  mimeType: string;
  load: () => Promise<Uint8Array>;
}

const ROLE_FILE_NAMES: Record<string, string> = { portrait: "portrait", profile: "profil", full_length: "en-pied" };
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function archiveApplication(env: DriveSyncEnv, drive: DriveClient, applicationId: string, knownFolderId: string | null, nowIso: string): Promise<void> {
  const application = await env.DB.prepare(`SELECT * FROM applications WHERE id = ?`).bind(applicationId).first<ApplicationRecord>();
  if (!application) throw new DriveError("application_missing", false);
  const { results: photos } = await env.DB.prepare(`SELECT id, role, content_type FROM application_photos WHERE application_id = ? ORDER BY role, created_at, id`)
    .bind(applicationId)
    .all<PhotoRow>();

  const reference = referenceFor(applicationId);
  const year = application.created_at.slice(0, 4);

  // 1. Arborescence commune, puis dossier du candidat (créé ou retrouvé).
  const candidaturesId = await ensureCommonFolders(env.DB, drive, year, nowIso);
  const folderId = await ensureApplicationFolder(env.DB, drive, applicationId, reference, candidaturesId, knownFolderId);

  // 2. Sources à archiver : récapitulatif + photos validées.
  let extraIndex = 0;
  const sources: Source[] = [
    {
      sourceId: "summary",
      name: `${reference}-recapitulatif.txt`,
      mimeType: "text/plain; charset=utf-8",
      load: async () => new TextEncoder().encode(renderSummary(application, photos ?? [], reference)),
    },
    ...(photos ?? []).map((photo) => {
      const label = photo.role === "extra" ? `complementaire-${++extraIndex}` : (ROLE_FILE_NAMES[photo.role] ?? "photo");
      return {
        sourceId: photo.id,
        name: `${reference}-${label}.${EXTENSIONS[photo.content_type] ?? "img"}`,
        mimeType: photo.content_type,
        load: async () => {
          const stored = await getPhoto(env.PHOTOS, photo.id);
          // Photo absente du stockage : jamais un fichier vide à sa place.
          if (!stored) throw new DriveError("photo_missing_in_storage", false);
          return stored.bytes;
        },
      };
    }),
  ];

  // 3. Ce qui existe déjà dans Drive (reprise après échec ou après une
  //    réponse perdue) est retrouvé par propriété, jamais retéléversé.
  const bySource = (files: DriveFile[]) => new Map(files.filter((f) => f.appProperties?.weblackSourceId).map((f) => [f.appProperties!.weblackSourceId!, f]));
  const existing = bySource(await drive.listChildren(folderId));
  const expectedSizes = new Map<string, number>();
  for (const source of sources) {
    const bytes = await source.load();
    expectedSizes.set(source.sourceId, bytes.length);
    if (existing.has(source.sourceId)) continue;
    await drive.upload(source.name, folderId, source.mimeType.split(";")[0]!, bytes, {
      weblackApplicationId: applicationId,
      weblackSourceId: source.sourceId,
    });
  }

  // 4. Vérification réelle : relecture du dossier, chaque source présente avec la bonne taille.
  const present = bySource(await drive.listChildren(folderId));
  for (const source of sources) {
    const file = present.get(source.sourceId);
    if (!file) throw new DriveError("verify_missing_file");
    if (Number(file.size) !== expectedSizes.get(source.sourceId)) throw new DriveError("verify_size_mismatch");
  }

  // 5. Aucun partage public : ni sur le dossier, ni sur un fichier.
  for (const id of [folderId, ...[...present.values()].map((f) => f.id)]) {
    const permissions = await drive.listPermissions(id);
    if (permissions.some((p) => p.type === "anyone" || p.type === "domain")) throw new DriveError("public_permission_detected", false);
  }

  // 6. Identifiants Drive vérifiés enregistrés dans D1.
  await env.DB.batch(
    sources.map((source) => {
      const file = present.get(source.sourceId)!;
      return env.DB.prepare(
        `INSERT INTO drive_files (application_id, source_id, drive_file_id, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (application_id, source_id) DO UPDATE SET drive_file_id = excluded.drive_file_id, size_bytes = excluded.size_bytes`,
      ).bind(applicationId, source.sourceId, file.id, Number(file.size), nowIso);
    }),
  );
}

/** WEBLACK TALENTS / <année> / Candidatures — retrouvés (cache D1 puis propriété Drive) avant toute création. */
async function ensureCommonFolders(db: D1Database, drive: DriveClient, year: string, nowIso: string): Promise<string> {
  const leafPath = `${year}/Candidatures`;
  const cachedLeaf = await db.prepare(`SELECT folder_id FROM drive_folders WHERE path = ?`).bind(leafPath).first<{ folder_id: string }>();
  if (cachedLeaf) {
    // Le dossier peut avoir été mis à la corbeille à la main : on le vérifie avant de s'en servir.
    const alive = await drive.getFile(cachedLeaf.folder_id).then((f) => !f.trashed).catch((error) => {
      if (error instanceof DriveError && error.code === "drive_not_found") return false;
      throw error;
    });
    if (alive) return cachedLeaf.folder_id;
    await db.prepare(`DELETE FROM drive_folders WHERE path IN ('root', ?, ?)`).bind(year, leafPath).run();
  }
  const rootId = await ensureFolder(db, drive, "root", ROOT_NAME, undefined, nowIso);
  const yearId = await ensureFolder(db, drive, year, year, rootId, nowIso);
  return ensureFolder(db, drive, leafPath, "Candidatures", yearId, nowIso);
}

async function ensureFolder(db: D1Database, drive: DriveClient, path: string, name: string, parentId: string | undefined, nowIso: string): Promise<string> {
  const cached = await db.prepare(`SELECT folder_id FROM drive_folders WHERE path = ?`).bind(path).first<{ folder_id: string }>();
  if (cached) return cached.folder_id;

  const found = (await drive.findByProperty("weblackPath", path, parentId))[0];
  const created = found ? undefined : await drive.createFolder(name, parentId, { weblackPath: path });
  const folderId = (found ?? created)!.id;

  // Deux synchronisations ont pu créer le même dossier en parallèle : la
  // première inscrite gagne, l'autre dossier (vide, créé à l'instant) part
  // à la corbeille.
  await db.prepare(`INSERT INTO drive_folders (path, folder_id, created_at) VALUES (?, ?, ?) ON CONFLICT (path) DO NOTHING`).bind(path, folderId, nowIso).run();
  const winner = (await db.prepare(`SELECT folder_id FROM drive_folders WHERE path = ?`).bind(path).first<{ folder_id: string }>())!.folder_id;
  if (created && winner !== created.id) await drive.trash(created.id).catch(() => undefined);
  return winner;
}

async function ensureApplicationFolder(
  db: D1Database,
  drive: DriveClient,
  applicationId: string,
  reference: string,
  parentId: string,
  knownFolderId: string | null,
): Promise<string> {
  if (knownFolderId) {
    const known = await drive.getFile(knownFolderId).catch(() => undefined);
    if (known && !known.trashed) return knownFolderId;
  }
  const found = (await drive.findByProperty("weblackApplicationId", applicationId, parentId)).find((f) => !f.appProperties?.weblackSourceId);
  const folderId = found?.id ?? (await drive.createFolder(reference, parentId, { weblackApplicationId: applicationId, weblackReference: reference })).id;
  // Enregistré tout de suite : même si la suite échoue, la reprise réutilise ce dossier.
  await db.prepare(`UPDATE drive_sync SET folder_id = ? WHERE application_id = ?`).bind(folderId, applicationId).run();
  return folderId;
}

// --- Récapitulatif ------------------------------------------------------------------

const SUMMARY_GROUPS: { title: string; fields: [keyof ApplicationRecord, string][] }[] = [
  {
    title: "Profil",
    fields: [
      ["first_name", "Prénom"],
      ["last_name", "Nom"],
      ["birth_date", "Date de naissance"],
      ["city", "Ville"],
      ["country", "Pays"],
      ["email", "E-mail"],
      ["phone", "Téléphone"],
      ["instagram", "Instagram"],
    ],
  },
  {
    title: "Profil professionnel",
    fields: [
      ["talent_category", "Catégorie"],
      ["talent_category_other", "Précision"],
      ["experience_level", "Niveau"],
      ["experience_duration", "Durée d'expérience"],
      ["portfolio_links", "Liens"],
      ["current_agency", "Agence actuelle"],
      ["exclusivity", "Exclusivité"],
    ],
  },
  {
    title: "Mensurations",
    fields: [
      ["height_cm", "Taille (cm)"],
      ["chest_cm", "Poitrine (cm)"],
      ["waist_cm", "Tour de taille (cm)"],
      ["hips_cm", "Hanches (cm)"],
      ["inseam_cm", "Entrejambe (cm)"],
      ["shoe_size", "Pointure"],
      ["shoe_system", "Système de pointure"],
      ["clothing_size", "Taille de vêtements"],
      ["eye_color", "Yeux"],
      ["hair_color", "Cheveux"],
    ],
  },
  {
    title: "Disponibilités",
    fields: [
      ["languages", "Langues"],
      ["languages_other", "Autre langue"],
      ["mobility", "Mobilité"],
      ["desired_projects", "Projets recherchés"],
      ["motivation", "Présentation"],
    ],
  },
];

const PHOTO_ROLE_LABELS: Record<string, string> = { portrait: "Portrait", profile: "Profil", full_length: "En pied", extra: "Complémentaire" };

export function renderSummary(application: ApplicationRecord, photos: PhotoRow[], reference: string): string {
  const translate = (key: string) => (ui.fr as Record<string, string>)[key];
  const lines = [
    "WEBLACK TALENTS — Récapitulatif de candidature",
    "",
    `Référence : ${reference}`,
    `Identifiant système : ${application.id}`,
    `Reçue le : ${application.created_at} (UTC)`,
    `Langue du formulaire : ${(application.submission_lang ?? "fr").toUpperCase()}`,
    `Notice de confidentialité acceptée : ${application.privacy_notice_version}`,
  ];
  for (const group of SUMMARY_GROUPS) {
    const rows = group.fields
      .map(([key, label]) => [label, formatApplicationField(key, application[key], translate)] as const)
      .filter(([, text]) => text !== "");
    if (rows.length === 0) continue;
    lines.push("", group.title.toUpperCase(), ...rows.map(([label, text]) => `${label} : ${text}`));
  }
  lines.push("", "PHOTOS", ...photos.map((p) => `${PHOTO_ROLE_LABELS[p.role] ?? p.role} (${p.content_type})`));
  lines.push(
    "",
    "--",
    "Archive générée automatiquement. Le dossier de référence (statut, notes, suppression) est géré dans l'administration WEBLACK : https://www.weblack.fr/admin/candidatures/",
    "Document confidentiel : ne pas partager ce dossier par lien public.",
  );
  return `${lines.join("\n")}\n`;
}
