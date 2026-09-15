import { fetchManualUrl } from "../ingestion/url.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { normalizeDateString } from "../validation/claimRegistry.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import { eventIdentity } from "./store.ts";
import { computeStatus, ESSENTIAL_FIELDS, type AgendaEvent, type EventVerification, type SourceRank } from "./types.ts";
import { WEBLACK_TERRITORIES, type WeblackTerritory } from "../generation/types.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isEvent: { type: "boolean" },
    eventName: { type: "string" },
    eventType: { type: "string" },
    discipline: { type: "string" },
    disciplineEn: { type: "string" },
    artistOrCreator: { type: "string" },
    institution: { type: "string" },
    startDate: { type: "string" },
    endDate: { type: "string" },
    time: { type: "string" },
    venue: { type: "string" },
    city: { type: "string" },
    country: { type: "string" },
    countryEn: { type: "string" },
    organizer: { type: "string" },
    cancelled: { type: "boolean" },
    territory: { type: "string", enum: [...WEBLACK_TERRITORIES] },
    editorialValue: { type: "string" },
    descriptionFr: { type: "string" },
    descriptionEn: { type: "string" },
    editorialRelevance: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: [
    "isEvent", "eventName", "eventType", "discipline", "artistOrCreator", "institution",
    "startDate", "endDate", "time", "venue", "city", "country", "organizer", "cancelled", "disciplineEn", "countryEn",
    "territory", "editorialValue", "descriptionFr", "descriptionEn", "editorialRelevance",
  ],
};

const SYSTEM_PROMPT = `Tu lis le texte RÉEL d'une page web et tu en extrais un éventuel événement culturel, artistique ou créatif.

Interdiction absolue : ne rien écrire qui ne soit pas dans le texte fourni. Aucune date déduite, aucun lieu supposé, aucun organisateur ajouté depuis tes connaissances. Un champ que la page ne donne pas reste une chaîne vide — c'est un résultat normal et attendu.

- "isEvent" : false si la page n'annonce pas un événement précis (page d'accueil, liste, article d'actualité sans événement identifiable).
- "startDate"/"endDate" : au format AAAA-MM-JJ si la page permet de les écrire ainsi, sinon la date telle qu'écrite. Vide si absente.
- "cancelled" : true seulement si la page dit explicitement que l'événement est annulé ou reporté.
- "country" / "countryEn" : le pays, en français pour le premier et en anglais pour le second — « Allemagne » / « Germany ». Vides si la page ne permet pas de l'établir.
- "discipline" / "disciplineEn" : la discipline, en français pour la première et en anglais pour la seconde — « photographie » / « photography », « art contemporain » / « contemporary art ». Un même libellé doit toujours être écrit de la même façon, en minuscules, pour que deux événements de la même discipline se retrouvent ensemble.

Le Journal WEBLACK est un média international de mode, luxe, art, culture, design et industries créatives. Ce n'est pas un guide des sorties.

- "territory" : lequel de ces territoires l'événement occupe réellement — FASHION_LUXURY, ART_CULTURE, DESIGN_ARCHITECTURE, CREATIVE_INDUSTRIES, TALENTS, CULTURAL_CREATIVE_BUSINESS, CULTURAL_SCENES_EVENTS, CULTURAL_AGENDA. S'il n'entre franchement dans aucun, réponds OUT_OF_TERRITORY.

Cela ne se juge pas aux mots-clés mais à ce que l'événement est :
- Une exposition dans un musée ou une galerie → ART_CULTURE, recevable.
- Un défilé, une présentation de créateur, une semaine de la mode → FASHION_LUXURY, recevable.
- Une biennale, une foire d'art, un festival de design → CULTURAL_SCENES_EVENTS, recevable.
- Un cours de danse, un atelier de percussions pour débutants, une initiation au DJing, une visite guidée de loisir → OUT_OF_TERRITORY. L'activité de loisir n'est pas un rendez-vous de création, même dans un lieu culturel.
- Un salon professionnel sans dimension créative (ascenseurs, bâtiment, agroalimentaire) → OUT_OF_TERRITORY.
- Un marché, une brocante, une fête de quartier → OUT_OF_TERRITORY.

- "editorialValue" : en une phrase, ce qui justifie que WEBLACK annonce cet événement — l'artiste, l'institution, la manifestation, ce qui s'y joue. Chaîne vide si rien ne le justifie, ce qui est une réponse acceptable.
- "descriptionFr" / "descriptionEn" : une ou deux phrases décrivant l'événement, tirées de ce que dit la page — ce qui est montré, par qui, dans quel cadre. N'y fais figurer aucune information absente de la page. Si la page ne décrit rien, laisse les deux vides. Écris la version française en français et la version anglaise en anglais, même si la page est dans une autre langue : traduire ce que la page dit n'est pas inventer, ajouter ce qu'elle ne dit pas l'est.
- "editorialRelevance" (0-100) : intérêt pour ce média. Un événement local peut être élevé s'il a une vraie valeur artistique ou une portée professionnelle ; une activité de loisir ou un événement commercial sans dimension créative est bas.`;

