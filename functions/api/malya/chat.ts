/**
 * POST /api/malya/chat — point d'entrée HTTP de MALYA.
 *
 * Zero Trust : tout est vérifié côté serveur, jamais déduit du client.
 *  - désactivé par défaut (MALYA_ENABLED=true requis) ;
 *  - origine identique obligatoire (pas d'appel inter-sites) ;
 *  - corps borné, JSON strict ;
 *  - limitation de débit par IP hachée (KV existant) ;
 *  - aucune conversation conservée ni journalisée ;
 *  - interrupteur d'urgence MALYA_SENSITIVE_SUSPENDED pour actions/mémoire.
 * Aucun secret n'est lu ici : la V1 n'appelle aucun service payant.
 */
import { json } from "../../lib/json.ts";
import { checkMalyaRate, pruneRate } from "../../lib/malya/rateLimit.ts";
import { handleTurn, type AuditEvent } from "../../lib/malya/orchestrator.ts";
import type { ChatRequest } from "../../lib/malya/types.ts";
import { createLlm, type AiBinding } from "../../lib/malya/llm.ts";

interface Env {
  /** Binding Workers AI (wrangler.toml [env.preview.ai]). */
  AI?: AiBinding;
  MALYA_ENABLED?: string;
  /** Seule valeur acceptée : « cloudflare ». */
  MALYA_AI_PROVIDER?: string;
  MALYA_MODEL?: string;
  MALYA_DAILY_NEURON_CAP?: string;
  /** Secret du tableau de bord : coupe l'inférence, les transmissions et la mémoire serveur ; le documentaire reste servi. */
  MALYA_EMERGENCY_STOP?: string;
  MALYA_SENSITIVE_SUSPENDED?: string;
  DB?: D1Database;
}

const MAX_BODY_BYTES = 16 * 1024;

function audit(event: AuditEvent): void {
  // Événement seul, jamais le contenu : pas de donnée personnelle dans les journaux.
  console.warn(JSON.stringify({ malya: event.type, skill: event.skill ?? null }));
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.MALYA_ENABLED !== "true") return json({ error: "suspended" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "invalid" }, 415);

  // Limitation de débit ATOMIQUE (D1) : par IP hachée puis globale ; échec fermé si la base est illisible.
  const verdict = await checkMalyaRate(env.DB, request);
  if (!verdict.ok) {
    if (verdict.reason === "unavailable") return json({ error: "suspended" }, 503);
    return json({ error: "rate_limited", scope: verdict.reason }, 429, { "Retry-After": String(verdict.retryAfter) });
  }
  // Purge déterministe des fenêtres expirées (toutes les 25 requêtes) : aucune IP hachée ne traîne indéfiniment.
  if (env.DB && verdict.globalCount % 25 === 1) await pruneRate(env.DB, Date.now()).catch(() => {});

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid" }, 400);

  const reply = await handleTurn(body as ChatRequest, {
    sensitiveSuspended: env.MALYA_SENSITIVE_SUSPENDED === "true" || env.MALYA_EMERGENCY_STOP === "true",
    llm: createLlm(env),
    audit,
  });
  return json(reply as unknown as Record<string, unknown>, 200);
};

// Toute autre méthode : refusée explicitement.
export const onRequest: PagesFunction<Env> = async () => json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
