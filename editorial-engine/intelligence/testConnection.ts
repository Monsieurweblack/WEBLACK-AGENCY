import { getOpenAiClient } from "./openaiClient.ts";

export interface OpenAiConnectionResult {
  ok: boolean;
  message: string;
}

/**
 * A real, minimal API call (list models — free, no generation) to confirm
 * the key actually works, not just that it's present. Never logs the key
 * itself; on failure, only the API's own error message is surfaced (which
 * OpenAI does not embed the key into).
 */
export async function testOpenAiConnection(): Promise<OpenAiConnectionResult> {
  try {
    const client = getOpenAiClient();
    const models = await client.models.list();
    const count = models.data.length;
    return { ok: true, message: `Clé valide — ${count} modèle(s) accessible(s).` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Échec de connexion OpenAI: ${message}` };
  }
}
