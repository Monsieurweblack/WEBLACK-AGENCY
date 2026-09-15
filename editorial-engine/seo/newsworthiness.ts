import type { SourceArticle } from "../sources/types.ts";
import type { EditorialAnalysis } from "../generation/types.ts";

export type NewsworthinessClass = "BREAKING" | "NEWS" | "TREND" | "ANALYSIS" | "REPORT" | "EVERGREEN";

export interface NewsworthinessResult {
  newsworthinessScore: number; // 0-100
  classification: NewsworthinessClass;
}

function hoursSincePublished(publishedAt: string | undefined): number | undefined {
  if (!publishedAt) return undefined;
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return undefined;
  const hours = (Date.now() - t) / 3_600_000;
  return hours >= 0 ? hours : undefined;
}

/**
 * §2 — BREAKING is deliberately the hardest classification to reach: it
 * requires BOTH a real, known publish timestamp under 6 hours old AND very
 * high importance/novelty from the editorial analysis. A source with no
 * timestamp, or one that's merely "interesting", can never be classified
 * BREAKING — the brief is explicit that this label must never be used
 * artificially just because a candidate looks exciting.
 */
export function classifyNewsworthiness(source: SourceArticle, analysis: EditorialAnalysis): NewsworthinessResult {
  const newsworthinessScore = Math.round(
    analysis.novelty * 0.3 + analysis.importance * 0.3 + analysis.readerInterest * 0.2 + analysis.relevance * 0.2,
  );

  const ageHours = hoursSincePublished(source.publishedAt);
  const format = analysis.format;

  let classification: NewsworthinessClass;
  if (ageHours !== undefined && ageHours <= 6 && analysis.importance >= 85 && analysis.novelty >= 85) {
    classification = "BREAKING";
  } else if (format === "report") {
    classification = "REPORT";
  } else if (format === "analysis" || format === "opinion") {
    classification = "ANALYSIS";
  } else if (ageHours !== undefined && ageHours <= 72 && analysis.novelty >= 60) {
    classification = "NEWS";
  } else if (analysis.novelty >= 50 && analysis.importance >= 50) {
    classification = "TREND";
  } else {
    classification = "EVERGREEN";
  }

  return { newsworthinessScore, classification };
}

/**
 * Settles the `format` the article is stored with — which is what decides,
 * at render time, whether the page declares schema.org `NewsArticle` or
 * plain `Article` (see src/components/pages/JournalDetail.astro).
 *
 * The declaration has to be earned, not claimed. `NewsArticle` tells Google
 * the page is genuine news, and labelling an evergreen analysis that way is
 * a structured-data misstatement that search engines penalise. So the
 * model's own choice of format is accepted for everything EXCEPT "news":
 * that one is only kept when the deterministic classifier — which needs a
 * real publication timestamp, not an impression of freshness — independently
 * agrees it is BREAKING or NEWS. This function can only ever downgrade an
 * over-claim, never manufacture one.
 */
export function resolveArticleFormat(
  analysisFormat: EditorialAnalysis["format"],
  classification: NewsworthinessClass,
): EditorialAnalysis["format"] {
  if (analysisFormat !== "news") return analysisFormat;
  if (classification === "BREAKING" || classification === "NEWS") return "news";
  // The model called it news; the timestamp evidence does not support it.
  return classification === "REPORT" ? "report" : "analysis";
}
