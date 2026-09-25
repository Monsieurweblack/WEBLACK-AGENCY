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

export type AgendaStatus = "UPCOMING" | "ONGOING" | "EXPIRED" | "CANCELLED" | "POSTPONED" | "REVIEW";

/** Le palier géographique de l'Agenda — voir editorial-engine/agenda/geography.ts, seule source de la règle. */
export type GeographicPriority = "AFRICA" | "AFRO_DIASPORA" | "INTERNATIONAL";

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
  /** Absent pour un événement à l'échelle d'une ville — une biennale n'a pas de salle unique. */
  venue?: string;
  city: string;
  country?: string;
  organizer?: string;
  description?: string;
  officialUrl: string;
  sourceUrls: string[];
  status: PublicAgendaStatus;
  lastVerifiedAt?: string;
  editorialRelevance?: number;
  geographicPriority?: GeographicPriority;
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
  // Le lieu n'est pas exigé : une biennale se tient dans toute une ville et
  // sa page officielle n'en nomme aucun. La ville, elle, reste requise.
  const required = [slug, doc.eventName, doc.startDate, doc.city, doc.officialUrl];
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
    venue: doc.venue || undefined,
    city: doc.city,
    country: doc.country || undefined,
    organizer: doc.organizer || undefined,
    officialUrl: doc.officialUrl,
    sourceUrls: Array.isArray(doc.sourceUrls) ? doc.sourceUrls.filter((u: unknown) => typeof u === "string") : [],
    status: doc.status,
    lastVerifiedAt: doc.lastVerifiedAt || undefined,
    editorialRelevance: typeof doc.editorialRelevance === "number" ? doc.editorialRelevance : undefined,
    geographicPriority: isGeographicPriority(doc.geographicPriority) ? doc.geographicPriority : undefined,
  };
}

const GEOGRAPHIC_PRIORITIES: GeographicPriority[] = ["AFRICA", "AFRO_DIASPORA", "INTERNATIONAL"];

function isGeographicPriority(value: unknown): value is GeographicPriority {
  return typeof value === "string" && (GEOGRAPHIC_PRIORITIES as string[]).includes(value);
}

/**
 * L'événement commence-t-il APRÈS la date de publication ?
 *
 * Un agenda annonce ce qui vient. Une exposition ouverte depuis deux
 * semaines n'est plus une annonce : elle donne à la page l'air d'avoir été
 * écrite avant-hier, et c'est la première chose qu'un lecteur remarque. La
 * règle est donc stricte — c'est la date de DÉBUT qui doit être postérieure
 * au jour de publication, pas seulement la date de fin.
 *
 * Le prix en est assumé : une exposition qui court jusqu'en décembre
 * disparaît de l'agenda le lendemain de son ouverture. Elle reste dans le
 * CMS avec son statut ONGOING, qui dit la vérité sur elle ; c'est l'annonce
 * qui cesse, pas la donnée.
 *
 * La date est recalculée à chaque construction du site plutôt que lue sur le
 * document : le statut stocké a été établi quand le moteur a écrit
 * l'événement, parfois des semaines plus tôt.
 */
export function startsAfterPublication(event: AgendaEventData, today: string): boolean {
  return event.startDate > today;
}


/**
 * L'événement se tient-il EN CE MOMENT ?
 *
 * L'Agenda n'annonce que ce qui commence après la publication : c'est ce
 * qui lui donne son sens d'annonce. Mais huit expositions vérifiées sont
 * ouvertes aujourd'hui — Londres, Johannesburg, Tokyo — et tombaient donc
 * dans un angle mort : trop tard pour être annoncées, trop vivantes pour
 * être oubliées.
 *
 * C'est exactement la matière de WEBLACK NOW, et c'est pourquoi cette
 * fonction existe séparément : « ce qui se passe » n'est pas « ce qui
 * vient ». Les deux listes ne se recoupent jamais, par construction.
 */
export function isRunningNow(event: AgendaEventData, today: string): boolean {
  return event.startDate <= today && (event.endDate || event.startDate) >= today;
}

/** Les valeurs réellement présentes dans la liste, pour ne proposer que des filtres qui filtrent quelque chose. */
export function agendaFacets(
  events: AgendaEventData[],
): { cities: string[]; countries: string[]; disciplines: string[]; regions: GeographicPriority[] } {
  const collect = (pick: (event: AgendaEventData) => string | undefined) =>
    [...new Set(events.map(pick).filter((value): value is string => Boolean(value && value.trim())))].sort((a, b) =>
      a.localeCompare(b, "fr"),
    );

  // Ordre de priorité éditoriale, pas alphabétique : Afrique d'abord,
  // diaspora ensuite, international en dernier — le filtre reprend la
  // hiérarchie du radar plutôt que de la dissoudre dans un tri neutre.
  const present = new Set(events.map((event) => event.geographicPriority).filter(Boolean));
  const regions = GEOGRAPHIC_PRIORITIES.filter((tier) => present.has(tier));

  return {
    cities: collect((event) => event.city),
    countries: collect((event) => event.country),
    disciplines: collect((event) => event.discipline),
    regions,
  };
}
