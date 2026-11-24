/**
 * Consentement et durée de conservation.
 *
 * V1 : le serveur ne conserve AUCUNE conversation. La « mémoire » est un
 * stockage local du navigateur, activé seulement par un consentement
 * explicite, expiré après MEMORY_TTL_DAYS jours et effaçable à tout moment.
 * Aucune donnée d'un utilisateur ne peut donc se retrouver chez un autre.
 */
import type { ConsentState } from "./types.ts";

export const MEMORY_TTL_DAYS = 30;
export const MEMORY_MAX_ITEMS = 40;

export function normalizeConsent(raw: unknown): ConsentState {
  const memory = !!raw && typeof raw === "object" && (raw as Record<string, unknown>).memory === true;
  return { memory };
}

export interface StoredTurn {
  role: "user" | "assistant";
  content: string;
  at: number;
}

/** Retire les tours expirés et borne le volume. */
export function pruneMemory(items: StoredTurn[], now: number): StoredTurn[] {
  const ttl = MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000;
  return items.filter((i) => now - i.at <= ttl).slice(-MEMORY_MAX_ITEMS);
}

/** Sans consentement, rien n'est repris d'une session précédente. */
export function recallable(consent: ConsentState, items: StoredTurn[], now: number): StoredTurn[] {
  return consent.memory ? pruneMemory(items, now) : [];
}
