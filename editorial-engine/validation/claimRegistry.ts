import type { GeneratedArticle, VerificationStatus, VerifiedFactSet } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";
import { recoverEvidence, assertsUnsupportedRelation } from "./evidenceRecovery.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

export type ClaimType = "quote" | "statistic" | "date" | "name" | "role" | "event" | "general";
export type ClaimImportance = "critical" | "significant" | "minor";
export type { VerificationStatus };

/**
 * The five evidence strategies (PHASE 3 brief). Ordered from strongest/
 * cheapest to weakest — a claim is verified through the FIRST one that
 * actually applies, never picked to "help" a claim pass.
 *  1. exactEvidence      — the claim's language quote appears verbatim in the source.
 *  2. normalizedEvidence — same, after normalizing punctuation/quotes/numbers/dates/case.
 *  3. translatedEvidence — source is in another language: verbatim-confirmed original-language
 *                          quote, whose atomic facts (incl. a hard field: quantity or date)
 *                          match the published claim's atomic facts.
 *  4. semanticEvidence   — same mechanism as (3), but only soft/descriptive fields overlap
 *                          (no quantity/date to cross-check) — weaker, still field-based, never
 *                          "the LLM feels good about it".
 *  5. independentEvidence — a critical claim corroborated by a primary source, or by 2+
 *                          independent secondary sources (existing §8 rule).
 */
export type EvidenceType = "exactEvidence" | "normalizedEvidence" | "translatedEvidence" | "semanticEvidence" | "independentEvidence" | "recoveredEvidence" | "none";
export type VerificationMethod = "EXACT" | "NORMALIZED" | "CROSS_LANGUAGE" | "SEMANTIC" | "INDEPENDENT_SOURCE" | "EVIDENCE_PACK" | "NONE";

export interface RegisteredSource {
  source: SourceArticle;
  /** A first-party statement (the subject's own site, an official press release, a direct quote from the organization involved) — as opposed to third-party reporting. Never inferred automatically; set explicitly by whoever configured the source, defaults to false. */
  isPrimary?: boolean;
}

/**
 * Atomic factual elements of one claim, decomposed so equivalence can be
 * checked field by field in code — never as a single "these mean the same
 * thing" LLM verdict. Every field is optional: a claim only populates the
 * fields it actually contains (a date claim has no "quantity", etc).
 */
export interface FactElements {
  subject?: string;
  action?: string;
  object?: string;
  quantity?: string;
  unit?: string;
  date?: string;
  place?: string;
  person?: string;
  organization?: string;
  causalRelation?: string;
}

export interface ClaimSourceEvidence {
  sourceUrl: string;
  sourceName: string;
  sourceLanguage: string;
  /** Verbatim excerpt from that source's own text, in the source's OWN language, confirmed programmatically to actually appear in it — this stays the canonical proof, never replaced by its translation. */
  evidenceQuote: string;
  /** A working translation of evidenceQuote into the claim's language — for human legibility and cross-language fact-element extraction ONLY. Never itself trusted as proof; empty when source and claim share a language. */
  evidenceTranslation: string;
  evidenceType: EvidenceType;
  verificationMethod: VerificationMethod;
  matchedFactFields: string[];
}

export interface FactMismatch {
  sourceUrl: string;
  sourceName: string;
  /** hard = an objectively-checkable field (quantity/date) actively disagrees → CONTRADICTED-grade signal. soft = a descriptive field (action/subject/place/...) disagrees → UNVERIFIED-grade signal (the source is real, but doesn't actually say what was published). */
  severity: "hard" | "soft";
  mismatchedFields: string[];
}

