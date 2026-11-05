/**
 * Validation serveur d'une demande commerciale. Seule source de vérité :
 * le navigateur contrôle aussi, mais tout ce qui arrive ici est relu.
 */
import { COUNTRIES } from "./talentOptions.ts";
import {
  BUDGETS,
  ENTRY_POINTS,
  INQUIRY_LIMITS,
  TIMELINES,
  isDivision,
  isServiceOf,
  type Division,
} from "./inquiryOptions.ts";

export type InquiryErrorReason = "required" | "invalid" | "too_long" | "too_short";
export interface InquiryError {
  field: string;
  reason: InquiryErrorReason;
}

export interface ValidInquiry {
  submissionId: string | null;
  lang: "fr" | "en";
  division: Division;
  service: string;
  fullName: string;
  email: string;
  organisation: string | null;
  country: string;
  description: string;
  timeline: string | null;
  budget: string | null;
  channel: string;
  entryPoint: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export type InquiryParseResult = { ok: true; value: ValidInquiry } | { ok: false; errors: InquiryError[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Canal / campagne : un libellé technique court, jamais du texte libre (ni adresse, ni nom). */
const TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const COUNTRY_SET = new Set<string>(COUNTRIES);

/** Retire les caractères de contrôle (sauf saut de ligne et tabulation dans les textes longs). */
function clean(value: unknown, multiline = false): string {
  if (typeof value !== "string") return "";
  const stripped = multiline
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    : value.replace(/[\u0000-\u001F\u007F]/g, " ");
  return stripped.normalize("NFC").trim();
}

function token(value: unknown): string | null {
  const v = clean(value).toLowerCase().slice(0, INQUIRY_LIMITS.channel);
  return TOKEN_RE.test(v) ? v : null;
}

export function parseInquiry(raw: unknown): InquiryParseResult {
  const errors: InquiryError[] = [];
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fail = (field: string, reason: InquiryErrorReason) => errors.push({ field, reason });

  const submissionId = typeof body.submissionId === "string" && UUID_RE.test(body.submissionId) ? body.submissionId : null;
  const lang = body.lang === "en" ? "en" : "fr";

  const division = body.division;
  if (!isDivision(division)) fail("division", division ? "invalid" : "required");

  const service = clean(body.service);
  if (isDivision(division)) {
    if (!service) fail("service", "required");
    else if (!isServiceOf(division, service)) fail("service", "invalid");
  }

  const fullName = clean(body.fullName);
  if (!fullName) fail("fullName", "required");
  else if (fullName.length > INQUIRY_LIMITS.name) fail("fullName", "too_long");

  const email = clean(body.email).toLowerCase();
  if (!email) fail("email", "required");
  else if (email.length > INQUIRY_LIMITS.email || !EMAIL_RE.test(email)) fail("email", "invalid");

  const organisation = clean(body.organisation);
  if (organisation.length > INQUIRY_LIMITS.organisation) fail("organisation", "too_long");

  const country = clean(body.country).toUpperCase();
  if (!country) fail("country", "required");
  else if (!COUNTRY_SET.has(country)) fail("country", "invalid");

  const description = clean(body.description, true);
  if (!description) fail("description", "required");
  else if (description.length < INQUIRY_LIMITS.descriptionMin) fail("description", "too_short");
  else if (description.length > INQUIRY_LIMITS.description) fail("description", "too_long");

  const timeline = clean(body.timeline);
  if (timeline && !(TIMELINES as readonly string[]).includes(timeline)) fail("timeline", "invalid");

  const budget = clean(body.budget);
  if (budget && !(BUDGETS as readonly string[]).includes(budget)) fail("budget", "invalid");

  // Origine : jamais une raison de refuser une demande — une valeur
  // inattendue est simplement ramenée à une forme sûre.
  const channel = token(body.channel) ?? "direct";
  const entry = clean(body.entryPoint).toLowerCase();
  const entryPoint = entry ? ((ENTRY_POINTS as readonly string[]).includes(entry) ? entry : "other") : null;

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      submissionId,
      lang,
      division: division as Division,
      service,
      fullName,
      email,
      organisation: organisation || null,
      country,
      description,
      timeline: timeline || null,
      budget: budget || null,
      channel,
      entryPoint,
      utmMedium: token(body.utmMedium),
      utmCampaign: token(body.utmCampaign),
    },
  };
}
