import type { GeneratedArticle, ExtractedFacts } from "../generation/types.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";
import { normalizeNumber } from "./claimRegistry.ts";
import { checkSeoTitle, checkSeoDescription } from "../seo/seo.ts";
import { log } from "../logs/logger.ts";

export interface QualityCheckResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Every number/date/proper-noun-looking token in the generated body should
 * trace back to something the fact-extraction step actually found — a
 * cheap guard against the model quietly adding a figure that "sounds
 * right". Not a proof of correctness, just a red flag for review.
 *
 * Bug found during the real validation campaign (Test D): the model
 * legitimately extracted "2026" into `facts.dates` rather than
 * `facts.numbers` (a defensible categorization the fact-extraction prompt
 * never forbids), but this check only looked at `facts.numbers` — a
 * genuinely grounded year was flagged as a possible invention. Fixed by
 * pooling digits from both arrays: a date string like "Sept. 22" or
 * "2026" contributes its digits exactly like a number would.
 *
 * Two further false-positive sources found once the writer started working
 * from verified facts: an English source states "141,000" while the French
 * article correctly writes "141 000", and the old token regex split that on
 * the space into "141" and "000", neither of which matched anything. Both
 * sides now go through the same locale-aware normalization the fact-check
 * uses. And `factEvidence` — the per-fact verbatim excerpts, the only part
 * of the extraction actually confirmed against the source — is pooled in
 * too, since a figure the writer was legitimately handed must never be
 * reported as a possible invention.
 */
function findUngroundedNumbers(article: GeneratedArticle, facts: ExtractedFacts): string[] {
  const evidenceText = (facts.factEvidence ?? []).flatMap((e) => [e.fact, e.evidenceQuote, e.evidenceTranslation]);
  const groundedSources = [...facts.numbers, ...facts.dates, ...evidenceText];
  const groundedNumbers = new Set(groundedSources.flatMap((n) => extractNumberTokens(n)).map(normalizeNumber).filter(Boolean));

  const flagged: string[] = [];
  for (const block of article.body) {
    if (block._type !== "block") continue;
    const text = block.children.map((c) => c.text).join("");
    for (const token of extractNumberTokens(text)) {
      const normalized = normalizeNumber(token);
      if (!normalized || normalized.replace(/[^\d]/g, "").length < 2) continue;
      if (!groundedNumbers.has(normalized)) flagged.push(token);
    }
  }
  return flagged;
}

/** Pulls number-looking tokens out of free text, keeping thousands-grouped figures ("141 000", "141,000") whole instead of splitting them on their separator. */
function extractNumberTokens(text: string): string[] {
  return text.match(/\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+(?:[.,]\d+)?/g) ?? [];
}

export function runQualityCheck(article: GeneratedArticle, facts: ExtractedFacts): QualityCheckResult {
  log("QUALITY CHECK", `Contrôle qualité — ${article.title}`);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!article.title || article.title.length < 10) errors.push("Titre absent ou trop court");
  if (article.title.length > 120) warnings.push("Titre long (> 120 caractères)");
  if (!article.slug) errors.push("Slug vide");
  if (!article.excerpt || article.excerpt.length < 20) errors.push("Excerpt absent ou trop court");
  if (!JOURNAL_CATEGORIES.includes(article.category)) errors.push(`Catégorie "${article.category}" hors liste autorisée`);
  if (!article.author) errors.push("Auteur manquant");
  if (article.body.length < 2) errors.push("Corps de l'article trop court (< 2 blocs)");

  const bodyText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join("") : ""))
    .join(" ");
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 80) errors.push(`Article trop court (${wordCount} mots, minimum 80)`);

  const seoTitleCheck = checkSeoTitle(article.seo?.title ?? "");
  const seoDescCheck = checkSeoDescription(article.seo?.description ?? "");
  warnings.push(...seoTitleCheck.issues, ...seoDescCheck.issues);

  const ungroundedNumbers = findUngroundedNumbers(article, facts);
  if (ungroundedNumbers.length > 0) {
    errors.push(`Chiffres présents dans l'article mais absents des faits extraits (possible invention): ${ungroundedNumbers.join(", ")}`);
  }

  // Repetition guard: same non-trivial sentence appearing more than once.
  const sentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 25);
  const seen = new Set<string>();
  for (const s of sentences) {
    if (seen.has(s)) warnings.push("Phrase répétée détectée dans le corps de l'article");
    seen.add(s);
  }

  const pass = errors.length === 0;
  log("QUALITY CHECK", `${pass ? "OK" : "ÉCHEC"} — ${errors.length} erreur(s), ${warnings.length} avertissement(s)`);
  return { pass, errors, warnings };
}
