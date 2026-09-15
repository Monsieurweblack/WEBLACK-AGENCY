/**
 * La règle d'accès public de l'Agenda — et rien d'autre.
 *
 * Ce module ne touche ni à Sanity ni à Astro : il ne fait que décider si un
 * document a le droit d'être annoncé. C'est délibérément la partie la plus
 * isolée du site, parce que c'est la seule dont une erreur se verrait
 * dehors — un événement annulé toujours affiché, une date qu'on n'a pas
 * vérifiée transmise à un moteur de recherche.
 *
 * Le moteur éditorial n'écrit déjà dans Sanity que ce qu'il a vérifié. Ce
 * tri-ci est le second, et il ne fait pas confiance au premier : un document
 * peut être corrigé à la main dans le Studio, et le site ne doit pas dépendre
 * de la prudence de qui l'a édité.
 */

export type AgendaStatus = "UPCOMING" | "ONGOING" | "EXPIRED" | "CANCELLED" | "REVIEW";

/**
 * Les deux seuls statuts qu'un visiteur peut rencontrer.
 *
 * Le type le dit plutôt que le commentaire : un événement qui parvient
 * jusqu'à une page est à venir ou en cours, jamais terminé, annulé ni en
 * revue. Les trois autres états existent dans le CMS et n'ont délibérément
 * pas de libellé d'affichage — il n'y a rien à en montrer.
 */
export type PublicAgendaStatus = Extract<AgendaStatus, "UPCOMING" | "ONGOING">;

export interface AgendaEventData {
  id: string;
  slug: string;
  eventName: string;
  eventType?: string;
  discipline?: string;
  artistOrCreator?: string;
  institution?: string;
  startDate: string;
  endDate?: string;
  time?: string;
  venue: string;
  city: string;
  country?: string;
  organizer?: string;
  description?: string;
  officialUrl: string;
  sourceUrls: string[];
  status: PublicAgendaStatus;
  lastVerifiedAt?: string;
  editorialRelevance?: number;
}

const PUBLIC_STATUSES: PublicAgendaStatus[] = ["UPCOMING", "ONGOING"];

export function isPublicStatus(status: unknown): status is PublicAgendaStatus {
  return typeof status === "string" && (PUBLIC_STATUSES as string[]).includes(status);
}

/**
 * Un document ne devient un événement affichable que s'il porte lui-même
 * tout ce qui permet de l'annoncer : quoi, quand, où, et une source que le
 * lecteur peut ouvrir. Rien n'est complété ici — ni ville déduite du nom du
 * musée, ni date reconstituée à partir d'un mois.
 */
export function toPublicEvent(doc: Record<string, any>): AgendaEventData | undefined {
  if (!isPublicStatus(doc.status)) return undefined;
  if (doc.verificationStatus !== "VERIFIED") return undefined;

  const slug = doc.slug?.current;
  const required = [slug, doc.eventName, doc.startDate, doc.venue, doc.city, doc.officialUrl];
  if (required.some((value) => typeof value !== "string" || value.trim() === "")) return undefined;

  return {
    id: doc._id,
    slug,
    eventName: doc.eventName,
    eventType: doc.eventType || undefined,
    discipline: doc.discipline || undefined,
    artistOrCreator: doc.artistOrCreator || undefined,
    institution: doc.institution || undefined,
    startDate: doc.startDate,
    endDate: doc.endDate || undefined,
    time: doc.time || undefined,
    venue: doc.venue,
    city: doc.city,
    country: doc.country || undefined,
    organizer: doc.organizer || undefined,
    officialUrl: doc.officialUrl,
    sourceUrls: Array.isArray(doc.sourceUrls) ? doc.sourceUrls.filter((u: unknown) => typeof u === "string") : [],
    status: doc.status,
    lastVerifiedAt: doc.lastVerifiedAt || undefined,
    editorialRelevance: typeof doc.editorialRelevance === "number" ? doc.editorialRelevance : undefined,
  };
}

/**
 * L'événement est-il encore à venir au moment où la page est construite ?
 *
 * Le statut stocké ne suffit pas : il a été calculé quand le moteur a écrit
 * le document, parfois des semaines plus tôt, et un site statique n'est
 * reconstruit qu'au déploiement suivant. La date, elle, ne ment pas.
 */
export function isStillRunning(event: AgendaEventData, today: string): boolean {
  return (event.endDate || event.startDate) >= today;
}

/** Les valeurs réellement présentes dans la liste, pour ne proposer que des filtres qui filtrent quelque chose. */
export function agendaFacets(events: AgendaEventData[]): { cities: string[]; countries: string[]; disciplines: string[] } {
  const collect = (pick: (event: AgendaEventData) => string | undefined) =>
    [...new Set(events.map(pick).filter((value): value is string => Boolean(value && value.trim())))].sort((a, b) =>
      a.localeCompare(b, "fr"),
    );

  return {
    cities: collect((event) => event.city),
    countries: collect((event) => event.country),
    disciplines: collect((event) => event.discipline),
  };
}
