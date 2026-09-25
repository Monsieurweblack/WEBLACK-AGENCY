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
 * Les 54 États africains reconnus par l'ONU, noms français et anglais —
 * utilisés pour vérifier une classification AFRICA contre le pays
 * réellement extrait de la page, pas seulement contre la ville.
 *
 * Existe à cause d'un cas réel observé en campagne de découverte : un
 * modèle a classé « Abstractions », une exposition de peinture abstraite
 * dans une galerie parisienne sans aucun rapport avec l'Afrique, comme
 * AFRICA — sans ville africaine, sans justification, sans qu'aucun élément
 * de la page ne l'évoque. `resolveGeographicPriority` (verify.ts) croise
 * désormais toute classification AFRICA contre cette liste (ou contre
 * AFRICA_CITIES) exactement comme il croise déjà AFRO_DIASPORA contre une
 * justification écrite — la même discipline anti-fabrication, appliquée au
 * palier qui en semblait dispensé.
 */
export const AFRICAN_COUNTRIES = new Set(
  [
    "Afrique du Sud", "South Africa", "Algérie", "Algeria", "Angola", "Bénin", "Benin", "Botswana",
    "Burkina Faso", "Burundi", "Cameroun", "Cameroon", "Cap-Vert", "Cabo Verde", "Cape Verde",
    "Comores", "Comoros", "Congo", "Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast", "Djibouti",
    "Égypte", "Egypte", "Egypt", "Érythrée", "Erythree", "Eritrea", "Eswatini", "Éthiopie", "Ethiopie", "Ethiopia",
    "Gabon", "Gambie", "Gambia", "Ghana", "Guinée", "Guinee", "Guinea", "Guinée-Bissau", "Guinea-Bissau",
    "Guinée équatoriale", "Equatorial Guinea", "Kenya", "Lesotho", "Liberia", "Libéria", "Libye", "Libya",
    "Madagascar", "Malawi", "Mali", "Maroc", "Morocco", "Maurice", "Mauritius", "Mauritanie", "Mauritania",
    "Mozambique", "Namibie", "Namibia", "Niger", "Nigeria", "Nigéria", "Ouganda", "Uganda",
    "République centrafricaine", "Central African Republic", "République démocratique du Congo",
    "Democratic Republic of the Congo", "DR Congo", "DRC", "Rwanda", "Sao Tomé-et-Principe", "São Tomé and Príncipe",
    "Sénégal", "Senegal", "Seychelles", "Sierra Leone", "Somalie", "Somalia", "Soudan", "Sudan",
    "Soudan du Sud", "South Sudan", "Tanzanie", "Tanzania", "Tchad", "Chad", "Togo", "Tunisie", "Tunisia",
    "Zambie", "Zambia", "Zimbabwe", "Sahara occidental", "Western Sahara",
  ].map((n) => n.toLowerCase()),
);

/** Le pays extrait désigne-t-il un État africain — comparaison normalisée, jamais devinée au-delà d'une correspondance de nom. */
export function isAfricanCountry(country: string): boolean {
  if (!country.trim()) return false;
  return AFRICAN_COUNTRIES.has(country.trim().toLowerCase());
}

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
  // France, Royaume-Uni, Belgique
  Paris: "Europe/Paris",
  Londres: "Europe/London",
  London: "Europe/London",
  Bruxelles: "Europe/Brussels",
  Brussels: "Europe/Brussels",
  // Allemagne, Espagne, Portugal, Italie
  Berlin: "Europe/Berlin",
  Madrid: "Europe/Madrid",
  Barcelone: "Europe/Madrid",
  Barcelona: "Europe/Madrid",
  Lisbonne: "Europe/Lisbon",
  Lisbon: "Europe/Lisbon",
  Milan: "Europe/Rome",
  Rome: "Europe/Rome",
  Amsterdam: "Europe/Amsterdam",
  // États-Unis, Canada
  "New York": "America/New_York",
  Atlanta: "America/New_York",
  Miami: "America/New_York",
  Washington: "America/New_York",
  Chicago: "America/Chicago",
  "Los Angeles": "America/Los_Angeles",
  Toronto: "America/Toronto",
  Montréal: "America/Toronto",
  Montreal: "America/Toronto",
  // Brésil, Caraïbes, Amérique latine
  "São Paulo": "America/Sao_Paulo",
  "Rio de Janeiro": "America/Sao_Paulo",
  Salvador: "America/Bahia",
  Kingston: "America/Jamaica",
  "Port-au-Prince": "America/Port-au-Prince",
  "La Havane": "America/Havana",
  Havana: "America/Havana",
  Bridgetown: "America/Barbados",
  Bogotá: "America/Bogota",
  Bogota: "America/Bogota",
  Cartagena: "America/Bogota",
  // Moyen-Orient, Asie, Océanie
  Dubaï: "Asia/Dubai",
  Dubai: "Asia/Dubai",
  Singapour: "Asia/Singapore",
  Singapore: "Asia/Singapore",
  Sydney: "Australia/Sydney",
  Melbourne: "Australia/Melbourne",
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
