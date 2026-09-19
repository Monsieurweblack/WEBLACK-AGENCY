import type { WeblackTerritory } from "../generation/types.ts";
import type { SourceRank } from "../agenda/types.ts";

export type { WeblackTerritory, SourceRank };

/**
 * WEBLACK NOW — radar culturel curaté.
 *
 * Deux origines, une seule vitrine. Un signal vient soit d'un événement déjà
 * vérifié par le pipeline Agenda et actuellement ONGOING (aucune nouvelle
 * écriture Sanity : on relit `event`, exactement ce que fait déjà le site
 * aujourd'hui via getOngoingEvents), soit d'une actualité créative repérée
 * dans les mêmes flux RSS que le Journal, réduite à une phrase plutôt qu'à
 * un article. Les deux partagent une chose : rien n'atteint NOW sans être
 * passé par le même degré d'exigence que le reste du moteur — territoire
 * réel, source qualifiée, preuve vérifiable, fraîcheur.
 *
 * `origin` distingue les deux sans dupliquer leur donnée : un signal
 * "ongoing-event" ne stocke pas une seconde fois ce qu'`event` sait déjà
 * (dates, lieu, officialUrl) — il porte seulement l'identifiant qui permet
 * de le relire.
 */
export type NowSignalOrigin = "editorial-signal" | "ongoing-event";

/**
 * Où en est un signal éditorial (origin "editorial-signal") dans le
 * pipeline — même famille de mots que RunRecord.status (database/db.ts) et
 * FinalDecision (validation/qualityGate.ts), pas un vocabulaire concurrent :
 *
 *   discovered  — candidat retenu d'un flux RSS, pas encore analysé.
 *   review      — analysé, mais une condition du Quality Gate n'est pas
 *                 entièrement remplie (§12 : jamais publié sans ce filet).
 *   published   — a franchi les huit conditions, écrit dans Sanity.
 *   rejected    — a échoué une condition bloquante (fabrication, source
 *                 invalide, hors territoire...). Conservé dans le stock
 *                 local pour ne pas ré-explorer le même terrain, jamais
 *                 écrit dans Sanity.
 *
 * EXPIRED n'est délibérément pas un état stocké : comme pour l'Agenda
 * (agenda/types.ts, effectiveStatus/computeStatus), la fraîcheur se calcule
 * depuis la donnée à chaque lecture — voir isEligibleForDisplay ci-dessous
 * et now/freshness.ts. Un signal ne devient jamais silencieusement obsolète
 * par absence de réécriture.
 */
export type NowSignalStatus = "discovered" | "review" | "published" | "rejected";

/**
 * Bande de fraîcheur — §8. Calculée, jamais déclarée : voir now/freshness.ts.
 * Une bande n'efface rien du système (§8, "IMPORTANT") : un signal EXPIRED
 * reste dans le stock local et, s'il a été publié, reste son document
 * Sanity — il cesse seulement d'être éligible à l'affichage NOW.
 */
export type FreshnessBand = "FRESH" | "CURRENT" | "HISTORICAL" | "EXPIRED";

/** §9 — chaque facteur du score, traçable individuellement plutôt que noyé dans un total opaque. */
export interface RelevanceBreakdown {
  editorialRelevance: number; // 0-100, depuis EditorialAnalysis.relevance (intelligence/analyze.ts, LLM, réutilisé tel quel)
  sourceRankPoints: number; // 0-100, depuis SourceRank (barème déterministe, now/relevance.ts)
  freshnessPoints: number; // 0-100, depuis FreshnessBand (barème déterministe)
  signalStrengthPoints: number; // 0-100, moyenne de reliability/importance (EditorialAnalysis, LLM)
  /** Pondération -> score composite. Documentée ici pour que le calcul soit relisible sans lire le code. */
  weights: { editorialRelevance: number; sourceRank: number; freshness: number; signalStrength: number };
  composite: number; // 0-100 — la seule valeur utilisée pour décider, jamais un des facteurs isolément
}

/**
 * Un signal éditorial — §7, modèle de données minimal. Chaque champ existe
 * parce qu'une décision du Quality Gate, de l'affichage ou de la
 * traçabilité en dépend ; aucun champ "au cas où".
 */
export interface NowSignal {
  /** Identifiant déterministe — même construction que agenda/store.ts eventIdentity(), sur (titre normalisé + URL source canonique). Deux découvertes du même signal produisent le même id. */
  id: string;
  origin: NowSignalOrigin;

  title: string;
  titleEn: string;

  territory: WeblackTerritory;
  /** Une phrase, jamais un paragraphe — voir generateSignal.ts. FR et EN sont deux rédactions indépendantes du même Evidence Pack, jamais une traduction mécanique l'une de l'autre (§16). */
  summary: string;
  summaryEn: string;

  /** Pourquoi ce signal regarde WEBLACK — reprend EditorialAnalysis.editorialValue tel quel, jamais reformulé. */
  relevanceReason: string;

  /** Date du fait rapporté (ouverture, annonce, nomination...) quand la source la donne — jamais déduite. Vide sinon : voir DATE VALID dans qualityGate.ts, qui n'exige une date que lorsque la nature du signal l'implique. */
  date: string;

  source: {
    name: string;
    /** Rang de la source — même échelle que l'Agenda (agenda/types.ts SourceRank), jamais un second barème. */
    rank: SourceRank;
    url: string;
    /** Le nom de l'éditeur réel du flux (ex: le <title> du canal RSS), distinct du nom de source interne à sources.json — mêmes conventions que ingestion/rss.ts. */
    publisher: string;
    publishedAt?: string;
  };

  discoveredAt: string;
  language: string;

  relevance: RelevanceBreakdown;
  status: NowSignalStatus;
  /** Pourquoi REVIEW ou REJECTED — vide si PUBLISHED. */
  statusReason: string;

  /** Uniquement si une image existe sur la source ET que son usage est celui d'un lien de renvoi (jamais réhébergée, jamais retouchée) — §7. Absent par défaut : mieux vaut un signal sans image qu'une image de provenance douteuse. */
  imageUrl?: string;

  /** Rempli uniquement pour origin "ongoing-event" — l'identifiant engineId de l'AgendaEvent d'où ce signal est dérivé, pour ne jamais dupliquer sa donnée (voir now/discover.ts deriveFromOngoingEvent). */
  sourceEventEngineId?: string;

  sanityDocumentId?: string;
}

/**
 * Seuils documentés — §5, §8, §9, §10. Des constantes nommées, pas des
 * nombres épars dans le code : une révision de politique éditoriale se fait
 * ici, en un endroit, et se justifie en un endroit.
 */
export const NOW_POLICY = {
  /** §10 — en dessous, REVIEW plutôt que publication, quelle que soit la fraîcheur ou la source. */
  minCompositeRelevance: 65,
  /** §1 — OUT_OF_TERRITORY est un rejet immédiat, jamais un score bas qui se faufile. */
  excludedTerritory: "OUT_OF_TERRITORY" as const,
  /** §8 — un signal "editorial-signal" plus vieux que ceci n'est plus montrable comme NOW, quel que soit son score. */
  freshnessBands: {
    freshHours: 72,
    currentDays: 14,
    historicalDays: 30,
  },
  /** §14 — jamais plus que cela sur l'accueil, quelle que soit l'abondance de signaux éligibles. */
  homepageMaxSignals: 5,
  homepageMinSignals: 3,
} as const;
