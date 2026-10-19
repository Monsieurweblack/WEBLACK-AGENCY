import { MAX_EXTRA_PHOTOS, REQUIRED_PHOTO_ROLES, type PhotoRole, type ValidApplication } from "./applicationTypes.ts";
import {
  COUNTRIES,
  EXPERIENCE_DURATIONS,
  EXPERIENCE_LEVELS,
  EYE_COLORS,
  HAIR_COLORS,
  LANGUAGES,
  MAX_LANGUAGES,
  MEASUREMENT_LIMITS,
  MOBILITY_OPTIONS,
  PROJECT_TYPES,
  SHOE_SIZE_LIMITS,
  SHOE_SYSTEMS,
  TALENT_CATEGORIES,
  TEXT_LIMITS,
} from "./talentOptions.ts";

/**
 * Validation serveur — la seule qui fasse foi. Le formulaire valide aussi,
 * mais rien n'oblige un appel direct à l'API à passer par lui : chaque règle
 * ici est indépendante de ce que le navigateur a pu vérifier.
 *
 * Les erreurs ne portent que le nom du champ et un code de raison — jamais
 * la valeur reçue, pour qu'aucune donnée personnelle ne remonte dans une
 * réponse d'erreur ou un journal.
 */

export type ValidationReason =
  | "required"
  | "type"
  | "too_long"
  | "format"
  | "invalid"
  | "out_of_range"
  | "implausible"
  | "minors_not_accepted"
  | "too_many"
  | "duplicate";

export interface ValidationError {
  field: string;
  reason: ValidationReason;
}

