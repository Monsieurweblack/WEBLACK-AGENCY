import type { GeneratedArticle, ExtractedFacts } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

/** §2 — the fact-check architecture the brief asks for: every important claim in the generated article represented individually, traceable to the source evidence that grounds it (or the absence of any). This is the shape a future automatic-removal step would consume (§2: "préparer le système pour qu'une affirmation non supportée puisse être automatiquement supprimée ou bloquée") — this phase wires the structure and uses it to BLOCK, not yet to auto-edit the article text (see module docblock below for why). */
export interface Claim {
  claim: string;
  supported: boolean;
  sourceEvidence: string;
  confidence: number; // 0-100 — the model's confidence in its own supported/unsupported call
}

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
          supported: { type: "boolean" },
          sourceEvidence: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["claim", "supported", "sourceEvidence", "confidence"],
      },
    },
  },
  required: ["claims"],
};

const SYSTEM_PROMPT = `Tu es un vérificateur de faits strict. On te donne un article et la liste des faits vérifiés dont il est censé être issu.

Décompose l'article en affirmations individuelles importantes (chaque nom propre, chiffre, date, événement, citation avancé comme un fait). Pour CHAQUE affirmation :
- "claim": l'affirmation telle qu'elle apparaît dans l'article.
- "supported": true UNIQUEMENT si elle correspond explicitement à quelque chose dans les faits fournis. Une connaissance générale que tu possèdes par ailleurs, même correcte, compte comme non supportée si elle n'est pas dans les faits fournis.
- "sourceEvidence": la portion exacte des faits fournis qui la supporte (chaîne vide si non supportée).
- "confidence": ta confiance (0-100) dans ce jugement supported/non-supported.

Inclus aussi les affirmations généralistes légitimes (reformulations, transitions) avec "supported": true et une "sourceEvidence" décrivant en une phrase pourquoi (ex: reformulation directe d'un fait fourni) — l'objectif est une couverture complète de l'article, pas seulement une liste de fautes.`;

export interface AntiFabricationResult {
  pass: boolean;
  claims: Claim[];
  unsupportedClaims: Claim[];
}

/**
 * §6 Call 4 (quality control, fact dimension). Structured as claims, not a
 * single pass/fail, so a future phase can act on individual unsupported
 * claims (strip just that sentence, or flag it inline) instead of
 * discarding an otherwise-good article over one bad claim. This phase
 * still treats ANY unsupported claim as a hard block rather than
 * auto-editing the generated text — surgically removing a sentence from
 * already-built Portable Text blocks without corrupting structure or
 * leaving a dangling reference is real engineering that deserves its own
 * validation pass with a real OPENAI_API_KEY to test against, not a
 * change shipped untested against real model output.
 */
export async function checkAntiFabrication(article: GeneratedArticle, facts: ExtractedFacts, runId: string): Promise<AntiFabricationResult> {
  log("FACT CHECK", `Contrôle anti-fabrication — ${article.title}`);
  const config = loadConfig();
  const articleText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join("\n");

  const result = await structuredCompletion<{ claims: Claim[] }>({
    system: SYSTEM_PROMPT,
    user: `Faits vérifiés:\n${JSON.stringify(facts, null, 2)}\n\nArticle à vérifier:\nTitre: ${article.title}\nExcerpt: ${article.excerpt}\n${articleText}`,
    schemaName: "anti_fabrication_check",
    schema: SCHEMA,
    model: config.modelFactcheck,
    step: "quality-control",
    runId,
  });

  const unsupportedClaims = result.claims.filter((c) => !c.supported);
  const pass = unsupportedClaims.length === 0;
  log("FACT CHECK", `${pass ? "OK" : "ÉCHEC"} — ${result.claims.length} affirmation(s) analysée(s), ${unsupportedClaims.length} non supportée(s)`);
  return { pass, claims: result.claims, unsupportedClaims };
}
