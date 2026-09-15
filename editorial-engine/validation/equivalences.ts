import { normalizeNumber } from "./claimRegistry.ts";

/**
 * Deterministic, value-preserving equivalences — and nothing else.
 *
 * The rule that shapes this whole module: two values that are genuinely
 * different must never collapse onto the same token. 2026 stays distinct
 * from 2023, 496 000 from 497 000, 14 h from 15 h. What IS collapsed is
 * only a difference of NOTATION for one and the same value:
 *
 *   "496,000"            = "496 000"          (thousands separator)
 *   "2 p.m."             = "14 heures"        (12- vs 24-hour clock)
 *   "Spring/Summer 2026" = "SS26"             (season shorthand)
 *
 * Times and seasons get their own token namespaces ("time:14",
 * "season:SS2026") rather than being folded into plain numbers. That is
 * what keeps the mapping safe in both directions: an article writing
 * "SS26" resolves to season:SS2026 and can only ever match a real
 * Spring/Summer 2026 in the source — while an unrelated "26 créateurs"
 * stays the plain number 26 and is still checked on its own merits. Fold
 * them into plain numbers instead and "26 créateurs" would silently start
 * matching any 2026 in the source.
 */

const SEASON_PREFIX: Record<string, string> = {
  "spring/summer": "SS",
  "spring-summer": "SS",
  "printemps/ete": "SS",
  "printemps-ete": "SS",
  "autumn/winter": "AW",
  "autumn-winter": "AW",
  "fall/winter": "AW",
  "fall-winter": "AW",
  "automne/hiver": "AW",
  "automne-hiver": "AW",
};

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Replaces a matched span with spaces so its digits cannot leak into the plain-number pass. */
function blank(text: string, start: number, length: number): string {
  return text.slice(0, start) + " ".repeat(length) + text.slice(start + length);
}

/**
 * Turns free text into comparable tokens: "season:SS2026", "time:14", and
 * plain normalized numbers for everything else. Both sides of any
 * comparison must go through this same function — that symmetry is what
 * makes the equivalences safe.
 */
export function extractComparableTokens(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  let working = stripAccents(text).toLowerCase();

  // Seasons written out: "spring/summer 2026" -> season:SS2026
  const spelledSeason = /\b(spring[\/-]summer|printemps[\/-]ete|autumn[\/-]winter|fall[\/-]winter|automne[\/-]hiver)\s+(\d{4})\b/g;
  for (let m = spelledSeason.exec(working); m !== null; m = spelledSeason.exec(working)) {
    const prefix = SEASON_PREFIX[m[1]!];
    if (prefix) tokens.push(`season:${prefix}${m[2]}`);
    working = blank(working, m.index, m[0].length);
    spelledSeason.lastIndex = m.index;
  }

  // Season shorthand: "SS26" / "AW26" / "FW26" -> season:SS2026
  const shortSeason = /\b(ss|aw|fw)\s?(\d{2})\b/g;
  for (let m = shortSeason.exec(working); m !== null; m = shortSeason.exec(working)) {
    const prefix = m[1] === "fw" ? "AW" : m[1]!.toUpperCase();
    tokens.push(`season:${prefix}20${m[2]}`);
    working = blank(working, m.index, m[0].length);
    shortSeason.lastIndex = m.index;
  }

  // 12-hour clock: "2 p.m." / "2:30 p.m." -> time:14
  const twelveHour = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?/g;
  for (let m = twelveHour.exec(working); m !== null; m = twelveHour.exec(working)) {
    const raw = Number(m[1]);
    if (raw >= 1 && raw <= 12) {
      const hour = m[3] === "p" ? (raw % 12) + 12 : raw % 12;
      tokens.push(`time:${hour}`);
    }
    working = blank(working, m.index, m[0].length);
    twelveHour.lastIndex = m.index;
  }

  // 24-hour clock: "14 heures" / "14h" / "14 h 00" / "14:00" -> time:14
  const twentyFourHour = /\b(\d{1,2})\s*(?:heures?|h\b|:\d{2})\s*(?:\d{2})?/g;
  for (let m = twentyFourHour.exec(working); m !== null; m = twentyFourHour.exec(working)) {
    const hour = Number(m[1]);
    if (hour >= 0 && hour <= 23) tokens.push(`time:${hour}`);
    working = blank(working, m.index, m[0].length);
    twentyFourHour.lastIndex = m.index;
  }

  // Everything left over is a plain figure, normalized for separators only.
  for (const raw of working.match(/\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+(?:[.,]\d+)?/g) ?? []) {
    const normalized = normalizeNumber(raw);
    if (normalized) tokens.push(normalized);
  }

  return tokens;
}

