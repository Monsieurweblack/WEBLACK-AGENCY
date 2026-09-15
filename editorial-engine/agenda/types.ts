import type { WeblackTerritory } from "../generation/types.ts";

/**
 * Structure interne de l'Agenda culturel. Rien de tout ceci n'est écrit
 * dans Sanity à ce stade : le sous-système doit d'abord démontrer qu'il
 * sait chercher, vérifier, dédupliquer et faire expirer des événements.
 */

/** Où en est l'événement par rapport à aujourd'hui — calculé depuis les dates vérifiées, jamais déclaré par un modèle. */
export type EventStatus = "UPCOMING" | "ONGOING" | "EXPIRED";

/**
 * VERIFIED — le nom et les dates ont été retrouvés dans le texte réel de la page officielle.
 * REVIEW — deux sources se contredisent, ou une donnée essentielle manque : décision humaine.
 * UNVERIFIED — la page n'a pas pu être lue, ou ne confirme pas ce qui était annoncé.
 * CANCELLED — la page indique explicitement une annulation.
 * GONE — la page a disparu depuis la dernière vérification.
 */
export type EventVerification = "VERIFIED" | "REVIEW" | "UNVERIFIED" | "CANCELLED" | "GONE";

/**
 * Le rang de la source, dans l'ordre de priorité de la mission. Il est
 * déduit de la page réellement lue — un domaine qui porte le nom du lieu
 * ou de l'institution est traité comme officiel — jamais d'une liste de
 * médias tenue à la main, qui vieillirait mal.
 */
export type SourceRank = "OFFICIAL" | "INSTITUTION" | "ORGANIZER" | "ARTIST_BRAND" | "MEDIA" | "SECONDARY";

export interface AgendaEvent {
  /** Clé d'identité déterministe — deux annonces du même événement produisent la même. */
  id: string;
  eventName: string;
  eventType: string;
  discipline: string;
  artistOrCreator: string;
  institution: string;
  /** ISO court (YYYY-MM-DD) quand la page la donne ; chaîne vide sinon — jamais déduite. */
  startDate: string;
  endDate: string;
  time: string;
  venue: string;
  city: string;
  country: string;
  organizer: string;
  officialUrl: string;
  /** Toutes les pages réellement consultées pour cet événement, la première étant celle qui fait foi. */
  sourceUrls: string[];
  sourceRank: SourceRank;
  verificationStatus: EventVerification;
  /** Ce qui a été retrouvé mot pour mot dans la page, et ce qui manquait. */
  verifiedFields: string[];
  missingFields: string[];
  /**
   * La page qui porte chaque donnée retenue. Un champ complété depuis une
   * page complémentaire garde l'URL de CETTE page, pas celle de la
   * découverte initiale : sans cela, on ne saurait plus sur quoi repose une
   * date d'ouverture lue ailleurs que sur la page de l'événement.
   */
  fieldSources: Record<string, string>;
  /** Pourquoi l'événement est en revue ou non vérifié. */
  note: string;
  lastVerifiedAt: string;
  status: EventStatus;
  /** Le territoire WEBLACK que l'événement occupe réellement, jugé sur la page lue. */
  territory: WeblackTerritory;
  /** Ce qui justifie que WEBLACK annonce cet événement. Vide = rien ne le justifie. */
  editorialValue: string;
  editorialRelevance: number;
}

/** Les champs sans lesquels une entrée d'agenda n'a pas de sens. Aucun ne peut être comblé par inférence. */
export const ESSENTIAL_FIELDS = ["eventName", "startDate", "venue", "city"] as const;

/**
 * Éligible à l'Agenda — délibérément distinct du seuil 90/90 des articles,
 * qui reste inchangé. Un événement vérifié et pertinent n'a pas à être un
 * sujet d'article pour mériter une ligne d'agenda.
 *
 * Être vérifié ne suffit pas à être publiable. Les premiers cycles réels
 * ont produit des entrées irréprochables sur le plan factuel — datées,
 * situées, confirmées sur la page officielle — et pourtant hors sujet :
 * un atelier de percussions pour débutants, une initiation au DJing. Un
 * événement doit donc aussi occuper un territoire du Journal et porter une
 * raison d'être annoncé ; sinon l'Agenda devient un guide des sorties.
 */
export function isAgendaEligible(event: AgendaEvent, minRelevance = 70): boolean {
  if (event.verificationStatus !== "VERIFIED") return false;
  if (event.status === "EXPIRED") return false;
  if (event.missingFields.length > 0) return false;
  // Le stock est append-only et contient des entrées antérieures à ces deux
  // champs : une entrée qui ne porte pas encore de jugement éditorial n'est
  // pas publiable, elle attend d'être relue.
  if (!event.territory || event.territory === "OUT_OF_TERRITORY") return false;
  if (!(event.editorialValue ?? "").trim()) return false;
  return event.editorialRelevance >= minRelevance;
}

/** UPCOMING / ONGOING / EXPIRED, depuis les seules dates vérifiées. Une date de fin absente fait foi de la date de début. */
export function computeStatus(startDate: string, endDate: string, now = new Date()): EventStatus {
  const today = now.toISOString().slice(0, 10);
  const start = startDate || endDate;
  const end = endDate || startDate;
  if (!start) return "EXPIRED"; // sans date, rien ne permet d'annoncer un événement à venir
  if (end < today) return "EXPIRED";
  if (start > today) return "UPCOMING";
  return "ONGOING";
}
