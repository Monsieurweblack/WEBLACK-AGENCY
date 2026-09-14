/**
 * §1 Level 4 support — a purely local, regex-based heuristic to approximate
 * "entities" (people/brand/organization/event-like proper nouns) in a piece
 * of text that was NOT run through the OpenAI fact-extraction step (i.e. an
 * existing Sanity article's title+excerpt, which the engine never
 * re-extracts facts from). This is intentionally crude — a capitalized
 * multi-word phrase detector, not real NER — and is used only as a
 * corroborating SIGNAL alongside title similarity, never as the sole basis
 * for a duplicate decision.
 */
const STOPWORDS_AT_PHRASE_START = new Set([
  "the", "a", "an", "le", "la", "les", "un", "une", "des", "de", "du", "et", "and", "or", "ou", "in", "on", "at", "for", "pour", "avec", "with",
]);

export function extractLocalEntities(text: string): string[] {
  const matches = text.match(/\b(?:[A-ZÀ-Ý][a-zà-ÿ'’-]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ'’-]+){0,3})\b/g) ?? [];
  const seen = new Set<string>();
  for (const m of matches) {
    const firstWord = m.split(/\s+/)[0]!.toLowerCase();
    if (STOPWORDS_AT_PHRASE_START.has(firstWord)) continue;
    if (m.length < 3) continue;
    seen.add(m.trim());
  }
  return [...seen];
}

/** Overlap ratio (0-1) between two entity lists, case-insensitive, plus which ones matched — used as an explanatory signal in the dedup decision, not as a threshold gate on its own. */
export function entityOverlap(a: string[], b: string[]): { ratio: number; shared: string[] } {
  const setB = new Set(b.map((e) => e.toLowerCase()));
  const shared = a.filter((e) => setB.has(e.toLowerCase()));
  const union = new Set([...a, ...b].map((e) => e.toLowerCase())).size;
  return { ratio: union === 0 ? 0 : shared.length / union, shared: [...new Set(shared)] };
}
