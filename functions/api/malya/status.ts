/**
 * GET /api/malya/status — état public minimal : MALYA répond-elle avec le modèle
 * ou depuis sa base documentaire seule ? Aucun montant, aucun compteur, aucun secret :
 * le détail budgétaire n'est visible que dans l'administration.
 */
import { json } from "../../lib/json.ts";
import { createLlm, REASON_LABEL, type LlmEnv } from "../../lib/malya/llm.ts";

export const onRequestGet: PagesFunction<LlmEnv> = async ({ env }) => {
  if (env.MALYA_ENABLED !== "true") return json({ available: false }, 503);
  const plan = await createLlm(env).plan();
  if (plan.ok) return json({ available: true, mode: "ai" }, 200);
  return json({ available: true, mode: "documentary", reason: plan.reason, message: REASON_LABEL[plan.reason] }, 200);
};