interface ExtractedEvent {
  isEvent: boolean;
  eventName: string;
  eventType: string;
  discipline: string;
  disciplineEn: string;
  artistOrCreator: string;
  institution: string;
  startDate: string;
  endDate: string;
  time: string;
  venue: string;
  city: string;
  country: string;
  countryEn: string;
  organizer: string;
  cancelled: boolean;
  territory: WeblackTerritory;
  editorialValue: string;
  descriptionFr: string;
  descriptionEn: string;
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
  } else if (isSiteRoot(url)) {
    // Une page d'accueil peut annoncer un événement aujourd'hui et tout
    // autre chose demain. Elle ne peut donc pas servir de page de
    // référence : la re-vérification n'y retrouverait plus rien, et le
    // lecteur à qui on la donne ne verrait pas l'événement annoncé.
    verificationStatus = "REVIEW";
    note = "L'événement n'a été lu que sur une page d'accueil, qui ne peut pas faire foi : page de l'événement à retrouver.";
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
    disciplineEn: extracted.disciplineEn.trim(),
    artistOrCreator: extracted.artistOrCreator.trim(),
    institution: extracted.institution.trim(),
    startDate,
    endDate,
    time: extracted.time.trim(),
    venue: extracted.venue.trim(),
    city: extracted.city.trim(),
    country: extracted.country.trim(),
    countryEn: extracted.countryEn.trim(),
    organizer: extracted.organizer.trim(),
    officialUrl: url,
    sourceUrls: [url],
    sourceRank: rankSource(url, extracted),
    verificationStatus,
    verifiedFields,
    missingFields: [...missingFields],
    // Tout ce qui est confirmé ici vient de cette page ; une résolution
    // complémentaire réécrira ensuite l'entrée du champ qu'elle comble.
    fieldSources: Object.fromEntries(verifiedFields.map((field) => [field, url])),
    note,
    lastVerifiedAt: new Date().toISOString(),
    status: computeStatus(startDate, endDate),
    territory: extracted.territory,
    editorialValue: extracted.editorialValue.trim(),
    descriptionFr: extracted.descriptionFr.trim(),
    descriptionEn: extracted.descriptionEn.trim(),
    territoryHistory: [extracted.territory],
    editorialRelevance: extracted.editorialRelevance,
  };

  return event;
}

/** Racine d'un site : "/", "/fr", "/en/"… Rien d'assez spécifique pour rester vrai demain. */
function isSiteRoot(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path === "" || /^\/[a-z]{2}(-[a-z]{2})?$/i.test(path);
  } catch {
    return false;
  }
}

/** Re-lit une page déjà connue : c'est ainsi qu'une annulation, un report ou une disparition sont rattrapés. */
export async function revalidateEvent(event: AgendaEvent, runId: string): Promise<AgendaEvent> {
  const fresh = await verifyEventPage(event.officialUrl, runId);
  if (!fresh) {
    return { ...event, verificationStatus: "GONE", note: "La page n'est plus lisible.", lastVerifiedAt: new Date().toISOString() };
  }
  return settleTerritory(event, {
    ...fresh,
    id: event.id,
    sourceUrls: [...new Set([...event.sourceUrls, ...fresh.sourceUrls])],
  });
}

/**
 * Tranche le territoire d'un événement relu — ou constate qu'il ne se
 * tranche pas.
 *
 * Un cas limite ne se reconnaît pas à son sujet mais à son instabilité :
 * relu, il change de camp. C'est arrivé sur un atelier berlinois, classé
 * hors territoire à une lecture et industries créatives à la suivante. Tant
 * que la réponse varie, la bonne décision n'est ni l'une ni l'autre : elle
 * est de ne pas publier et de laisser un humain trancher.
 *
 * Une lecture qui confirme la précédente, en revanche, ne déclenche rien —
 * la stabilité est le cas normal, pas une exception.
 */
