import OpenAI from "openai";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import { recordTrace } from "../logs/observability.ts";
import { AFRICA_CITIES, AFRO_DIASPORA_CITIES, INTERNATIONAL_CITIES, type GeographicPriority } from "./geography.ts";

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
 * Les villes interrogées, par palier de priorité géographique — Afrique
 * d'abord, diaspora afro-descendante ensuite, reste du monde pertinent
 * enfin. WEBLACK AGENDA est un radar culturel africain et afro-diasporique
 * avant d'être un agenda culturel généraliste : cette priorité doit être
 * structurelle, pas le fruit d'un tirage qui la respecterait "en moyenne".
 *
 * Chaque liste couvre volontairement plus que les six métropoles les plus
 * documentées en ligne (Lagos, Johannesburg, Dakar, Accra, Nairobi, Le Cap) :
 * s'y limiter reproduirait, à l'échelle du continent, le même biais que la
 * rotation qui s'était arrêtée sur Tokyo six cycles de suite avant que la
 * graine n'avance déterministiquement (voir plus bas) — la diversité
 * géographique vient de la liste, jamais du hasard.
 *
 * Ce choix pèse sur ce qui est CHERCHÉ, jamais sur ce qui est retenu : un
 * événement lagosien passe exactement la même vérification qu'un événement
 * tokyoïte, et aucun quota ne garantit à une région d'être publiée.
 */
const AFRICA_CITY_LIST = Object.keys(AFRICA_CITIES);
const DIASPORA_CITY_LIST = Object.keys(AFRO_DIASPORA_CITIES);
const INTERNATIONAL_CITY_LIST = Object.keys(INTERNATIONAL_CITIES);

/**
 * Palier interrogé à chaque emplacement de recherche, répété sur toute la
 * longueur de la rotation : deux tiers Afrique, un sixième diaspora, un
 * sixième international. Fixe la priorité éditoriale de façon structurelle
 * — un cycle de trois recherches (SEARCHES_PER_CYCLE) n'échantillonne pas
 * forcément les trois paliers d'un coup, mais la couverture converge vers ce
 * ratio au fil des cycles, exactement comme la couverture des villes
 * elles-mêmes émerge sur plusieurs cycles et non sur un seul.
 */
const TIER_SEQUENCE: readonly GeographicPriority[] = ["AFRICA", "AFRICA", "AFRO_DIASPORA", "AFRICA", "AFRICA", "INTERNATIONAL"];

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

/**
 * Angles dédiés aux villes de diaspora (Paris, New York, Rio, Londres…).
 *
 * Une requête générique — « expositions dans les musées à New York » — n'y
 * ramène que de l'art contemporain sans rapport avec l'Afrique ou ses
 * diasporas : la ville seule n'oriente pas la recherche. Il faut nommer le
 * lien recherché dans la requête elle-même, à charge ensuite pour verify.ts
 * de confirmer ou d'infirmer ce lien sur la page réellement lue — jamais
 * déduit de l'apparence de qui que ce soit (voir classifyGeographicPriority).
 */
export const DIASPORA_EVENT_TYPES = [
  "expositions d'artistes africains ou afro-descendants dans les musées et galeries",
  "événements culturels de la diaspora africaine et afro-caribéenne",
  "expositions et festivals sur la culture afro-brésilienne ou afro-caribéenne",
  "défilés et présentations de créateurs de mode africains ou afro-descendants",
  "conférences, talks et rencontres sur la création africaine contemporaine à l'international",
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
    const tier = TIER_SEQUENCE[(seed + i) % TIER_SEQUENCE.length]!;
    const cities = tier === "AFRICA" ? AFRICA_CITY_LIST : tier === "AFRO_DIASPORA" ? DIASPORA_CITY_LIST : INTERNATIONAL_CITY_LIST;
    const types = tier === "AFRO_DIASPORA" ? DIASPORA_EVENT_TYPES : EVENT_TYPES;
    const city = cities[(seed + i * 7) % cities.length]!;
    const type = types[(seed + i * 3) % types.length]!;
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

Consulte les pages officielles des institutions elles-mêmes : musées, fondations, galeries, centres d'art, maisons de mode, organisateurs de foires et de biennales — y compris leurs comptes officiels Instagram, Facebook, LinkedIn, X ou YouTube lorsqu'une annonce y est publiée : ce sont des sources légitimes au même titre qu'un site web, du moment qu'elles émanent bien du compte officiel de l'institution ou de l'organisateur.

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
