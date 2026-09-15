import type { GeneratedArticle } from "./types.ts";
import { containsRelationMarker } from "../validation/equivalences.ts";
import { log } from "../logs/logger.ts";

export interface Neutralization {
  before: string;
  after: string;
  marker: string;
}

export interface NeutralizationResult {
  article: GeneratedArticle;
  rewrites: Neutralization[];
  /** Sentences still asserting a relation after the pass — nothing safe could be done with them, so they must be judged by the fact check. */
  irreducible: string[];
}

/**
 * Turns an asserted causality back into the plain juxtaposition of facts it
 * was built from — but only where that can be done without touching the
 * facts themselves.
 *
 * The writer is told never to invent a causal link, and mostly obeys; what
 * survives is a discourse connective laid over two facts that are each
 * genuinely in the Evidence Pack. "Le salon ouvre le 22 septembre. Par
 * conséquent, la ville se prépare." asserts a consequence the source never
 * stated, while the two statements on their own are supported. Removing the
 * connective removes the invented claim and leaves the facts standing.
 *
 * This is deliberately narrow. It only ever DELETES a connective or splits
 * a clause — it never rewrites a sentence's substance, never reorders
 * facts, and never touches causality carried by the verb itself ("son
 * passage chez Fendi l'a conduite chez Dior"), because neutralising that
 * would mean rewriting French prose, which cannot be done safely by string
 * surgery and would need a model call this pipeline is not allowed to add.
 * Those are left intact and reported as irreducible, so the fact check
 * rejects the article rather than a mangled sentence reaching a reader.
 */
export function neutralizeCausality(article: GeneratedArticle): NeutralizationResult {
  const rewrites: Neutralization[] = [];
  const irreducible: string[] = [];

  const body = article.body.map((block) => {
    if (block._type !== "block") return block;
    const children = block.children.map((child) => {
      const before = child.text;
      const after = neutralizeSentence(before, rewrites);
      if (containsRelationMarker(after)) irreducible.push(after);
      return after === before ? child : { ...child, text: after };
    });
    return { ...block, children };
  });

  if (rewrites.length > 0) {
    log("GENERATION", `Causalité neutralisée — ${rewrites.length} formulation(s) ramenée(s) à une relation factuelle neutre`);
  }
  return { article: { ...article, body }, rewrites, irreducible };
}

/**
 * Only adverbials — a consequence asserted by a word that can simply be
 * deleted, leaving a complete sentence behind.
 *
 * Subordinate causal clauses ("…, ce qui a entraîné une hausse de la
 * production") are deliberately NOT here. Splitting one leaves "Une hausse
 * de la production." — a verbless fragment, because the clause's only verb
 * was the causal verb itself. Publishing broken French to avoid a rejection
 * would be the wrong trade; those are reported as irreducible and the fact
 * check turns the article down.
 */
const PATTERNS: { marker: string; find: RegExp }[] = [
  { marker: "Par conséquent", find: /^\s*par cons[ée]quent,?\s*/giu },
  { marker: "Pour cette raison", find: /^\s*pour cette raison,?\s*/giu },
  { marker: "De ce fait", find: /^\s*de ce fait,?\s*/giu },
  { marker: "C'est pourquoi", find: /^\s*c['’]est pourquoi,?\s*/giu },
  { marker: "Ainsi", find: /^\s*ainsi,\s*/giu },
  { marker: "Donc", find: /^\s*donc,?\s*/giu },
  { marker: ", par conséquent,", find: /,\s*par cons[ée]quent,\s*/giu },
  { marker: ", donc,", find: /,\s*donc,\s*/giu },
  { marker: ", de ce fait,", find: /,\s*de ce fait,\s*/giu },
];

function neutralizeSentence(text: string, rewrites: Neutralization[]): string {
  let current = text;
  for (const { marker, find } of PATTERNS) {
    find.lastIndex = 0;
    if (!find.test(current)) continue;
    find.lastIndex = 0;
    const before = current;
    current = tidy(current.replace(find, " "));
    if (current !== before) rewrites.push({ before, after: current, marker });
  }
  return current;
}

/** Restores the small things the deletions break: doubled spaces, a lowercase start, a space before punctuation. */
function tidy(text: string): string {
  const cleaned = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\.\s*\./g, ".")
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
