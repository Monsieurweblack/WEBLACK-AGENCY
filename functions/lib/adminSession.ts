/**
 * Session admin — un cookie signé (HMAC-SHA256), sans état côté serveur :
 * rien à stocker, rien à révoquer individuellement (une rotation de
 * ADMIN_SESSION_SECRET invalide toutes les sessions d'un coup, ce qui
 * suffit pour une équipe restreinte).
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

export async function isValidAdminSession(request: Request, secret: string): Promise<boolean> {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [issuedAt, nonce, signature] = parts as [string, string, string];

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_SECONDS * 1000) return false;

  const expected = await hmac(secret, `${issuedAt}.${nonce}`);
  return timingSafeEqual(expected, signature);
}

/** Garde commune à toute route admin : renvoie `undefined` si la session est valide, sinon la réponse 401/503 à retourner directement. */
export async function requireAdmin(request: Request, secret: string | undefined): Promise<Response | undefined> {
  if (!secret) return new Response(JSON.stringify({ ok: false, reason: "unconfigured" }), { status: 503 });
  const valid = await isValidAdminSession(request, secret);
  if (!valid) return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), { status: 401 });
  return undefined;
}
