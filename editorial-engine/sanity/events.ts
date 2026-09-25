import { getSanityClient } from "./client.ts";
import { log } from "../logs/logger.ts";
import { isAgendaEligible, effectiveStatus, computeStatus, type AgendaEvent, type ControlMode } from "../agenda/types.ts";

/**
 * Écrit l'Agenda vérifié dans Sanity, un document `event` par événement.
 *
 * Deux principes, repris du reste du moteur.
 *
 * D'abord, rien ne part qui ne soit éligible : vérifié sur la page
 * officielle, complet, dans un territoire du Journal, et porteur d'une
 * raison d'être annoncé. `publishEvent` refuse le reste plutôt que de le
 * dégrader en brouillon — un agenda à moitié sûr n'a pas d'intérêt.
 *
 * Ensuite, l'écriture est idempotente. L'identité déterministe de
 * l'événement (nom + lieu + date de début) sert d'ancre : le cycle suivant
 * retrouve le document et le met à jour au lieu d'en créer un second. C'est
 * ce qui permet à la re-vérification de rattraper un report ou une
 * annulation sur un événement déjà publié.
 */

const ID_PREFIX = "event-editorial-engine-";

export interface EventPublication {
  documentId: string;
  created: boolean;
}

/** Slug lisible et stable : le nom porte le sens, la date de début lève les homonymies d'une édition à l'autre. */
export function eventSlug(event: AgendaEvent): string {
  const base = event.eventName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${base || "evenement"}-${event.startDate}`;
}

/** Le document tel qu'il sera écrit. Extrait pour être vérifiable sans toucher à Sanity. */
export function toEventDocument(event: AgendaEvent): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    _type: "event",
    eventName: event.eventName,
    slug: { _type: "slug", current: eventSlug(event) },
    startDate: event.startDate,
    venue: event.venue,
    city: event.city,
    territory: event.territory,
    editorialValue: event.editorialValue,
    editorialRelevance: event.editorialRelevance,
    officialUrl: event.officialUrl,
    sourceUrls: [...new Set(event.sourceUrls)],
    verificationStatus: event.verificationStatus,
    // Le statut publié réunit la position dans le temps et ce qui a pu être
    // établi : c'est le seul champ que le site ait à lire pour décider
    // d'annoncer un événement ou non.
    status: effectiveStatus(event),
    lastVerifiedAt: event.lastVerifiedAt,
    engineId: event.id,
    featured: false,
    // La provenance voyage avec la donnée : un relecteur doit pouvoir
    // remonter à la page qui établit chaque date et chaque lieu.
    sources: Object.entries(event.fieldSources).map(([field, url]) => ({ _type: "object", _key: field, field, url })),
  };

  doc.geographicPriority = event.geographicPriority ?? "INTERNATIONAL";
  doc.controlMode = event.controlMode ?? "AUTOMATED";
  if ((event.timezone ?? "").trim()) doc.timezone = event.timezone.trim();

  // Les champs que la source n'a pas donnés ne sont pas écrits : une chaîne
  // vide dans Sanity se lirait comme une donnée, alors qu'il n'y en a pas.
  const optional: [string, string][] = [
    ["endDate", event.endDate],
    ["time", event.time],
    ["eventType", event.eventType],
    ["discipline", event.discipline],
    ["disciplineEn", event.disciplineEn ?? ""],
    ["artistOrCreator", event.artistOrCreator],
    ["institution", event.institution],
    ["organizer", event.organizer],
    ["country", event.country],
    ["countryEn", event.countryEn ?? ""],
    ["descriptionFr", event.descriptionFr ?? ""],
    ["descriptionEn", event.descriptionEn ?? ""],
    ["geographicJustification", event.geographicJustification ?? ""],
  ];
  for (const [key, value] of optional) {
    if (value.trim()) doc[key] = value.trim();
  }
  return doc;
}

/**
 * Champs qu'un éditeur peut corriger dans le Studio — mêmes noms, même
 * portée que EDITORIAL_PROTECTED_FIELDS côté stock local (agenda/store.ts).
 * Dupliqué plutôt qu'importé : ce module écrit des documents Sanity bruts
 * (Record<string, unknown>), pas des AgendaEvent, et les deux listes n'ont
 * aucune raison structurelle de rester le même objet TypeScript — seulement
 * la même liste de noms, à maintenir en phase.
 */
const SANITY_EDITORIAL_PROTECTED_FIELDS = [
  "eventName", "eventType", "discipline", "disciplineEn", "artistOrCreator", "institution",
  "venue", "city", "country", "countryEn", "organizer",
  "territory", "editorialValue", "descriptionFr", "descriptionEn", "editorialRelevance",
  "geographicPriority", "geographicJustification", "timezone",
] as const;

export interface ExistingEventDocument {
  _id: string;
  slug?: { current?: string };
  controlMode?: ControlMode;
  startDate?: string;
  endDate?: string;
  [field: string]: unknown;
}

/** Retrouve le document déjà écrit pour cet événement, s'il existe — avec tout ce qu'il faut pour respecter un contrôle éditorial déjà posé dans le Studio. */
export async function findEventDocument(engineId: string): Promise<ExistingEventDocument | null> {
  const client = getSanityClient();
  return client.fetch(
    `*[_type == "event" && engineId == $engineId][0]{ _id, slug, controlMode, startDate, endDate, ${SANITY_EDITORIAL_PROTECTED_FIELDS.join(", ")} }`,
    { engineId },
  );
}

/**
 * Décide ce qui part réellement en écriture, selon ce qu'un éditeur a posé
 * DANS SANITY — pas dans le stock local du moteur, qui n'a aucune vue sur
 * une modification faite directement dans le Studio. C'est le pendant, côté
 * Sanity, d'`applyControlMode` (agenda/store.ts) : même principe, sur la
 * forme de document que ce module manipule.
 *
 * AUTOMATED (ou absent — documents antérieurs à ce champ) : `fresh` s'écrit
 * tel quel, comportement historique inchangé.
 * EDITORIAL : rien du contenu ne part ; seul `status` est recalculé depuis
 * les dates ACTUELLEMENT dans Sanity (qu'un éditeur a pu lui-même corrigées).
 * HYBRID : le factuel de `fresh` s'écrit, l'éditorial déjà posé dans Sanity
 * est repris tel quel par-dessus.
 */
export function applySanityControlMode(existing: ExistingEventDocument, fresh: Record<string, unknown>): Record<string, unknown> {
  const controlMode = existing.controlMode;
  if (!controlMode || controlMode === "AUTOMATED") return fresh;

  if (controlMode === "EDITORIAL") {
    return { status: computeStatus(existing.startDate ?? "", existing.endDate ?? ""), lastVerifiedAt: new Date().toISOString() };
  }

  const preserved = Object.fromEntries(
    SANITY_EDITORIAL_PROTECTED_FIELDS.filter((field) => existing[field] !== undefined).map((field) => [field, existing[field]]),
  );
  return { ...fresh, ...preserved };
}

/**
 * Une URL publique ne bouge pas.
 *
 * Le slug se déduit du nom de l'événement, et une re-lecture de la même page
 * peut le formuler autrement — « Berlin Fashion Week 2027 » puis « Berlin
 * Fashion Week ». Laisser le slug suivre reviendrait à déplacer une page
 * déjà indexée et déjà partagée, sur une variation de style. Le nom affiché,
 * lui, se met bien à jour : c'est l'adresse qui est figée, pas le contenu.
 */
export function preserveSlug(doc: Record<string, unknown>, existingSlug: string | undefined): Record<string, unknown> {
  if (!existingSlug) return doc;
  return { ...doc, slug: { _type: "slug", current: existingSlug } };
}

/**
 * Publie un événement, ou met à jour celui qui existe déjà.
 *
 * Refuse tout ce qui n'est pas éligible : c'est la même règle que pour les
 * articles — on ne contourne jamais un échec de vérification pour remplir
 * une page.
 */
export async function publishEvent(event: AgendaEvent): Promise<EventPublication> {
  if (!isAgendaEligible(event)) {
    throw new Error(
      `Événement non éligible, écriture refusée : « ${event.eventName} » (${event.verificationStatus}, territoire ${event.territory}, pertinence ${event.editorialRelevance}).`,
    );
  }

  const client = getSanityClient();
  const existing = await findEventDocument(event.id);
  const doc = toEventDocument(event);

  if (existing) {
    const toWrite = applySanityControlMode(existing, preserveSlug(doc, existing.slug?.current));
    if (existing.controlMode === "EDITORIAL") {
      log("SANITY", `Agenda — ${existing._id} sous contrôle éditorial : seul le statut temporel est recalculé (${event.eventName})`);
    } else {
      log("SANITY", `Agenda — mise à jour ${existing._id} : ${event.eventName}`);
    }
    await client.patch(existing._id).set(toWrite).commit();
    return { documentId: existing._id, created: false };
  }

  const _id = `${ID_PREFIX}${event.id}`;
  log("SANITY", `Agenda — publication ${_id} : ${event.eventName}`);
  const created = await client.createOrReplace({ _id, ...doc } as { _id: string; _type: string });
  return { documentId: created._id, created: true };
}

/** Les événements déjà écrits dans Sanity, pour confronter ce qui est en ligne à ce que le moteur sait aujourd'hui. */
export async function listPublishedEvents(): Promise<{ _id: string; engineId: string; verificationStatus: string }[]> {
  const client = getSanityClient();
  return client.fetch(`*[_type == "event" && defined(engineId)]{ _id, engineId, verificationStatus }`);
}

/**
 * Retire de l'annonce un événement en ligne que le moteur ne juge plus
 * publiable.
 *
 * Une annulation n'est pas le seul cas : une re-vérification peut découvrir
 * qu'une donnée essentielle a disparu de la page, ou qu'un événement n'est
 * finalement pas en territoire. Le document reste, son état dit pourquoi.
 */
export async function withdrawEvent(documentId: string, reason: string): Promise<void> {
  const client = getSanityClient();
  log("SANITY", `Agenda — retrait de l'annonce ${documentId} : ${reason}`);
  await client.patch(documentId).set({ verificationStatus: "REVIEW", status: "REVIEW", lastVerifiedAt: new Date().toISOString() }).commit();
}

/**
 * Répercute une annulation, un report ou la disparition d'une page sur un
 * événement DÉJÀ publié.
 *
 * Le document n'est pas supprimé : son état de vérification est écrit tel
 * quel, pour que le site cesse de l'annoncer et qu'un relecteur voie ce qui
 * s'est passé. Effacer ferait disparaître l'information sans laisser de
 * trace de la raison.
 */
export async function reflectStatusChange(event: AgendaEvent): Promise<boolean> {
  const existing = await findEventDocument(event.id);
  if (!existing) return false;

  const client = getSanityClient();
  log("SANITY", `Agenda — ${event.eventName} passe en ${event.verificationStatus}, document ${existing._id} mis à jour`);
  await client
    .patch(existing._id)
    .set({ verificationStatus: event.verificationStatus, status: effectiveStatus(event), lastVerifiedAt: event.lastVerifiedAt })
    .commit();
  return true;
}
