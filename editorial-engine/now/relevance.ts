import type { EditorialAnalysis } from "../generation/types.ts";
import type { RelevanceBreakdown, SourceRank, FreshnessBand } from "./types.ts";
import { freshnessPoints } from "./freshness.ts";

/**
 * §9 — le score de pertinence WEBLACK NOW.
 *
 * Volontairement PAS un appel modèle : demander à un LLM "sur 100, à quel
 * point ce signal est-il pertinent pour WEBLACK NOW" reproduirait exactement
 * ce que analyzeArticle() (intelligence/analyze.ts) fait déjà pour le
 * territoire et la pertinence éditoriale — un second jugement esthétique
 * n'ajouterait rien, coûterait un appel de plus, et serait, lui,
 * difficilement explicable. Le score composite ci-dessous recombine des
 * signaux déjà produits ailleurs (l'analyse éditoriale, réutilisée telle
 * quelle) avec des faits purement mécaniques (rang de la source, fraîcheur)
 * — chaque facteur est un nombre qu'on peut recalculer à la main.
 *
 * Ce n'est jamais un jugement de qualité politique, idéologique ou
 * esthétique (§9) : aucun des quatre facteurs ne porte sur le contenu
 * lui-même au-delà de ce que analyzeArticle() a déjà établi (qui, elle,
 * juge la pertinence au territoire et à la valeur créative — voir son
 * system prompt, "LA PERTINENCE NE SE JUGE PAS AUX MOTS-CLÉS").
 */
const SOURCE_RANK_POINTS: Record<SourceRank, number> = {
  OFFICIAL: 100,
  INSTITUTION: 90,
  ORGANIZER: 80,
  ARTIST_BRAND: 70,
  MEDIA: 50,
  SECONDARY: 20,
};

export function sourceRankPoints(rank: SourceRank): number {
  return SOURCE_RANK_POINTS[rank];
}

const WEIGHTS = {
  editorialRelevance: 0.45,
  sourceRank: 0.25,
  freshness: 0.2,
  signalStrength: 0.1,
} as const;

export function scoreSignal(input: {
  analysis: Pick<EditorialAnalysis, "relevance" | "reliability" | "importance">;
  sourceRank: SourceRank;
  freshnessBand: FreshnessBand;
}): RelevanceBreakdown {
  const editorialRelevance = clamp(input.analysis.relevance);
  const sourceRank = clamp(sourceRankPoints(input.sourceRank));
  const freshness = clamp(freshnessPoints(input.freshnessBand));
  // Moyenne de deux facteurs déjà produits par analyzeArticle() : reliability
  // (qualité/proximité des sources, telle que jugée par l'analyse) et
  // importance (importance CULTURELLE, explicitement pas économique ni
  // médiatique — voir generation/types.ts EditorialAnalysis.importance).
  const signalStrength = clamp((input.analysis.reliability + input.analysis.importance) / 2);

  const composite = Math.round(
    editorialRelevance * WEIGHTS.editorialRelevance +
      sourceRank * WEIGHTS.sourceRank +
      freshness * WEIGHTS.freshness +
      signalStrength * WEIGHTS.signalStrength,
  );

  return {
    editorialRelevance,
    sourceRankPoints: sourceRank,
    freshnessPoints: freshness,
    signalStrengthPoints: signalStrength,
    weights: { ...WEIGHTS },
    composite: clamp(composite),
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
