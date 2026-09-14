import type { SourceArticle } from "../sources/types.ts";
import type { ExtractedFacts } from "../generation/types.ts";
import { findRunByCanonicalUrl, findRunByContentHash } from "../database/db.ts";
import { getSanityClient } from "../sanity/client.ts";
import { loadConfig } from "../config/env.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { extractLocalEntities, entityOverlap } from "./entities.ts";
import { log } from "../logs/logger.ts";

export type DuplicateDecisionCode =
  | "duplicate_exact"
  | "duplicate_semantic"
  | "same_event_new_information"
  | "same_entity_different_event"
  | "new_story";

export interface DuplicateDecision {
  decision: DuplicateDecisionCode;
  confidence: number; // 0-100
  reason: string;
  matchedArticleId: string | null;
  /** true when the engine could not confidently resolve an ambiguous case (Level 4/5 unavailable or inconclusive) — the pipeline must not silently proceed OR silently reject in that case. */
  needsReview: boolean;
  /** Diagnostic detail, not used for the decision itself beyond what's already folded into `reason` — kept for test-results/ transparency. */
  signals: {
    titleSimilarity?: number;
    entityOverlapRatio?: number;
    sharedEntities?: string[];
  };
}

/** Blocking (never write to Sanity without human review) vs. non-blocking decisions — §1's explicit rule that sharing a person/brand must never alone cause a rejection is encoded here: same_entity_different_event and new_story never block. */
export function isBlockingDecision(decision: DuplicateDecisionCode): boolean {
  return decision === "duplicate_exact" || decision === "duplicate_semantic";
}

export function titleSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

const DUPLICATE_THRESHOLD = 0.6; // Level 3 — kept exactly as validated in the previous phase.
const AMBIGUOUS_LOWER_BOUND = 0.2; // lowered this phase after Test E — see test-results/00-SUMMARY.md.

interface SanityJournalTitle {
  _id: string;
  title: string;
  excerpt?: string;
  slug: string;
}

/**
 * §1 Levels 1-3 — no OpenAI call, runs for every candidate regardless of
 * budget (§11: never pay for a duplicate). Levels 1/2 check the LOCAL run
 * history only (they answer "have we, this engine, already processed this
 * exact url/content" — not "does WEBLACK have an existing article about
 * this", which is what Level 3 checks against live Sanity titles).
 */
async function earlyLevels(article: SourceArticle): Promise<DuplicateDecision | { ambiguousCandidate: SanityJournalTitle; similarity: number } | null> {
  const byUrl = findRunByCanonicalUrl(article.canonicalUrl);
  if (byUrl) {
    return {
      decision: "duplicate_exact",
      confidence: 100,
      reason: `Même URL canonique déjà traitée (run #${byUrl.id}, statut ${byUrl.status}).`,
      matchedArticleId: byUrl.sanityDocumentId ?? null,
      needsReview: false,
      signals: {},
    };
  }

  if (article.contentHash) {
    const byContent = findRunByContentHash(article.contentHash);
    if (byContent) {
      return {
        decision: "duplicate_exact",
        confidence: 95,
        reason: `Même contenu déjà traité sous une autre URL (run #${byContent.id}, statut ${byContent.status}).`,
        matchedArticleId: byContent.sanityDocumentId ?? null,
        needsReview: false,
        signals: {},
      };
    }
  }

  const client = getSanityClient();
  const existingTitles: SanityJournalTitle[] = await client.fetch(
    `*[_type == "journal" && defined(title)]{_id, title, excerpt, "slug": slug.current}`,
  );

  let best: { candidate: SanityJournalTitle; similarity: number } | undefined;
  for (const candidate of existingTitles) {
    const similarity = titleSimilarity(article.title, candidate.title);
    if (!best || similarity > best.similarity) best = { candidate, similarity };
  }

  if (!best || best.similarity < AMBIGUOUS_LOWER_BOUND) {
    return {
      decision: "new_story",
      confidence: 80,
      reason: best ? `Titre le plus proche à ${(best.similarity * 100).toFixed(0)}% ("${best.candidate.title}") — sous le seuil d'ambiguïté.` : "Aucun article WEBLACK existant à comparer.",
      matchedArticleId: null,
      needsReview: false,
      signals: { titleSimilarity: best?.similarity },
    };
  }

  if (best.similarity >= DUPLICATE_THRESHOLD) {
    return {
      decision: "duplicate_semantic",
      confidence: Math.round(best.similarity * 100),
      reason: `Titre très similaire à un article WEBLACK existant ("${best.candidate.title}", ${(best.similarity * 100).toFixed(0)}% de recouvrement).`,
      matchedArticleId: best.candidate._id,
      needsReview: false,
      signals: { titleSimilarity: best.similarity },
    };
  }

  return { ambiguousCandidate: best.candidate, similarity: best.similarity };
}

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: {
      type: "string",
      enum: ["duplicate_exact", "duplicate_semantic", "same_event_new_information", "same_entity_different_event", "new_story"],
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
  },
  required: ["decision", "confidence", "reasoning"],
};

/**
 * §1 Level 5 — only reached for the ambiguous title-similarity band, and
 * only when an OpenAI key is configured (§11 cost control: this is the one
 * dedup level that costs money, so it only runs when the cheap signals
 * couldn't resolve it). Enriched with the Level 4 entity-overlap signal so
 * the model isn't reasoning from titles alone.
 */
