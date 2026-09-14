import crypto from "node:crypto";
import type { SourceArticle } from "../sources/types.ts";
import type { EditorialAnalysis, ExtractedFacts, GeneratedArticle, PortableBlock } from "./types.ts";
import { JOURNAL_CATEGORIES } from "./types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { slugify } from "../seo/seo.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import { loadEditorialBible, bibleToPromptRules } from "../config/editorialBible.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    excerpt: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["heading", "paragraph", "quote"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
      },
    },
  },
  required: ["title", "excerpt", "seoTitle", "seoDescription", "paragraphs"],
};

interface GenerationResult {
  title: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  paragraphs: { kind: "heading" | "paragraph" | "quote"; text: string }[];
}

const WRITING_RULES = `Tu es rédacteur pour le Journal de WEBLACK, agence créative indépendante et internationale (talent, créativité, culture — jamais un registre géographique/communautaire).

Ton : premium, éditorial, précis, contemporain, intelligent, international, élégant.
À éviter absolument : clickbait, phrases génériques creuses, répétitions, superlatifs vides, sensationnalisme, toute affirmation qui n'est pas dans les faits fournis.

Règle absolue anti-fabrication : tu ne dois utiliser QUE les faits fournis ci-dessous (déjà extraits et vérifiés depuis la source). N'invente aucun nom, chiffre, date, citation ou événement qui n'y figure pas. Si une information utile manque, formule la phrase sans elle plutôt que de la deviner.

Tu ne dois JAMAIS copier ou paraphraser mécaniquement le texte source phrase par phrase : comprends les faits, identifie l'angle éditorial WEBLACK, et restructure entièrement la rédaction dans une forme originale.

Structure attendue : un titre, un excerpt (1-2 phrases), un titre SEO (50-60 caractères environ), une meta description SEO (140-160 caractères environ), et le corps en paragraphes (3 à 6 paragraphes de 2-4 phrases, éventuellement un intertitre si le sujet s'y prête, éventuellement une citation si une citation vérifiable existe dans les faits).`;

export async function generateArticle(
  sourceArticle: SourceArticle,
  facts: ExtractedFacts,
  analysis: EditorialAnalysis,
  runId: string,
): Promise<GeneratedArticle> {
  log("GENERATION", `Rédaction — ${sourceArticle.title}`);
  const config = loadConfig();
  if (!config.defaultAuthor) {
    throw new Error(
      "EDITORIAL_DEFAULT_AUTHOR absent de .env — un article généré doit porter une signature explicite, jamais inventée. Voir editorial-engine/.env.example.",
    );
  }

  const bible = loadEditorialBible();
  const systemPrompt = bible ? `${WRITING_RULES}\n\n${bibleToPromptRules(bible)}` : WRITING_RULES;

  const factsBlock = JSON.stringify(facts, null, 2);
  const result = await structuredCompletion<GenerationResult>({
    system: systemPrompt,
    user: `Angle éditorial retenu: ${analysis.angle}\nCatégorie: ${analysis.category}\n\nFaits vérifiés à utiliser (et uniquement ceux-ci):\n${factsBlock}\n\nTitre de la source originale (pour contexte, ne pas copier): ${sourceArticle.title}`,
    schemaName: "generated_article",
    schema: SCHEMA,
    model: config.modelWriting,
    step: "generation",
    runId,
    sourceUrl: sourceArticle.url,
  });

  const body: PortableBlock[] = result.paragraphs.map((p) => ({
    _type: "block" as const,
    _key: crypto.randomUUID(),
    style: p.kind === "heading" ? "h3" : p.kind === "quote" ? "blockquote" : "normal",
    children: [{ _type: "span" as const, _key: crypto.randomUUID(), text: p.text, marks: [] }],
    markDefs: [] as [],
  }));

  const category = JOURNAL_CATEGORIES.includes(analysis.category) ? analysis.category : "news";

  return {
    lang: "fr",
    title: result.title,
    slug: slugify(result.title),
    excerpt: result.excerpt,
    category,
    format: analysis.format,
    publishDate: new Date().toISOString().slice(0, 10),
    author: config.defaultAuthor,
    // Deliberately no coverImage: reusing the source's image without a
    // verified, reusable license would be exactly the kind of unauthorized
    // copy Phase 11 forbids. An editor adds a licensed image by hand in
    // Studio before publishing.
    body,
    seo: { title: result.seoTitle, description: result.seoDescription },
    source: { name: sourceArticle.sourceName, url: sourceArticle.url },
    editorialScore: analysis.score,
    confidenceScore: analysis.reliability,
  };
}
