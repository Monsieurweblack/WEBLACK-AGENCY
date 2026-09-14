import type { SourceArticle } from "../sources/types.ts";
import type { ExtractedFacts, EditorialAnalysis } from "../generation/types.ts";
import type { SearchIntent } from "../seo/opportunityEngine.ts";
import { structuredCompletion } from "./openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

export interface KeywordStrategy {
  primaryKeyword: string;
  secondaryKeywords: string[];
  entities: { type: "Person" | "Brand" | "Organization" | "Event" | "Location"; name: string }[];
  searchIntent: SearchIntent;
  contentAngle: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    primaryKeyword: { type: "string" },
    secondaryKeywords: { type: "array", items: { type: "string" } },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["Person", "Brand", "Organization", "Event", "Location"] },
          name: { type: "string" },
        },
        required: ["type", "name"],
      },
    },
    searchIntent: { type: "string", enum: ["informational", "navigational", "commercial", "news", "mixed"] },
    contentAngle: { type: "string" },
  },
  required: ["primaryKeyword", "secondaryKeywords", "entities", "searchIntent", "contentAngle"],
};

const SYSTEM_PROMPT = `Tu es stratège SEO pour le Journal WEBLACK. À partir des faits déjà vérifiés (extraits de la source, jamais inventés), détermine :
- primaryKeyword : l'expression de recherche la plus probable qu'un lecteur intéressé par ce sujet taperait — dérivée du sujet réel, jamais un mot-clé générique plaqué artificiellement.
- secondaryKeywords : 3 à 6 variantes/expressions connexes, réellement pertinentes au contenu.
- entities : UNIQUEMENT les personnes/marques/organisations/événements/lieux qui apparaissent explicitement dans les faits fournis — n'en invente aucune, n'en ajoute aucune par déduction.
- searchIntent : l'intention de recherche dominante pour ce sujet.
- contentAngle : une phrase décrivant l'angle éditorial qui sert à la fois le lecteur et le référencement (jamais du bourrage de mots-clés — un article reste un article, pas une liste de mots-clés).

Règle absolue : ne jamais halluciner un mot-clé ou une entité qui ne correspond à rien dans les faits fournis.`;

/** §3/§5/§6 — Call 5 in the pipeline (after fact-extraction, before/alongside writing), gated behind OpenAI like every other judgment call in this engine. */
export async function buildKeywordStrategy(
  source: SourceArticle,
  facts: ExtractedFacts,
  analysis: EditorialAnalysis,
  runId: string,
): Promise<KeywordStrategy> {
  log("SEO", `Stratégie de mots-clés — ${source.title}`);
  const config = loadConfig();
  const strategy = await structuredCompletion<KeywordStrategy>({
    system: SYSTEM_PROMPT,
    user: `Titre source: ${source.title}\nAngle éditorial retenu: ${analysis.angle}\nCatégorie: ${analysis.category}\n\nFaits vérifiés:\n${JSON.stringify(facts, null, 2)}`,
    schemaName: "keyword_strategy",
    schema: SCHEMA,
    model: config.modelAnalysis,
    step: "seo-strategy",
    runId,
    sourceUrl: source.url,
  });
  return strategy;
}
