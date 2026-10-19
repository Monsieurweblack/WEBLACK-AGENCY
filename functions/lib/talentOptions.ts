/**
 * Valeurs autorisées du formulaire de candidature Talent — source unique,
 * importée à la fois par le serveur (validation.ts, qui refuse toute valeur
 * absente de ces listes) et par le formulaire Astro (qui en tire ses options).
 * Les libellés vivent dans src/i18n/ui.ts (clés talentApplication.option.*),
 * jamais ici : ce module ne porte que des codes stables, stockés tels quels
 * en D1.
 */

export const TALENT_CATEGORIES = ["runway", "commercial", "photo", "editorial", "creative", "other"] as const;
export type TalentCategory = (typeof TALENT_CATEGORIES)[number];

/** Catégories pour lesquelles les mensurations complètes ont une utilité de casting. */
export const MODEL_CATEGORIES: readonly TalentCategory[] = ["runway", "commercial", "photo", "editorial"];

/** Codes conservés depuis la première version (dossiers déjà compatibles) ; "some_experience" est libellé « Intermédiaire ». */
export const EXPERIENCE_LEVELS = ["beginner", "some_experience", "experienced", "professional"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_DURATIONS = ["none", "lt1", "1to3", "3to5", "gt5"] as const;
export type ExperienceDuration = (typeof EXPERIENCE_DURATIONS)[number];

export const MOBILITY_OPTIONS = ["local", "national", "international"] as const;
export type Mobility = (typeof MOBILITY_OPTIONS)[number];

export const PROJECT_TYPES = ["runway", "editorial", "advertising", "ecommerce", "showroom", "events"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const EYE_COLORS = ["dark_brown", "brown", "hazel", "green", "blue", "grey", "other"] as const;
export const HAIR_COLORS = ["black", "dark_brown", "brown", "blonde", "red", "grey", "shaved", "other"] as const;
export const SHOE_SYSTEMS = ["EU", "UK", "US"] as const;

/**
 * Codes de langue (ISO 639) — noms affichés via Intl.DisplayNames dans la
 * langue de la page, donc jamais traduits à la main. Langues africaines
 * présentes délibérément : elles sont courantes parmi les candidat·e·s.
 */
export const LANGUAGES = [
  "fr", "en", "es", "pt", "ar", "de", "it", "nl", "ru", "zh", "ja", "ko", "hi", "tr", "pl", "ro", "el",
  "sv", "no", "da", "fi", "he", "fa", "ur", "bn", "vi", "th", "id",
  "sw", "wo", "ln", "yo", "ig", "ha", "am", "zu", "xh", "ff", "bm", "rw", "kg", "tw", "ee", "sn", "so", "mg",
] as const;

/** ISO 3166-1 alpha-2 (territoires inhabités exclus) + XK (Kosovo, reconnu par Intl). */
export const COUNTRIES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE",
  "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BY", "BZ", "CA", "CC", "CD",
  "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK",
  "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD",
  "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GT", "GU", "GW", "GY", "HK", "HN", "HR", "HT",
  "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI",
  "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA",
  "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW",
  "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF",
  "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB",
  "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "US", "UY",
  "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

/**
 * Indicatif proposé automatiquement quand un pays est choisi — limité aux
 * indicatifs dont la valeur est certaine. Absent = le champ reste à saisir
 * à la main ; il n'est jamais deviné.
 */
export const DIAL_CODES: Partial<Record<(typeof COUNTRIES)[number], string>> = {
  FR: "33", BE: "32", CH: "41", LU: "352", MC: "377", DE: "49", IT: "39", ES: "34", PT: "351", GB: "44", IE: "353",
  NL: "31", NO: "47", SE: "46", DK: "45", FI: "358", AT: "43", PL: "48", GR: "30", RO: "40", CZ: "420", HU: "36",
  UA: "380", RU: "7", TR: "90", US: "1", CA: "1", BR: "55", MX: "52", AR: "54", CO: "57", HT: "509",
  GP: "590", MQ: "596", GF: "594", RE: "262", YT: "262", PF: "689", NC: "687",
  SN: "221", MR: "222", ML: "223", GN: "224", CI: "225", BF: "226", NE: "227", TG: "228", BJ: "229", MU: "230",
  LR: "231", SL: "232", GH: "233", NG: "234", TD: "235", CF: "236", CM: "237", CV: "238", ST: "239", GQ: "240",
  GA: "241", CG: "242", CD: "243", AO: "244", GW: "245", SC: "248", SD: "249", RW: "250", ET: "251", SO: "252",
  DJ: "253", KE: "254", TZ: "255", UG: "256", BI: "257", MZ: "258", ZM: "260", MG: "261", ZW: "263", NA: "264",
  MW: "265", LS: "266", BW: "267", SZ: "268", KM: "269", ZA: "27", GM: "220", ER: "291", SS: "211", EG: "20",
  LY: "218", TN: "216", DZ: "213", MA: "212", AE: "971", SA: "966", QA: "974", IL: "972", LB: "961", IN: "91",
  CN: "86", JP: "81", KR: "82", AU: "61", NZ: "64",
};

/** Limites de mensurations, en centimètres — plages humaines plausibles, jamais des seuils de sélection. */
export const MEASUREMENT_LIMITS = {
  heightCm: [100, 230],
  chestCm: [50, 160],
  waistCm: [40, 150],
  hipsCm: [50, 170],
  inseamCm: [40, 110],
} as const;

export const SHOE_SIZE_LIMITS = [15, 55] as const;

export const TEXT_LIMITS = {
  name: 80,
  city: 100,
  instagram: 120,
  categoryOther: 120,
  languagesOther: 120,
  agency: 120,
  exclusivity: 300,
  clothingSize: 20,
  portfolioLink: 300,
  portfolioLinksCount: 5,
  motivation: 1500,
} as const;

export const MAX_LANGUAGES = 12;

/**
 * Limites réelles d'upload, affichées telles quelles au candidat.
 * originalMaxBytes : fichier choisi sur l'appareil (vérifié dans le
 * navigateur avant réencodage). uploadedMaxBytes : fichier reçu par le
 * serveur après réencodage JPEG ≤ 1600 px (upload.ts le refuse au-delà).
 */
export const UPLOAD_LIMITS = {
  originalMaxBytes: 20 * 1024 * 1024,
  uploadedMaxBytes: 10 * 1024 * 1024,
  maxDimension: 1600,
  acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxExtraPhotos: 3,
} as const;
