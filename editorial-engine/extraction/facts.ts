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
  },
  required: ["people", "brands", "organizations", "locations", "dates", "numbers", "events", "claims", "keyFacts", "quotes"],
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
- Les citations ("quotes") doivent être copiées mot pour mot depuis le texte source, jamais reformulées.`;

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
