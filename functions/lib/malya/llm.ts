/**
 * Passerelle IA de MALYA — Cloudflare Workers AI (binding `AI`), plan gratuit uniquement.
 *
 * Aucun appel à un fournisseur tiers : la seule voie d'inférence est `env.AI.run(...)`. Une valeur de
 * MALYA_AI_PROVIDER autre que « cloudflare » ferme la passerelle (aucun autre fournisseur n'existe dans
 * le code). Ordre d'une requête : interrupteurs → fournisseur → binding → modèle gratuit à tarif connu →
 * registre quotidien de Neurons → réservation atomique du pire coût → appel → réconciliation.
 * À la moindre défaillance, MALYA répond en mode documentaire, sans repli payant.
 */
import { DEFAULT_MODEL, FREE_DAILY_NEURONS, costMilli, rateFor } from "./pricing.ts";
import {
  DEFAULT_DAILY_CAP_NEURONS, capMilli, estimateTokens, limitsFor, lockForToday, noteBlocked, noteError, release, reserve, settle, snapshot,
  type BudgetState, type Limits,
} from "./budget.ts";

/** Surface minimale du binding Workers AI utilisée ici (permet une doublure en test). */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface LlmEnv {
  AI?: AiBinding;
  MALYA_AI_PROVIDER?: string;
  MALYA_MODEL?: string;
  MALYA_ENABLED?: string;
  MALYA_EMERGENCY_STOP?: string;
  MALYA_DAILY_NEURON_CAP?: string;
  DB?: D1Database;
}

export type LlmFailure =
  | "disabled" | "emergency_stop" | "wrong_provider" | "no_binding" | "unknown_model" | "budget_unavailable"
  | "budget_suspended" | "budget_exhausted" | "quota_exhausted" | "model_unavailable" | "provider_error" | "timeout"
  | "invalid_response" | "empty_reply";

export interface Plan { ok: true; limits: Limits; state: BudgetState; model: string }
export type PlanResult = Plan | { ok: false; reason: LlmFailure };

export interface LlmCall {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  inputChars: number;
  limits: Limits;
}
export type LlmResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number; state: BudgetState; model: string }
  | { ok: false; reason: LlmFailure };

export interface Llm {
  plan(): Promise<PlanResult>;
  call(req: LlmCall): Promise<LlmResult>;
}

export const TIMEOUT_MS = 25_000;

export function dailyCapOf(env: LlmEnv): number {
  const n = env.MALYA_DAILY_NEURON_CAP === undefined || env.MALYA_DAILY_NEURON_CAP === "" ? DEFAULT_DAILY_CAP_NEURONS : Number(env.MALYA_DAILY_NEURON_CAP);
  return capMilli(n, FREE_DAILY_NEURONS);
}