/**
 * Markers of a factual RELATION — causality, motivation, consequence,
 * comparison, dependency. A published claim may only carry one of these if
 * the evidence carries one too: inferring "her time at Fendi led her to
 * Dior" from "she worked at Fendi, then at Dior" is exactly the kind of
 * new relation the writer must never introduce.
 */
const RELATION_MARKERS = [
  // French — causality / consequence / motivation
  "a cause de", "parce que", "en raison de", "grace a", "du fait", "ce qui a conduit", "conduit a", "a conduit",
  "entraine", "entrainant", "provoque", "provoquant", "resulte", "resultant", "decoule", "par consequent",
  "consequence", "explique par", "s explique", "ce qui explique", "afin de", "dans le but", "motive par", "pousse par",
  "permet de", "permettant", "a permis", "c est pourquoi", "pour cette raison", "de ce fait", "si bien que",
  "au point de", "faute de",
  // French — comparison / dependency
  "plus que", "moins que", "davantage que", "contrairement a", "au detriment de", "depend de", "grace auquel",
  // English equivalents, for same-language sources
  "because", "due to", "thanks to", "led to", "leading to", "resulted in", "as a result",
  "therefore", "consequently", "in order to", "driven by", "so that", "more than", "less than",
];

/**
 * "donc" and "ainsi" assert a consequence just as surely as "par
 * cons\u00e9quent", but both have common non-causal uses \u2014 "ainsi que" means
 * "as well as", and both appear inside longer words. They are matched as
 * whole words with "ainsi que" excluded, rather than left out of the net.
 */
const STANDALONE_MARKERS = /(^|[\s,;:-])(donc|ainsi)(?!\s+que)\b/;

export function containsRelationMarker(text: string): boolean {
  if (!text) return false;
  const normalized = stripAccents(text).toLowerCase().replace(/['\u2019]/g, " ").replace(/\s+/g, " ");
  if (RELATION_MARKERS.some((marker) => normalized.includes(marker))) return true;
  return STANDALONE_MARKERS.test(normalized);
}

const STOPWORDS = new Set([
  "dans", "avec", "pour", "cette", "cette", "leur", "leurs", "elle", "elles", "nous", "vous", "plus",
  "sont", "etre", "avoir", "fait", "faire", "chez", "selon", "entre", "aussi", "meme", "tout", "tous",
  "toute", "toutes", "depuis", "apres", "avant", "alors", "ainsi", "donc", "mais", "comme", "ses",
  "the", "and", "that", "with", "from", "this", "these", "those", "have", "has", "been", "will", "its",
  "for", "are", "was", "were", "their", "they", "which", "into", "about", "after", "before", "also",
]);

/**
 * Five-character stems of the content words.
 *
 * The Evidence Pack holds facts in the SOURCE's language while the article
 * is French, and the extraction step does not reliably fill in a working
 * translation — so comparing whole words across languages finds almost
 * nothing even when both sentences plainly describe the same fact.
 * Domain vocabulary here is overwhelmingly Latinate and shares its stem
 * across the two languages: économie/economy, africaine/African,
 * industrie/industry, importe/imports, exportations/exports. Five
 * characters is long enough that unrelated words rarely collide, and short
 * enough to survive the differing endings.
 *
 * This is a topical anchor, never a proof: recovery additionally requires
 * that the claim introduce no new figure and no new relation.
 */
export function stems(text: string): string[] {
  return [...new Set(contentWords(text).map((w) => w.slice(0, 5)))];
}

/** Content words of length >= 4, accent- and case-insensitive, stopwords removed — used to check two statements are actually about the same thing. */
export function contentWords(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}
