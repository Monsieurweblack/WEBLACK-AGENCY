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

// ── Conversations séparées (mémoire locale, niveau 1) ──────────────────
export const MAX_CONVERSATIONS = 5;

export interface Conversation {
  id: string;
  /** Dernière activité (ms). */
  at: number;
  turns: StoredTurn[];
}

export interface ConversationStore {
  active: string;
  items: Conversation[];
}

export function emptyStore(id: string, now: number): ConversationStore {
  return { active: id, items: [{ id, at: now, turns: [] }] };
}

/** Ouvre une conversation neuve ; les plus anciennes au-delà du plafond sont supprimées. */
export function startConversation(store: ConversationStore, id: string, now: number): ConversationStore {
  const items = [...store.items, { id, at: now, turns: [] }].sort((a, b) => a.at - b.at).slice(-MAX_CONVERSATIONS);
  return { active: id, items };
}

export function appendTurn(store: ConversationStore, turn: StoredTurn): ConversationStore {
  return {
    ...store,
    items: store.items.map((c) => (c.id === store.active ? { ...c, at: turn.at, turns: [...c.turns, turn].slice(-MEMORY_MAX_ITEMS) } : c)),
  };
}

export function pruneStore(store: ConversationStore, now: number): ConversationStore {
  const items = store.items.map((c) => ({ ...c, turns: pruneMemory(c.turns, now) })).filter((c) => c.turns.length > 0 || c.id === store.active);
  return { active: store.active, items };
}

export function deleteConversation(store: ConversationStore, id: string, fallbackId: string, now: number): ConversationStore {
  const items = store.items.filter((c) => c.id !== id);
  if (items.length === 0) return emptyStore(fallbackId, now);
  return { active: store.active === id ? items[items.length - 1].id : store.active, items };
}