export function settleTerritory(previous: AgendaEvent, fresh: AgendaEvent): AgendaEvent {
  const history = [...new Set([...(previous.territoryHistory ?? [previous.territory]), fresh.territory])].filter(Boolean);
  const settled = { ...fresh, territoryHistory: history };
  if (history.length <= 1) return settled;

  return {
    ...settled,
    verificationStatus: "REVIEW",
    note: `Pertinence ambiguë : l'événement a été rattaché tour à tour à ${history.join(" puis ")}. Territoire à trancher.`,
  };
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
 * Les libellés de mois, dans les langues où les pages d'agenda sont
 * écrites. Accents retirés : la comparaison se fait sur du texte
 * normalisé. Les abréviations qui sont aussi des mots courants (set, out,
 * ago) sont volontairement absentes — elles confirmeraient des dates que
 * la page ne porte pas.
 */
const MONTH_FORMS: string[][] = [
  ["janvier", "january", "januar", "januari", "enero", "gennaio", "janeiro", "jan"],
  ["fevrier", "february", "februar", "februari", "febrero", "febbraio", "fevereiro", "feb", "fev"],
  ["mars", "march", "marz", "maart", "marzo", "marco", "mar"],
  ["avril", "april", "abril", "aprile", "apr", "avr"],
  ["mai", "may", "mei", "mayo", "maggio", "maio"],
  ["juin", "june", "juni", "junio", "giugno", "junho", "jun"],
  ["juillet", "july", "juli", "julio", "luglio", "julho", "jul"],
  ["aout", "august", "augustus", "agosto", "aug"],
  ["septembre", "september", "septiembre", "settembre", "setembro", "sept", "sep"],
  ["octobre", "october", "oktober", "octubre", "ottobre", "outubro", "oct", "okt"],
  ["novembre", "november", "noviembre", "novembro", "nov"],
  ["decembre", "december", "dezember", "diciembre", "dicembre", "dezembro", "dec", "dez", "dic"],
];

/**
 * Une date est confirmée si la page porte ses composants — le jour, le
 * mois et l'année — sous une forme ou une autre.
 *
 * Les pages d'agenda ne sont pas écrites en français : Berlin annonce
 * « 13. September 2026 », Londres « 13 September 2026 », Anvers
 * « 13 september », et beaucoup de sites s'en tiennent à 13/09/2026. Ne
 * reconnaître que les mois français faisait échouer la confirmation sur
 * des dates pourtant correctement lues : l'événement partait en UNVERIFIED
 * alors que sa page officielle le portait noir sur blanc.
 *
 * L'exigence ne bouge pas pour autant : le jour et l'année doivent se
 * retrouver dans le texte, et le mois sous un libellé qui désigne bien ce
 * mois-là. On élargit les formes acceptées, pas le niveau de preuve.
 */
export function dateAppears(iso: string, pageText: string): boolean {
  if (!iso) return false;
  const haystack = normalize(pageText);
  if (haystack.includes(normalize(iso))) return true;

  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  // L'année reste exigible dans tous les cas : « 13 septembre » seul ne dit
  // pas de quelle année il s'agit.
  if (!haystack.includes(year!)) return false;

  const d = String(Number(day));
  const m = String(Number(month));

  // 13/09/2026, 13.9.2026, 09-13-2026 (usage américain), 2026-09-13.
  const numeric = new RegExp(
    `(?:^|[^0-9])(?:0?${d}[./-]0?${m}|0?${m}[./-]0?${d})[./-]${year}(?:[^0-9]|$)` +
      `|(?:^|[^0-9])${year}[./-]0?${m}[./-]0?${d}(?:[^0-9]|$)`,
  );
  if (numeric.test(haystack)) return true;

  // 13 septembre, 13. September, 13 de septiembre, September 13.
  const forms = (MONTH_FORMS[Number(month) - 1] ?? []).join("|");
  if (!forms) return false;
  const literal = new RegExp(
    `(?:^|[^0-9])0?${d}(?:er|st|nd|rd|th)?\\.?\\s*(?:de\\s+|of\\s+)?(?:${forms})\\b` +
      `|(?:${forms})\\b\\.?\\s*0?${d}(?:er|st|nd|rd|th)?(?:[^0-9]|$)`,
  );
  return literal.test(haystack);
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
