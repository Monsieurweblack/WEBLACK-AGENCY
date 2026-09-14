import type { GeneratedArticle, ExtractedFacts } from "../generation/types.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";
import { extractComparableTokens } from "./equivalences.ts";
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
  const grounded = new Set([...facts.numbers, ...facts.dates, ...evidenceText].flatMap((text) => extractComparableTokens(text)));

  const flagged: string[] = [];
  for (const block of article.body) {
    if (block._type !== "block") continue;
    const text = block.children.map((c) => c.text).join("");
    for (const token of extractComparableTokens(text)) {
      // Single digits carry too little signal to be worth flagging, but a
      // time or a season always does, whatever its numeric length.
      const isTyped = token.includes(":");
      if (!isTyped && token.replace(/[^\d]/g, "").length < 2) continue;
      if (!grounded.has(token)) flagged.push(token);
    }
  }
  return flagged;
}

/**
 * Filler openings and empty intensifiers that read as generated text rather
 * than as an editorial voice. Matched on an accent- and case-insensitive
 * form so "À l'heure où" and "a l'heure ou" are the same thing.
 */
const BANNED_PHRASES = [
  "dans un monde ou",
  "plus que jamais",
  "a l heure ou",
  "force est de constater",
  "il est indeniable",
  "il va sans dire",
  "on ne presente plus",
  "veritable revolution",
  "revolutionne le monde",
  "incontournable de la mode",
  "en cette ere",
  "a l aube d une nouvelle ere",
  "ne cesse de croitre",
  "en constante evolution",
  "un tournant decisif",
  "la question se pose",
  "une chose est sure",
  "in a world where",
  "now more than ever",
];

function findBannedPhrases(text: string): string[] {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, " ")
    .replace(/\s+/g, " ");
  return BANNED_PHRASES.filter((phrase) => normalized.includes(phrase));
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

  const banned = findBannedPhrases(bodyText + " " + article.title + " " + article.excerpt);
  if (banned.length > 0) {
    errors.push(`Formulations génériques interdites par la ligne éditoriale WEBLACK: ${banned.join(", ")}`);
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
