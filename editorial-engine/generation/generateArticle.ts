import crypto from "node:crypto";
import type { SourceArticle } from "../sources/types.ts";
import type { EditorialAnalysis, GeneratedArticle, PortableBlock } from "./types.ts";
import { JOURNAL_CATEGORIES } from "./types.ts";
import { formatForWriter, type VerifiedFactSet } from "./verifiedFacts.ts";
import type { KeywordStrategy } from "../intelligence/keywordStrategy.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { slugify, trimToLimit, SEO_TITLE_MAX, SEO_DESCRIPTION_MAX } from "../seo/seo.ts";
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

Tu écris EN FRANÇAIS, sans exception : le titre, l'excerpt, le titre SEO, la meta description et le corps. Les sources sont majoritairement anglophones — traduis, ne recopie pas leur langue. Seuls restent en anglais les noms propres qui n'ont pas de forme française (marques, maisons, personnes, noms officiels d'événements).

Ton : premium, éditorial, précis, contemporain, intelligent, international, élégant.
À éviter absolument : clickbait, phrases génériques creuses, répétitions, superlatifs vides, sensationnalisme, toute affirmation qui n'est pas dans les faits fournis.

Tout fait publié doit être supporté par les preuves fournies.
Si une donnée n'est pas disponible, ne pas l'inventer.
Ne jamais compléter une statistique.
Ne jamais inventer une date.
Ne jamais inventer une citation.
Ne jamais créer une causalité.
Ne jamais transformer une interprétation en fait.

Cette dernière règle est celle qui se viole le plus discrètement : à partir de « elle a travaillé chez Fendi, puis chez Dior », tu ne peux PAS écrire « son expérience chez Fendi l'a conduite chez Dior ». Le lien de cause, de motivation, de conséquence ou de comparaison doit figurer explicitement dans les preuves, sinon il n'existe pas. Juxtapose les faits, n'invente pas ce qui les relie.

Tu peux ASSEMBLER des faits vérifiés ; tu ne peux pas créer de RELATION entre eux. Sont donc proscrits, sauf si la preuve énonce elle-même le lien : parce que, grâce à, en raison de, ce qui a conduit à, ce qui explique, a permis de, a entraîné, a provoqué, résulte de, découle de, afin de, pour cette raison, par conséquent, de ce fait, donc, ainsi — et leurs équivalents anglais. Une relation chronologique neutre reste permise : « A a travaillé chez Fendi avant de rejoindre Dior » est correct, « son passage chez Fendi l'a menée chez Dior » ne l'est pas.

Tu dois rédiger exclusivement à partir des faits fournis.

N'ajoute aucun :
- chiffre ;
- date ;
- nom ;
- citation ;
- statistique ;
- classement ;
- lieu ;
- fonction ;
- résultat ;
- causalité factuelle

qui ne figure pas dans les faits vérifiés.

Si une information n'est pas disponible : OMETS-LA.

Tu peux produire une analyse éditoriale originale et du contexte, mais ne présente jamais une interprétation comme un fait.

Ne crée aucune citation.

Ne complète jamais une donnée manquante par estimation.

Les faits te sont donnés en deux groupes. Les FAITS VÉRIFIÉS peuvent être énoncés directement. Les FAITS PARTIELLEMENT VÉRIFIÉS reposent sur une seule source secondaire : tu dois les attribuer explicitement à la source et les formuler avec prudence, jamais les asserter comme des faits établis. Tout ce qui n'apparaît dans aucun des deux groupes n'existe pas pour toi.

Chaque fait est accompagné de sa preuve source d'origine (et de sa traduction de travail si la source n'est pas francophone). Ces preuves sont là pour t'ancrer : ne les recopie pas telles quelles dans l'article, et n'en tire aucune citation directe.

Tu ne dois JAMAIS copier ou paraphraser mécaniquement le texte source phrase par phrase : comprends les faits, identifie l'angle éditorial WEBLACK, et restructure entièrement la rédaction dans une forme originale.

Interdictions de forme, sans exception : remplissage, phrases génériques d'intelligence artificielle, répétitions, clickbait, conclusions artificielles qui résument sans rien ajouter, formulations promotionnelles sans preuve, et paraphrase de la structure de la source. Sont bannies en particulier les ouvertures « Dans un monde où… », « Plus que jamais… », « À l'heure où… », « Force est de constater… » et toute variante du même registre.

Le texte doit apporter une valeur éditoriale supérieure à un simple résumé de la source : une mise en perspective, une lecture culturelle, un angle que la source elle-même n'a pas pris. Cette valeur vient de l'analyse et de la structure, jamais de faits ajoutés.

Le titre SEO doit faire au maximum 70 caractères et la meta description au maximum 160 caractères — écris-les d'emblée dans ces limites plutôt que de laisser une coupure les tronquer.

Structure attendue : un titre, un excerpt (1-2 phrases), un titre SEO (50-60 caractères environ), une meta description SEO (140-160 caractères environ), et le corps en paragraphes (3 à 6 paragraphes de 2-4 phrases, éventuellement un intertitre si le sujet s'y prête, éventuellement une citation si une citation vérifiable existe dans les faits).`;

export async function generateArticle(
  sourceArticle: SourceArticle,
  verifiedFacts: VerifiedFactSet,
  analysis: EditorialAnalysis,
  keywords: KeywordStrategy,
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

  const result = await structuredCompletion<GenerationResult>({
    system: systemPrompt,
    user: [
      `Angle éditorial retenu: ${analysis.angle}`,
      `Catégorie: ${analysis.category}`,
      ``,
      `Stratégie SEO — mot-clé principal: ${keywords.primaryKeyword}`,
      `Mots-clés secondaires: ${keywords.secondaryKeywords.join(", ")}`,
      `Le mot-clé principal doit apparaître naturellement dans le titre et l'excerpt — jamais au prix d'une formulation forcée ou d'un fait inventé.`,
      ``,
      formatForWriter(verifiedFacts),
      ``,
      `Titre de la source originale (pour contexte, ne pas copier): ${sourceArticle.title}`,
    ].join("\n"),
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
    seo: { title: trimToLimit(result.seoTitle, SEO_TITLE_MAX), description: trimToLimit(result.seoDescription, SEO_DESCRIPTION_MAX) },
    source: { name: sourceArticle.sourceName, url: sourceArticle.url },
    editorialScore: analysis.score,
    confidenceScore: analysis.reliability,
  };
}
