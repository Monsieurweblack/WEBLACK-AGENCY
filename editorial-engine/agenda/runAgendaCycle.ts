import { newRunId } from "../logs/runId.ts";
import { log } from "../logs/logger.ts";
import { planSearches, discoverPages } from "./discover.ts";
import { verifyEventPage, revalidateEvent } from "./verify.ts";
import { resolveMissingFields } from "./resolve.ts";
import { currentEvents, findEvent, mergeEvent, saveEvent, expirePastEvents, upcomingEvents, reviewEvents } from "./store.ts";

export interface AgendaCycleResult {
  searches: number;
  pagesConsulted: number;
  eventsFound: number;
  eventsNew: number;
  eventsMerged: number;
  inReview: number;
  expired: number;
  revalidated: number;
  cancelledOrGone: number;
  /** Pages voisines du domaine officiel ouvertes pour combler une donnée manquante. */
  complementaryPages: number;
  fieldsResolved: number;
  /** Événements qui seraient partis en revue et que le domaine officiel a permis de vérifier. */
  resolvedToVerified: number;
}

/** Combien de recherches par cycle. Volontairement bas : la fiabilité prime sur le volume, et la rotation couvre les villes au fil des cycles. */
const SEARCHES_PER_CYCLE = 3;
/** Combien de pages déjà connues on re-vérifie à chaque passage — c'est ainsi qu'un report ou une annulation est rattrapé. */
const REVALIDATIONS_PER_CYCLE = 3;

/**
 * Un passage d'Agenda, appelé depuis le cycle éditorial existant.
 *
 * Il ne crée ni boucle, ni planificateur, ni verrou propre : il s'exécute à
 * l'intérieur du cycle qui détient déjà le verrou anti-concurrence, et
 * n'écrit rien dans Sanity. Tout ce qu'il produit va dans le stock interne.
 */
export async function runAgendaCycle(dryRun: boolean): Promise<AgendaCycleResult> {
  const runId = newRunId();
  const result: AgendaCycleResult = {
    searches: 0, pagesConsulted: 0, eventsFound: 0, eventsNew: 0,
    eventsMerged: 0, inReview: 0, expired: 0, revalidated: 0, cancelledOrGone: 0,
    complementaryPages: 0, fieldsResolved: 0, resolvedToVerified: 0,
  };

  // Ce qui est fini cesse d'abord d'être annoncé comme à venir.
  result.expired = expirePastEvents().expired;

  for (const query of planSearches(SEARCHES_PER_CYCLE)) {
    result.searches++;
    const pages = await discoverPages(query, runId);
    result.pagesConsulted += pages.length;

    for (const page of pages) {
      let event = await verifyEventPage(page.url, runId);
      if (!event) continue;
      result.eventsFound++;

      // Une donnée essentielle absente de la page principale ne vaut pas
      // rejet tant que le domaine officiel n'a pas été interrogé : les
      // horaires et les dates vivent souvent sur la page voisine.
      if (event.missingFields.length > 0 && event.verificationStatus === "REVIEW") {
        const resolution = await resolveMissingFields(event, runId);
        result.complementaryPages += resolution.pagesTried.length;
        result.fieldsResolved += resolution.resolvedFields.length;

        if (resolution.contradiction) {
          event = { ...resolution.event, verificationStatus: "REVIEW", note: resolution.contradiction };
        } else if (resolution.event.missingFields.length === 0) {
          event = { ...resolution.event, verificationStatus: "VERIFIED", note: "" };
          result.resolvedToVerified++;
        } else {
          event = {
            ...resolution.event,
            note: `Donnée(s) essentielle(s) introuvable(s), y compris sur le domaine officiel : ${resolution.event.missingFields.join(", ")}.`,
          };
        }
      }

      if (event.verificationStatus === "REVIEW") result.inReview++;
      if (event.verificationStatus === "CANCELLED" || event.verificationStatus === "GONE") result.cancelledOrGone++;

      const existing = findEvent(event.id);
      if (existing) {
        // Même exposition annoncée ailleurs : une seule entrée, la meilleure source fait foi.
        if (!dryRun) saveEvent(mergeEvent(existing, event));
        result.eventsMerged++;
      } else {
        if (!dryRun) saveEvent(event);
        result.eventsNew++;
      }
    }
  }

  // Re-vérification des entrées les plus anciennement contrôlées.
  const stale = currentEvents()
    .filter((e) => e.status !== "EXPIRED")
    .sort((a, b) => a.lastVerifiedAt.localeCompare(b.lastVerifiedAt))
    .slice(0, REVALIDATIONS_PER_CYCLE);

  for (const event of stale) {
    const refreshed = await revalidateEvent(event, runId);
    if (!dryRun) saveEvent(refreshed);
    result.revalidated++;
    if (refreshed.verificationStatus === "CANCELLED" || refreshed.verificationStatus === "GONE") result.cancelledOrGone++;
  }

  log(
    "SOURCE FOUND",
    `Agenda — ${result.searches} recherche(s), ${result.pagesConsulted} page(s), ${result.eventsFound} événement(s) lu(s) : ${result.eventsNew} nouveau(x), ${result.eventsMerged} fusionné(s), ${result.inReview} en revue, ${result.expired} expiré(s), ${result.revalidated} re-vérifié(s)${dryRun ? " [dry-run, rien stocké]" : ""}`,
  );
  log("SOURCE FOUND", `Agenda — stock : ${upcomingEvents().length} événement(s) vérifié(s) à venir, ${reviewEvents().length} en attente de décision humaine`);
  return result;
}
