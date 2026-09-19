import type { VerifiedFactSet } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";
import { formatForWriter, isEmpty } from "../generation/verifiedFacts.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

/**
 * §6 — un fait, un contexte minimal, une source : jamais un texte
 * artificiellement riche. Une phrase, pas un article. Reprend telle quelle
 * la garde anti-fabrication du reste du moteur — l'Evidence Pack
 * (generation/verifiedFacts.ts) construit à partir des mêmes faits extraits
 * et programmatiquement vérifiés que le Journal utilise, jamais un second
 * mécanisme de vérification pour NOW.
 *
 * FR et EN sont deux rédactions indépendantes à partir du MÊME pack, jamais
 * une traduction mécanique de l'une vers l'autre (§16) — le modèle reçoit
 * l'instruction explicite de ne traduire aucun nom propre.
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    titleFr: { type: "string" },
    titleEn: { type: "string" },
    summaryFr: { type: "string" },
    summaryEn: { type: "string" },
    dateIfStated: { type: "string" },
  },
  required: ["titleFr", "titleEn", "summaryFr", "summaryEn", "dateIfStated"],
};

const SYSTEM_PROMPT = `Tu rédiges un signal pour WEBLACK NOW — un radar culturel, pas un article. Une phrase factuelle par langue, jamais un paragraphe.

Tu ne disposes QUE des faits vérifiés ci-dessous. Aucune déduction, aucune cause, aucun jugement de valeur, aucun superlatif que la source n'emploie pas elle-même.

- "titleFr"/"titleEn" : un intitulé court (moins de 12 mots), factuel — jamais accrocheur ni ambigu.
- "summaryFr"/"summaryEn" : UNE phrase, fait + contexte minimal, rien d'autre. Rédige les deux indépendamment l'une de l'autre à partir des mêmes faits — n'écris jamais l'anglais en traduisant d'abord le français, ni l'inverse.
- Les noms propres (personnes, marques, institutions, titres d'œuvres ou d'événements) restent dans leur forme officielle, à l'identique en français et en anglais — ne les traduis JAMAIS.
- "dateIfStated" : la date du fait rapporté (ouverture, annonce...) au format AAAA-MM-JJ si et seulement si les faits vérifiés la donnent explicitement. Chaîne vide sinon — ne déduis jamais une date.

Si les faits vérifiés ne permettent pas une phrase honnête et autonome, rédige la phrase la plus courte et la plus prudente que les faits permettent réellement plutôt que d'en ajouter.`;

export interface GeneratedSignalText {
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  dateIfStated: string;
}

export async function generateSignalText(article: SourceArticle, pack: VerifiedFactSet, runId: string): Promise<GeneratedSignalText | undefined> {
  if (isEmpty(pack)) {
    log("GENERATION", `NOW — aucun fait vérifié pour "${article.title}", pas de signal généré.`);
    return undefined;
  }
  const config = loadConfig();
  const result = await structuredCompletion<GeneratedSignalText>({
    system: SYSTEM_PROMPT,
    user: `Source : ${article.sourceName} — ${article.url}\nTitre original : ${article.title}\n\n${formatForWriter(pack)}`,
    schemaName: "now_signal_text",
    schema: SCHEMA,
    model: config.modelWriting,
    step: "generation",
    runId,
    sourceUrl: article.url,
  });
  return result;
}
