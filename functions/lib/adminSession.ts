/**
 * Session admin — un cookie signé (HMAC-SHA256), valable 12 h. Seul état
 * côté serveur : la liste des sessions fermées par « Se déconnecter »
 * (KV, jusqu'à leur expiration naturelle). Une rotation de
 * ADMIN_SESSION_SECRET invalide toutes les sessions d'un coup.
 *
 * Le mot de passe lui-même (ADMIN_PASSWORD) n'est comparé qu'une fois, à la
 * connexion (login.ts) — ce fichier ne le connaît pas, il ne signe qu'un
 * jeton après coup. Comparaison à temps constant pour éviter qu'une mesure
 * de latence révèle la longueur du préfixe correct.
 */

const SESSION_COOKIE = "weblack_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(secret: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const nonce = crypto.randomUUID();
  const payload = `${issuedAt}.${nonce}`;
  const signature = await hmac(secret, payload);
  const value = `${payload}.${signature}`;
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** Session lue depuis le cookie, signature et âge vérifiés ; `undefined` sinon. */
async function readSession(request: Request, secret: string): Promise<{ nonce: string; expiresAt: number } | undefined> {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return undefined;

  const parts = value.split(".");
  if (parts.length !== 3) return undefined;
  const [issuedAt, nonce, signature] = parts as [string, string, string];

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_SECONDS * 1000) return undefined;

  const expected = await hmac(secret, `${issuedAt}.${nonce}`);
  if (!timingSafeEqual(expected, signature)) return undefined;
  return { nonce, expiresAt: Number(issuedAt) + SESSION_TTL_SECONDS * 1000 };
}

/**
 * Révocation à la déconnexion : le jeton reste signé, mais son nonce est
 * inscrit dans KV jusqu'à son expiration naturelle — un cookie copié avant
 * la déconnexion ne rouvre plus la session.
 */
const revokedKey = (nonce: string) => `admin-session-revoked:${nonce}`;

export async function isValidAdminSession(request: Request, secret: string, kv?: KVNamespace): Promise<boolean> {
  const session = await readSession(request, secret);
  if (!session) return false;
  if (kv && (await kv.get(revokedKey(session.nonce))) !== null) return false;
  return true;
}

export async function revokeAdminSession(request: Request, secret: string, kv: KVNamespace): Promise<void> {
  const session = await readSession(request, secret);
  if (!session) return;
  // KV impose un TTL d'au moins 60 s.
  const ttl = Math.max(60, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await kv.put(revokedKey(session.nonce), "1", { expirationTtl: ttl });
}

/** Garde commune à toute route admin : renvoie `undefined` si la session est valide, sinon la réponse 401/503 à retourner directement. */
export async function requireAdmin(request: Request, secret: string | undefined, kv?: KVNamespace): Promise<Response | undefined> {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!secret) return new Response(JSON.stringify({ ok: false, reason: "unconfigured" }), { status: 503, headers });
  const valid = await isValidAdminSession(request, secret, kv);
  if (!valid) return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), { status: 401, headers });
  return undefined;
}

/**
 * Comparaison de deux secrets sans fuite de longueur ni de préfixe : on
 * compare leurs empreintes SHA-256, de longueur fixe, à temps constant.
 */
export async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return timingSafeEqual(await digest(candidate), await digest(expected));
}

/** Identifiants générés par crypto.randomUUID() — tout autre format est refusé avant d'interroger D1/KV. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
