import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENGINE_ROOT } from "../config/env.ts";
import { computeStatus, type AgendaEvent } from "./types.ts";

const STORE_FILE = path.join(ENGINE_ROOT, "logs", "agenda-events.jsonl");

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
    .map((line) => JSON.parse(line) as AgendaEvent);
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

  return {
    ...authoritative,
    sourceUrls,
    // Une donnée absente chez la source qui fait foi peut être complétée par
    // l'autre SI celle-ci l'a réellement vérifiée — jamais par inférence.
    endDate: authoritative.endDate || (other.verifiedFields.includes("endDate") ? other.endDate : ""),
    time: authoritative.time || (other.verifiedFields.includes("time") ? other.time : ""),
    organizer: authoritative.organizer || other.organizer,
    status: computeStatus(authoritative.startDate, authoritative.endDate || other.endDate),
    lastVerifiedAt: new Date().toISOString(),
  };
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
