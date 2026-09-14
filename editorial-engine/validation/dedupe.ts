import type { SourceArticle } from "../sources/types.ts";
import { findRunByHash } from "../database/db.ts";
import { getSanityClient } from "../sanity/client.ts";
import { loadConfig } from "../config/env.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { log } from "../logs/logger.ts";

export type DuplicateVerdict = "duplicate" | "new-angle" | "distinct";

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  /** true when the engine could not confidently tell "same story, new angle" from "actual duplicate" — per the brief's rule (§11 applied to dedup too): when in doubt, the engine must not decide silently. */
  needsReview: boolean;
  verdict: DuplicateVerdict;
  reason?: string;
  existingSanitySlug?: string;
  titleSimilarity?: number;
}

/** Token-overlap similarity (Jaccard over lowercased word sets) — simple, dependency-free, good enough to flag near-identical titles without needing an embeddings call for every candidate. */
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

/**
 * Above this, treat as a duplicate outright — this is the original 62%-band
 * check, kept exactly as validated. Below the lower bound, titles are
 * considered unrelated with high enough confidence to skip the LLM call.
 * In between, the same subject may just be covered from a different angle
 * (e.g. two genuinely different WEBLACK articles both mentioning "Nordic
 * Fashion Industry Summit") — that ambiguity is resolved by comparing
 * excerpts with the model instead of guessing from title overlap alone.
 */
const DUPLICATE_THRESHOLD = 0.6;
/**
 * Lowered from an initial 0.35 after a real test (Test E, see
 * editorial-engine/test-results/00-SUMMARY.md) showed an official event
 * page and WEBLACK's own headline about the *same* event sharing only
 * ~23-29% of words — below 0.35, so the ambiguous-review path never
 * triggered and the candidate was silently treated as unrelated. 0.2 still
 * won't catch every such case (a proper fix would compare named entities,
 * not raw word overlap — noted as a follow-up, not built this phase), but
 * it turns this specific real miss into a `needsReview` instead of a
 * silent pass-through.
 */
const AMBIGUOUS_LOWER_BOUND = 0.2;

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["duplicate", "new-angle", "distinct"] },
    reasoning: { type: "string" },
  },
  required: ["verdict", "reasoning"],
};

async function classifyRelationship(
  candidateTitle: string,
  candidateExcerpt: string | undefined,
  existingTitle: string,
): Promise<{ verdict: DuplicateVerdict; reasoning: string } | undefined> {
  const config = loadConfig();
  if (!config.openaiApiKey) return undefined; // no key: fall back to needsReview rather than guessing
  try {
    const result = await structuredCompletion<{ verdict: DuplicateVerdict; reasoning: string }>({
      system: `Tu compares deux titres (et un extrait si disponible) pour un Journal éditorial. Détermine leur relation:
- "duplicate": couvre le même événement/annonce sous le même angle — publier le second serait une redite.
- "new-angle": même événement/sujet/marque, mais angle éditorial réellement différent (nouvelle information, nouvelle perspective, suite d'un développement) — publier les deux est légitime.
- "distinct": sujets réellement différents, la similarité de titre est une coïncidence lexicale.
Ne classe JAMAIS "duplicate" seulement parce que deux articles mentionnent la même personnalité ou marque.`,
      user: `Article WEBLACK existant: "${existingTitle}"\n\nNouveau candidat: "${candidateTitle}"${candidateExcerpt ? `\nExtrait: ${candidateExcerpt}` : ""}`,
      schemaName: "duplicate_classification",
      schema: CLASSIFY_SCHEMA,
    });
    return result;
  } catch (error) {
    log("DUPLICATE CHECK", `Classification LLM échouée (${error instanceof Error ? error.message : error}) — bascule en needsReview`);
    return undefined;
  }
}

/**
 * Phase 5/13, in order: local run history by hash (fastest, catches "we
 * already processed this exact URL"), then title similarity against every
 * existing WEBLACK journal document in both languages. A high-similarity
 * match (≥60%) is treated as a duplicate outright — the originally
 * validated behavior. A mid-range match (35-60%) is NOT auto-skipped or
 * auto-approved: it is classified by the model into duplicate / new-angle /
 * distinct, and if that classification is itself unavailable or uncertain,
 * the result is `needsReview: true` rather than a silent decision either
 * way — nothing about the same person/brand appearing twice is ever
 * auto-rejected on that basis alone.
 */
export async function checkDuplicate(article: SourceArticle): Promise<DuplicateCheckResult> {
  log("DUPLICATE CHECK", `Vérification — ${article.title}`);

  const existingRun = findRunByHash(article.hash);
  if (existingRun && existingRun.status !== "error") {
    return {
      isDuplicate: true,
      needsReview: false,
      verdict: "duplicate",
      reason: `Déjà traité (hash identique, run #${existingRun.id}, statut ${existingRun.status})`,
    };
  }

  const client = getSanityClient();
  const existingTitles: { title: string; slug: string }[] = await client.fetch(
    `*[_type == "journal" && defined(title)]{ title, "slug": slug.current }`,
  );

  let bestAmbiguous: { existing: { title: string; slug: string }; similarity: number } | undefined;

  for (const existing of existingTitles) {
    if (!existing.title) continue;
    const similarity = titleSimilarity(article.title, existing.title);

    if (similarity >= DUPLICATE_THRESHOLD) {
      return {
        isDuplicate: true,
        needsReview: false,
        verdict: "duplicate",
        reason: `Titre très similaire à un article WEBLACK existant ("${existing.title}", similarité ${(similarity * 100).toFixed(0)}%)`,
        existingSanitySlug: existing.slug,
        titleSimilarity: similarity,
      };
    }

    if (similarity >= AMBIGUOUS_LOWER_BOUND && (!bestAmbiguous || similarity > bestAmbiguous.similarity)) {
      bestAmbiguous = { existing, similarity };
    }
  }

  if (bestAmbiguous) {
    const classification = await classifyRelationship(article.title, article.excerpt, bestAmbiguous.existing.title);
    if (!classification || classification.verdict === "new-angle") {
      return {
        isDuplicate: false,
        needsReview: true,
        verdict: classification?.verdict ?? "new-angle",
        reason:
          classification?.reasoning ??
          `Similarité de titre ambiguë (${(bestAmbiguous.similarity * 100).toFixed(0)}%) avec "${bestAmbiguous.existing.title}", classification automatique indisponible — nécessite une relecture humaine.`,
        existingSanitySlug: bestAmbiguous.existing.slug,
        titleSimilarity: bestAmbiguous.similarity,
      };
    }
    if (classification.verdict === "duplicate") {
      return {
        isDuplicate: true,
        needsReview: false,
        verdict: "duplicate",
        reason: `Classifié comme doublon par le modèle: ${classification.reasoning}`,
        existingSanitySlug: bestAmbiguous.existing.slug,
        titleSimilarity: bestAmbiguous.similarity,
      };
    }
  }

  return { isDuplicate: false, needsReview: false, verdict: "distinct" };
}
