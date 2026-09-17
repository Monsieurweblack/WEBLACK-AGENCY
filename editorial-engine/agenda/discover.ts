import OpenAI from "openai";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import { recordTrace } from "../logs/observability.ts";

/**
 * Découverte d'événements par recherche web.
 *
 * Ce module ne rapporte QUE des URL réellement consultées par l'outil de
 * recherche — les annotations que l'API renvoie avec sa réponse. Il ne
 * demande jamais au modèle de restituer une fiche d'événement structurée,
 * et c'est délibéré : sollicité ainsi, le modèle produit des événements
 * plausibles mais périmés, avec des URL officielles qui n'existent pas.
 * Testé, constaté. Ce qui sort d'ici n'est donc qu'une liste de pages à
 * aller lire ; tout le contenu factuel vient ensuite de la page elle-même
 * (voir verify.ts).
 */

/**
 * Les villes interrogées, dans l'ordre où la rotation les balaie.
 *
 * L'Europe et l'Afrique ouvrent la liste et y occupent le plus de place :
 * ce sont les deux scènes que le Journal suit de près, et c'est une
 * décision éditoriale assumée, pas un hasard de tirage. Le reste du monde
 * reste présent — le positionnement est international — mais y revient
 * moins souvent.
 *
 * Ce choix pèse sur ce qui est CHERCHÉ, jamais sur ce qui est retenu :
 * un événement lagosien passe exactement la même vérification qu'un
 * événement tokyoïte, et aucun quota ne garantit à une région d'être
 * publiée.
 */
const CITIES = [
  // Europe
  "Paris", "Londres", "Milan", "Berlin", "Madrid", "Bruxelles", "Amsterdam",
  "Anvers", "Copenhague", "Vienne", "Lisbonne", "Rome", "Stockholm", "Zurich",
  // Afrique
  "Lomé", "Accra", "Lagos", "Dakar", "Abidjan", "Bamako", "Cotonou", "Kinshasa",
  "Johannesburg", "Le Cap", "Nairobi", "Marrakech", "Casablanca", "Le Caire", "Tunis", "Addis-Abeba",
  // Amériques
  "New York", "Montréal", "São Paulo",
  // Moyen-Orient / Asie
  "Dubaï", "Tokyo", "Séoul",
];

/**
 * Les angles de recherche sont ancrés sur les institutions, pas sur le
 * type d'activité.
 *
 * Formulés largement — « workshops de création à Berlin » — les moteurs
 * remontent les listings municipaux de loisirs, et l'Agenda s'est rempli
 * d'ateliers de percussions pour débutants : vérifiés, datés, réels, et
 * totalement hors de la ligne du Journal. Nommer l'institution dans la
 * requête ramène ce que WEBLACK couvre effectivement.
 */
const EVENT_TYPES = [
  "expositions dans les musées, fondations et galeries",
  "biennales, triennales et grandes manifestations artistiques",
  "foires d'art contemporain et salons de design",
  "semaines de la mode, défilés et présentations de créateurs",
  "prix, distinctions et remises de récompenses en création",
  "festivals de design, d'architecture et de photographie",
  "performances, scénographies et créations dans les institutions culturelles",
];

export interface DiscoveredPage {
  url: string;
  /** Ce que la recherche cherchait — utile pour comprendre a posteriori pourquoi cette page est remontée. */
  query: string;
}

/**
 * Choisit les angles de recherche du cycle plutôt que de balayer la liste
 * entière : trente-six villes fois sept types feraient deux cent cinquante
 * appels par cycle pour un agenda qui n'a pas besoin d'être exhaustif à
 * chaque heure.
 *
 * La graine avance d'une unité par heure, soit un cycle : la rotation
 * progresse alors pas à pas dans la liste et l'a parcourue entièrement en
 * un jour et demi. Semée sur l'horodatage à la milliseconde, comme
 * auparavant, elle tirait au hasard à chaque passage — et le hasard s'est
 * arrêté six fois de suite sur Tokyo, ce qui a donné un agenda japonais.
 * Une rotation qui avance est ce qui garantit la couverture, pas un quota.
 */
export function planSearches(count: number, seed = Math.floor(Date.now() / 3_600_000)): string[] {
  const plans: string[] = [];
  for (let i = 0; i < count; i++) {
    const city = CITIES[(seed + i * 7) % CITIES.length]!;
    const type = EVENT_TYPES[(seed + i * 3) % EVENT_TYPES.length]!;
    plans.push(`${type} à ${city}`);
  }
  return plans;
}

/** Une recherche : renvoie les pages réellement consultées, jamais un contenu inventé. */
export async function discoverPages(query: string, runId: string): Promise<DiscoveredPage[]> {
  const config = loadConfig();
  if (!config.openaiApiKey) return [];
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const startedAt = Date.now();
  const horizon = new Date();
  const until = new Date(horizon.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);

  try {
    const response = await client.responses.create({
      model: config.modelAnalysis,
      tools: [{ type: "web_search" }],
      input: `Recherche des ${query} qui se tiennent actuellement ou commencent entre le ${horizon.toISOString().slice(0, 10)} et le ${until}.

Consulte les pages officielles des institutions elles-mêmes : musées, fondations, galeries, centres d'art, maisons de mode, organisateurs de foires et de biennales.

N'ouvre pas les listings municipaux de loisirs, les plateformes de billetterie généralistes, ni les pages de cours et d'ateliers pour amateurs : ce ne sont pas des rendez-vous de création.

Cite les pages que tu as consultées.`,
    });

    const urls = new Set<string>();
    for (const item of response.output ?? []) {
      const content = (item as { content?: { annotations?: { url?: string }[] }[] }).content ?? [];
      for (const part of content) {
        for (const annotation of part.annotations ?? []) {
          if (annotation.url) urls.add(annotation.url.split("?")[0]!);
        }
      }
    }

    recordTrace({
      runId,
      model: config.modelAnalysis,
      step: "analysis",
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      success: true,
      tokenUsage: {
        promptTokens: response.usage?.input_tokens,
        completionTokens: response.usage?.output_tokens,
        totalTokens: response.usage?.total_tokens,
      },
    });

    log("SOURCE FOUND", `Agenda — « ${query} » : ${urls.size} page(s) consultée(s)`);
    return [...urls].map((url) => ({ url, query }));
  } catch (error) {
    recordTrace({
      runId,
      model: config.modelAnalysis,
      step: "analysis",
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    log("SOURCE FOUND", `Agenda — recherche « ${query} » échouée : ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
