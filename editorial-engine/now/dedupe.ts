import type { SourceArticle } from "../sources/types.ts";
import { titleSimilarity } from "../validation/dedupe.ts";
import { findRunByCanonicalUrl, findRunByContentHash } from "../database/db.ts";
import { currentSignals } from "./store.ts";
import { currentEvents } from "../agenda/store.ts";
import { log } from "../logs/logger.ts";

/**
 * NO DUPLICATE — §10, §18. Une fonction propre à NOW plutôt qu'une
 * généralisation de validation/dedupe.ts#checkDuplicate : cette dernière est
 * câblée sur le Journal (elle interroge `*[_type=="journal"]` dans Sanity,
 * §19 explicitement "ne casse pas la déduplication" existante) et sur un
 * appel modèle pour la zone ambiguë — un coût et une dépendance que NOW n'a
 * pas besoin de payer pour des signaux d'une phrase. `titleSimilarity`,
 * elle, est déjà une fonction pure exportée : réutilisée telle quelle,
 * jamais réécrite.
 *
 * Trois surfaces vérifiées, dans cet ordre — un candidat écarté par la
 * première n'a pas besoin des suivantes :
 *   1. Historique local du moteur (même URL canonique / même contenu déjà
 *      traité, tous pipelines confondus — findRunByCanonicalUrl travaille
 *      sur la table `runs` commune, donc un article déjà tenté côté
 *      Journal sous la même URL est reconnu ici gratuitement).
 *   2. Signaux NOW déjà en stock (tout statut — un candidat rejeté hier
 *      pour la même URL ne doit pas être retraité chaque cycle).
 *   3. Événements Agenda en cours (§4 : NOW ne doit jamais annoncer, sous
 *      forme de "signal éditorial", quelque chose que l'Agenda couvre déjà
 *      comme événement vérifié — les deux flux doivent rester disjoints).
 */
export interface NowDuplicateDecision {
  isDuplicate: boolean;
  reason: string;
}

const TITLE_DUPLICATE_THRESHOLD = 0.6; // même seuil que validation/dedupe.ts DUPLICATE_THRESHOLD — un seul jugement de "titres trop proches" dans tout le moteur.

export function checkNowDuplicate(article: SourceArticle): NowDuplicateDecision {
  const byUrl = findRunByCanonicalUrl(article.canonicalUrl);
  if (byUrl) {
    return { isDuplicate: true, reason: `URL déjà traitée par le moteur (run #${byUrl.id}, statut ${byUrl.status}).` };
  }
  if (article.contentHash) {
    const byContent = findRunByContentHash(article.contentHash);
    if (byContent) {
      return { isDuplicate: true, reason: `Même contenu déjà traité sous une autre URL (run #${byContent.id}).` };
    }
  }

  for (const signal of currentSignals()) {
    if (signal.source.url === article.url) {
      return { isDuplicate: true, reason: `Signal déjà en stock pour cette URL (statut ${signal.status}).` };
    }
    const similarity = titleSimilarity(article.title, signal.title);
    if (similarity >= TITLE_DUPLICATE_THRESHOLD) {
      return { isDuplicate: true, reason: `Titre très proche d'un signal déjà en stock ("${signal.title}", ${(similarity * 100).toFixed(0)}%).` };
    }
  }

  for (const event of currentEvents()) {
    if (event.status === "EXPIRED") continue;
    const similarity = titleSimilarity(article.title, event.eventName);
    if (similarity >= TITLE_DUPLICATE_THRESHOLD) {
      log("DUPLICATE CHECK", `NOW — candidat proche d'un événement Agenda déjà connu : "${article.title}" ~ "${event.eventName}"`);
      return { isDuplicate: true, reason: `Déjà couvert par l'Agenda comme événement vérifié ("${event.eventName}") — NOW ne double pas l'Agenda.` };
    }
  }

  return { isDuplicate: false, reason: "" };
}
