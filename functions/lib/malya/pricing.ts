/**
 * Tarifs Anthropic — configuration versionnée, jamais inventée.
 *
 * Source : https://platform.claude.com/docs/en/about-claude/pricing
 * Consultée et recoupée avec https://platform.claude.com/docs/en/models/overview
 * le 2026-11-24. Un prix de ce fichier doit être revérifié avant toute
 * activation (PRICING_VERIFIED_AT est affiché dans l'administration).
 *
 * Unité : USD par million de tokens (MTok). 1 USD/MTok = 1 micro-USD par token,
 * donc coût_micro = tokens × prix.
 */
export const PRICING_VERIFIED_AT = "2026-11-24";
export const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

export interface ModelPrice {
  /** Prix jusqu'au seuil de prompt. */
  input: number;
  output: number;
  /** Haiku 5.5 : au-delà de 100 000 tokens de prompt, tarif supérieur. */
  longPromptThreshold?: number;
  longInput?: number;
  longOutput?: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longPromptThreshold: 100_000, longInput: 0.5, longOutput: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export const DEFAULT_MODEL = "claude-haiku-5-5";

export function priceFor(model: string): ModelPrice | null {
  return PRICES[model] ?? null;
}

/** Coût en micro-USD, arrondi à l'entier supérieur ; null si le modèle n'a pas de tarif connu (fail-closed). */
export function costMicro(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const long = p.longPromptThreshold !== undefined && inputTokens > p.longPromptThreshold;
  const pin = long ? (p.longInput ?? p.input) : p.input;
  const pout = long ? (p.longOutput ?? p.output) : p.output;
  return Math.ceil(inputTokens * pin + outputTokens * pout);
}
