import { stems } from "../validation/equivalences.ts";
import { log } from "../logs/logger.ts";
import { verifyEventPage } from "./verify.ts";
import { ESSENTIAL_FIELDS, type AgendaEvent } from "./types.ts";

/**
 * Complète un événement dont il manque une donnée essentielle, en allant
 * lire d'autres pages du MÊME domaine officiel.
 *
 * Une page d'exposition renvoie presque toujours ses horaires, ses dates ou
 * son lieu vers une page voisine — « infos pratiques », « billetterie »,
 * « visiter », le calendrier de l'institution. Rejeter l'événement parce
 * que sa page principale ne répète pas tout reviendrait à jeter des
 * événements réels et correctement documentés.
 *
 * Ce que ce module ne fait jamais : déduire. Une donnée complétée provient
 * toujours du texte d'une page réellement téléchargée, et l'URL de cette
 * page est enregistrée avec elle. Un extrait de résultat de recherche ne
 * vaut jamais preuve — seule une page que l'on a pu lire compte.
 */

/** Combien de pages voisines on accepte d'ouvrir pour un événement. Au-delà, le coût dépasse le bénéfice. */
const MAX_COMPLEMENTARY_PAGES = 4;

/** Chemins et libellés qui, sur un site d'institution, portent les informations pratiques. */
const INFO_HINTS = [
  "infos-pratiques", "informations-pratiques", "infos", "pratique", "horaires", "visiter", "visite", "visit",
  "billetterie", "billets", "tickets", "reservation", "book",
  "agenda", "calendrier", "calendar", "programme", "program", "expositions", "exhibitions", "events", "evenements",
  "presse", "press", "communique",
];

export interface ResolutionOutcome {
  event: AgendaEvent;
  /** Les pages voisines réellement ouvertes, qu'elles aient servi ou non. */
  pagesTried: string[];
  resolvedFields: string[];
  /** Renseigné si deux pages faisant autorité se contredisent. */
  contradiction?: string;
}

/**
 * Récupère les liens du même hôte susceptibles de porter l'information
 * manquante. Le HTML est lu directement : l'extracteur d'articles ne rend
 * que du texte, et ce sont les liens qui nous intéressent ici.
 */
export async function sameDomainCandidates(pageUrl: string): Promise<string[]> {
  let origin: URL;
  try {
    origin = new URL(pageUrl);
  } catch {
    return [];
  }

  let html: string;
  try {
    const response = await fetch(pageUrl, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!response.ok) return [];
    html = await response.text();
  } catch {
    return [];
  }

  const found = new Map<string, number>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const [, href, label] = match;
    let resolved: URL;
    try {
      resolved = new URL(href!, pageUrl);
    } catch {
      continue;
    }
    // Strictement le même domaine officiel : une billetterie tierce n'est
    // pas une source officielle au sens de la règle.
    if (resolved.hostname !== origin.hostname) continue;
    resolved.hash = "";
    const candidate = resolved.toString();
    if (candidate === pageUrl) continue;

    // Les indices sont cherchés comme des mots, pas comme des fragments :
    // sans cela « press » se déclenche sur « impressum » et l'on ouvre les
    // mentions légales du site à chaque événement.
    const words = new Set(
      `${resolved.pathname} ${label ?? ""}`
        .toLowerCase()
        .split(/[^a-zà-ÿ]+/)
        .filter(Boolean),
    );
    const segments = new Set(resolved.pathname.toLowerCase().split("/").filter(Boolean));
    const score = INFO_HINTS.reduce((n, hint) => (words.has(hint) || segments.has(hint) ? n + 1 : n), 0);
    if (score > 0) found.set(candidate, Math.max(found.get(candidate) ?? 0, score));
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COMPLEMENTARY_PAGES)
    .map(([url]) => url);
}

/**
 * Deux pages parlent-elles du même événement ?
 *
 * Le nom seul ne suffit pas — « Exposition » ou « Agenda » se ressemblent
 * partout. On exige donc que le nom concorde ET qu'au moins un autre
 * identifiant concorde aussi : l'artiste, l'institution, le lieu ou une
 * date déjà connue.
 */
export function refersToSameEvent(known: AgendaEvent, candidate: AgendaEvent): boolean {
  const nameStems = new Set(stems(known.eventName));
  const candidateStems = stems(candidate.eventName);
  const sharedName = candidateStems.filter((s) => nameStems.has(s)).length;
  if (sharedName < 2) return false;

  const agrees = (a: string, b: string) => {
    if (!a.trim() || !b.trim()) return false;
    const setA = new Set(stems(a));
    return stems(b).some((s) => setA.has(s));
  };

  return (
    agrees(known.artistOrCreator, candidate.artistOrCreator) ||
    agrees(known.institution, candidate.institution) ||
    agrees(known.venue, candidate.venue) ||
    (known.startDate !== "" && known.startDate === candidate.startDate)
  );
}

/**
 * Tente de combler les champs essentiels manquants depuis les pages
 * voisines du domaine officiel. Renvoie l'événement complété, la liste des
 * champs résolus et, le cas échéant, la contradiction rencontrée.
 */
export async function resolveMissingFields(event: AgendaEvent, runId: string): Promise<ResolutionOutcome> {
  if (event.missingFields.length === 0) return { event, pagesTried: [], resolvedFields: [] };

  const candidates = await sameDomainCandidates(event.officialUrl);
  if (candidates.length === 0) return { event, pagesTried: [], resolvedFields: [] };

  const pagesTried: string[] = [];
  const resolvedFields: string[] = [];
  let working = { ...event, fieldSources: { ...event.fieldSources } };
  let contradiction: string | undefined;

  for (const url of candidates) {
    if (working.missingFields.length === 0) break;
    pagesTried.push(url);

    const neighbour = await verifyEventPage(url, runId);
    if (!neighbour) continue;
    if (!refersToSameEvent(working, neighbour)) continue;

    for (const field of ESSENTIAL_FIELDS) {
      const incoming = field === "startDate" ? neighbour.startDate : neighbour[field];
      if (!incoming.trim()) continue;
      // Seule une valeur que la page voisine confirme elle-même compte.
      if (!neighbour.verifiedFields.includes(field)) continue;

      const existing = field === "startDate" ? working.startDate : working[field];

      if (existing.trim() && existing.trim() !== incoming.trim()) {
        // Deux pages officielles qui ne disent pas la même chose : personne ne tranche.
        contradiction = `Contradiction sur « ${field} » entre ${working.fieldSources[field] ?? working.officialUrl} (${existing}) et ${url} (${incoming}).`;
        continue;
      }
      if (existing.trim()) continue;

      working = { ...working, [field]: incoming.trim() };
      working.fieldSources[field] = url;
      working.verifiedFields = [...new Set([...working.verifiedFields, field])];
      working.missingFields = working.missingFields.filter((f) => f !== field);
      resolvedFields.push(field);
    }

    working.sourceUrls = [...new Set([...working.sourceUrls, url])];
  }

  if (resolvedFields.length > 0) {
    log("FETCH", `Agenda — « ${event.eventName} » : ${resolvedFields.join(", ")} complété(s) depuis le domaine officiel`);
  }
  return { event: working, pagesTried, resolvedFields, contradiction };
}
