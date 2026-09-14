import type { GeneratedArticle, ExtractedFacts } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { log } from "../logs/logger.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    unsupportedClaims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          reason: { type: "string" },
        },
        required: ["claim", "reason"],
      },
    },
    pass: { type: "boolean" },
  },
  required: ["unsupportedClaims", "pass"],
};

const SYSTEM_PROMPT = `Tu es un vérificateur de faits strict. On te donne un article et la liste des faits vérifiés dont il est censé être issu.

Ta tâche : identifier toute affirmation dans l'article (nom propre, chiffre, date, événement, citation, lieu) qui n'apparaît PAS dans les faits fournis, même si elle est plausible ou correspond à une connaissance générale que tu possèdes par ailleurs. Une connaissance générale non présente dans les faits fournis compte comme une affirmation non supportée — l'article ne doit reposer QUE sur les faits donnés.

N'inclus pas comme "non supportée" une reformulation légitime d'un fait qui EST dans la liste (ex: "plus de 200" reformulé depuis "203" est acceptable). Sois strict mais pas absurde.

"pass" doit être false si au moins une affirmation non supportée est trouvée.`;

export interface AntiFabricationResult {
  pass: boolean;
  unsupportedClaims: { claim: string; reason: string }[];
}

/**
 * Phase 6 of the QA brief, explicitly flagged as top priority: an LLM-based
 * second pass comparing the generated article against the extracted facts
 * it was supposed to be built from — catches what the heuristic
 * number-grounding check in qualityCheck.ts cannot (invented names, dates,
 * subtly-added context the model "knows" but that isn't in the source).
 */
export async function checkAntiFabrication(article: GeneratedArticle, facts: ExtractedFacts): Promise<AntiFabricationResult> {
  log("FACT CHECK", `Contrôle anti-fabrication — ${article.title}`);
  const articleText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join("\n");

  const result = await structuredCompletion<AntiFabricationResult>({
    system: SYSTEM_PROMPT,
    user: `Faits vérifiés:\n${JSON.stringify(facts, null, 2)}\n\nArticle à vérifier:\nTitre: ${article.title}\nExcerpt: ${article.excerpt}\n${articleText}`,
    schemaName: "anti_fabrication_check",
    schema: SCHEMA,
  });

  log("FACT CHECK", `${result.pass ? "OK" : "ÉCHEC"} — ${result.unsupportedClaims.length} affirmation(s) non supportée(s)`);
  return result;
}
