import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENGINE_ROOT } from "../config/env.ts";
import type { Newsletter } from "./buildNewsletter.ts";

const QUEUE_FILE = path.join(ENGINE_ROOT, "logs", "newsletter-queue.jsonl");

/**
 * immediate — eligible for dispatch as soon as the article is published.
 * scheduled — held until `sendAfter`.
 * digest    — held until gathered with others into one issue, on demand.
 * dailyDigest / weeklyDigest — same, on a fixed rhythm.
 */
export type NewsletterMode = "immediate" | "scheduled" | "digest" | "dailyDigest" | "weeklyDigest";
export type NewsletterStatus = "queued" | "sent" | "failed";

export interface QueuedNewsletter {
  id: string;
  runId: string;
  sanityDocumentId: string;
  queuedAt: string;
  mode: NewsletterMode;
  /** ISO timestamp before which a scheduled issue must not go out. */
  sendAfter?: string;
  status: NewsletterStatus;
  sentAt?: string;
  /** Why a dispatch attempt failed — kept so a retry is an informed decision, not a blind one. */
  error?: string;
  newsletter: Newsletter;
}

export function enqueueNewsletter(entry: Omit<QueuedNewsletter, "id" | "queuedAt" | "status">): QueuedNewsletter {
  const queued: QueuedNewsletter = { ...entry, id: crypto.randomUUID(), queuedAt: new Date().toISOString(), status: "queued" };
  fs.appendFileSync(QUEUE_FILE, JSON.stringify(queued) + "\n", "utf8");
  return queued;
}

export function readQueue(): QueuedNewsletter[] {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  return fs
    .readFileSync(QUEUE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueuedNewsletter);
}

/**
 * The queue is append-only, so an update is a new line that supersedes the
 * earlier one for the same id. Rewriting the file in place would risk
 * truncating the whole history on a crash mid-write, for no gain at this
 * volume.
 */
export function markNewsletter(id: string, patch: Partial<Pick<QueuedNewsletter, "status" | "sentAt" | "error">>): void {
  const current = readQueue().find((entry) => entry.id === id);
  if (!current) throw new Error(`Newsletter inconnue dans la file : ${id}`);
  fs.appendFileSync(QUEUE_FILE, JSON.stringify({ ...current, ...patch }) + "\n", "utf8");
}

/** Latest state per id — what the queue actually is, once supersessions are applied. */
export function currentQueue(): QueuedNewsletter[] {
  const byId = new Map<string, QueuedNewsletter>();
  for (const entry of readQueue()) byId.set(entry.id, entry);
  return [...byId.values()];
}

/** Issues whose moment has come: queued, and either immediate or past their scheduled time. Digest issues are held until explicitly gathered. */
export function dueNewsletters(now = new Date()): QueuedNewsletter[] {
  return currentQueue().filter((entry) => {
    if (entry.status !== "queued") return false;
    if (entry.mode === "immediate") return true;
    if (entry.mode === "scheduled") return entry.sendAfter !== undefined && new Date(entry.sendAfter) <= now;
    return false;
  });
}

const DIGEST_MODES: ReadonlySet<NewsletterMode> = new Set(["digest", "dailyDigest", "weeklyDigest"]);

/** Everything waiting to be gathered, whatever its rhythm. Individual sending is unaffected: an immediate or scheduled issue never lands here. */
export function pendingDigest(): QueuedNewsletter[] {
  return currentQueue().filter((entry) => entry.status === "queued" && DIGEST_MODES.has(entry.mode));
}
