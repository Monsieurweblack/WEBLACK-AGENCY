import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENGINE_ROOT } from "../config/env.ts";
import { computeStatus, type AgendaEvent } from "./types.ts";
import { cityPriorityHint, timezoneForCity } from "./geography.ts";

const STORE_FILE = path.join(ENGINE_ROOT, "logs", "agenda-events.jsonl");

/**
 * Complète les champs introduits après coup (geographicPriority, timezone,
 * controlMode, geographicJustification) pour une ligne du journal écrite
 * avant leur existence — le journal est append-only, il contient
 * nécessairement de telles lignes.
 *
 * Même prudence que le backfill Sanity (voir backfill-geography.mjs) : la
 * géographie de la ville est un fait déjà vérifié, AFRICA s'en déduit donc
 * mécaniquement ; AFRO_DIASPORA exige une justification écrite qu'une
 * entrée ancienne n'a jamais portée, elle retombe donc sur INTERNATIONAL
 * plutôt que d'être supposée.
 */
export function normalizeLegacyEvent(raw: AgendaEvent): AgendaEvent {
  if (raw.geographicPriority && raw.timezone !== undefined && raw.controlMode) return raw;
  return {
    ...raw,
    geographicPriority: raw.geographicPriority ?? (cityPriorityHint(raw.city) === "AFRICA" ? "AFRICA" : "INTERNATIONAL"),
    geographicJustification: raw.geographicJustification ?? "",
    timezone: raw.timezone ?? timezoneForCity(raw.city),
    controlMode: raw.controlMode ?? "AUTOMATED",
  };
}

/**
 * Identité d'un événement, indépendante de qui l'annonce.
 *
 * Une même exposition reprise par cinq médias doit produire une seule
 * entrée : la clé ne retient donc que ce qui appartient à l'événement —
 * son nom, son lieu, sa date de début — normalisés. L'URL n'entre pas dans
 * la clé, justement parce qu'elle change d'une reprise à l'autre.
 */
