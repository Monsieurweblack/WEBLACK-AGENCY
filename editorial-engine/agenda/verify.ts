import { fetchManualUrl } from "../ingestion/url.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { normalizeDateString } from "../validation/claimRegistry.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import { eventIdentity } from "./store.ts";
import { computeStatus, ESSENTIAL_FIELDS, type AgendaEvent, type EventVerification, type SourceRank } from "./types.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isEvent: { type: "boolean" },
    eventName: { type: "string" },
    eventType: { type: "string" },
    discipline: { type: "string" },
    artistOrCreator: { type: "string" },
    institution: { type: "string" },
    startDate: { type: "string" },
    endDate: { type: "string" },
    time: { type: "string" },
    venue: { type: "string" },
    city: { type: "string" },
    country: { type: "string" },
    organizer: { type: "string" },
    cancelled: { type: "boolean" },
    editorialRelevance: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: [
    "isEvent", "eventName", "eventType", "discipline", "artistOrCreator", "institution",
    "startDate", "endDate", "time", "venue", "city", "country", "organizer", "cancelled", "editorialRelevance",
  ],
};

const SYSTEM_PROMPT = `Tu lis le texte RÉEL d'une page web et tu en extrais un éventuel événement culturel, artistique ou créatif.

Interdiction absolue : ne rien écrire qui ne soit pas dans le texte fourni. Aucune date déduite, aucun lieu supposé, aucun organisateur ajouté depuis tes connaissances. Un champ que la page ne donne pas reste une chaîne vide — c'est un résultat normal et attendu.

- "isEvent" : false si la page n'annonce pas un événement précis (page d'accueil, liste, article d'actualité sans événement identifiable).
- "startDate"/"endDate" : au format AAAA-MM-JJ si la page permet de les écrire ainsi, sinon la date telle qu'écrite. Vide si absente.
- "cancelled" : true seulement si la page dit explicitement que l'événement est annulé ou reporté.
- "editorialRelevance" (0-100) : intérêt pour un média de mode, luxe, art, culture, design et industries créatives. Un événement local peut être élevé s'il a une vraie valeur artistique ou une portée professionnelle ; un événement commercial sans dimension créative est bas.`;

interface ExtractedEvent {
  isEvent: boolean;
  eventName: string;
  eventType: string;
  discipline: string;
  artistOrCreator: string;
  institution: string;
  startDate: string;
  endDate: string;
  time: string;
  venue: string;
  city: string;
  country: string;
  organizer: string;
  cancelled: boolean;
  editorialRelevance: number;
}

/**
 * Lit une page réellement, en extrait l'événement, puis CONFIRME dans le
 * texte ce qui a été extrait.
 *
 * La confirmation est le point entier de ce module. L'extraction reste une
 * opération de modèle, donc faillible ; la vérification qui suit ne l'est
 * pas : le nom et les dates doivent se retrouver dans le texte téléchargé,
 * sans quoi l'événement n'est pas retenu. C'est la même discipline que le
 * reste du moteur — le modèle propose, le code vérifie contre la source.
 */
export async function verifyEventPage(url: string, runId: string): Promise<AgendaEvent | undefined> {
  const config = loadConfig();
  let page: Awaited<ReturnType<typeof fetchManualUrl>>;
  try {
    page = await fetchManualUrl(url);
  } catch {
    // Page disparue, protégée ou vide : rien à vérifier, donc rien à retenir.
    log("FETCH", `Agenda — page illisible, ignorée : ${url}`);
    return undefined;
  }

  const pageText = `${page.title}\n${page.text ?? page.excerpt ?? ""}`;
  if (pageText.trim().length < 120) return undefined;

  const extracted = await structuredCompletion<ExtractedEvent>({
    system: SYSTEM_PROMPT,
    user: `URL: ${url}\n\nTexte de la page :\n${pageText.slice(0, 12_000)}`,
    schemaName: "agenda_event",
    schema: SCHEMA,
    model: config.modelFactcheck,
    step: "fact-extraction",
    runId,
    sourceUrl: url,
  });

  if (!extracted.isEvent || !extracted.eventName.trim()) return undefined;

  const startDate = normalizeIso(extracted.startDate);
  const endDate = normalizeIso(extracted.endDate);

  const verifiedFields = confirmAgainstPage(extracted, pageText, startDate, endDate);
  const missingFields = ESSENTIAL_FIELDS.filter((field) => {
    const value = field === "startDate" ? startDate : (extracted[field] ?? "");
    return value.trim() === "";
  });

  let verificationStatus: EventVerification = "VERIFIED";
  let note = "";

  if (extracted.cancelled) {
    verificationStatus = "CANCELLED";
    note = "La page indique explicitement une annulation ou un report.";
  } else if (missingFields.length > 0) {
    // Aucune donnée essentielle absente n'est comblée par inférence.
    verificationStatus = "REVIEW";
    note = `Donnée(s) essentielle(s) absente(s) de la page : ${missingFields.join(", ")}.`;
  } else if (!verifiedFields.includes("eventName")) {
    verificationStatus = "UNVERIFIED";
    note = "Le nom extrait ne se retrouve pas dans le texte de la page.";
  } else if (startDate && !verifiedFields.includes("startDate")) {
    verificationStatus = "UNVERIFIED";
    note = "La date de début ne se retrouve pas dans le texte de la page.";
  }

  const event: AgendaEvent = {
    id: eventIdentity({ eventName: extracted.eventName, venue: extracted.venue, city: extracted.city, startDate }),
    eventName: extracted.eventName.trim(),
    eventType: extracted.eventType.trim(),
    discipline: extracted.discipline.trim(),
    artistOrCreator: extracted.artistOrCreator.trim(),
    institution: extracted.institution.trim(),
    startDate,
    endDate,
    time: extracted.time.trim(),
    venue: extracted.venue.trim(),
    city: extracted.city.trim(),
    country: extracted.country.trim(),
    organizer: extracted.organizer.trim(),
    officialUrl: url,
    sourceUrls: [url],
    sourceRank: rankSource(url, extracted),
    verificationStatus,
    verifiedFields,
    missingFields: [...missingFields],
    note,
    lastVerifiedAt: new Date().toISOString(),
    status: computeStatus(startDate, endDate),
    editorialRelevance: extracted.editorialRelevance,
  };

  return event;
}

