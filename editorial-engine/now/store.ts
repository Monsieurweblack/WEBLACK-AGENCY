import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENGINE_ROOT } from "../config/env.ts";
import type { NowSignal } from "./types.ts";

/**
 * Stock local des signaux NOW — même construction que agenda/store.ts :
 * append-only, une ligne JSON par état, l'identité déterministe permet de
 * retrouver le dernier état d'un signal sans jamais réécrire une ligne
 * passée. Le stock garde tout, y compris REJECTED — c'est lui qui empêche
 * de ré-explorer indéfiniment le même terrain (voir now/dedupe.ts).
 */
// Test isolation (même convention que database/db.ts EDITORIAL_TEST_DB) :
// les tests unitaires pointent vers un fichier jetable pour ne jamais lire
// ni écrire le stock réel du moteur.
const STORE_FILE = process.env.EDITORIAL_TEST_NOW_STORE || path.join(ENGINE_ROOT, "logs", "now-signals.jsonl");

/** Identité déterministe : titre normalisé + URL source canonique. Deux découvertes du même signal produisent le même id — même esprit que agenda/store.ts eventIdentity(). */
export function signalIdentity(input: { title: string; sourceUrl: string }): string {
  const norm = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const key = [norm(input.title), input.sourceUrl].join("|");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function saveSignal(signal: NowSignal): void {
  fs.appendFileSync(STORE_FILE, JSON.stringify(signal) + "\n", "utf8");
}

export function readAllSignalEntries(): NowSignal[] {
  if (!fs.existsSync(STORE_FILE)) return [];
  return fs
    .readFileSync(STORE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NowSignal);
}

/** L'état courant de chaque signal, une fois les réécritures appliquées. */
export function currentSignals(): NowSignal[] {
  const byId = new Map<string, NowSignal>();
  for (const entry of readAllSignalEntries()) byId.set(entry.id, entry);
  return [...byId.values()];
}

export function findSignal(id: string): NowSignal | undefined {
  return currentSignals().find((s) => s.id === id);
}

export function publishedSignals(): NowSignal[] {
  return currentSignals().filter((s) => s.status === "published");
}

export function reviewSignals(): NowSignal[] {
  return currentSignals().filter((s) => s.status === "review");
}
