/**
 * Tarification Workers AI en Neurons — configuration versionnée, jamais inventée.
 *
 * Source : https://developers.cloudflare.com/workers-ai/platform/pricing/ (lue le 2026-11-24).
 * Plan gratuit : 10 000 Neurons par jour, réinitialisés à 00:00 UTC, aucun frais.
 * Un Neuron n'est PAS une conversation : le coût d'un tour dépend des tokens lus et écrits.
 */
export const PRICING_VERIFIED_AT = "2026-11-24";
export const PRICING_SOURCE = "https://developers.cloudflare.com/workers-ai/platform/pricing/";
export const FREE_DAILY_NEURONS = 10_000;

/** Neurons par million de tokens (entrée / sortie), tels que publiés. */
export interface ModelRate { input: number; output: number }

export const RATES: Record<string, ModelRate> = {
  // Modèle retenu (essais du 2026-11-24 : meilleur français, structure, 4–8 s, ≈ 56 Neurons par tour type).
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 31876, output: 50488 },
  // Alternative évaluée : plus rapide, ton plus promotionnel, ≈ 80 Neurons par tour type.
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26668, output: 204805 },
};

export const DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/** Modèles que la documentation déclare payants : jamais acceptés, même configurés. */
export const PAID_ONLY = new Set([
  "@cf/moonshotai/kimi-k2.6", "@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.2", "@cf/zai-org/glm-5.3", "@cf/zai-org/glm-5.3-flash",
  "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/deepseek-ai/deepseek-v4.1-flash-1017", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/thinkingmachines/inkling-2-small",
]);

export function rateFor(model: string): ModelRate | null {
  return PAID_ONLY.has(model) ? null : (RATES[model] ?? null);
}

/** Coût en milli-Neurons (entier, arrondi au supérieur) ; null si le modèle n'a pas de tarif gratuit connu (fail-closed). */
export function costMilli(model: string, inputTokens: number, outputTokens: number): number | null {
  const r = rateFor(model);
  if (!r) return null;
  // neurons = tokens × taux / 1e6 → milli-neurons = tokens × taux / 1e3
  return Math.max(1, Math.ceil((inputTokens * r.input + outputTokens * r.output) / 1000));
}