function parseOutput(raw: unknown): { text: string; inputTokens?: number; outputTokens?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const inner = (r.result && typeof r.result === "object" ? r.result : r) as Record<string, unknown>;
  const choice = (inner.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
  const text = typeof inner.response === "string" ? inner.response : typeof choice === "string" ? choice : null;
  if (text === null) return null;
  const u = (inner.usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
  return { text, inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens) };
}

function classify(error: unknown): { reason: LlmFailure; quota: boolean } {
  const msg = String((error as { message?: unknown })?.message ?? error ?? "");
  if (/allocation|neurons|4006|quota|rate.?limit|429/i.test(msg)) return { reason: "quota_exhausted", quota: true };
  if (/time(d)? ?out|timeout|aborted/i.test(msg)) return { reason: "timeout", quota: false };
  if (/no such model|unknown model|model.*(not found|unavailable|deprecated)|5007|7003/i.test(msg)) return { reason: "model_unavailable", quota: false };
  return { reason: "provider_error", quota: false };
}

export function createLlm(env: LlmEnv, opts: { now?: () => Date } = {}): Llm {
  const now = opts.now ?? (() => new Date());
  const model = env.MALYA_MODEL?.trim() || DEFAULT_MODEL;
  const cap = dailyCapOf(env);

  async function plan(): Promise<PlanResult> {
    if (env.MALYA_EMERGENCY_STOP === "true") return { ok: false, reason: "emergency_stop" };
    if (env.MALYA_ENABLED !== "true") return { ok: false, reason: "disabled" };
    if (env.MALYA_AI_PROVIDER !== "cloudflare") return { ok: false, reason: "wrong_provider" };
    if (!env.AI || typeof env.AI.run !== "function") return { ok: false, reason: "no_binding" };
    if (!rateFor(model)) return { ok: false, reason: "unknown_model" };
    if (!env.DB || cap <= 0) return { ok: false, reason: "budget_unavailable" };
    try {
      const snap = await snapshot(env.DB, now(), cap);
      const limits = limitsFor(snap.state);
      if (!limits) return { ok: false, reason: snap.state === "blocked" ? "budget_exhausted" : "budget_suspended" };
      return { ok: true, limits, state: snap.state, model };
    } catch {
      return { ok: false, reason: "budget_unavailable" }; // fail-closed
    }
  }

  async function call(req: LlmCall): Promise<LlmResult> {
    const p = await plan();
    if (!p.ok) return p;
    const db = env.DB as D1Database;
    const ai = env.AI as AiBinding;
    const maxTokens = Math.min(req.limits.maxOutputTokens, p.limits.maxOutputTokens);
    const worst = costMilli(model, estimateTokens(req.inputChars), maxTokens);
    if (worst === null) return { ok: false, reason: "unknown_model" };

    try {
      if (!(await reserve(db, now(), worst, cap))) {
        await noteBlocked(db, now()).catch(() => {});
        return { ok: false, reason: "budget_exhausted" };
      }
    } catch {
      return { ok: false, reason: "budget_unavailable" };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        ai.run(model, { messages: [{ role: "system", content: req.system }, ...req.messages], max_tokens: maxTokens }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS); }),
      ]);
      const out = parseOutput(raw);
      if (!out) {
        await settle(db, now(), worst, model, estimateTokens(req.inputChars), maxTokens).catch(() => {}); // appel parti : on garde le pire cas
        return { ok: false, reason: "invalid_response" };
      }
      const inTok = out.inputTokens ?? estimateTokens(req.inputChars);
      const outTok = out.outputTokens ?? Math.ceil(out.text.length / 2);
      await settle(db, now(), worst, model, inTok, outTok);
      const text = out.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (!text) return { ok: false, reason: "empty_reply" };
      return { ok: true, text, inputTokens: inTok, outputTokens: outTok, state: p.state, model };
    } catch (error) {
      const c = classify(error);
      if (c.quota) await lockForToday(db, now(), cap).catch(() => {}); // plus aucun appel avant 00:00 UTC
      else if (c.reason === "model_unavailable") await release(db, now(), worst).catch(() => {}); // rejeté avant traitement
      else await noteError(db, now()).catch(() => {}); // incertain : la réservation reste comptée
      return { ok: false, reason: c.reason };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { plan, call };
}

export const REASON_LABEL: Record<LlmFailure, { fr: string; en: string }> = {
  disabled: { fr: "Le service conversationnel n'est pas activé.", en: "The conversational service is not enabled." },
  emergency_stop: { fr: "Le service conversationnel est suspendu (arrêt d'urgence).", en: "The conversational service is suspended (emergency stop)." },
  wrong_provider: { fr: "Le fournisseur d'IA configuré n'est pas autorisé.", en: "The configured AI provider is not allowed." },
  no_binding: { fr: "Le moteur d'IA n'est pas raccordé à cet environnement.", en: "The AI engine is not attached to this environment." },
  unknown_model: { fr: "Le modèle configuré n'est pas un modèle gratuit à tarif vérifié.", en: "The configured model is not a free model with a verified rate." },
  budget_unavailable: { fr: "Le contrôle de l'allocation est indisponible : l'IA est suspendue par précaution.", en: "Allocation control is unavailable: AI is suspended as a precaution." },
  budget_suspended: { fr: "L'allocation gratuite du jour est presque atteinte : l'IA est suspendue.", en: "Today's free allocation is nearly reached: AI is suspended." },
  budget_exhausted: { fr: "L'allocation gratuite du jour est atteinte : MALYA répond depuis sa base documentaire.", en: "Today's free allocation is reached: MALYA answers from its documentary base." },
  quota_exhausted: { fr: "L'allocation gratuite du jour est épuisée : MALYA répond depuis sa base documentaire.", en: "Today's free allocation is used up: MALYA answers from its documentary base." },
  model_unavailable: { fr: "Le modèle d'IA est momentanément indisponible.", en: "The AI model is temporarily unavailable." },
  provider_error: { fr: "Le moteur d'IA est momentanément indisponible.", en: "The AI engine is temporarily unavailable." },
  timeout: { fr: "Le moteur d'IA a mis trop de temps à répondre.", en: "The AI engine took too long to respond." },
  invalid_response: { fr: "Le moteur d'IA a renvoyé une réponse inexploitable.", en: "The AI engine returned an unusable reply." },
  empty_reply: { fr: "Le moteur d'IA n'a pas renvoyé de réponse exploitable.", en: "The AI engine returned no usable reply." },
};
