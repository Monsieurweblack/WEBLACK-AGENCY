import type { SourceArticle } from "../sources/types.ts";
import type { ExtractedFacts } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
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

const SYSTEM_PROMPT = `Tu es un assistant de fact-checking pour une rédaction éditoriale. Ta seule tâche est d'EXTRAIRE des faits déjà présents dans le texte source fourni — jamais d'en déduire, inventer ou compléter.

Règles absolues :
- N'inclus QUE ce qui est explicitement écrit dans le texte source.
- Si une catégorie (personnes, marques, dates, chiffres...) n'a aucune valeur explicite dans le texte, retourne un tableau vide pour cette catégorie — ne jamais la remplir par déduction.
- Les citations ("quotes") doivent être copiées mot pour mot depuis le texte source, jamais reformulées.
- N'ajoute aucune information de contexte général que tu connaîtrais par ailleurs (biographie, historique, chiffres de marché) si elle n'est pas dans le texte fourni.`;

export async function extractFacts(article: SourceArticle): Promise<ExtractedFacts> {
  log("FACT CHECK", `Extraction des faits — ${article.title}`);
  const sourceText = article.text ?? article.excerpt;
  if (!sourceText) {
    throw new Error(`Aucun texte exploitable pour "${article.title}" (ni contenu complet, ni extrait) — extraction impossible.`);
  }
  const facts = await structuredCompletion<ExtractedFacts>({
    system: SYSTEM_PROMPT,
    user: `Titre: ${article.title}\n\nTexte source:\n${sourceText}`,
    schemaName: "extracted_facts",
    schema: SCHEMA,
  });
  return facts;
}
