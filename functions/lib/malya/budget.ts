/**
 * Registre d'usage Workers AI (Neurons) — plafond QUOTIDIEN, fail-closed.
 *
 * Coût nul : on ne dépasse jamais l'allocation gratuite (10 000 Neurons/jour). Le plafond de MALYA est
 * volontairement plus bas (6 000 par défaut) pour laisser de la marge au reste du compte, et reste sous
 * l'allocation gratuite même si le compte passait un jour en Workers Paid (aucun dépassement facturable).
 *
 * Réservation atomique : une seule instruction `UPDATE … WHERE engagé + montant <= plafond`, sérialisée par
 * D1 : des requêtes parallèles ou plusieurs sessions ne peuvent pas dépasser le plafond. Le pire coût
 * (prompt estimé par excès + max_tokens) est réservé AVANT l'appel puis remplacé par l'usage réel.
 */
import { costMilli } from "./pricing.ts";

export type BudgetState = "normal" | "watch" | "limited" | "strict" | "suspended" | "blocked";

export interface Limits { maxOutputTokens: number; historyTurns: number; passages: number }

export function stateFor(ratio: number): BudgetState {
  if (ratio >= 1) return "blocked";
  if (ratio >= 0.95) return "suspended";
  if (ratio >= 0.85) return "strict";
  if (ratio >= 0.7) return "limited";
  if (ratio >= 0.5) return "watch";
  return "normal";
}

export function limitsFor(state: BudgetState): Limits | null {
  switch (state) {
    case "normal":
    case "watch":
      return { maxOutputTokens: 600, historyTurns: 10, passages: 4 };
    case "limited":
      return { maxOutputTokens: 450, historyTurns: 6, passages: 3 };
    case "strict":
      return { maxOutputTokens: 300, historyTurns: 3, passages: 2 };
    default:
      return null;
  }
}

export const DEFAULT_DAILY_CAP_NEURONS = 6000;

/** Plafond quotidien en milli-Neurons ; 0 (donc blocage) si la valeur est invalide ou dépasse l'allocation gratuite. */
export function capMilli(neurons: number, freeAllocation = 10_000): number {
  if (!Number.isFinite(neurons) || neurons <= 0 || neurons > freeAllocation) return 0;
  return Math.floor(neurons * 1000);
}

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Estimation PAR EXCÈS du nombre de tokens d'un texte : 1 token pour 2 caractères, +20 %. */
export function estimateTokens(chars: number): number {
  return Math.ceil((chars / 2) * 1.2);
}

export interface Snapshot {
  day: string; capMilli: number; committedMilli: number; settledMilli: number; ratio: number; state: BudgetState;
  calls: number; errors: number; quotaHits: number; blocked: number; inputTokens: number; outputTokens: number;
}

interface Row {
  committed_milli: number; settled_milli: number; calls: number; errors: number; quota_hits: number;
  blocked: number; input_tokens: number; output_tokens: number;
}

export async function snapshot(db: D1Database, now: Date, cap: number): Promise<Snapshot> {
  const day = dayKey(now);
  await db.prepare("INSERT OR IGNORE INTO malya_ai_usage (day, updated_at) VALUES (?1, ?2)").bind(day, now.toISOString()).run();
  const row = await db.prepare("SELECT * FROM malya_ai_usage WHERE day = ?1").bind(day).first<Row>();
  if (!row) throw new Error("registre d'usage illisible");
  const ratio = cap > 0 ? row.committed_milli / cap : 1;
  return {
    day, capMilli: cap, committedMilli: row.committed_milli, settledMilli: row.settled_milli, ratio, state: cap > 0 ? stateFor(ratio) : "blocked",
    calls: row.calls, errors: row.errors, quotaHits: row.quota_hits, blocked: row.blocked, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
  };
}

/** Réservation atomique. `false` = plafond atteint : l'appel ne doit PAS être fait. */
export async function reserve(db: D1Database, now: Date, amount: number, cap: number): Promise<boolean> {
  if (!Number.isInteger(amount) || amount <= 0 || cap <= 0) return false;
  const day = dayKey(now);
  await db.prepare("INSERT OR IGNORE INTO malya_ai_usage (day, updated_at) VALUES (?1, ?2)").bind(day, now.toISOString()).run();
  const r = await db
    .prepare("UPDATE malya_ai_usage SET committed_milli = committed_milli + ?1, calls = calls + 1, updated_at = ?4 WHERE day = ?2 AND committed_milli + ?1 <= ?3")
    .bind(amount, day, cap, now.toISOString())
    .run();
  return r.meta.changes === 1;
}

export async function noteBlocked(db: D1Database, now: Date): Promise<void> {
  await db.prepare("UPDATE malya_ai_usage SET blocked = blocked + 1, updated_at = ?2 WHERE day = ?1").bind(dayKey(now), now.toISOString()).run();
}

/** Remplace la réservation par l'usage réel (tokens × taux publié). */
export async function settle(db: D1Database, now: Date, reserved: number, model: string, inputTokens: number, outputTokens: number): Promise<void> {
  const actual = costMilli(model, inputTokens, outputTokens) ?? reserved;
  await db
    .prepare("UPDATE malya_ai_usage SET committed_milli = MAX(0, committed_milli - ?1 + ?2), settled_milli = settled_milli + ?2, input_tokens = input_tokens + ?3, output_tokens = output_tokens + ?4, updated_at = ?6 WHERE day = ?5")
    .bind(reserved, actual, inputTokens, outputTokens, dayKey(now), now.toISOString())
    .run();
}

/** Libère une réservation quand on est CERTAIN qu'aucun Neuron n'a été consommé (rejet avant traitement). */
export async function release(db: D1Database, now: Date, reserved: number): Promise<void> {
  await db
    .prepare("UPDATE malya_ai_usage SET committed_milli = MAX(0, committed_milli - ?1), calls = MAX(0, calls - 1), errors = errors + 1, updated_at = ?3 WHERE day = ?2")
    .bind(reserved, dayKey(now), now.toISOString())
    .run();
}

export async function noteError(db: D1Database, now: Date): Promise<void> {
  await db.prepare("UPDATE malya_ai_usage SET errors = errors + 1, updated_at = ?2 WHERE day = ?1").bind(dayKey(now), now.toISOString()).run();
}

/**
 * Workers AI a refusé : l'allocation gratuite du jour est épuisée (compte partagé avec d'autres usages ou
 * estimation trop basse). On verrouille le reste de la journée UTC : plus aucun appel avant 00:00 UTC.
 */
export async function lockForToday(db: D1Database, now: Date, cap: number): Promise<void> {
  await db
    .prepare("UPDATE malya_ai_usage SET committed_milli = MAX(committed_milli, ?1), quota_hits = quota_hits + 1, updated_at = ?3 WHERE day = ?2")
    .bind(cap, dayKey(now), now.toISOString())
    .run();
}
