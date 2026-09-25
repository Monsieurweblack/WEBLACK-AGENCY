/**
 * La priorité géographique de l'Agenda : Afrique d'abord, puis diaspora
 * afro-descendante, puis reste du monde pertinent pour WEBLACK.
 *
 * Ce module porte deux choses volontairement distinctes :
 *
 * 1. Les LISTES de villes par palier, qui alimentent la rotation de
 *    `discover.ts`. La liste Afrique ne se limite pas aux six métropoles
 *    déjà couvertes (Lagos, Johannesburg, Dakar, Accra, Nairobi, Le Cap) —
 *    la couvrir seule referait le même biais que la rotation qui s'était
 *    arrêtée sur Tokyo six cycles de suite (voir discover.ts). La diversité
 *    géographique doit venir de la liste elle-même, pas d'un tirage.
 *
 * 2. La timezone IANA de chaque ville, utilisée pour dater les événements
 *    sans dépendre implicitement d'UTC ou de la timezone du serveur qui
 *    exécute le moteur. Une ville absente de la table n'a pas de timezone
 *    inventée : l'événement reste "date-only", exactement la même
 *    convention que lorsque l'heure elle-même est absente de la page.
 */

export const GEOGRAPHIC_PRIORITIES = ["AFRICA", "AFRO_DIASPORA", "INTERNATIONAL"] as const;
export type GeographicPriority = (typeof GEOGRAPHIC_PRIORITIES)[number];

/**
 * Villes africaines couvertes par la rotation, par région — pour que la
 * diversité soit structurelle plutôt que le fruit d'un tirage qui
 * favoriserait toujours les mêmes grandes capitales anglophones et
 * francophones les plus documentées en ligne.
 */
export const AFRICA_CITIES: Record<string, string> = {
  // Afrique de l'Ouest
  Lagos: "Africa/Lagos",
  Accra: "Africa/Accra",
  Dakar: "Africa/Dakar",
  Abidjan: "Africa/Abidjan",
  Lomé: "Africa/Lome",
  Cotonou: "Africa/Porto-Novo",
  Bamako: "Africa/Bamako",
  Conakry: "Africa/Conakry",
  Freetown: "Africa/Freetown",
  Monrovia: "Africa/Monrovia",
  Niamey: "Africa/Niamey",
  Ouagadougou: "Africa/Ouagadougou",
  "Bissau": "Africa/Bissau",
  Praia: "Atlantic/Cape_Verde",
  Nouakchott: "Africa/Nouakchott",
  Banjul: "Africa/Banjul",
  // Afrique centrale
  Kinshasa: "Africa/Kinshasa",
  Brazzaville: "Africa/Brazzaville",
  Yaoundé: "Africa/Douala",
  Douala: "Africa/Douala",
  Libreville: "Africa/Libreville",
  Bangui: "Africa/Bangui",
  "N'Djamena": "Africa/Ndjamena",
  Malabo: "Africa/Malabo",
  // Afrique de l'Est
  Nairobi: "Africa/Nairobi",
  "Addis-Abeba": "Africa/Addis_Ababa",
  "Addis Ababa": "Africa/Addis_Ababa",
  "Dar es Salaam": "Africa/Dar_es_Salaam",
  Kampala: "Africa/Kampala",
  Kigali: "Africa/Kigali",
  Djibouti: "Africa/Djibouti",
  Khartoum: "Africa/Khartoum",
  Mogadiscio: "Africa/Mogadishu",
  Mogadishu: "Africa/Mogadishu",
  // Afrique australe
  Johannesburg: "Africa/Johannesburg",
  "Le Cap": "Africa/Johannesburg",
  "Cape Town": "Africa/Johannesburg",
  Pretoria: "Africa/Johannesburg",
  Maputo: "Africa/Maputo",
  Harare: "Africa/Harare",
  Lusaka: "Africa/Lusaka",
  Gaborone: "Africa/Gaborone",
  Windhoek: "Africa/Windhoek",
  Antananarivo: "Indian/Antananarivo",
  // Afrique du Nord
  "Le Caire": "Africa/Cairo",
  Cairo: "Africa/Cairo",
  Tunis: "Africa/Tunis",
  Alger: "Africa/Algiers",
  Algiers: "Africa/Algiers",
  Casablanca: "Africa/Casablanca",
  Marrakech: "Africa/Casablanca",
  Rabat: "Africa/Casablanca",
  Tripoli: "Africa/Tripoli",
};

