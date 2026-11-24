/**
 * Supervision MALYA — lecture seule, protégée par la session admin existante
 * (aucun second système d'authentification). Ne contient AUCUNE conversation :
 * uniquement l'état du service, le budget, la base documentaire et les compteurs.
 */
import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { createLlm, type LlmEnv } from "../../lib/malya/llm.ts";
import { capMicro, snapshot } from "../../lib/malya/budget.ts";
import { PRICING_SOURCE, PRICING_VERIFIED_AT, DEFAULT_MODEL } from "../../lib/malya/pricing.ts";
import { KNOWLEDGE, coverage, reviewReport } from "../../lib/malya/knowledge.ts";
import { SKILLS } from "../../lib/malya/skills.ts";

interface Env extends LlmEnv {
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const now = new Date();
  const plan = await createLlm(env, { now: () => now }).plan();
  const cap = capMicro(Number(env.MALYA_MONTHLY_BUDGET_EUR ?? "15"), env.MALYA_FX_USD_PER_EUR ? Number(env.MALYA_FX_USD_PER_EUR) : 1.0);
  let budget: unknown = { available: false };
  if (env.DB) {
    try {
      const s = await snapshot(env.DB, now, cap);
      budget = {
        available: true, month: s.month, state: s.state, ratio: Number(s.ratio.toFixed(4)),
        capUsd: s.capMicro / 1e6, committedUsd: s.committedMicro / 1e6, settledUsd: s.settledMicro / 1e6,
        calls: s.calls, errors: s.errors, refusals: s.refusals, blockedCalls: s.blocked, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
      };
    } catch {
      budget = { available: false, error: "registre illisible" };
    }
  }
  return json({
    generatedAt: now.toISOString(),
    service: {
      enabled: env.MALYA_ENABLED === "true", emergencyStop: env.MALYA_EMERGENCY_STOP === "true",
      provider: { keyConfigured: Boolean(env.ANTHROPIC_API_KEY), model: env.MALYA_MODEL?.trim() || DEFAULT_MODEL, mode: plan.ok ? "ai" : "documentary", reason: plan.ok ? null : plan.reason },
      pricing: { verifiedAt: PRICING_VERIFIED_AT, source: PRICING_SOURCE },
      memory: { local: "available (browser, consent)", server: "not implemented" },
    },
    budget,
    knowledge: { coverage: coverage(KNOWLEDGE), ...reviewReport(KNOWLEDGE, now) },
    skills: SKILLS.map((s) => ({ id: s.id, tools: s.tools })),
  }, 200);
};