async function classifyAmbiguous(
  article: SourceArticle,
  facts: ExtractedFacts | undefined,
  candidate: SanityJournalTitle,
  runId: string,
): Promise<{ decision: DuplicateDecisionCode; confidence: number; reasoning: string } | undefined> {
  const config = loadConfig();
  if (!config.openaiApiKey) return undefined;

  const newEntities = facts ? [...facts.people, ...facts.brands, ...facts.organizations, ...facts.events] : extractLocalEntities(article.title + " " + (article.excerpt ?? ""));
  const existingEntities = extractLocalEntities(candidate.title + " " + (candidate.excerpt ?? ""));
  const { ratio, shared } = entityOverlap(newEntities, existingEntities);

  try {
    const result = await structuredCompletion<{ decision: DuplicateDecisionCode; confidence: number; reasoning: string }>({
      system: `Tu compares un nouvel article candidat à un article déjà publié sur le Journal WEBLACK pour déterminer leur relation exacte. Choisis EXACTEMENT une des 5 catégories :
- "duplicate_exact": littéralement le même contenu.
- "duplicate_semantic": couvre le même événement/annonce sous le même angle — publier le second serait une redite pure.
- "same_event_new_information": même événement/sujet, mais le nouveau candidat apporte une information réellement nouvelle (suite, développement, angle différent) — légitime à publier.
- "same_entity_different_event": partage une personne/marque/organisation avec l'article existant, mais concerne un événement différent — légitime à publier, ne JAMAIS classer "duplicate" pour cette seule raison.
- "new_story": sujet réellement différent, la similarité de titre est une coïncidence lexicale.`,
      user: `Article WEBLACK existant: "${candidate.title}"${candidate.excerpt ? `\nExtrait existant: ${candidate.excerpt}` : ""}\n\nNouveau candidat: "${article.title}"${article.excerpt ? `\nExtrait candidat: ${article.excerpt}` : ""}\n\nEntités du candidat (personnes/marques/organisations/événements)${facts ? "" : " (approximatives, pas encore extraites par fact-check)"}: ${newEntities.join(", ") || "(aucune)"}\nEntités partagées avec l'article existant (signal local, indicatif): ${shared.join(", ") || "(aucune)"} (recouvrement ${(ratio * 100).toFixed(0)}%)`,
      schemaName: "duplicate_classification_v2",
      schema: CLASSIFY_SCHEMA,
      model: config.modelAnalysis,
      step: "dedup-classification",
      runId,
      sourceUrl: article.url,
    });
    return result;
  } catch (error) {
    log("DUPLICATE CHECK", `Classification LLM échouée (${error instanceof Error ? error.message : error}) — bascule en needsReview`);
    return undefined;
  }
}

/**
 * Full 5-level pipeline. Called twice in practice from scheduler/run.ts:
 * once early (facts undefined — Levels 1-3, may already resolve the case
 * without spending anything on OpenAI) and, only if that returned an
 * ambiguous candidate, again after fact-extraction (facts defined —
 * Levels 4-5, now with real extracted entities instead of the title-only
 * approximation).
 */
export async function checkDuplicate(article: SourceArticle, runId: string, facts?: ExtractedFacts): Promise<DuplicateDecision> {
  log("DUPLICATE CHECK", `Vérification — ${article.title}`);

  const early = await earlyLevels(article);
  if (early === null) {
    return { decision: "new_story", confidence: 50, reason: "Aucun signal.", matchedArticleId: null, needsReview: false, signals: {} };
  }
  if ("decision" in early) return early;

  // Ambiguous band (Level 3 was inconclusive) — try Level 4/5.
  const { ambiguousCandidate, similarity } = early;
  const newEntities = facts ? [...facts.people, ...facts.brands, ...facts.organizations, ...facts.events] : extractLocalEntities(article.title + " " + (article.excerpt ?? ""));
  const existingEntities = extractLocalEntities(ambiguousCandidate.title + " " + (ambiguousCandidate.excerpt ?? ""));
  const { ratio: entityOverlapRatio, shared: sharedEntities } = entityOverlap(newEntities, existingEntities);

  const classification = await classifyAmbiguous(article, facts, ambiguousCandidate, runId);

  if (!classification) {
    return {
      decision: "same_entity_different_event", // conservative non-blocking default — never guess "duplicate" without a classification
      confidence: 30,
      reason: `Similarité de titre ambiguë (${(similarity * 100).toFixed(0)}%) avec "${ambiguousCandidate.title}" — classification automatique indisponible (pas de clé OpenAI ou appel échoué), nécessite une relecture humaine.`,
      matchedArticleId: ambiguousCandidate._id,
      needsReview: true,
      signals: { titleSimilarity: similarity, entityOverlapRatio, sharedEntities },
    };
  }

  return {
    decision: classification.decision,
    confidence: classification.confidence,
    reason: classification.reasoning,
    matchedArticleId: ambiguousCandidate._id,
    needsReview: classification.decision === "same_event_new_information", // legitimate to publish, but still worth a human glance since it's adjacent to an existing article
    signals: { titleSimilarity: similarity, entityOverlapRatio, sharedEntities },
  };
}