/** Re-lit une page déjà connue : c'est ainsi qu'une annulation, un report ou une disparition sont rattrapés. */
export async function revalidateEvent(event: AgendaEvent, runId: string): Promise<AgendaEvent> {
  const fresh = await verifyEventPage(event.officialUrl, runId);
  if (!fresh) {
    return { ...event, verificationStatus: "GONE", note: "La page n'est plus lisible.", lastVerifiedAt: new Date().toISOString() };
  }
  return { ...fresh, id: event.id, sourceUrls: [...new Set([...event.sourceUrls, ...fresh.sourceUrls])] };
}

/** ISO court quand c'est possible, valeur d'origine sinon — on ne fabrique pas une date qu'on n'a pas su lire. */
function normalizeIso(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const normalized = normalizeDateString(trimmed);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : trimmed;
}

/** Ce qui se retrouve réellement dans le texte téléchargé. Le reste n'est pas vérifié, quoi qu'en dise l'extraction. */
function confirmAgainstPage(extracted: ExtractedEvent, pageText: string, startDate: string, endDate: string): string[] {
  const haystack = normalize(pageText);
  const confirmed: string[] = [];

  const present = (value: string) => value.trim().length > 2 && haystack.includes(normalize(value));
  if (present(extracted.eventName)) confirmed.push("eventName");
  if (present(extracted.venue)) confirmed.push("venue");
  if (present(extracted.city)) confirmed.push("city");
  if (present(extracted.artistOrCreator)) confirmed.push("artistOrCreator");
  if (present(extracted.institution)) confirmed.push("institution");
  if (present(extracted.organizer)) confirmed.push("organizer");
  if (present(extracted.time)) confirmed.push("time");
  if (dateAppears(startDate, pageText)) confirmed.push("startDate");
  if (dateAppears(endDate, pageText)) confirmed.push("endDate");

  return confirmed;
}

/**
 * Une date est confirmée si la page porte ses composants — le jour et
 * l'année — sous une forme ou une autre. La page écrit « 10 septembre
 * 2026 » quand l'extraction a produit « 2026-09-10 » : comparer les
 * chaînes telles quelles ne prouverait rien.
 */
function dateAppears(iso: string, pageText: string): boolean {
  if (!iso) return false;
  const haystack = normalize(pageText);
  if (haystack.includes(normalize(iso))) return true;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return haystack.includes(normalize(iso));
  const [, year, month, day] = match;
  const dayNoPad = String(Number(day));
  const months = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
  const monthName = months[Number(month) - 1] ?? "";
  return haystack.includes(`${dayNoPad} ${monthName}`) && haystack.includes(year!);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Le rang se déduit de la page lue, pas d'une liste de médias tenue à la
 * main : si le domaine porte le nom du lieu ou de l'institution annoncés,
 * la page est celle de l'organisateur lui-même.
 */
export function rankSource(url: string, extracted: Pick<ExtractedEvent, "venue" | "institution" | "organizer" | "artistOrCreator">): SourceRank {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "SECONDARY";
  }
  const hostWords = host.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]+/g, "");
  const matches = (value: string) => {
    const compact = normalize(value).replace(/[^a-z0-9]+/g, "");
    return compact.length >= 5 && (hostWords.includes(compact) || compact.includes(hostWords));
  };

  if (matches(extracted.institution) || matches(extracted.venue)) return "OFFICIAL";
  if (matches(extracted.organizer)) return "ORGANIZER";
  if (matches(extracted.artistOrCreator)) return "ARTIST_BRAND";
  if (/\.(museum|gouv\.[a-z]+|gov|edu)$/.test(host)) return "INSTITUTION";
  return "MEDIA";
}
