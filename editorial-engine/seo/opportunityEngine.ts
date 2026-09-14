import type { SourceArticle } from "../sources/types.ts";
import type { EditorialAnalysis } from "../generation/types.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";

export type SearchIntent = "informational" | "navigational" | "commercial" | "news" | "mixed";

/**
 * §1 — this engine has no connection to any real search-volume or
 * competition data source (no Search Console, no Keyword Planner, no SERP
 * API). `searchDemand` and `competition` are ALWAYS "unknown" — never a
 * fabricated number — per the brief's explicit instruction. The
 * seoOpportunityScore below is computed only from the components that ARE
 * grounded in real, available data.
 */
export interface SeoOpportunity {
  searchIntent: SearchIntent;
  searchDemand: "unknown";
  competition: "unknown";
  freshness: number; // 0-100, derived from the source's own publish date
  newsworthiness: number; // 0-100, see newsworthiness.ts
  weblackRelevance: number; // 0-100, = analysis.relevance (already a real editorial judgment)
  evergreenPotential: number; // 0-100, heuristic from category/format
  seoOpportunityScore: number; // 0-100 — weighted average of the components above that are actually numeric
}

function freshnessScore(publishedAt: string | undefined): number {
  if (!publishedAt) return 50; // unknown date — neutral, not penalized nor rewarded
  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) return 50;
  const ageHours = (Date.now() - publishedTime) / 3_600_000;
  if (ageHours < 0) return 50; // clock skew or future-dated source — don't reward/punish a guess
  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 80;
  if (ageHours <= 24 * 7) return 60;
  if (ageHours <= 24 * 30) return 35;
  return 15;
}

/** Evergreen content (durable analysis/reports) ages well in search; hard news ages fast. Derived from the category/format actually assigned, not guessed independently. */
function evergreenScore(category: string, format: string | undefined): number {
  if (format === "news") return 15;
  if (category === "news" || category === "reports") return 30;
  if (category === "insights" || category === "industry-perspectives" || category === "analysis") return 80;
  if (format === "analysis" || format === "opinion") return 85;
  return 50;
}

function inferSearchIntent(analysis: EditorialAnalysis): SearchIntent {
  if (analysis.format === "news") return "news";
  if (analysis.category === "designers" || analysis.category === "fashion") return "mixed";
  if (analysis.format === "analysis" || analysis.format === "report") return "informational";
  return "informational";
}

export function computeSeoOpportunity(source: SourceArticle, analysis: EditorialAnalysis): SeoOpportunity {
  const freshness = freshnessScore(source.publishedAt);
  const evergreenPotential = evergreenScore(analysis.category, analysis.format);
  const weblackRelevance = analysis.relevance;
  const newsworthiness = analysis.novelty; // newsworthiness.ts recomputes a fuller score; this local value keeps the opportunity score self-contained when only analysis is available.

  // Only real numeric signals are averaged — searchDemand/competition (both
  // "unknown") are excluded entirely rather than defaulted to a mid-point,
  // which would silently fabricate a number where none exists.
  const seoOpportunityScore = Math.round(
    freshness * 0.2 + newsworthiness * 0.2 + weblackRelevance * 0.3 + evergreenPotential * 0.15 + analysis.seoPotential * 0.15,
  );

  return {
    searchIntent: inferSearchIntent(analysis),
    searchDemand: "unknown",
    competition: "unknown",
    freshness,
    newsworthiness,
    weblackRelevance,
    evergreenPotential,
    seoOpportunityScore,
  };
}

export function isKnownJournalCategory(category: string): boolean {
  return (JOURNAL_CATEGORIES as readonly string[]).includes(category);
}
