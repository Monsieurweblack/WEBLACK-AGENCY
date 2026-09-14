import type { SourceArticle } from "../sources/types.ts";
import { findRunByHash } from "../database/db.ts";
import { getSanityClient } from "../sanity/client.ts";
import { log } from "../logs/logger.ts";

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: string;
  existingSanitySlug?: string;
}

/** Token-overlap similarity (Jaccard over lowercased word sets) — simple, dependency-free, good enough to flag near-identical titles without needing an embeddings call for every candidate. */
function titleSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

const SIMILARITY_THRESHOLD = 0.6;

/**
 * Phase 5, in order: local run history by hash (fastest, catches "we already
 * processed this exact URL"), then title similarity against every existing
 * WEBLACK journal document in both languages (catches the same story republished
 * from a different source URL). No semantic-embeddings step — the token-overlap
 * check plus the exact-hash check already cover the two failure modes that
 * matter here without adding embeddings-API cost/complexity for a low-volume
 * editorial feed.
 */
export async function checkDuplicate(article: SourceArticle): Promise<DuplicateCheckResult> {
  log("DUPLICATE CHECK", `Vérification — ${article.title}`);

  const existingRun = findRunByHash(article.hash);
  if (existingRun && existingRun.status !== "error") {
    return { isDuplicate: true, reason: `Déjà traité (hash identique, run #${existingRun.id}, statut ${existingRun.status})` };
  }

  const client = getSanityClient();
  const existingTitles: { title: string; slug: string }[] = await client.fetch(
    `*[_type == "journal" && defined(title)]{ title, "slug": slug.current }`,
  );
  for (const existing of existingTitles) {
    if (!existing.title) continue;
    const similarity = titleSimilarity(article.title, existing.title);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return {
        isDuplicate: true,
        reason: `Titre très similaire à un article WEBLACK existant ("${existing.title}", similarité ${(similarity * 100).toFixed(0)}%)`,
        existingSanitySlug: existing.slug,
      };
    }
  }

  return { isDuplicate: false };
}
