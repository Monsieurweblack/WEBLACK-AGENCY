import type { SourceArticle } from "../sources/types.ts";
import type { EditorialAnalysis } from "../generation/types.ts";
import { JOURNAL_CATEGORIES, JOURNAL_FORMATS, WEBLACK_TERRITORIES } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    territory: { type: "string", enum: [...WEBLACK_TERRITORIES] },
    editorialValue: { type: "string" },
    relevance: { type: "integer", minimum: 0, maximum: 100 },
    importance: { type: "integer", minimum: 0, maximum: 100 },
    novelty: { type: "integer", minimum: 0, maximum: 100 },
    reliability: { type: "integer", minimum: 0, maximum: 100 },
    readerInterest: { type: "integer", minimum: 0, maximum: 100 },
    creativeInterest: { type: "integer", minimum: 0, maximum: 100 },
    analyticalPotential: { type: "integer", minimum: 0, maximum: 100 },
    originality: { type: "integer", minimum: 0, maximum: 100 },
    seoPotential: { type: "integer", minimum: 0, maximum: 100 },
    category: { type: "string", enum: [...JOURNAL_CATEGORIES] },
    format: { type: ["string", "null"], enum: [...JOURNAL_FORMATS, null] },
    angle: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
  },
  required: [
    "territory",
    "editorialValue",
    "relevance",
    "importance",
    "novelty",
    "reliability",
    "readerInterest",
    "creativeInterest",
    "analyticalPotential",
    "originality",
    "seoPotential",
    "category",
    "format",
    "angle",
    "priority",
    "score",
    "reasoning",
  ],
};

const EDITORIAL_LINE = `Le Journal WEBLACK est un média contemporain international à la croisée de la mode, du luxe, de l'art, de la culture, du design et des industries créatives. Ce n'est PAS un média d'actualité générale.

LES HUIT TERRITOIRES — un sujet qui n'entre réellement dans aucun d'eux est OUT_OF_TERRITORY :

01 FASHION_LUXURY — mode, haute couture, créateurs, maisons, fashion weeks, textile, beauté, joaillerie, accessoires, retail et luxe.
02 ART_CULTURE — art contemporain, photographie, cinéma, littérature, musique, patrimoine, institutions, musées, galeries, scènes culturelles.
03 DESIGN_ARCHITECTURE — design produit, mobilier, architecture, espaces, scénographie, direction artistique.
04 CREATIVE_INDUSTRIES — économie créative, innovation et technologies au service de la création, médias, communication, branding, production, nouveaux modèles.
05 TALENTS — créateurs, artistes, designers, photographes, stylistes, directeurs artistiques, entrepreneurs créatifs, personnalités émergentes.
06 CULTURAL_CREATIVE_BUSINESS — stratégies de marques créatives, investissements, acquisitions, collaborations, développement international, modèles économiques de la création.
07 CULTURAL_SCENES_EVENTS — expositions, festivals, biennales, fashion weeks, foires, performances, grands rendez-vous créatifs.
08 CULTURAL_AGENDA — événement à venir ou en cours, accessible au public, avec des informations pratiques vérifiables.

LA PERTINENCE NE SE JUGE PAS AUX MOTS-CLÉS mais à ce que le sujet fait réellement :
- « Une entreprise augmente ses bénéfices. » → OUT_OF_TERRITORY. Un résultat financier n'est pas un sujet de création.
- « Une maison de luxe augmente ses investissements dans la création. » → CULTURAL_CREATIVE_BUSINESS, recevable : l'argent y sert la création.
- « Un musée ouvre une exposition d'art contemporain. » → ART_CULTURE, recevable.
- « Une personnalité politique prononce un discours. » → OUT_OF_TERRITORY, sauf lien culturel ou créatif substantiel et démontré.
- « Une technologie transforme les processus de création dans la mode. » → CREATIVE_INDUSTRIES, recevable : elle change la façon de créer.

LA VALEUR ÉDITORIALE WEBLACK — le sujet doit répondre franchement à AU MOINS UNE de ces questions, et tu dois écrire laquelle dans "editorialValue" :
- Est-ce une évolution importante dans la création ?
- Est-ce un événement culturel significatif ?
- Est-ce un talent à découvrir ?
- Est-ce la transformation d'une industrie créative ?
- Est-ce une tendance suffisamment documentée ?
- Est-ce une information utile aux professionnels de la création ?
- Est-ce un événement que notre audience voudrait réellement découvrir ?
Si aucune ne tient, laisse "editorialValue" vide et donne des scores bas : le sujet doit être rejeté.

GÉOGRAPHIE — la couverture est internationale : Europe (Paris, Londres, Milan, Berlin…), Amériques (New York, Los Angeles, Mexico…), Afrique (Lomé, Accra, Lagos, Dakar, Abidjan, Bamako, Cotonou, Kinshasa, Johannesburg, Nairobi, Marrakech, Le Caire…), Moyen-Orient et Asie (Dubaï, Doha, Tokyo, Séoul, Shanghai…). Deux biais à éviter symétriquement : ne jamais retenir un sujet africain pour la seule raison qu'il est africain, et ne jamais surévaluer un sujet occidental pour la seule raison qu'il est mieux relayé. Seule la valeur éditoriale compte.

PUBLIER MOINS, MAIS MIEUX. Un jour sans publication vaut mieux qu'un article médiocre. Un sujet correct mais banal doit recevoir des scores moyens, pas des scores complaisants.`;

export async function analyzeArticle(article: SourceArticle, runId: string): Promise<EditorialAnalysis> {
  log("EDITORIAL SCORE", `Analyse — ${article.title}`);
  const config = loadConfig();
  const sourceText = article.text ?? article.excerpt ?? "";
  const analysis = await structuredCompletion<EditorialAnalysis>({
    system: `Tu es le rédacteur en chef adjoint de WEBLACK, chargé d'évaluer si un contenu externe mérite d'être traité par la rédaction.\n\n${EDITORIAL_LINE}\n\nCe que tu mesures, de 0 à 100 :\n- relevance : pertinence pour le territoire WEBLACK.\n- importance : importance CULTURELLE, pas économique ni médiatique.\n- creativeInterest : ce que le sujet apporte à la création elle-même.\n- novelty : nouveauté réelle de l'information.\n- analyticalPotential : y a-t-il de quoi écrire autre chose qu'une reprise de communiqué ?\n- readerInterest : valeur pour une audience de professionnels et d'amateurs de création.\n- originality : sujet déjà traité partout, ou angle neuf ?\n- reliability : qualité et proximité des sources (une source primaire ou officielle vaut mieux qu'une reprise).\n- seoPotential : mesuré, mais il ne justifie JAMAIS à lui seul de retenir un sujet.\n\nÉvalue honnêtement — ne gonfle jamais un score pour "faire plaisir". Si "territory" vaut OUT_OF_TERRITORY, ou si aucune question de valeur éditoriale ne trouve de réponse, alors relevance et score global doivent être bas (< 40).`,
    user: `Titre: ${article.title}\nSource: ${article.sourceName}\nExtrait/texte: ${sourceText.slice(0, 6000)}`,
    schemaName: "editorial_analysis",
    schema: SCHEMA,
    model: config.modelAnalysis,
    step: "analysis",
    runId,
    sourceUrl: article.url,
  });
  return analysis;
}
