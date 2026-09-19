import { getSanityClient } from "./client.ts";
import { log } from "../logs/logger.ts";
import type { NowSignal } from "../now/types.ts";

/**
 * Écrit un signal WEBLACK NOW dans Sanity — un document `nowSignal` par
 * signal d'origine "editorial-signal" uniquement. Un signal "ongoing-event"
 * n'est JAMAIS écrit ici : il est déjà un document `event`, publié par
 * l'Agenda (sanity/events.ts) — l'écrire une seconde fois sous un autre
 * type dupliquerait une donnée déjà vraie ailleurs. Voir runNowCycle.ts,
 * qui ne passe à cette fonction que des signaux "editorial-signal".
 *
 * Mêmes deux principes que sanity/events.ts : rien ne part qui ne soit
 * éligible (status "published", décidé par now/qualityGate.ts — cette
 * fonction ne rejuge jamais cette décision, elle refuse simplement d'écrire
 * ce qui ne la porte pas) ; l'écriture est idempotente via l'identité
 * déterministe du signal.
 *
 * Le type Sanity `nowSignal` est documenté et écrit dans WEBLACK-STUDIO
 * (schemaTypes/documents/nowSignal.ts) mais volontairement PAS DÉPLOYÉ dans
 * ce chantier — voir le rapport du bloc 06, §13 : un déploiement de schéma
 * est une action délibérée, distincte de la construction du pipeline.
 * Avant ce déploiement, un appel à cette fonction échoue simplement avec
 * l'erreur Sanity native "unknown document type" — un échec explicite,
 * jamais une écriture silencieuse dans le vide.
 */

const ID_PREFIX = "now-signal-editorial-engine-";

export interface NowSignalPublication {
  documentId: string;
  created: boolean;
}

export function nowSignalSlug(signal: NowSignal): string {
  const base = signal.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${base || "signal"}-${signal.discoveredAt.slice(0, 10)}`;
}

/** Le document tel qu'il sera écrit — extrait pour être vérifiable sans toucher à Sanity, même convention que toEventDocument(). */
export function toNowSignalDocument(signal: NowSignal): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    _type: "nowSignal",
    title: signal.title,
    titleEn: signal.titleEn,
    slug: { _type: "slug", current: nowSignalSlug(signal) },
    territory: signal.territory,
    summary: signal.summary,
    summaryEn: signal.summaryEn,
    relevanceReason: signal.relevanceReason,
    sourceName: signal.source.name,
    sourceUrl: signal.source.url,
    sourcePublisher: signal.source.publisher,
    sourceRank: signal.source.rank,
    discoveredAt: signal.discoveredAt,
    language: signal.language,
    relevanceScore: signal.relevance.composite,
    engineId: signal.id,
  };
  if (signal.date) doc.eventDate = signal.date;
  if (signal.source.publishedAt) doc.sourcePublishedAt = signal.source.publishedAt;
  if (signal.imageUrl) doc.imageUrl = signal.imageUrl;
  return doc;
}

export async function findNowSignalDocument(engineId: string): Promise<{ _id: string } | null> {
  const client = getSanityClient();
  return client.fetch(`*[_type == "nowSignal" && engineId == $engineId][0]{ _id }`, { engineId });
}

export async function publishNowSignal(signal: NowSignal): Promise<NowSignalPublication> {
  if (signal.status !== "published") {
    throw new Error(`Signal non éligible à l'écriture (statut "${signal.status}") : « ${signal.title} ». ${signal.statusReason}`);
  }
  if (signal.origin !== "editorial-signal") {
    throw new Error(`Signal d'origine "${signal.origin}" — jamais écrit dans Sanity (voir le commentaire en tête de fichier) : « ${signal.title} ».`);
  }

  const client = getSanityClient();
  const existing = await findNowSignalDocument(signal.id);
  const doc = toNowSignalDocument(signal);

  if (existing) {
    log("SANITY", `NOW — mise à jour ${existing._id} : ${signal.title}`);
    await client.patch(existing._id).set(doc).commit();
    return { documentId: existing._id, created: false };
  }

  const _id = `${ID_PREFIX}${signal.id}`;
  log("SANITY", `NOW — publication ${_id} : ${signal.title}`);
  const created = await client.createOrReplace({ _id, ...doc } as { _id: string; _type: string });
  return { documentId: created._id, created: true };
}
