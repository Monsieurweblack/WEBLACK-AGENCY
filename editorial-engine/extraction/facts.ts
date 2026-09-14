import type { SourceArticle } from "../sources/types.ts";
import type { ExtractedFacts } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    people: { type: "array", items: { type: "string" } },
    brands: { type: "array", items: { type: "string" } },
    organizations: { type: "array", items: { type: "string" } },
    locations: { type: "array", items: { type: "string" } },
    dates: { type: "array", items: { type: "string" } },
    numbers: { type: "array", items: { type: "string" } },
    events: { type: "array", items: { type: "string" } },
    claims: { type: "array", items: { type: "string" } },
    keyFacts: { type: "array", items: { type: "string" } },
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" }, attributedTo: { type: "string" } },
        required: ["text", "attributedTo"],
      },
    },
    sourceLanguage: { type: "string" },
    // Folded into this existing call on purpose: the model is already
    // reading the source text here, so attaching each fact's verbatim
    // excerpt costs no additional request — and it is what makes the
    // pre-writing verification possible without any new model call.
    factEvidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fact: { type: "string" },
          category: { type: "string", enum: ["person", "brand", "organization", "location", "date", "number", "event", "quote", "general"] },
          importance: { type: "string", enum: ["critical", "significant", "minor"] },
          evidenceQuote: { type: "string" },
          evidenceTranslation: { type: "string" },
        },
        required: ["fact", "category", "importance", "evidenceQuote", "evidenceTranslation"],
      },
    },
  },
  required: ["people", "brands", "organizations", "locations", "dates", "numbers", "events", "claims", "keyFacts", "quotes", "sourceLanguage", "factEvidence"],
};

/**
 * §3 hardening: an explicit forbidden-list, not just a general "don't
 * invent" instruction — spelled out because a general instruction is
 * exactly what a model drifts away from under a long context. Preferring
 * omission over a plausible-sounding completion is stated as the default,
 * not an edge case.
 */
const SYSTEM_PROMPT = `Tu es un assistant de fact-checking pour une rédaction éditoriale. Ta seule tâche est d'EXTRAIRE des faits déjà présents dans le texte source fourni — jamais d'en déduire, inventer ou compléter.

Interdictions absolues, sans exception :
- Aucun fait qui n'est pas explicitement dans le texte source, même s'il te semble évident ou probable.
- Aucun chiffre inventé ou arrondi/estimé si le texte ne le donne pas explicitement.
- Aucune date inventée ou déduite (ex: ne pas déduire une année à partir du contexte si elle n'est pas écrite).
- Aucune citation inventée ou reformulée — une citation absente du texte source est absente, point.
- Aucune biographie ou contexte historique non nécessaire ajouté depuis tes connaissances générales.
- Aucune information "supposée" parce qu'elle est cohérente avec le reste.

Règle de préférence : si une information est incertaine ou absente, ton comportement par défaut est l'OMISSION — ne remplis jamais un champ par une complétion imaginative simplement parce qu'il semble incomplet vide. Un tableau vide est un résultat parfaitement normal et attendu pour une catégorie absente du texte.

- Si une catégorie (personnes, marques, dates, chiffres...) n'a aucune valeur explicite dans le texte, retourne un tableau vide pour cette catégorie.
- Les citations ("quotes") doivent être copiées mot pour mot depuis le texte source, jamais reformulées.

"sourceLanguage" : la langue réelle du texte source ("en", "fr", ...).

"factEvidence" : c'est le champ le plus important. Pour CHAQUE fait atomique réellement exploitable (un chiffre, une date, un nom, une fonction, un lieu, un événement, une citation, une relation de cause à effet), produis une entrée :
- "fact" : le fait, énoncé DANS LA LANGUE DU TEXTE SOURCE (ne traduis pas ici — la traduction viendra plus tard).
- "category" : person, brand, organization, location, date, number, event, quote, ou general.
- "importance" : "critical" si une erreur sur ce fait tromperait le lecteur (chiffres, dates, citations, fonctions, causalité) ; "significant" pour les autres faits vérifiables ; "minor" pour les détails d'ambiance.
- "evidenceQuote" : l'extrait EXACT, mot pour mot, copié du texte source, qui prouve ce fait. Copie-colle, ne reformule pas, ne corrige pas la ponctuation.
- "evidenceTranslation" : une traduction française fidèle de cet extrait si la source n'est pas en français ; chaîne vide si la source est déjà en français.

Règle décisive : si tu ne peux pas copier un extrait exact du texte source pour prouver un fait, alors N'INCLUS PAS ce fait dans "factEvidence". Un fait sans extrait vérifiable sera écarté automatiquement et n'atteindra jamais la rédaction — mieux vaut une liste courte et solide qu'une liste longue et invérifiable.`;

export async function extractFacts(article: SourceArticle, runId: string): Promise<ExtractedFacts> {
  log("FACT CHECK", `Extraction des faits — ${article.title}`);
  const config = loadConfig();
  const sourceText = article.text ?? article.excerpt;
  if (!sourceText) {
    throw new Error(`Aucun texte exploitable pour "${article.title}" (ni contenu complet, ni extrait) — extraction impossible.`);
  }
  const facts = await structuredCompletion<ExtractedFacts>({
    system: SYSTEM_PROMPT,
    user: `Titre: ${article.title}\n\nTexte source:\n${sourceText.slice(0, 12_000)}`,
    schemaName: "extracted_facts",
    schema: SCHEMA,
    model: config.modelFactcheck,
    step: "fact-extraction",
    runId,
    sourceUrl: article.url,
  });
  return facts;
}