export interface RegisteredClaim {
  claim: string;
  /** Set when the claim's proof came back from the Evidence Pack rather than from the fact-checker's own citation — the claim restates a fact already confirmed verbatim before writing. */
  recoveredFromEvidencePack?: boolean;
  /** Alias of `claim` — the claim exactly as published, in the article's language. Kept as its own field per the brief so the record is self-describing without reaching into the article. */
  publishedClaim: string;
  claimLanguage: string;
  type: ClaimType;
  importance: ClaimImportance;
  verificationStatus: VerificationStatus;
  verificationMethod: VerificationMethod;
  confidence: number; // model's self-reported confidence — recorded for transparency, NEVER used to upgrade verificationStatus (see determineStatus below)
  sources: ClaimSourceEvidence[]; // only entries that passed programmatic verification (Level 1-4)
  mismatches: FactMismatch[]; // entries where the quote was real but its facts contradicted the published claim
  reasoning: string;
}

export interface ClaimRegistryResult {
  claims: RegisteredClaim[];
  /** FACT-CHECK PASS/FAIL — false if any "critical" claim is UNVERIFIED or CONTRADICTED. */
  pass: boolean;
  blockingClaims: RegisteredClaim[];
}

const FACT_ELEMENTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    action: { type: "string" },
    object: { type: "string" },
    quantity: { type: "string" },
    unit: { type: "string" },
    date: { type: "string" },
    place: { type: "string" },
    person: { type: "string" },
    organization: { type: "string" },
    causalRelation: { type: "string" },
  },
  required: ["subject", "action", "object", "quantity", "unit", "date", "place", "person", "organization", "causalRelation"],
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          claimLanguage: { type: "string" },
          type: { type: "string", enum: ["quote", "statistic", "date", "name", "role", "event", "general"] },
          importance: { type: "string", enum: ["critical", "significant", "minor"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          publishedFactElements: FACT_ELEMENTS_SCHEMA,
          sourceEvidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                sourceIndex: { type: "integer" },
                sourceLanguage: { type: "string" },
                // The model's claimed verbatim excerpt, in the SOURCE's own
                // language — trusted nowhere in this module until
                // verifyEvidenceAgainstSources() below confirms it actually
                // appears in that source's real text.
                evidenceQuote: { type: "string" },
                // A working translation of evidenceQuote into claimLanguage —
                // never itself proof; empty string when sourceLanguage ===
                // claimLanguage.
                evidenceTranslation: { type: "string" },
                // Atomic facts extracted from evidenceTranslation (or from
                // evidenceQuote directly when the languages match) so they
                // are directly, string-comparable against publishedFactElements.
                sourceFactElements: FACT_ELEMENTS_SCHEMA,
              },
              required: ["sourceIndex", "sourceLanguage", "evidenceQuote", "evidenceTranslation", "sourceFactElements"],
            },
          },
          contradictionDetected: { type: "boolean" },
          contradictionNote: { type: "string" },
        },
        required: ["claim", "claimLanguage", "type", "importance", "confidence", "publishedFactElements", "sourceEvidence", "contradictionDetected", "contradictionNote"],
      },
    },
  },
  required: ["claims"],
};

/** Shape of one claim as returned by the model, before programmatic verification — exported so tests can exercise verifyEvidenceAgainstSources()/determineStatus() directly with fixtures, without paying for a real API call per scenario. */
export interface RawSourceEvidenceForTesting {
  sourceIndex: number;
  sourceLanguage: string;
  evidenceQuote: string;
  evidenceTranslation: string;
  sourceFactElements: FactElements;
}
export interface RawClaimForTesting {
  claim: string;
  claimLanguage: string;
  type: ClaimType;
  importance: ClaimImportance;
  confidence: number;
  publishedFactElements: FactElements;
  sourceEvidence: RawSourceEvidenceForTesting[];
  contradictionDetected: boolean;
  contradictionNote: string;
}
type RawClaim = RawClaimForTesting;

