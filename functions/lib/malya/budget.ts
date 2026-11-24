/**
 * Registre budgétaire MALYA — plafond de dépense mensuel, fail-closed.
 *
 * Pourquoi D1 : une limite en mémoire ne tient pas sur Cloudflare (instances
 * multiples, requêtes simultanées). La réservation est UNE instruction SQL
 * conditionnelle (`UPDATE … WHERE committed + montant <= plafond`) : D1 la
 * sérialise, donc deux requêtes parallèles ne peuvent pas dépasser le plafond.
 * Le montant est réservé AVANT l'appel (pire cas : prompt estimé par excès +
 * max_tokens en sortie), puis réconcilié avec l'usage réel.
 *
 * Fail-closed : registre indisponible, tarif inconnu ou erreur SQL = aucun
 * appel payant. Le mode documentaire reste disponible.
 */
import { costMicro } from "./pricing.ts";

export type BudgetState = "normal" | "watch" | "limited" | "strict" | "suspended" | "blocked";

export interface Limits {
  maxOutputTokens: number;
  historyTurns: number;
  passages: number;
}

/** Seuils du brief : 50 / 70 / 85 / 95 / 100 %. */
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
      return { maxOutputTokens: 1400, historyTurns: 12, passages: 4 };
    case "limited":
      return { maxOutputTokens: 1000, historyTurns: 6, passages: 3 };
    case "strict":
      return { maxOutputTokens: 700, historyTurns: 3, passages: 2 };
    default:
      return null; // suspended / blocked : aucun nouvel appel payant
  }
}

/**
 * Plafond en micro-USD. Le brief fixe 15 EUR/mois ; la facturation Anthropic est en USD.
 * Hypothèse prudente : 1 EUR = `fxUsdPerEur` USD (défaut 1,00, volontairement bas : un
 * plafond de 15 USD est inférieur à 15 EUR tant que l'euro vaut plus d'un dollar), puis
 * une marge de sécurité de 10 % pour les frais éventuels.
 */
export function capMicro(budgetEur: number, fxUsdPerEur = 1.0, safetyMargin = 0.1): number {
  if (!Number.isFinite(budgetEur) || budgetEur <= 0 || !Number.isFinite(fxUsdPerEur) || fxUsdPerEur <= 0) return 0;
  return Math.floor(budgetEur * fxUsdPerEur * (1 - safetyMargin) * 1_000_000);
}

export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

/** Estimation PAR EXCÈS du nombre de tokens d'un texte : 1 token pour 2 caractères, +20 %. */
export function estimateTokens(chars: number): number {
  return Math.ceil((chars / 2) * 1.2);
}

export interface Snapshot {
  month: string;
  capMicro: number;
  committedMicro: number;
  settledMicro: number;
  ratio: number;
  state: BudgetState;
  calls: number;
  errors: number;
  refusals: number;
  blocked: number;
  inputTokens: number;
  outputTokens: number;
}

interface Row {
  committed_micro: number; settled_micro: number; calls: number; errors: number; refusals: number;
  blocked: number; input_tokens: number; output_tokens: number;
}

export async function snapshot(db: D1Database, now: Date, cap: number): Promise<Snapshot> {
  const month = monthKey(now);
  await db.prepare("INSERT OR IGNORE INTO malya_budget (month, updated_at) VALUES (?1, ?2)").bind(month, now.toISOString()).run();
  const row = await db.prepare("SELECT * FROM malya_budget WHERE month = ?1").bind(month).first<Row>();
  if (!row) throw new Error("registre budgétaire illisible");
  const ratio = cap > 0 ? row.committed_micro / cap : 1;
  return {
    month, capMicro: cap, committedMicro: row.committed_micro, settledMicro: row.settled_micro, ratio,
    state: cap > 0 ? stateFor(ratio) : "blocked", calls: row.calls, errors: row.errors, refusals: row.refusals,
    blocked: row.blocked, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
  };
}

/** Réservation atomique. `false` = plafond atteint : l'appel ne doit PAS être fait. */
export async function reserve(db: D1Database, now: Date, amount: number, cap: number): Promise<boolean> {
  if (!Number.isInteger(amount) || amount <= 0 || cap <= 0) return false;
  const month = monthKey(now);
  await db.prepare("INSERT OR IGNORE INTO malya_budget (month, updated_at) VALUES (?1, ?2)").bind(month, now.toISOString()).run();
  const r = await db
    .prepare("UPDATE malya_budget SET committed_micro = committed_micro + ?1, calls = calls + 1, updated_at = ?4 WHERE month = ?2 AND committed_micro + ?1 <= ?3")
    .bind(amount, month, cap, now.toISOString())
    .run();
  return r.meta.changes === 1;
}

export async function noteBlocked(db: D1Database, now: Date): Promise<void> {
  await db.prepare("UPDATE malya_budget SET blocked = blocked + 1, updated_at = ?2 WHERE month = ?1").bind(monthKey(now), now.toISOString()).run();
}

/** Réconcilie la réservation avec l'usage réel. */
export async function settle(db: D1Database, now: Date, reserved: number, model: string, inputTokens: number, outputTokens: number, refused = false): Promise<void> {
  const actual = costMicro(model, inputTokens, outputTokens) ?? reserved; // tarif inconnu : on garde le pire cas
  await db
    .prepare("UPDATE malya_budget SET committed_micro = MAX(0, committed_micro - ?1 + ?2), settled_micro = settled_micro + ?2, input_tokens = input_tokens + ?3, output_tokens = output_tokens + ?4, refusals = refusals + ?5, updated_at = ?7 WHERE month = ?6")
    .bind(reserved, actual, inputTokens, outputTokens, refused ? 1 : 0, monthKey(now), now.toISOString())
    .run();
}

/** Libère une réservation quand on est CERTAIN que rien n'a été facturé (requête rejetée avant traitement). */
export async function release(db: D1Database, now: Date, reserved: number): Promise<void> {
  await db
    .prepare("UPDATE malya_budget SET committed_micro = MAX(0, committed_micro - ?1), calls = MAX(0, calls - 1), errors = errors + 1, updated_at = ?3 WHERE month = ?2")
    .bind(reserved, monthKey(now), now.toISOString())
    .run();
}

/** Appel incertain (délai dépassé, erreur serveur) : la réservation reste comptée comme dépensée. */
export async function noteError(db: D1Database, now: Date): Promise<void> {
  await db.prepare("UPDATE malya_budget SET errors = errors + 1, updated_at = ?2 WHERE month = ?1").bind(monthKey(now), now.toISOString()).run();
}
