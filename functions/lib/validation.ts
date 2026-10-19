import { EXPERIENCE_LEVELS, MAX_EXTRA_PHOTOS, REQUIRED_PHOTO_ROLES, type ApplicationPayload } from "./applicationTypes.ts";

/**
 * Validation serveur complète — le formulaire valide déjà côté client,
 * mais rien n'y oblige un appel direct à cette API. Chaque règle ici est
 * indépendante de ce que l'interface a pu vérifier ou non.
 */

export interface ValidationError {
  field: string;
  reason: string;
}

const MAX_SHORT = 200;
const MAX_LONG = 4000;

function isNonEmptyString(value: unknown, max = MAX_SHORT): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isOptionalString(value: unknown, max = MAX_SHORT): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length <= max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[+()0-9\s.-]{6,30}$/;

/** Accepte la virgule décimale (saisie FR) comme le point (saisie EN) — jamais les deux formats simultanément sur un même nombre. */
export function parseDecimal(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function computeAge(birthDateIso: string, today = new Date()): number | undefined {
  if (!DATE_RE.test(birthDateIso)) return undefined;
  const [year, month, day] = birthDateIso.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const birth = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC fait "rouler" un jour hors échelle (ex. 31 février) vers le
  // mois suivant plutôt que de renvoyer NaN — on vérifie donc que la date
  // reconstruite correspond toujours exactement à ce qui a été saisi.
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return undefined;
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthdayThisYear =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

export function validateApplication(payload: ApplicationPayload, minorsAllowed: boolean): ValidationError[] {
  const errors: ValidationError[] = [];
  const req = (field: keyof ApplicationPayload, max = MAX_SHORT) => {
    if (!isNonEmptyString(payload[field], max)) errors.push({ field, reason: "required" });
  };
  const opt = (field: keyof ApplicationPayload, max = MAX_SHORT) => {
    if (!isOptionalString(payload[field], max)) errors.push({ field, reason: "too_long" });
  };

  // 01 — Profil
  req("firstName");
  req("lastName");
  req("city");
  req("country");
  opt("instagram");
  opt("languages", MAX_SHORT);

  if (!DATE_RE.test(payload.birthDate ?? "")) errors.push({ field: "birthDate", reason: "format" });
  else {
    const age = computeAge(payload.birthDate);
    if (age === undefined || age < 0 || age > 100) errors.push({ field: "birthDate", reason: "implausible" });
    else if (age < 18 && !minorsAllowed) errors.push({ field: "birthDate", reason: "minors_not_accepted" });
  }

  if (!isNonEmptyString(payload.email) || !EMAIL_RE.test(payload.email) || payload.email.length > 254) {
    errors.push({ field: "email", reason: "format" });
  }
  if (!isNonEmptyString(payload.phone) || !PHONE_RE.test(payload.phone)) {
    errors.push({ field: "phone", reason: "format" });
  }

  // 02 — Mensurations : tout facultatif, jamais de seuil éliminatoire. On
  // valide seulement que ce qui a été saisi est un nombre plausible, pas
  // qu'il se situe dans une fourchette "acceptable".
  for (const [field, value] of [
    ["heightCm", payload.heightCm],
    ["chestCm", payload.chestCm],
    ["waistCm", payload.waistCm],
    ["hipsCm", payload.hipsCm],
    ["inseamCm", payload.inseamCm],
  ] as const) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 300)) {
      errors.push({ field, reason: "implausible" });
    }
  }
  opt("shoeSize", 20);
  opt("shoeSystem", 20);
  opt("clothingSize", 20);
  opt("hairColor", 50);
  opt("eyeColor", 50);

  // 03 — Expérience
  if (!EXPERIENCE_LEVELS.includes(payload.experienceLevel)) errors.push({ field: "experienceLevel", reason: "invalid" });
  opt("pastMissions", MAX_LONG);
  opt("currentAgency");
  opt("exclusivity", MAX_LONG);
  opt("portfolioLinks", MAX_LONG);
  opt("skills", MAX_LONG);
  opt("training", MAX_LONG);
  if (payload.projects !== undefined) {
    if (!Array.isArray(payload.projects) || payload.projects.length > 3) {
      errors.push({ field: "projects", reason: "too_many" });
    } else {
      for (const project of payload.projects) {
        if (
          typeof project !== "object" ||
          project === null ||
          !isOptionalString(project.name, MAX_SHORT) ||
          !isOptionalString(project.role, MAX_SHORT) ||
          !isOptionalString(project.year, 10)
        ) {
          errors.push({ field: "projects", reason: "invalid_entry" });
          break;
        }
      }
    }
  }

  // 04 — Photos : 3 rôles obligatoires, chacun un seul photoId ; jusqu'à 3
  // photos complémentaires. L'existence réelle des photoId référencés est
  // vérifiée par submit.ts (accès KV), pas ici.
  for (const role of REQUIRED_PHOTO_ROLES) {
    const ids = payload.photoIds?.[role];
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") {
      errors.push({ field: `photo.${role}`, reason: "required" });
    }
  }
  const extra = payload.photoIds?.extra;
  if (extra !== undefined && (!Array.isArray(extra) || extra.length > MAX_EXTRA_PHOTOS)) {
    errors.push({ field: "photo.extra", reason: "too_many" });
  }

  // Disponibilités
  opt("availability", MAX_LONG);
  opt("mobility", MAX_LONG);
  opt("desiredProjects", MAX_LONG);
  opt("motivation", MAX_LONG);

  // 05 — Vérification
  if (payload.accuracyConfirmed !== true) errors.push({ field: "accuracyConfirmed", reason: "required" });
  if (payload.privacyNoticeAccepted !== true) errors.push({ field: "privacyNoticeAccepted", reason: "required" });
  if (!isNonEmptyString(payload.privacyNoticeVersion, 40)) errors.push({ field: "privacyNoticeVersion", reason: "required" });

  return errors;
}
