import type { GeneratedArticle } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";
import { log } from "../logs/logger.ts";

/** Word-shingles (overlapping n-word sequences) — the standard cheap technique for detecting near-copies without an embeddings call: a rewrite that just swaps synonyms still shares almost no 8-word shingles with the original, while an actual paraphrase-in-place does. */
function shingles(text: string, n = 8): Set<string> {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[a-z0-9]+/g);
  if (!words || words.length < n) return new Set();
  const result = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    result.add(words.slice(i, i + n).join(" "));
  }
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export interface AntiCopyResult {
  pass: boolean;
  overlapRatio: number;
  matchedShingles: string[];
}

/**
 * Phase 7 of the QA brief: refuse content that is structurally too close to
 * the source, not just reworded. Threshold set on 8-word shingles — a
 * genuinely restructured article (different sentence order, different
 * paragraph grouping, different framing) naturally lands well under this
 * even when it covers the same facts; a rewrite that keeps the source's
 * sentence structure and swaps a few words does not.
 */
const OVERLAP_THRESHOLD = 0.15;

export function checkAntiCopy(article: GeneratedArticle, source: SourceArticle): AntiCopyResult {
  const sourceText = source.text ?? source.excerpt ?? "";
  const generatedText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join(" ");

  const sourceShingles = shingles(sourceText);
  const generatedShingles = shingles(generatedText);
  const overlapRatio = jaccard(sourceShingles, generatedShingles);

  const matchedShingles = [...generatedShingles].filter((s) => sourceShingles.has(s)).slice(0, 5);
  const pass = overlapRatio <= OVERLAP_THRESHOLD;

  log("QUALITY CHECK", `Anti-copie: overlap ${(overlapRatio * 100).toFixed(1)}% (seuil ${(OVERLAP_THRESHOLD * 100).toFixed(0)}%) — ${pass ? "OK" : "ÉCHEC"}`);
  return { pass, overlapRatio, matchedShingles };
}