const SYSTEM_PROMPT = `Tu es un fact-checker indépendant, spécialisé dans la vérification multilingue. On te donne un article (dans sa langue de publication) et une ou plusieurs sources numérotées (potentiellement dans une autre langue). Décompose l'article en affirmations factuelles significatives (chiffres, dates, noms, fonctions, citations, événements) et pour CHACUNE :

- "claimLanguage" : la langue dans laquelle l'affirmation est publiée (ex: "fr").
- "type": quote (citation directe), statistic (chiffre), date, name (nom propre), role (fonction/titre), event, ou general.
- "importance": "critical" pour tout ce qui pourrait induire le lecteur en erreur si c'est faux (chiffres, citations, fonctions, causalité) ; "significant" pour le reste des faits vérifiables ; "minor" pour les détails d'ambiance.
- "publishedFactElements": décompose l'affirmation TELLE QUE PUBLIÉE en éléments atomiques (sujet, action, objet, quantité, unité, date, lieu, personne, organisation, relation causale) — ne remplis que les champs pertinents, laisse les autres vides ("").
- "sourceEvidence": pour CHAQUE source qui contient réellement l'information à l'origine de ce claim :
  - "sourceLanguage": la langue RÉELLE de cette source (ex: "en").
  - "evidenceQuote": l'extrait EXACT, mot pour mot, DANS LA LANGUE D'ORIGINE de la source, qui prouve le fait. N'invente jamais un extrait — s'il n'y a pas de correspondance exacte dans une source, ne mentionne pas cette source pour ce claim.
  - "evidenceTranslation": si la source n'est pas dans la même langue que le claim publié, une traduction de travail fidèle de "evidenceQuote" dans la langue du claim. Chaîne vide si les langues sont identiques.
  - "sourceFactElements": IMPÉRATIF — ces champs doivent TOUJOURS être rédigés dans la même langue que "claimLanguage" (la langue du claim publié), JAMAIS dans la langue de la source. Si la source est dans une autre langue, décompose "evidenceTranslation" (pas "evidenceQuote") en éléments atomiques ; si la source est déjà dans la même langue que le claim, décompose "evidenceQuote" directement. Un champ "sourceFactElements" rédigé dans la langue de la source (au lieu de celle du claim) sera considéré comme une erreur : la comparaison automatique qui suit est purement textuelle et échouera systématiquement si les deux côtés ne sont pas dans la même langue.
  S'il n'y a AUCUNE source qui la prouve, "sourceEvidence" doit être un tableau vide.
- "contradictionDetected": true si deux sources ou plus se contredisent sur cette affirmation (ex: chiffres différents pour le même fait) — dans ce cas décris le désaccord dans "contradictionNote".

Exemple (source en anglais, claim publié en français) :
Source : "Organizers confirmed the month of September alone is set to attract 496,000 visitors to Milan Fashion Week."
Claim publié : "Le seul mois de septembre devrait attirer 496 000 visiteurs à la Fashion Week de Milan."
→ "evidenceQuote": "Organizers confirmed the month of September alone is set to attract 496,000 visitors to Milan Fashion Week." (anglais, verbatim de la source)
→ "evidenceTranslation": "Les organisateurs ont confirmé que le seul mois de septembre devrait attirer 496 000 visiteurs à la Fashion Week de Milan." (français)
→ "sourceFactElements" (rédigé en FRANÇAIS, à partir de evidenceTranslation, PAS de evidenceQuote) : {"subject": "le mois de septembre", "action": "attirer", "quantity": "496000", "unit": "visiteurs", "date": "septembre", "place": "Milan", ...}
→ "publishedFactElements" (français) : {"subject": "le mois de septembre", "action": "attirer", "quantity": "496000", "unit": "visiteurs", "date": "septembre", "place": "Milan", ...}
Les deux objets sont dans la MÊME langue et se comparent directement.

Règle absolue : ne jamais citer un "evidenceQuote" qui n'est pas mot pour mot dans la source — un extrait approximatif ou reformulé sera rejeté de toute façon par une vérification automatique indépendante de ta réponse. La traduction ("evidenceTranslation") n'est JAMAIS considérée comme preuve en elle-même — seule "evidenceQuote" (texte original) fait foi de l'existence du fait dans la source ; la traduction et les éléments atomiques ne servent qu'à vérifier que le sens publié correspond bien au sens de la source.`;

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Deeper normalization for Level 2 (NORMALIZED): punctuation, quote/apostrophe variants, and whitespace around numbers — so "496,000" / "496 000", "l'exposition" / "l' exposition", curly vs straight quotes, etc. compare equal without touching the actual digits (that stays exact — see normalizeNumber for locale-aware grouping). */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,](?=\d{3}(\D|$))/g, "") // strip thousands separators immediately followed by exactly 3 digits
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s'".-]/gu, "")
    .trim();
}

