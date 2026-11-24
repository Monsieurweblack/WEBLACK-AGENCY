/**
 * Passerelle Anthropic de MALYA — appels exclusivement côté serveur, via le SDK officiel.
 *
 * Ordre d'une requête : interrupteurs → clé → tarif connu → registre budgétaire →
 * réservation atomique du pire coût → appel → réconciliation. À la moindre
 * défaillance avant l'appel, rien n'est facturé et MALYA répond en mode documentaire.
 *
 * Modèle : variable MALYA_MODEL (défaut claude-haiku-5-5). L'identifiant et son tarif
 * ont été relevés dans la documentation officielle le 2026-11-24 (voir pricing.ts) ;
 * un modèle sans tarif connu est refusé : on ne dépense pas sans pouvoir chiffrer.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, costMicro, priceFor } from "./pricing.ts";
import { capMicro, estimateTokens, limitsFor, noteBlocked, noteError, release, reserve, settle, snapshot, type BudgetState, type Limits } from "./budget.ts";

export interface LlmEnv {
  ANTHROPIC_API_KEY?: string;
  MALYA_MODEL?: string;
  MALYA_ENABLED?: string;
  MALYA_EMERGENCY_STOP?: string;
  MALYA_MONTHLY_BUDGET_EUR?: string;
  MALYA_FX_USD_PER_EUR?: string;
  DB?: D1Database;
}

export type LlmFailure =
  | "disabled" | "emergency_stop" | "no_api_key" | "unknown_model" | "budget_unavailable"
  | "budget_suspended" | "budget_exhausted" | "provider_error" | "timeout" | "refusal" | "empty_reply";

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

/** Surface minimale du SDK utilisée ici : permet d'injecter une doublure en test. */
export interface MessagesApi {
  create(params: Record<string, unknown>, options?: { timeout?: number }): Promise<{
    content: { type: string; text?: string }[];
    usage: { input_tokens: number; output_tokens: number };
    stop_reason: string | null;
  }>;
}

const TIMEOUT_MS = 25_000;

export function createLlm(env: LlmEnv, opts: { now?: () => Date; messages?: MessagesApi } = {}): Llm {
  const now = opts.now ?? (() => new Date());
  const model = env.MALYA_MODEL?.trim() || DEFAULT_MODEL;
  const budgetEur = Number(env.MALYA_MONTHLY_BUDGET_EUR ?? "15");
  const cap = capMicro(budgetEur, env.MALYA_FX_USD_PER_EUR ? Number(env.MALYA_FX_USD_PER_EUR) : 1.0);

  async function plan(): Promise<PlanResult> {
    if (env.MALYA_EMERGENCY_STOP === "true") return { ok: false, reason: "emergency_stop" };
    if (env.MALYA_ENABLED !== "true") return { ok: false, reason: "disabled" };
    if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: "no_api_key" };
    if (!priceFor(model)) return { ok: false, reason: "unknown_model" };
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
    const maxTokens = Math.min(req.limits.maxOutputTokens, p.limits.maxOutputTokens);
    const worst = costMicro(model, estimateTokens(req.inputChars), maxTokens);
    if (worst === null) return { ok: false, reason: "unknown_model" };

    let reserved = false;
    try {
      reserved = await reserve(db, now(), worst, cap);
      if (!reserved) {
        await noteBlocked(db, now()).catch(() => {});
        return { ok: false, reason: "budget_exhausted" };
      }
    } catch {
      return { ok: false, reason: "budget_unavailable" };
    }

    const api = opts.messages ?? (new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS }).messages as unknown as MessagesApi);
    try {
      const res = await api.create(
        { model, max_tokens: maxTokens, system: req.system, messages: req.messages, output_config: { effort: "low" } },
        { timeout: TIMEOUT_MS },
      );
      const inTok = res.usage.input_tokens;
      const outTok = res.usage.output_tokens;
      const refused = res.stop_reason === "refusal";
      await settle(db, now(), worst, model, inTok, outTok, refused);
      if (refused) return { ok: false, reason: "refusal" };
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) return { ok: false, reason: "empty_reply" };
      return { ok: true, text, inputTokens: inTok, outputTokens: outTok, state: p.state, model };
    } catch (error) {
      const status = (error as { status?: number }).status;
      // Rejet avant traitement (4xx hors délai) : rien n'a été facturé, on libère la réservation.
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409) {
        await release(db, now(), worst).catch(() => {});
      } else {
        await noteError(db, now()).catch(() => {}); // incertain : la réservation reste comptée
      }
      const name = (error as { name?: string }).name ?? "";
      return { ok: false, reason: /timeout/i.test(name) || status === 408 ? "timeout" : "provider_error" };
    }
  }

  return { plan, call };
}

export const REASON_LABEL: Record<LlmFailure, { fr: string; en: string }> = {
  disabled: { fr: "Le service conversationnel n'est pas activé.", en: "The conversational service is not enabled." },
  emergency_stop: { fr: "Le service conversationnel est suspendu (arrêt d'urgence).", en: "The conversational service is suspended (emergency stop)." },
  no_api_key: { fr: "Le fournisseur d'IA n'est pas configuré.", en: "The AI provider is not configured." },
  unknown_model: { fr: "Le modèle configuré n'a pas de tarif vérifié.", en: "The configured model has no verified price." },
  budget_unavailable: { fr: "Le contrôle du budget est indisponible : les appels payants sont suspendus par précaution.", en: "Budget control is unavailable: paid calls are suspended as a precaution." },
  budget_suspended: { fr: "Le budget mensuel est presque atteint : les nouveaux appels payants sont suspendus.", en: "The monthly budget is nearly reached: new paid calls are suspended." },
  budget_exhausted: { fr: "Le budget mensuel est atteint : MALYA répond depuis sa base documentaire.", en: "The monthly budget is reached: MALYA answers from its documentary base." },
  provider_error: { fr: "Le fournisseur d'IA est momentanément indisponible.", en: "The AI provider is temporarily unavailable." },
  timeout: { fr: "Le fournisseur d'IA a mis trop de temps à répondre.", en: "The AI provider took too long to respond." },
  refusal: { fr: "Le modèle a décliné cette demande.", en: "The model declined this request." },
  empty_reply: { fr: "Le modèle n'a pas renvoyé de réponse exploitable.", en: "The model returned no usable reply." },
};
