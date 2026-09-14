import OpenAI from "openai";
import { loadConfig } from "../config/env.ts";

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

export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** Calls the model with a JSON Schema-constrained response and returns the parsed object, typed by the caller. */
export async function structuredCompletion<T>(params: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
}): Promise<T> {
  const openai = getOpenAiClient();
  const completion = await openai.chat.completions.create({
    model: params.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error(`Réponse OpenAI vide pour ${params.schemaName}.`);
  return JSON.parse(content) as T;
}
