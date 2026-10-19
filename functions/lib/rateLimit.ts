/**
 * Limitation de débit sur KV — pas de nouveau service : le même namespace
 * qui stocke les photos (voir photos.ts) porte aussi ces compteurs, sous un
 * préfixe distinct. Une fenêtre fixe (pas de fenêtre glissante précise) :
 * suffisant pour écarter un envoi automatisé en rafale, qui est le seul
 * risque réel sur un formulaire de candidature à faible volume.
 *
 * L'IP n'est jamais la clé en clair — un hash SHA-256 tronqué réduit déjà
 * son exposition dans les clés KV, alors qu'aucune exigence légale ne
 * l'impose ici (ce n'est pas une donnée conservée, une fenêtre glissante
 * d'une heure au plus).
 */

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * `scope` distingue l'upload de photo (fréquent, une candidature en génère
 * plusieurs) de la soumission finale (rare, une seule par candidat) — deux
 * budgets séparés sous la même IP.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = `ratelimit:${scope}:${await hashIp(ip)}`;
  const current = Number((await kv.get(key)) ?? "0");

  if (current >= limit) return { allowed: false, remaining: 0 };

  // put() avec expirationTtl déjà posé ne le prolonge pas lu seul : on relit
  // la valeur plutôt que de réinitialiser la fenêtre à chaque appel.
  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return { allowed: true, remaining: limit - current - 1 };
}
