import { newRunId } from "../logs/runId.ts";
import { log } from "../logs/logger.ts";
import { planSearches, discoverPages } from "./discover.ts";
import { verifyEventPage, revalidateEvent } from "./verify.ts";
import { resolveMissingFields } from "./resolve.ts";
import { currentEvents, findEvent, mergeEvent, saveEvent, expirePastEvents, upcomingEvents, reviewEvents } from "./store.ts";
import { isAgendaEligible } from "./types.ts";
import { publishEvent, reflectStatusChange, listPublishedEvents, withdrawEvent } from "../sanity/events.ts";

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
  /** Écrits dans Sanity : nouveaux documents, mises à jour, et annulations répercutées. */
  published: number;
  updated: number;
  statusReflected: number;
}

/** Combien de recherches par cycle. Volontairement bas : la fiabilité prime sur le volume, et la rotation couvre les villes au fil des cycles. */
const SEARCHES_PER_CYCLE = 3;
/** Combien de pages déjà connues on re-vérifie à chaque passage — c'est ainsi qu'un report ou une annulation est rattrapé. */
const REVALIDATIONS_PER_CYCLE = 3;

/**
 * Un passage d'Agenda, appelé depuis le cycle éditorial existant.
 *
 * Il ne crée ni boucle, ni planificateur, ni verrou propre : il s'exécute à
 * l'intérieur du cycle qui détient déjà le verrou anti-concurrence.
 *
 * Tout ce qu'il lit va d'abord dans le stock interne ; seule la part
 * éligible — vérifiée, complète, en territoire — est ensuite écrite dans
 * Sanity. Le stock garde donc la trace de ce qui a été écarté et pourquoi,
 * ce que Sanity, lui, n'a pas à porter.
 */
export async function runAgendaCycle(dryRun: boolean, searchSeed?: number): Promise<AgendaCycleResult> {
  const runId = newRunId();
  const result: AgendaCycleResult = {
    searches: 0, pagesConsulted: 0, eventsFound: 0, eventsNew: 0,
    eventsMerged: 0, inReview: 0, expired: 0, revalidated: 0, cancelledOrGone: 0,
    complementaryPages: 0, fieldsResolved: 0, resolvedToVerified: 0,
    published: 0, updated: 0, statusReflected: 0,
  };

  // Ce qui est fini cesse d'abord d'être annoncé comme à venir.
  result.expired = expirePastEvents().expired;

  // Sans graine explicite, la rotation avance d'elle-même d'un cran par
  // heure — soit un cycle. En passer une permet de dérouler plusieurs
  // cycles d'affilée sans qu'ils interrogent tous les mêmes villes.
  for (const query of planSearches(SEARCHES_PER_CYCLE, searchSeed)) {
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
    let refreshed = await revalidateEvent(event, runId);
    // Une re-lecture perd parfois une donnée que la page portait la
    // première fois — un communiqué de presse qui ne répète pas la ville,
    // par exemple. Le domaine officiel a droit à la même question ici que
    // lors de la découverte : sans cela, un événement déjà publié tombe en
    // revue pour une donnée qui n'a jamais cessé d'exister.
    if (refreshed.missingFields.length > 0 && refreshed.verificationStatus === "REVIEW") {
      const resolution = await resolveMissingFields(refreshed, runId);
      result.complementaryPages += resolution.pagesTried.length;
      result.fieldsResolved += resolution.resolvedFields.length;
      if (!resolution.contradiction && resolution.event.missingFields.length === 0) {
        refreshed = { ...resolution.event, verificationStatus: "VERIFIED", note: "" };
        result.resolvedToVerified++;
      } else if (resolution.contradiction) {
        refreshed = { ...resolution.event, verificationStatus: "REVIEW", note: resolution.contradiction };
      }
    }
    if (!dryRun) saveEvent(refreshed);
    result.revalidated++;
    if (refreshed.verificationStatus === "CANCELLED" || refreshed.verificationStatus === "GONE") result.cancelledOrGone++;
  }

  // Publication : uniquement ce qui est éligible, c'est-à-dire vérifié sur
  // la page officielle, complet, en territoire, et porteur d'une raison
  // d'être annoncé. Rien n'est dégradé en brouillon pour remplir la page.
  if (!dryRun) {
    for (const event of upcomingEvents()) {
      if (!isAgendaEligible(event)) continue;
      try {
        const written = await publishEvent(event);
        if (written.created) result.published++;
        else result.updated++;
      } catch (error) {
        log("SANITY", `Agenda — écriture refusée pour « ${event.eventName} » : ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Ce qui est en ligne doit rester vrai. Un événement annulé, une page
    // disparue, une donnée essentielle qui s'efface entre deux lectures :
    // le document est mis à jour pour que le site cesse de l'annoncer,
    // jamais supprimé en silence — effacer ferait disparaître l'information
    // sans laisser trace de la raison.
    const connus = new Map(currentEvents().map((e) => [e.id, e]));
    try {
      for (const doc of await listPublishedEvents()) {
        const event = connus.get(doc.engineId);
        if (event && isAgendaEligible(event)) continue;
        if (doc.verificationStatus !== "VERIFIED") continue; // déjà retiré de l'annonce

        if (event && (event.verificationStatus === "CANCELLED" || event.verificationStatus === "GONE")) {
          if (await reflectStatusChange(event)) result.statusReflected++;
          continue;
        }
        await withdrawEvent(doc._id, event ? event.note || "l'événement n'est plus éligible" : "événement absent du stock");
        result.statusReflected++;
      }
    } catch (error) {
      log("SANITY", `Agenda — confrontation avec les documents en ligne impossible : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log(
    "SOURCE FOUND",
    `Agenda — ${result.searches} recherche(s), ${result.pagesConsulted} page(s), ${result.eventsFound} événement(s) lu(s) : ${result.eventsNew} nouveau(x), ${result.eventsMerged} fusionné(s), ${result.inReview} en revue, ${result.expired} expiré(s), ${result.revalidated} re-vérifié(s)${dryRun ? " [dry-run, rien stocké]" : ""}`,
  );
  log("SOURCE FOUND", `Agenda — stock : ${upcomingEvents().length} événement(s) vérifié(s) à venir, ${reviewEvents().length} en attente de décision humaine`);
  log("SANITY", `Agenda — Sanity : ${result.published} publié(s), ${result.updated} mis à jour, ${result.statusReflected} changement(s) d’état répercuté(s)${dryRun ? " [dry-run, rien écrit]" : ""}`);
  return result;
}