export function eventIdentity(event: Pick<AgendaEvent, "eventName" | "venue" | "city" | "startDate">): string {
  const norm = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const key = [norm(event.eventName), norm(event.venue || event.city), event.startDate].join("|");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Append-only, comme le reste des journaux du moteur : une ligne par état, la dernière fait foi. */
export function saveEvent(event: AgendaEvent): void {
  fs.appendFileSync(STORE_FILE, JSON.stringify(event) + "\n", "utf8");
}

export function readAllEntries(): AgendaEvent[] {
  if (!fs.existsSync(STORE_FILE)) return [];
  return fs
    .readFileSync(STORE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => normalizeLegacyEvent(JSON.parse(line) as AgendaEvent));
}

/** L'état courant de chaque événement, une fois les réécritures appliquées. */
export function currentEvents(): AgendaEvent[] {
  const byId = new Map<string, AgendaEvent>();
  for (const entry of readAllEntries()) byId.set(entry.id, entry);
  return [...byId.values()];
}

export function findEvent(id: string): AgendaEvent | undefined {
  return currentEvents().find((e) => e.id === id);
}

/**
 * Fusionne un candidat avec ce qui est déjà connu.
 *
 * Deux règles de fond. D'abord, une source mieux placée l'emporte sur une
 * source moins bien placée : une reprise média ne doit pas écraser les
 * dates lues sur la page de l'institution. Ensuite, une contradiction sur
 * une donnée pratique entre deux sources de même rang ne se tranche pas
 * toute seule — elle passe en REVIEW, sans publication.
 */
export function mergeEvent(existing: AgendaEvent, candidate: AgendaEvent): AgendaEvent {
  const rankOrder = ["OFFICIAL", "INSTITUTION", "ORGANIZER", "ARTIST_BRAND", "MEDIA", "SECONDARY"];
  const candidateBetter = rankOrder.indexOf(candidate.sourceRank) < rankOrder.indexOf(existing.sourceRank);
  const authoritative = candidateBetter ? candidate : existing;
  const other = candidateBetter ? existing : candidate;

  const sourceUrls = [...new Set([authoritative.officialUrl, ...existing.sourceUrls, ...candidate.sourceUrls].filter(Boolean))];

  // Contradiction sur une date, à rang égal : personne ne tranche.
  const sameRank = existing.sourceRank === candidate.sourceRank;
  const datesDiffer =
    (existing.startDate && candidate.startDate && existing.startDate !== candidate.startDate) ||
    (existing.endDate && candidate.endDate && existing.endDate !== candidate.endDate);

  if (sameRank && datesDiffer) {
    return {
      ...authoritative,
      sourceUrls,
      verificationStatus: "REVIEW",
      note: `Dates contradictoires entre deux sources de même rang : ${existing.startDate}–${existing.endDate} (${existing.officialUrl}) contre ${candidate.startDate}–${candidate.endDate} (${candidate.officialUrl}).`,
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  // Une donnée absente chez la source qui fait foi peut être complétée par
  // l'autre SI celle-ci l'a réellement vérifiée — jamais par inférence.
  // La ville est de ce nombre : une page officielle qui ne la redit pas
  // (observé sur la page du musée pour « Mariko Mori : All That Shines »)
  // ne doit pas condamner l'événement à rester en revue alors qu'une reprise
  // fiable l'a vérifiée noir sur blanc.
  const fillEssential = (field: "city" | "venue") =>
    authoritative[field] || (other.verifiedFields.includes(field) ? other[field] : "");
  const city = fillEssential("city");
  const venue = fillEssential("venue");
  const filledFields = [
    ...(city && !authoritative.city ? ["city"] : []),
    ...(venue && !authoritative.venue ? ["venue"] : []),
  ];

  return {
    ...authoritative,
    sourceUrls,
    city,
    venue,
    endDate: authoritative.endDate || (other.verifiedFields.includes("endDate") ? other.endDate : ""),
    time: authoritative.time || (other.verifiedFields.includes("time") ? other.time : ""),
    organizer: authoritative.organizer || other.organizer,
    verifiedFields: [...new Set([...authoritative.verifiedFields, ...filledFields])],
    missingFields: authoritative.missingFields.filter((f) => !filledFields.includes(f)),
    fieldSources: {
      ...authoritative.fieldSources,
      ...(filledFields.includes("city") ? { city: other.fieldSources.city ?? other.officialUrl } : {}),
      ...(filledFields.includes("venue") ? { venue: other.fieldSources.venue ?? other.officialUrl } : {}),
    },
    status: computeStatus(authoritative.startDate, authoritative.endDate || other.endDate),
    lastVerifiedAt: new Date().toISOString(),
  };
}

/**
 * Champs qu'un éditeur peut corriger dans le Studio et que le moteur ne
 * doit jamais réécrire silencieusement une fois l'entrée passée en HYBRID —
 * en EDITORIAL, c'est la totalité du contenu qui est protégée (voir
 * `applyControlMode`). Tout ce qui n'y figure pas est temporel ou tient à la
 * vérification elle-même (dates, statut, sources, annulation) : c'est
 * précisément ce que le moteur reste seul à établir, même sous contrôle
 * éditorial, parce qu'un événement passé doit toujours cesser d'être
 * annoncé (§17 — aucune exception).
 */
const EDITORIAL_PROTECTED_FIELDS = [
  "eventName", "eventType", "discipline", "disciplineEn", "artistOrCreator", "institution",
  "venue", "city", "country", "countryEn", "organizer",
  "territory", "territoryHistory", "editorialValue", "descriptionFr", "descriptionEn", "editorialRelevance",
  "geographicPriority", "geographicJustification", "timezone",
] as const satisfies readonly (keyof AgendaEvent)[];

/**
 * Applique la protection éditoriale avant d'accepter ce que le moteur vient
 * de recalculer pour une entrée déjà connue.
 *
 * AUTOMATED — comportement historique, `incoming` s'applique tel quel.
 * EDITORIAL — rien du contenu ne bouge ; seul le statut temporel est
 * recalculé, sur les dates telles qu'un éditeur a pu lui-même les corriger.
 * HYBRID — le factuel et le temporel viennent de la fraîche lecture
 * (`incoming`), l'éditorial reste celui que l'éditeur a arrêté.
 *
 * Dans les deux cas protégés, `controlMode` lui-même n'est jamais repris de
 * `incoming` : une re-vérification ne remet jamais une entrée sous contrôle
 * automatisé de son propre chef.
 */
export function applyControlMode(existing: AgendaEvent, incoming: AgendaEvent): AgendaEvent {
  if (existing.controlMode === "AUTOMATED" || !existing.controlMode) return incoming;

  if (existing.controlMode === "EDITORIAL") {
    return { ...existing, status: computeStatus(existing.startDate, existing.endDate), lastVerifiedAt: new Date().toISOString() };
  }

  const preserved = Object.fromEntries(EDITORIAL_PROTECTED_FIELDS.map((field) => [field, existing[field]])) as Partial<AgendaEvent>;
  return { ...incoming, ...preserved, controlMode: existing.controlMode };
}

/**
 * Repêche les entrées restées en revue pour une cause qui a depuis disparu.
 *
 * Deux façons dont l'écart apparaît : un durcissement passé des champs
 * essentiels (« venue » exigé, puis retiré — commit 5156005) laisse des
 * notes qui citent un champ qui ne bloque plus rien ; une fusion antérieure
 * à l'ajout de la propagation de champ (voir mergeEvent) a pu combler la
 * donnée manquante sans jamais repasser le statut à VERIFIED. Dans les deux
 * cas, le signal est le même et sans ambiguïté : `missingFields` vide, note
 * qui dit encore l'inverse. On ne touche à rien d'autre — une revue tenant à
 * une contradiction ou à une page d'accueil garde `missingFields` vide DÈS
 * le départ, donc n'a jamais porté cette note et n'est jamais concernée.
 */
/** Le test lui-même, séparé de la lecture/écriture pour rester vérifiable sans toucher au stock réel. */
export function isStaleMissingFieldReview(event: AgendaEvent): boolean {
  return event.verificationStatus === "REVIEW" && event.missingFields.length === 0 && /essentielle/.test(event.note ?? "");
}

export function promoteResolvedReviews(): { promoted: number } {
  let promoted = 0;
  for (const event of currentEvents()) {
    if (!isStaleMissingFieldReview(event)) continue;
    saveEvent({ ...event, verificationStatus: "VERIFIED", note: "", lastVerifiedAt: new Date().toISOString() });
    promoted++;
  }
  return { promoted };
}

/** Repasse les événements stockés au calendrier du jour : ce qui est fini cesse d'être annoncé comme à venir. */
export function expirePastEvents(now = new Date()): { expired: number } {
  let expired = 0;
  for (const event of currentEvents()) {
    if (event.status === "EXPIRED") continue;
    const status = computeStatus(event.startDate, event.endDate, now);
    if (status === "EXPIRED") {
      saveEvent({ ...event, status, lastVerifiedAt: now.toISOString() });
      expired++;
    }
  }
  return { expired };
}

/** Ce que l'Agenda peut réellement proposer aujourd'hui. */
export function upcomingEvents(): AgendaEvent[] {
  return currentEvents()
    .filter((e) => e.status !== "EXPIRED" && e.verificationStatus === "VERIFIED")
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
}

export function reviewEvents(): AgendaEvent[] {
  return currentEvents().filter((e) => e.verificationStatus === "REVIEW");
}
