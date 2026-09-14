export type PriorityLevel = "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | "REJECT";

export interface CombinedPriority {
  editorialScore: number;
  seoOpportunityScore: number;
  newsworthinessScore: number;
  priority: PriorityLevel;
}

/**
 * §19 — a simple, transparent average of the three scores this engine
 * already computes for independent reasons (editorial analysis, SEO
 * opportunity, newsworthiness). No hidden weighting toward any one
 * dimension — a topic strong on exactly one axis and weak on the others
 * lands in the middle, not at the top, which matches the brief's intent
 * that this be a genuinely combined priority, not editorial score renamed.
 */
export function combinePriority(editorialScore: number, seoOpportunityScore: number, newsworthinessScore: number): CombinedPriority {
  const average = (editorialScore + seoOpportunityScore + newsworthinessScore) / 3;

  let priority: PriorityLevel;
  if (editorialScore < 40) priority = "REJECT"; // below WEBLACK's own relevance bar — SEO/news scores can't rescue an off-topic subject
  else if (average >= 85) priority = "CRITICAL";
  else if (average >= 65) priority = "HIGH";
  else if (average >= 45) priority = "NORMAL";
  else priority = "LOW";

  return { editorialScore, seoOpportunityScore, newsworthinessScore, priority };
}