export type ParseResult = { ok: true; value: ValidApplication } | { ok: false; errors: ValidationError[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const INSTAGRAM_RE = /^(@?[A-Za-z0-9._]{1,30}|https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?)$/;
const PHOTO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepte la virgule décimale (saisie FR) comme le point (saisie EN). */
export function parseDecimal(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const raw = value.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return undefined;
  return Number(raw);
}

export function computeAge(birthDateIso: string, today = new Date()): number | undefined {
  if (!DATE_RE.test(birthDateIso)) return undefined;
  const [year, month, day] = birthDateIso.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const birth = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC fait "rouler" un jour hors échelle (31 février -> mars) plutôt
  // que de renvoyer NaN : la date reconstruite doit correspondre exactement.
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return undefined;
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Retire espaces, points, tirets et parenthèses — la saisie humaine d'un numéro, pas sa valeur. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s.\-()]/g, "");
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function parseApplication(raw: unknown, minorsAllowed: boolean, today = new Date()): ParseResult {
  const errors: ValidationError[] = [];
  const fail = (field: string, reason: ValidationReason) => errors.push({ field, reason });

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: "body", reason: "type" }] };
  }
  const input = raw as Record<string, unknown>;

  /** Texte obligatoire : présent, de type chaîne, non vide après nettoyage, dans la limite. */
  const requiredText = (field: string, max: number): string => {
    const value = input[field];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      fail(field, "required");
      return "";
    }
    if (typeof value !== "string") {
      fail(field, "type");
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      fail(field, "too_long");
      return "";
    }
    return trimmed;
  };

  /** Texte facultatif : absent ou vide = null, sinon même contrôle de type et de longueur. */
  const optionalText = (field: string, max: number): string | null => {
    const value = input[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      fail(field, "type");
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (trimmed.length > max) {
      fail(field, "too_long");
      return null;
    }
    return trimmed;
  };

  const requiredChoice = <T extends string>(field: string, list: readonly T[]): T | undefined => {
    const value = input[field];
    if (value === undefined || value === null || value === "") {
      fail(field, "required");
      return undefined;
    }
    if (!includes(list, value)) {
      fail(field, typeof value === "string" ? "invalid" : "type");
      return undefined;
    }
    return value;
  };

  const optionalChoice = <T extends string>(field: string, list: readonly T[]): T | null => {
    const value = input[field];
    if (value === undefined || value === null || value === "") return null;
    if (!includes(list, value)) {
      fail(field, typeof value === "string" ? "invalid" : "type");
      return null;
    }
    return value;
  };

  /** Liste de codes : tableau de chaînes, toutes autorisées, sans doublon, dans la limite. */
  const choiceList = <T extends string>(field: string, list: readonly T[], max: number): T[] => {
    const value = input[field];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      fail(field, "type");
      return [];
    }
    if (value.length > max) {
      fail(field, "too_many");
      return [];
    }
    if (!value.every((item) => includes(list, item))) {
      fail(field, "invalid");
      return [];
    }
    if (new Set(value).size !== value.length) {
      fail(field, "duplicate");
      return [];
    }
    return value as T[];
  };

  const measurement = (field: keyof typeof MEASUREMENT_LIMITS): number | null => {
    const value = input[field];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(field, "type");
      return null;
    }
    const [min, max] = MEASUREMENT_LIMITS[field];
    if (value < min || value > max) {
      fail(field, "out_of_range");
      return null;
    }
    return Math.round(value * 10) / 10;
  };

  // --- 01 · Profil ---------------------------------------------------------

  const lang = input.lang === "en" ? "en" : input.lang === "fr" ? "fr" : undefined;
  if (!lang) fail("lang", input.lang === undefined ? "required" : "invalid");

  const firstName = requiredText("firstName", TEXT_LIMITS.name);
  const lastName = requiredText("lastName", TEXT_LIMITS.name);
  const city = requiredText("city", TEXT_LIMITS.city);
  const country = requiredChoice("country", COUNTRIES);

  let birthDate = "";
  let isMinor = false;
  if (typeof input.birthDate !== "string" || input.birthDate === "") {
    fail("birthDate", input.birthDate === undefined || input.birthDate === "" ? "required" : "type");
  } else {
    const age = computeAge(input.birthDate, today);
    if (age === undefined) fail("birthDate", "format");
    else if (age < 0 || age > 100) fail("birthDate", "implausible");
    else {
      isMinor = age < 18;
      // Le contrôle qui fait foi : l'âge est recalculé ici à partir de la
      // date reçue, quel que soit ce que le navigateur a affiché.
      if (isMinor && !minorsAllowed) fail("birthDate", "minors_not_accepted");
      else birthDate = input.birthDate;
    }
  }

  const email = requiredText("email", 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) fail("email", "format");

  const phoneRaw = requiredText("phone", 40);
  const phone = normalizePhone(phoneRaw);
  if (phoneRaw && !E164_RE.test(phone)) fail("phone", "format");

  // Représentant légal : exigé seulement si le parcours mineur est ouvert
  // dans Sanity (minorsAllowed) ET que la personne est mineure. Fermé par
  // défaut — un mineur est alors refusé plus haut, ces champs ignorés.
  let guardian: ValidApplication["guardian"] = null;
  if (isMinor && minorsAllowed) {
    const name = requiredText("legalGuardianName", TEXT_LIMITS.name);
    const guardianEmail = requiredText("legalGuardianEmail", 254).toLowerCase();
    if (guardianEmail && !EMAIL_RE.test(guardianEmail)) fail("legalGuardianEmail", "format");
    const guardianPhoneRaw = requiredText("legalGuardianPhone", 40);
    const guardianPhone = normalizePhone(guardianPhoneRaw);
    if (guardianPhoneRaw && !E164_RE.test(guardianPhone)) fail("legalGuardianPhone", "format");
    guardian = { name, email: guardianEmail, phone: guardianPhone };
  }

  // --- 02 · Profil professionnel --------------------------------------------

  const category = requiredChoice("category", TALENT_CATEGORIES);
  let categoryOther: string | null = null;
  if (category === "other") {
    // Réponse conditionnelle : « Autre » n'a de sens qu'avec sa précision.
    categoryOther = requiredText("categoryOther", TEXT_LIMITS.categoryOther) || null;
  }
  const experienceLevel = requiredChoice("experienceLevel", EXPERIENCE_LEVELS);
  const experienceDuration = requiredChoice("experienceDuration", EXPERIENCE_DURATIONS);

  let portfolioLinks: string[] = [];
  const linksValue = input.portfolioLinks;
  if (linksValue !== undefined && linksValue !== null) {
    if (!Array.isArray(linksValue) || !linksValue.every((l) => typeof l === "string")) {
      fail("portfolioLinks", "type");
    } else {
      const cleaned = linksValue.map((l) => l.trim()).filter(Boolean);
      if (cleaned.length > TEXT_LIMITS.portfolioLinksCount) fail("portfolioLinks", "too_many");
      else if (cleaned.some((l) => l.length > TEXT_LIMITS.portfolioLink)) fail("portfolioLinks", "too_long");
      else if (!cleaned.every(isHttpUrl)) fail("portfolioLinks", "format");
      else portfolioLinks = cleaned;
    }
  }

  const instagram = optionalText("instagram", TEXT_LIMITS.instagram);
  if (instagram && !INSTAGRAM_RE.test(instagram)) fail("instagram", "format");
  const currentAgency = optionalText("currentAgency", TEXT_LIMITS.agency);
  const exclusivity = optionalText("exclusivity", TEXT_LIMITS.exclusivity);

  // --- 03 · Mensurations — toutes facultatives, jamais éliminatoires --------

  const heightCm = measurement("heightCm");
  const chestCm = measurement("chestCm");
  const waistCm = measurement("waistCm");
  const hipsCm = measurement("hipsCm");
  const inseamCm = measurement("inseamCm");

  let shoeSize: number | null = null;
  const shoeValue = input.shoeSize;
  if (shoeValue !== undefined && shoeValue !== null && shoeValue !== "") {
    if (typeof shoeValue !== "number" || !Number.isFinite(shoeValue)) fail("shoeSize", "type");
    else if (shoeValue < SHOE_SIZE_LIMITS[0] || shoeValue > SHOE_SIZE_LIMITS[1] || (shoeValue * 2) % 1 !== 0) {
      fail("shoeSize", "out_of_range");
    } else shoeSize = shoeValue;
  }
  const shoeSystem = optionalChoice("shoeSystem", SHOE_SYSTEMS);
  if (shoeSize !== null && shoeSystem === null) fail("shoeSystem", "required");
  const clothingSize = optionalText("clothingSize", TEXT_LIMITS.clothingSize);
  const hairColor = optionalChoice("hairColor", HAIR_COLORS);
  const eyeColor = optionalChoice("eyeColor", EYE_COLORS);

  // --- 04 · Photos -----------------------------------------------------------
  // Forme seulement : l'existence réelle de chaque photo est vérifiée par
  // submit.ts, qui seul a accès au stockage.

  const photoIds: { role: PhotoRole; id: string }[] = [];
  const photosValue = input.photoIds;
  if (typeof photosValue !== "object" || photosValue === null || Array.isArray(photosValue)) {
    fail("photoIds", "type");
  } else {
    const photos = photosValue as Record<string, unknown>;
    for (const role of REQUIRED_PHOTO_ROLES) {
      const ids = photos[role];
      if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string" || !PHOTO_ID_RE.test(ids[0])) {
        fail(`photo.${role}`, "required");
      } else photoIds.push({ role, id: ids[0] });
    }
    const extra = photos.extra;
    if (extra !== undefined) {
      if (!Array.isArray(extra) || !extra.every((id) => typeof id === "string" && PHOTO_ID_RE.test(id))) {
        fail("photo.extra", "type");
      } else if (extra.length > MAX_EXTRA_PHOTOS) fail("photo.extra", "too_many");
      else for (const id of extra as string[]) photoIds.push({ role: "extra", id });
    }
    if (new Set(photoIds.map((p) => p.id)).size !== photoIds.length) fail("photoIds", "duplicate");
  }

  // --- 05 · Disponibilités et confirmation ----------------------------------

  const languages = choiceList("languages", LANGUAGES, MAX_LANGUAGES);
  const languagesOther = optionalText("languagesOther", TEXT_LIMITS.languagesOther);
  if (languages.length === 0 && !languagesOther && !errors.some((e) => e.field === "languages")) {
    fail("languages", "required");
  }
  const mobility = requiredChoice("mobility", MOBILITY_OPTIONS);
  const desiredProjects = choiceList("desiredProjects", PROJECT_TYPES, PROJECT_TYPES.length);
  const motivation = optionalText("motivation", TEXT_LIMITS.motivation);

  if (input.accuracyConfirmed !== true) fail("accuracyConfirmed", "required");
  if (input.privacyNoticeAccepted !== true) fail("privacyNoticeAccepted", "required");
  const privacyNoticeVersion = requiredText("privacyNoticeVersion", 40);

  if (errors.length > 0 || !lang || !country || !category || !experienceLevel || !experienceDuration || !mobility) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      lang,
      firstName,
      lastName,
      birthDate,
      isMinor,
      city,
      country,
      email,
      phone,
      guardian,
      category,
      categoryOther,
      experienceLevel,
      experienceDuration,
      portfolioLinks,
      instagram,
      currentAgency,
      exclusivity,
      heightCm,
      chestCm,
      waistCm,
      hipsCm,
      inseamCm,
      shoeSize,
      shoeSystem,
      clothingSize,
      hairColor,
      eyeColor,
      photoIds,
      languages,
      languagesOther,
      mobility,
      desiredProjects,
      motivation,
      privacyNoticeVersion,
    },
  };
}
