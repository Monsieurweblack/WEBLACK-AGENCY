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
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { handleTurn, type AuditEvent } from "../../lib/malya/orchestrator.ts";
import type { ChatRequest } from "../../lib/malya/types.ts";

interface Env {
  MALYA_ENABLED?: string;
  MALYA_SENSITIVE_SUSPENDED?: string;
  PHOTOS?: KVNamespace;
}

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 10 * 60;

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
  if (!env.PHOTOS) return json({ error: "suspended" }, 503); // sans compteur de débit, on ne sert pas (échec fermé)

  const rate = await checkRateLimit(env.PHOTOS, request, "malya-chat", RATE_LIMIT, RATE_WINDOW_SECONDS);
  if (!rate.allowed) return json({ error: "rate_limited" }, 429, { "Retry-After": String(RATE_WINDOW_SECONDS) });

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
    sensitiveSuspended: env.MALYA_SENSITIVE_SUSPENDED === "true",
    audit,
  });
  return json(reply as unknown as Record<string, unknown>, 200);
};

// Toute autre méthode : refusée explicitement.
export const onRequest: PagesFunction<Env> = async () => json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