/**
 * Villes hors d'Afrique où se tiennent des événements documentés comme
 * africains ou afro-descendants — diaspora ouest-atlantique, caribéenne,
 * afro-brésilienne, afro-européenne. La classification AFRO_DIASPORA d'un
 * événement précis ne dépend jamais de sa seule ville (voir
 * `classifyGeographicPriority` plus bas et le point 12 de la mission :
 * jamais déduite de l'apparence physique) — cette liste sert uniquement à
 * ORIENTER la recherche vers des scènes où cette actualité existe
 * réellement, pas à décider du résultat.
 */
export const AFRO_DIASPORA_CITIES: Record<string, string> = {
  Paris: "Europe/Paris",
  Londres: "Europe/London",
  London: "Europe/London",
  Bruxelles: "Europe/Brussels",
  Brussels: "Europe/Brussels",
  Lisbonne: "Europe/Lisbon",
  Lisbon: "Europe/Lisbon",
  Amsterdam: "Europe/Amsterdam",
  "New York": "America/New_York",
  Atlanta: "America/New_York",
  Miami: "America/New_York",
  Washington: "America/New_York",
  Chicago: "America/Chicago",
  "Los Angeles": "America/Los_Angeles",
  Toronto: "America/Toronto",
  Montréal: "America/Toronto",
  Montreal: "America/Toronto",
  "São Paulo": "America/Sao_Paulo",
  "Rio de Janeiro": "America/Sao_Paulo",
  Salvador: "America/Bahia",
  Kingston: "America/Jamaica",
  "Port-au-Prince": "America/Port-au-Prince",
  "La Havane": "America/Havana",
  Havana: "America/Havana",
  Bridgetown: "America/Barbados",
};

/** Reste du monde pertinent pour WEBLACK, sans lien de diaspora documenté. */
export const INTERNATIONAL_CITIES: Record<string, string> = {
  Milan: "Europe/Rome",
  Rome: "Europe/Rome",
  Berlin: "Europe/Berlin",
  Madrid: "Europe/Madrid",
  Anvers: "Europe/Brussels",
  Antwerp: "Europe/Brussels",
  Copenhague: "Europe/Copenhagen",
  Copenhagen: "Europe/Copenhagen",
  Vienne: "Europe/Vienna",
  Vienna: "Europe/Vienna",
  Stockholm: "Europe/Stockholm",
  Zurich: "Europe/Zurich",
  Dubaï: "Asia/Dubai",
  Tokyo: "Asia/Tokyo",
  Séoul: "Asia/Seoul",
  Singapour: "Asia/Singapore",
  "Hong Kong": "Asia/Hong_Kong",
};

/** Table complète, pour la recherche de timezone déterministe. */
const ALL_CITY_TIMEZONES: Record<string, string> = { ...AFRICA_CITIES, ...AFRO_DIASPORA_CITIES, ...INTERNATIONAL_CITIES };

/**
 * La timezone IANA d'une ville connue, sinon rien — jamais UTC par défaut,
 * jamais la timezone de la machine qui exécute le moteur. Une ville non
 * répertoriée n'est pas une timezone inconnue traitée comme UTC : c'est une
 * absence, exactement comme un champ que la source ne donne pas.
 */
export function timezoneForCity(city: string): string {
  if (!city) return "";
  const direct = ALL_CITY_TIMEZONES[city.trim()];
  if (direct) return direct;
  // Une source écrit parfois « Le Cap, Afrique du Sud » ou « Cape Town » —
  // on ne devine pas au-delà d'une correspondance exacte de nom de ville,
  // le reste resterait une inférence.
  return "";
}

/**
 * Classe une ville dans son palier géographique — sert à orienter la
 * DÉCOUVERTE, jamais à décider seul de la classification finale d'un
 * événement (voir verify.ts : la classification retenue vient de ce que la
 * page dit réellement d'un lien avec l'Afrique ou ses diasporas, pas
 * seulement de la ville où l'événement se tient — un événement afro-
 * descendant peut avoir lieu à Milan, un événement sans aucun rapport peut
 * avoir lieu à Lagos).
 */
export function cityPriorityHint(city: string): GeographicPriority | undefined {
  if (!city) return undefined;
  const trimmed = city.trim();
  if (trimmed in AFRICA_CITIES) return "AFRICA";
  if (trimmed in AFRO_DIASPORA_CITIES) return "AFRO_DIASPORA";
  if (trimmed in INTERNATIONAL_CITIES) return "INTERNATIONAL";
  return undefined;
}
