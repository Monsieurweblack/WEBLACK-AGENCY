import type { SourceArticle } from "../sources/types.ts";
import type { EditorialAnalysis } from "../generation/types.ts";
import { JOURNAL_CATEGORIES, JOURNAL_FORMATS } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { log } from "../logs/logger.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    relevance: { type: "integer", minimum: 0, maximum: 100 },
    importance: { type: "integer", minimum: 0, maximum: 100 },
    novelty: { type: "integer", minimum: 0, maximum: 100 },
    reliability: { type: "integer", minimum: 0, maximum: 100 },
    readerInterest: { type: "integer", minimum: 0, maximum: 100 },
    seoPotential: { type: "integer", minimum: 0, maximum: 100 },
    category: { type: "string", enum: [...JOURNAL_CATEGORIES] },
    format: { type: ["string", "null"], enum: [...JOURNAL_FORMATS, null] },
    angle: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
  },
  required: ["relevance", "importance", "novelty", "reliability", "readerInterest", "seoPotential", "category", "format", "angle", "priority", "score", "reasoning"],
};

const EDITORIAL_LINE = `WEBLACK est une agence créative indépendante et internationale reliant talent, créativité et pertinence culturelle. Territoires éditoriaux pertinents : mode, luxe, création, culture, industries créatives, talents, design, beauté, business créatif, mode africaine et diasporique, influence culturelle. Ton : premium, éditorial, précis, contemporain, international. WEBLACK ne se positionne PAS comme une agence géographique ou communautaire — éviter tout sujet hors de ces territoires (politique générale, faits divers, sport hors mode/culture, etc.), même s'il est populaire.`;

export async function analyzeArticle(article: SourceArticle): Promise<EditorialAnalysis> {
  log("EDITORIAL SCORE", `Analyse — ${article.title}`);
  const sourceText = article.text ?? article.excerpt ?? "";
  const analysis = await structuredCompletion<EditorialAnalysis>({
    system: `Tu es le rédacteur en chef adjoint de WEBLACK, chargé d'évaluer si un contenu externe mérite d'être traité par la rédaction.\n\n${EDITORIAL_LINE}\n\nÉvalue objectivement chaque critère de 0 à 100. Le score global doit refléter honnêtement la pertinence réelle pour WEBLACK — ne gonfle jamais les scores pour "faire plaisir". Si le sujet est hors des territoires éditoriaux de WEBLACK, le score de pertinence et le score global doivent être bas (< 40).`,
    user: `Titre: ${article.title}\nSource: ${article.sourceName}\nExtrait/texte: ${sourceText.slice(0, 6000)}`,
    schemaName: "editorial_analysis",
    schema: SCHEMA,
  });
  return analysis;
}
