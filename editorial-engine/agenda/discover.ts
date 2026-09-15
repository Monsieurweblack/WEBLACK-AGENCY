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

const CITIES = [
  // Afrique
  "Lomé", "Accra", "Lagos", "Dakar", "Abidjan", "Bamako", "Cotonou", "Kinshasa", "Johannesburg", "Nairobi", "Marrakech", "Le Caire",
  // Europe
  "Paris", "Londres", "Milan", "Berlin", "Madrid", "Bruxelles", "Amsterdam",
  // Amériques
  "New York", "Los Angeles", "Montréal", "Mexico", "São Paulo",
  // Moyen-Orient / Asie
  "Dubaï", "Doha", "Riyad", "Tokyo", "Séoul", "Shanghai",
];

const EVENT_TYPES = [
  "expositions et vernissages",
  "festivals et biennales",
  "foires d'art et salons",
  "fashion weeks et défilés",
  "conférences, masterclasses et workshops de création",
  "performances et événements design",
  "architecture, photographie et patrimoine",
];

export interface DiscoveredPage {
  url: string;
  /** Ce que la recherche cherchait — utile pour comprendre a posteriori pourquoi cette page est remontée. */
  query: string;
}

/**
 * Tire au sort les angles de recherche du cycle plutôt que de balayer la
 * liste entière : trente villes fois sept types feraient deux cents appels
 * par cycle pour un agenda qui n'a pas besoin d'être exhaustif à chaque
 * heure. La rotation couvre l'ensemble au fil des cycles, sans imposer de
 * quota géographique — la pertinence prime, pas la répartition.
 */
export function planSearches(count: number, seed = Date.now()): string[] {
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
      input: `Recherche des ${query} qui se tiennent actuellement ou commencent entre le ${horizon.toISOString().slice(0, 10)} et le ${until}. Consulte en priorité les pages officielles des institutions, musées, galeries, fondations et organisateurs. Cite les pages que tu as consultées.`,
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
