import { newRunId } from "../logs/runId.ts";
import { log } from "../logs/logger.ts";
import { discoverEditorialSignals } from "./discover.ts";
import { currentSignals, findSignal, saveSignal } from "./store.ts";
import { publishNowSignal } from "../sanity/now.ts";

/**
 * Un passage de WEBLACK NOW — même esprit que runAgendaCycle.ts : ne crée
 * ni boucle, ni verrou propre ; s'exécute à l'intérieur du cycle qui en
 * détient déjà un (scheduler/cycleLock.ts). Ce chantier ne modifie ni ce
 * verrou ni le cycle éditorial du Journal — voir cli.ts pour l'appel
 * indépendant `npm run editorial:now`.
 *
 * Deux flux, un seul stock : discoverEditorialSignals() (RSS) alimente le
 * stock local ; deriveFromOngoingEvent() (agenda/store.ts, voir
 * discover.ts) n'y entre PAS — un événement Agenda ONGOING reste sa propre
 * source de vérité, jamais dupliqué dans le stock NOW (voir
 * src/lib/content.ts getNowSignals(), qui unifie les deux au moment de la
 * lecture, côté site).
 */
export interface NowCycleResult {
  candidatesFound: number;
  newSignals: number;
  published: number;
  updated: number;
  review: number;
  rejected: number;
}

export async function runNowCycle(dryRun: boolean, maxCandidates = 6): Promise<NowCycleResult> {
  const runId = newRunId();
  const result: NowCycleResult = { candidatesFound: 0, newSignals: 0, published: 0, updated: 0, review: 0, rejected: 0 };

  const candidates = await discoverEditorialSignals(runId, maxCandidates);
  result.candidatesFound = candidates.length;

  for (const signal of candidates) {
    if (!findSignal(signal.id)) {
      if (!dryRun) saveSignal(signal);
      result.newSignals++;
    } else if (!dryRun) {
      saveSignal(signal); // ré-évaluation d'un signal déjà connu (ex. passé de REVIEW à REJECTED après relecture) — append-only, même principe que agenda/store.ts.
    }

    if (signal.status === "review") result.review++;
    if (signal.status === "rejected") result.rejected++;
  }

  if (!dryRun) {
    for (const signal of currentSignals()) {
      if (signal.status !== "published" || signal.origin !== "editorial-signal") continue;
      try {
        const written = await publishNowSignal(signal);
        if (written.created) result.published++;
        else result.updated++;
      } catch (error) {
        log("SANITY", `NOW — écriture refusée pour « ${signal.title} » : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  log(
    "SOURCE FOUND",
    `NOW — ${result.candidatesFound} candidat(s) analysé(s) : ${result.newSignals} nouveau(x), ${result.review} en revue, ${result.rejected} rejeté(s)${dryRun ? " [dry-run, rien stocké]" : ""}`,
  );
  log("SANITY", `NOW — Sanity : ${result.published} publié(s), ${result.updated} mis à jour${dryRun ? " [dry-run, rien écrit]" : ""}`);
  return result;
}
