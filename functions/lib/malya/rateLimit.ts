/**
 * Limitation de débit atomique pour MALYA (D1).
 *
 * Le compteur KV du reste du site lit puis écrit : deux requêtes simultanées lisent la
 * même valeur et passent toutes les deux. Ici, l'incrément est UNE instruction SQL
 * (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) : D1 la sérialise, donc exactement
 * `limit` requêtes passent par fenêtre, même en parallèle.
 *
 * Deux plafonds : par IP (hachée) et global, ce dernier protégeant la disponibilité et
 * le budget contre une attaque distribuée. Échec fermé : base illisible = refus.
 */
async function hashIp(ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export interface Hit { allowed: boolean; count: number }

export async function hit(db: D1Database, key: string, limit: number, windowSeconds: number, nowMs: number): Promise<Hit> {
  const row = await db
    .prepare(
      `INSERT INTO malya_rate (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         window_start = CASE WHEN malya_rate.window_start <= ?2 - ?3 THEN ?2 ELSE malya_rate.window_start END,
         count = CASE WHEN malya_rate.window_start <= ?2 - ?3 THEN 1 ELSE malya_rate.count + 1 END
       RETURNING count`,
    )
    .bind(key, nowMs, windowSeconds * 1000)
    .first<{ count: number }>();
  const count = row?.count ?? Number.POSITIVE_INFINITY;
  return { allowed: count <= limit, count };
}

export const LIMITS = { perIp: { limit: 30, windowSeconds: 600 }, global: { limit: 1200, windowSeconds: 3600 } } as const;

export type Verdict = { ok: true; globalCount: number } | { ok: false; reason: "ip" | "global" | "unavailable"; retryAfter: number };

export async function checkMalyaRate(db: D1Database | undefined, request: Request, nowMs: number = Date.now()): Promise<Verdict> {
  if (!db) return { ok: false, reason: "unavailable", retryAfter: 60 };
  try {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const mine = await hit(db, "ip:" + (await hashIp(ip)), LIMITS.perIp.limit, LIMITS.perIp.windowSeconds, nowMs);
    if (!mine.allowed) return { ok: false, reason: "ip", retryAfter: LIMITS.perIp.windowSeconds };
    const all = await hit(db, "global", LIMITS.global.limit, LIMITS.global.windowSeconds, nowMs);
    if (!all.allowed) return { ok: false, reason: "global", retryAfter: LIMITS.global.windowSeconds };
    return { ok: true, globalCount: all.count };
  } catch {
    return { ok: false, reason: "unavailable", retryAfter: 60 };
  }
}

/** Nettoyage des fenêtres expirées (appelé de temps à autre, sans effet sur les compteurs actifs). */
export async function pruneRate(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("DELETE FROM malya_rate WHERE window_start < ?1").bind(nowMs - 24 * 3600 * 1000).run();
}
