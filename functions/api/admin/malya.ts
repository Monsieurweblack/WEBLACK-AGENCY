/**
 * Supervision MALYA — lecture seule, protégée par la session admin existante
 * (aucun second système d'authentification). Ne contient AUCUNE conversation :
 * uniquement l'état du service, l'usage de l'allocation gratuite, la base documentaire et les compteurs.
 */
import { json } from "../../lib/json.ts";
import { requireAdmin } from "../../lib/adminSession.ts";
import { createLlm, dailyCapOf, type LlmEnv } from "../../lib/malya/llm.ts";
import { snapshot } from "../../lib/malya/budget.ts";
import { DEFAULT_MODEL, FREE_DAILY_NEURONS, PRICING_SOURCE, PRICING_VERIFIED_AT } from "../../lib/malya/pricing.ts";
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
  const cap = dailyCapOf(env);
  let usage: unknown = { available: false };
  if (env.DB) {
    try {
      const s = await snapshot(env.DB, now, cap);
      usage = {
        available: true, day: s.day, state: s.state, ratio: Number(s.ratio.toFixed(4)),
        dailyCapNeurons: s.capMilli / 1000, freeAllocationNeurons: FREE_DAILY_NEURONS, committedNeurons: s.committedMilli / 1000, settledNeurons: s.settledMilli / 1000,
        calls: s.calls, errors: s.errors, quotaHits: s.quotaHits, blockedCalls: s.blocked, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
      };
    } catch {
      usage = { available: false, error: "registre illisible" };
    }
  }
  return json({
    generatedAt: now.toISOString(),
    service: {
      enabled: env.MALYA_ENABLED === "true", emergencyStop: env.MALYA_EMERGENCY_STOP === "true",
      provider: { name: env.MALYA_AI_PROVIDER ?? null, bindingPresent: Boolean(env.AI), model: env.MALYA_MODEL?.trim() || DEFAULT_MODEL, mode: plan.ok ? "ai" : "documentary", reason: plan.ok ? null : plan.reason },
      pricing: { verifiedAt: PRICING_VERIFIED_AT, source: PRICING_SOURCE },
      memory: { local: "available (browser, consent)", server: "not implemented" },
    },
    usage,
    knowledge: { coverage: coverage(KNOWLEDGE), ...reviewReport(KNOWLEDGE, now) },
    skills: SKILLS.map((s) => ({ id: s.id, tools: s.tools })),
  }, 200);
};