/** Strips diacritics and normalizes case/whitespace/leading articles for cross-language-safe(ish) soft-field comparison (used only once both sides are already in the SAME language — see verifyEvidenceAgainstSources). */
function normalizeTextField(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(le |la |les |l |un |une |des |the |a |an )/, "");
}

function matchText(a: string, b: string): boolean {
  const na = normalizeTextField(a);
  const nb = normalizeTextField(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na));
}

/** Locale-agnostic number normalization: strips thousands separators (",", ".", " ", "'", nbsp) while preserving a genuine trailing decimal. "496,000" and "496 000" both normalize to "496000"; "49.6" (a real decimal) stays "49.6". */
export function normalizeNumber(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/[^\d.,\s\u00a0\u202f']/g, "");
  if (!cleaned) return undefined;
  const parts = cleaned.split(/[.,\s\u00a0\u202f']+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const last = parts[parts.length - 1]!;
  const isDecimal = parts.length > 1 && last.length <= 2 && !/^\d{3}$/.test(last);
  if (isDecimal) return parts.slice(0, -1).join("") + "." + last;
  return parts.join("");
}

const FR_MONTHS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04", mai: "05", juin: "06",
  juillet: "07", août: "08", aout: "08", septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};
const EN_MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07",
  august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** Parses an English or French date phrase (or an ISO-ish one) into YYYY-MM-DD, without guessing on genuinely ambiguous numeric-only formats (dd/mm vs mm/dd) — returns undefined rather than risk a false equivalence. */
export function normalizeDateString(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-zéûôâîàèêçù]+)\s+(\d{4})/);
  if (dmy) {
    const month = FR_MONTHS[dmy[2]!] ?? EN_MONTHS[dmy[2]!];
    if (month) return `${dmy[3]}-${month}-${dmy[1]!.padStart(2, "0")}`;
  }

  const mdy = s.match(/([a-zéûôâîàèêçù]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (mdy) {
    const month = FR_MONTHS[mdy[1]!] ?? EN_MONTHS[mdy[1]!];
    if (month) return `${mdy[3]}-${month}-${mdy[2]!.padStart(2, "0")}`;
  }

  // A bare month name with no day/year attached (e.g. the model only
  // extracted "septembre" / "September" into the "date" field) — still
  // worth comparing at the month level. Returning undefined here would make
  // compareFactElements treat two genuinely-equal bare months as an
  // unparseable, discarded field — see the caller for why that specific gap
  // used to surface as a false CONTRADICTED on a real live run.
  const bareMonth = s.match(/^([a-zéûôâîàèêçù]+)$/);
  if (bareMonth) {
    const month = FR_MONTHS[bareMonth[1]!] ?? EN_MONTHS[bareMonth[1]!];
    if (month) return `month:${month}`;
  }
  return undefined;
}

const HARD_FIELDS = ["quantity", "date"] as const;
const SOFT_FIELDS = ["subject", "action", "object", "unit", "place", "person", "organization", "causalRelation"] as const;

export interface FactComparisonResult {
  verdict: "match" | "hard_mismatch" | "soft_mismatch" | "insufficient";
  matchedFields: string[];
  mismatchedFields: string[];
}

/**
 * §"LEVEL 3/4" of the brief — the actual cross-language/semantic equivalence
 * check, entirely field-by-field and deterministic. Compares only fields
 * populated on BOTH sides; a claim never gets credit for a field the source
 * simply didn't mention. A mismatch on a hard (quantity/date) field is
 * reported separately from a soft (descriptive) one, so determineStatus can
 * distinguish "the number is actually wrong" (CONTRADICTED-grade) from "the
 * framing/causality isn't actually supported" (UNVERIFIED-grade) — this is
 * what catches a correct number attached to an unsupported action/cause.
 */
export function compareFactElements(source: FactElements, published: FactElements): FactComparisonResult {
  const matched: string[] = [];
  const mismatchedHard: string[] = [];
  const mismatchedSoft: string[] = [];

  for (const f of HARD_FIELDS) {
    const a = source[f]?.trim();
    const b = published[f]?.trim();
    if (!a || !b) continue;
    const na = f === "quantity" ? normalizeNumber(a) : normalizeDateString(a);
    const nb = f === "quantity" ? normalizeNumber(b) : normalizeDateString(b);
    // Neither side could be parsed into a comparable form — a parser
    // limitation is not evidence of disagreement; skip rather than accuse.
    if (na === undefined || nb === undefined) continue;
    if (na === nb) matched.push(f);
    else mismatchedHard.push(f);
  }
  for (const f of SOFT_FIELDS) {
    const a = source[f]?.trim();
    const b = published[f]?.trim();
    if (!a || !b) continue;
    if (matchText(a, b)) matched.push(f);
    else mismatchedSoft.push(f);
  }

  if (matched.length === 0 && mismatchedHard.length === 0 && mismatchedSoft.length === 0) {
    return { verdict: "insufficient", matchedFields: [], mismatchedFields: [] };
  }
  if (mismatchedHard.length > 0) return { verdict: "hard_mismatch", matchedFields: matched, mismatchedFields: [...mismatchedHard, ...mismatchedSoft] };
  if (mismatchedSoft.length > 0) return { verdict: "soft_mismatch", matchedFields: matched, mismatchedFields: mismatchedSoft };
  return { verdict: "match", matchedFields: matched, mismatchedFields: [] };
}

function langOf(tag: string | undefined): string {
  return (tag ?? "").trim().toLowerCase();
}

/**
 * §10 of the original brief, extended for multilingual sources. Two
 * independent checks are chained, and NEITHER is ever skipped:
 *
 *   STEP 1 — the quote itself must be real. evidenceQuote must really,
 *   verbatim (Level 1) or near-verbatim after normalization (Level 2),
 *   appear in that source's own real text, in the source's OWN language.
 *   If it doesn't, the whole entry is discarded outright — no amount of
 *   translation or fact-element matching can rescue a quote that was never
 *   really there. This check alone is nearly always same-language (the
 *   quote is checked against the source it was drawn from), so it is
 *   necessary but NOT sufficient by itself for a cross-language claim.
 *
 *   STEP 2 — the quote must actually support what was PUBLISHED, not just
 *   exist somewhere in the source:
 *     - type "quote": the PUBLISHED claim text itself must contain that
 *       same verbatim quote — never the source. A translated quote, by
 *       construction, cannot pass this (zero tolerance, no fallback).
 *     - same language as the claim: if there are no comparable atomic
 *       facts (compareFactElements → "insufficient"), the Step-1 verbatim
 *       match alone is trusted (this preserves the original single-language
 *       behavior). Any real mismatch on a comparable field still blocks it.
 *     - different language from the claim: compareFactElements MUST return
 *       "match" (Level 3 if a hard field like quantity/date was checked,
 *       Level 4 if only descriptive fields were) — "insufficient" is NOT a
 *       pass here. Per the brief: never turn UNVERIFIED into VERIFIED just
 *       because a translation "seems" faithful with nothing to actually check.
 */
export function verifyEvidenceAgainstSources(rawClaim: RawClaimForTesting, registeredSources: RegisteredSource[]): { verified: ClaimSourceEvidence[]; mismatches: FactMismatch[] } {
  const verified: ClaimSourceEvidence[] = [];
  const mismatches: FactMismatch[] = [];

  for (const match of rawClaim.sourceEvidence) {
    const entry = registeredSources[match.sourceIndex];
    if (!entry) continue;
    const rawSourceText = `${entry.source.title} ${entry.source.text ?? entry.source.excerpt ?? ""}`;
    const rawQuote = match.evidenceQuote;
    if (!rawQuote || rawQuote.trim().length < 8) continue;

    const exactMatch = normalize(rawSourceText).includes(normalize(rawQuote));
    const normalizedMatch = !exactMatch && normalizeForComparison(rawSourceText).includes(normalizeForComparison(rawQuote));
    if (!exactMatch && !normalizedMatch) continue; // Step 1 failed: the asserted quote is not really in the source — never trusted, for any claim type.

    const baseEvidence = {
      sourceUrl: entry.source.url,
      sourceName: entry.source.sourceName,
      sourceLanguage: match.sourceLanguage,
      evidenceQuote: match.evidenceQuote,
      evidenceTranslation: match.evidenceTranslation,
    };

    if (rawClaim.type === "quote") {
      // Zero tolerance: checked against the PUBLISHED claim text, not the
      // source — a translated quote will never literally appear in a
      // differently-worded published sentence, which is exactly the point.
      const claimHasQuoteExact = normalize(rawClaim.claim).includes(normalize(rawQuote));
      const claimHasQuoteNormalized = !claimHasQuoteExact && normalizeForComparison(rawClaim.claim).includes(normalizeForComparison(rawQuote));
      if (claimHasQuoteExact || claimHasQuoteNormalized) {
        verified.push({ ...baseEvidence, evidenceType: claimHasQuoteExact ? "exactEvidence" : "normalizedEvidence", verificationMethod: claimHasQuoteExact ? "EXACT" : "NORMALIZED", matchedFactFields: [] });
      }
      continue; // a quote never falls through to fact-element comparison
    }

    const crossLanguage = langOf(match.sourceLanguage) !== "" && langOf(rawClaim.claimLanguage) !== "" && langOf(match.sourceLanguage) !== langOf(rawClaim.claimLanguage);
    const comparison = compareFactElements(match.sourceFactElements, rawClaim.publishedFactElements);

    if (comparison.verdict === "hard_mismatch" || comparison.verdict === "soft_mismatch") {
      mismatches.push({ sourceUrl: entry.source.url, sourceName: entry.source.sourceName, severity: comparison.verdict === "hard_mismatch" ? "hard" : "soft", mismatchedFields: comparison.mismatchedFields });
      continue;
    }

    if (comparison.verdict === "insufficient") {
      if (crossLanguage) continue; // nothing checkable to bridge the language gap — never a free pass.
      verified.push({ ...baseEvidence, evidenceType: exactMatch ? "exactEvidence" : "normalizedEvidence", verificationMethod: exactMatch ? "EXACT" : "NORMALIZED", matchedFactFields: [] });
      continue;
    }

    // comparison.verdict === "match"
    if (!crossLanguage) {
      verified.push({ ...baseEvidence, evidenceType: exactMatch ? "exactEvidence" : "normalizedEvidence", verificationMethod: exactMatch ? "EXACT" : "NORMALIZED", matchedFactFields: comparison.matchedFields });
    } else {
      const usedHardField = comparison.matchedFields.some((f) => (HARD_FIELDS as readonly string[]).includes(f));
      verified.push({ ...baseEvidence, evidenceType: usedHardField ? "translatedEvidence" : "semanticEvidence", verificationMethod: usedHardField ? "CROSS_LANGUAGE" : "SEMANTIC", matchedFactFields: comparison.matchedFields });
    }
  }

  return { verified, mismatches };
}

/**
 * Determines verificationStatus from ONLY: (a) programmatically-verified
 * evidence (Level 1-4), (b) explicit fact-element mismatches (real quote,
 * wrong facts), (c) whether any backing source is marked primary, (d)
 * whether the model flagged a contradiction. `confidence` never enters this
 * decision — a confident model is not the same thing as a proven claim
 * (the brief's explicit "ne jamais transformer un score de confiance en
 * vérité").
 */
export function determineStatus(rawClaim: RawClaimForTesting, verification: { verified: ClaimSourceEvidence[]; mismatches: FactMismatch[] }, registeredSources: RegisteredSource[]): VerificationStatus {
  const { verified, mismatches } = verification;

  if (rawClaim.contradictionDetected) return "CONTRADICTED";
  if (mismatches.some((m) => m.severity === "hard")) return "CONTRADICTED";

  // Quotes get zero tolerance (§5): only exactEvidence/normalizedEvidence count, and only those are ever pushed into `verified` for a quote (see verifyEvidenceAgainstSources) — so an empty `verified` here already means no verbatim match was found, regardless of confidence or importance.
  if (rawClaim.type === "quote" && verified.length === 0) return "UNVERIFIED";

  if (verified.length === 0) return "UNVERIFIED";

  const backedByPrimary = rawClaim.sourceEvidence.some((m) => registeredSources[m.sourceIndex]?.isPrimary && verified.some((v) => v.sourceUrl === registeredSources[m.sourceIndex]!.source.url));

  if (rawClaim.importance === "critical") {
    // §8: a single weak (non-primary) source is not enough for a sensitive/important fact — Level 5 (independentEvidence).
    if (verified.length >= 2 || backedByPrimary) return "VERIFIED";
    return "PARTIALLY_VERIFIED";
  }

  return "VERIFIED";
}

function reasonFor(rawClaim: RawClaimForTesting, verified: ClaimSourceEvidence[], mismatches: FactMismatch[]): string {
  if (rawClaim.contradictionDetected) return rawClaim.contradictionNote;
  const hardMismatch = mismatches.find((m) => m.severity === "hard");
  if (hardMismatch) return `Le fait publié contredit la source sur : ${hardMismatch.mismatchedFields.join(", ")} (source: ${hardMismatch.sourceName}).`;
  const softMismatch = mismatches.find((m) => m.severity === "soft");
  if (softMismatch) return `La citation existe dans la source, mais ne soutient pas ce qui est réellement affirmé (écart sur : ${softMismatch.mismatchedFields.join(", ")} — source: ${softMismatch.sourceName}).`;
  if (verified.length > 0) {
    const byLevel = verified.map((v) => `${v.sourceName} [${v.verificationMethod}${v.matchedFactFields.length ? `: ${v.matchedFactFields.join(", ")}` : ""}]`).join("; ");
    return `Preuve vérifiée : ${byLevel}.`;
  }
  return "Aucune preuve vérifiable trouvée dans les sources fournies.";
}

/**
 * §6 pipeline step ("FINAL FACT-CHECK PASS"), run after generation. Accepts
 * multiple sources (registeredSources.length can be 1 or more) — the
 * verification logic itself is genuinely multi-source-capable and is
 * exercised that way in tests/claimRegistry.test.ts. The live pipeline
 * (scheduler/run.ts) currently calls this with a single source, since
 * ingestion only ever fetches one URL per run today; extending ingestion to
 * merge multiple URLs into one article is a separate, larger feature not
 * built in this phase.
 */
export async function buildClaimRegistry(
  article: GeneratedArticle,
  registeredSources: RegisteredSource[],
  runId: string,
  evidencePack?: VerifiedFactSet,
): Promise<ClaimRegistryResult> {
  log("FACT CHECK", `Registre de claims (fact-check final, multilingue) — ${article.title}`);
  const config = loadConfig();

  const articleText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join("\n");

  const sourcesBlock = registeredSources
    .map((s, i) => `[Source ${i}] ${s.isPrimary ? "(PRIMAIRE) " : ""}${s.source.sourceName} — ${s.source.url}\n${s.source.text ?? s.source.excerpt ?? ""}`)
    .join("\n\n");

  const raw = await structuredCompletion<{ claims: RawClaim[] }>({
    system: SYSTEM_PROMPT,
    user: `Article (langue de publication : ${article.lang}):\nTitre: ${article.title}\nExcerpt: ${article.excerpt}\n${articleText}\n\n--- Sources ---\n${sourcesBlock}`,
    schemaName: "claim_registry",
    schema: SCHEMA,
    model: config.modelFactcheck,
    step: "quality-control",
    runId,
  });

  const claims: RegisteredClaim[] = raw.claims.map((rawClaim) => {
    const verification = verifyEvidenceAgainstSources(rawClaim, registeredSources);
    let verificationStatus = determineStatus(rawClaim, verification, registeredSources);
    let sources = verification.verified;
    let recoveredFromEvidencePack = false;
    let reasoning = reasonFor(rawClaim, verification.verified, verification.mismatches);

    // The fact-checker found nothing, but the claim may simply be restating
    // a fact already confirmed verbatim before writing — hand it back its
    // original proof rather than rejecting a sentence we ourselves sourced.
    if (sources.length === 0 && verificationStatus === "UNVERIFIED") {
      const recovered = recoverEvidence(rawClaim.claim, rawClaim.type, evidencePack);
      if (recovered) {
        recoveredFromEvidencePack = true;
        verificationStatus = recovered.fact.status;
        sources = [
          {
            sourceUrl: registeredSources[0]?.source.url ?? "",
            sourceName: registeredSources[0]?.source.sourceName ?? "",
            sourceLanguage: evidencePack?.sourceLanguage ?? "",
            evidenceQuote: recovered.fact.evidenceQuote,
            evidenceTranslation: recovered.fact.evidenceTranslation,
            evidenceType: "recoveredEvidence",
            verificationMethod: "EVIDENCE_PACK",
            matchedFactFields: recovered.matchedTokens,
          },
        ];
        reasoning = `Preuve récupérée du fait déjà vérifié avant rédaction : « ${recovered.fact.fact} » (statut d'origine ${recovered.fact.status}, données communes : ${recovered.matchedTokens.join(", ") || "aucune donnée chiffrée"}).`;
      }
    }

    // A genuine excerpt does not license a relation it never states.
    if (verificationStatus !== "UNVERIFIED" && verificationStatus !== "CONTRADICTED") {
      const evidenceTexts = sources.flatMap((s) => [s.evidenceQuote, s.evidenceTranslation]);
      if (assertsUnsupportedRelation(rawClaim.claim, evidenceTexts)) {
        verificationStatus = "UNVERIFIED";
        reasoning = "L'affirmation introduit une relation (causalité, motivation, conséquence ou comparaison) que la preuve source n'énonce pas.";
        sources = [];
      }
    }

    const primaryMethod = sources[0]?.verificationMethod ?? "NONE";
    return {
      claim: rawClaim.claim,
      recoveredFromEvidencePack,
      publishedClaim: rawClaim.claim,
      claimLanguage: rawClaim.claimLanguage,
      type: rawClaim.type,
      importance: rawClaim.importance,
      verificationStatus,
      verificationMethod: verificationStatus === "VERIFIED" || verificationStatus === "PARTIALLY_VERIFIED" ? primaryMethod : "NONE",
      confidence: rawClaim.confidence,
      sources,
      mismatches: verification.mismatches,
      reasoning,
    };
  });

  // Absolute blocking rules. Beyond critical claims, an unsupported figure
  // or an unsupported quote blocks on its own whatever its importance, and
  // any contradiction blocks outright — a wrong number or an invented
  // quotation misleads a reader regardless of how incidental it looked to
  // the model that classified it.
  const blockingClaims = claims.filter((c) => {
    const unsupported = c.verificationStatus === "UNVERIFIED" || c.verificationStatus === "CONTRADICTED";
    if (!unsupported) return false;
    return c.importance === "critical" || c.type === "statistic" || c.type === "quote" || c.verificationStatus === "CONTRADICTED";
  });

  const pass = blockingClaims.length === 0;
  log("FACT CHECK", `${pass ? "FACT-CHECK PASS" : "FACT-CHECK FAIL"} — ${claims.length} claim(s), ${blockingClaims.length} bloquant(s)`);
  return { claims, pass, blockingClaims };
}
