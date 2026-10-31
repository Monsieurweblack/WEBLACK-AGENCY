/**
 * Données structurées schema.org `Event` des pages Agenda — source unique,
 * utilisée par src/components/pages/AgendaDetail.astro pour toutes les pages
 * FR et EN.
 *
 * Organisateur (anomalie Search Console « Champ url manquant (dans
 * organizer) ») : Google attend un organisateur avec son site. Les documents
 * de l'Agenda ne portent que le NOM de l'organisateur. Aucune URL n'est
 * inventée : `organizer.url` n'est déclaré que lorsque la page officielle de
 * l'événement — vérifiée par le moteur éditorial — est hébergée sur le
 * domaine de l'organisateur lui-même, c'est-à-dire lorsque le nom de
 * l'organisateur se lit dans ce domaine (même principe que la classification
 * « ORGANIZER » de editorial-engine/agenda/verify.ts → rankSource). L'URL
 * déclarée est alors l'origine de ce site (https://domaine/).
 *
 * Sans URL vérifiable, l'organisateur n'est PAS déclaré dans les données
 * structurées (un organisateur sans site est précisément l'anomalie
 * signalée) ; son nom reste affiché sur la page. Ces cas sont listés par
 * `organizerUrlStatus` pour être complétés à la source.
 *
 * Module pur : testé dans src/lib/agenda-structured-data.test.ts.
 */
import type { AgendaEventData } from "./agenda-public";

export type OrganizerUrlReason =
  | "verified-domain" // le domaine de la page officielle porte le nom de l'organisateur
  | "no-organizer" // aucun organisateur renseigné
  | "multiple-organizers" // « A et B » : une seule URL ne représenterait qu'une partie
  | "social-or-aggregator" // page officielle sur un réseau social : pas un site d'organisateur
  | "domain-mismatch" // la page officielle n'est pas sur le domaine de l'organisateur
  | "invalid-url";

export interface OrganizerUrlStatus {
  url?: string;
  reason: OrganizerUrlReason;
}

/** Plateformes dont une page n'est jamais « le site » d'un organisateur. */
const SOCIAL_HOSTS = /(^|\.)(linkedin\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|threads\.net)$/;
/** Suffixes génériques retirés avant comparaison (domaine « org.ac.za » → « org »). */
const GENERIC_LABELS = new Set(["com", "org", "net", "co", "ac", "gov", "gouv", "edu", "www"]);
/** Plusieurs organisateurs déclarés ensemble. */
const SEVERAL = /\s(?:and|et|&|und|e|y)\s|,|\/|;/i;

function compact(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function organizerUrlStatus(event: Pick<AgendaEventData, "organizer" | "officialUrl">): OrganizerUrlStatus {
  const organizer = event.organizer?.trim();
  if (!organizer) return { reason: "no-organizer" };
  if (SEVERAL.test(` ${organizer} `)) return { reason: "multiple-organizers" };

  let url: URL;
  try {
    url = new URL(event.officialUrl);
  } catch {
    return { reason: "invalid-url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { reason: "invalid-url" };
  const host = url.hostname.toLowerCase();
  if (SOCIAL_HOSTS.test(host)) return { reason: "social-or-aggregator" };

  // « press.brusselsairlines.com » → « pressbrusselsairlines » ; « www.mori.art.museum » → « moriart ».
  const labels = host.split(".");
  labels.pop(); // domaine de premier niveau
  while (labels.length > 1 && GENERIC_LABELS.has(labels[labels.length - 1]!)) labels.pop();
  const hostCompact = labels.filter((label) => label !== "www").join("");
  const name = compact(organizer);

  const matches = name.length >= 5 && hostCompact.length >= 5 && (hostCompact.includes(name) || name.includes(hostCompact));
  if (!matches) return { reason: "domain-mismatch" };
  return { url: `https://${host}/`, reason: "verified-domain" };
}

/** Objet JSON-LD complet de l'événement, ou `undefined` s'il ne peut pas être décrit sans invention. */
export function buildEventJsonLd(event: AgendaEventData, options: { inLanguage: string; description?: string }) {
  if (!event.eventName || !event.startDate || !event.city) return undefined;
  const organizer = organizerUrlStatus(event);
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.eventName,
    startDate: event.startDate,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      // Pas de nom de lieu quand la source n'en donne pas : nommer la ville
      // comme si elle était une salle serait une donnée inventée.
      ...(event.venue ? { name: event.venue } : {}),
      address: {
        "@type": "PostalAddress",
        addressLocality: event.city,
        ...(event.country ? { addressCountry: event.country } : {}),
      },
    },
    ...(options.description ? { description: options.description } : {}),
    ...(organizer.url ? { organizer: { "@type": "Organization", name: event.organizer, url: organizer.url } } : {}),
    ...(event.artistOrCreator ? { performer: { "@type": "Person", name: event.artistOrCreator } } : {}),
    url: event.officialUrl,
    inLanguage: options.inLanguage,
  };
}
