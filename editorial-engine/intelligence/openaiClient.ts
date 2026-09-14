import OpenAI from "openai";
import { loadConfig } from "../config/env.ts";
import { recordTrace, type TraceEvent } from "../logs/observability.ts";
import { log } from "../logs/logger.ts";

let client: OpenAI | undefined;

export function getOpenAiClient(): OpenAI {
  const config = loadConfig();
  if (!config.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY absent de .env — requis pour l'analyse éditoriale, l'extraction des faits et la génération. Voir editorial-engine/.env.example.",
    );
  }
  if (client) return client;
  client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

/** Legacy alias kept for callers that don't (yet) pass a specific step/model — resolves to the shared default model. */
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export function isRetryable(error: unknown): boolean {
  // OpenAI SDK errors expose `status` for HTTP errors. 429 (rate limit) and
  // any 5xx are transient — retry. 4xx other than 429 (bad request, auth,
  // invalid schema) will never succeed on retry, so fail fast instead of
  // burning attempts and quietly waiting on a request that can't work.
  const status = (error as { status?: number })?.status;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  if (status !== undefined) return false;
  return true; // network-level errors (no status) — worth a retry
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface StructuredCompletionParams {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  step: TraceEvent["step"];
  runId: string;
  sourceUrl?: string;
}

/**
 * Calls the model with a JSON Schema-constrained response, retrying
 * transient failures with exponential backoff (§12), and records one
 * observability trace per attempt sequence (§10) — never the key, only
 * step/model/latency/token usage/outcome. One logical call here always
 * means exactly one set of retries for the SAME request; a retry re-sends
 * the identical prompt, so it can only reproduce the same article, not
 * generate a different one for the same source (the risk the brief
 * flags — see idempotency test in editorial-engine/tests/).
 */
export async function structuredCompletion<T>(params: StructuredCompletionParams): Promise<T> {
  const openai = getOpenAiClient();
  const model = params.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: params.schemaName, strict: true, schema: params.schema },
        },
      });
      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error(`Réponse OpenAI vide pour ${params.schemaName}.`);

      recordTrace({
        runId: params.runId,
        sourceUrl: params.sourceUrl,
        model,
        step: params.step,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        success: true,
        tokenUsage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      });
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error) && attempt < MAX_RETRIES;
      log(
        "ERROR",
        `OpenAI ${params.schemaName} tentative ${attempt}/${MAX_RETRIES} échouée: ${error instanceof Error ? error.message : error}${retryable ? " — retry" : ""}`,
      );
      if (!retryable) {
        recordTrace({
          runId: params.runId,
          sourceUrl: params.sourceUrl,
          model,
          step: params.step,
          timestamp: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
