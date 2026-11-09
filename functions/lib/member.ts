/**
 * Espace membre WEBLACK TALENT — connexion sans mot de passe.
 *
 * Lien magique : jeton aléatoire de 256 bits, seule son empreinte SHA-256
 * est stockée, usage unique (consommation atomique), expiration 15 minutes.
 * Le lien porte le jeton dans le FRAGMENT d'URL (#t=…) : il n'atteint jamais
 * les journaux du serveur ni l'en-tête Referer ; la page le lit puis le
 * présente en POST à /api/member/verify.
 *
 * Session : ligne member_sessions (révocable), cookie HttpOnly/Secure/Lax
 * portant uniquement l'identifiant de session signé (HMAC). La clé de
 * signature est DÉRIVÉE du secret d'administration existant (HMAC avec une
 * étiquette propre) : aucun nouveau secret à gérer, et un cookie membre ne
 * peut jamais être confondu avec un cookie d'administration.
 *
 * Niveau : déduit des statuts des candidatures de la personne (seule source
 * de vérité), jamais stocké.
 */
import { normalizeEmail } from "./contacts.ts";
import { E164_RE, INSTAGRAM_RE, isHttpUrl, normalizePhone } from "./validation.ts";
import { TEXT_LIMITS } from "./talentOptions.ts";

export const MEMBER_COOKIE = "weblack_member_session";
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const MEMBER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
}

/** Clé de session membre, dérivée du secret d'administration (étiquette distincte). */
export async function memberKey(adminSecret: string): Promise<string> {
  return hmac(adminSecret, "weblack-member-session-v1");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface MemberEnv {
  DB: D1Database;
  ADMIN_SESSION_SECRET?: string;
}

// --- Jetons de connexion -------------------------------------------------------------

export async function createLoginToken(db: D1Database, email: string, now = Date.now()): Promise<string> {
  const token = randomToken();
  await db
    .prepare(`INSERT INTO member_login_tokens (id, email, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), normalizeEmail(email), await sha256(token), new Date(now).toISOString(), new Date(now + LOGIN_TOKEN_TTL_MS).toISOString())
    .run();
  return token;
}

/** Consomme un jeton : une seule fois, avant expiration. Renvoie l'adresse, ou null. */
export async function consumeLoginToken(db: D1Database, token: string, now = Date.now()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const hash = await sha256(token);
  const nowIso = new Date(now).toISOString();
  // Mise à jour conditionnelle : deux consommations simultanées ne peuvent pas réussir toutes les deux.
  const result = await db
    .prepare(`UPDATE member_login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(nowIso, hash, nowIso)
    .run();
  if (result.meta.changes !== 1) return null;
  const row = await db.prepare(`SELECT email FROM member_login_tokens WHERE token_hash = ?`).bind(hash).first<{ email: string }>();
  return row?.email ?? null;
}

// --- Sessions ------------------------------------------------------------------------

export async function createSession(env: MemberEnv, email: string, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO member_sessions (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, normalizeEmail(email), new Date(now).toISOString(), new Date(now + MEMBER_SESSION_TTL_MS).toISOString())
    .run();
  const signature = await hmac(await memberKey(env.ADMIN_SESSION_SECRET!), id);
  return `${MEMBER_COOKIE}=${id}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(MEMBER_SESSION_TTL_MS / 1000)}`;
}

export function clearMemberCookie(): string {
  return `${MEMBER_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(request: Request): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === MEMBER_COOKIE) return rest.join("=");
  }
  return undefined;
}

export interface MemberSession {
  id: string;
  email: string;
}

/** Session valide (signature, existence, non révoquée, non expirée) ou null. */
export async function readMemberSession(env: MemberEnv, request: Request, now = Date.now()): Promise<MemberSession | null> {
  if (!env.ADMIN_SESSION_SECRET) return null;
  const value = readCookie(request);
  if (!value) return null;
  const [id, signature] = value.split(".");
  if (!id || !signature || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = await hmac(await memberKey(env.ADMIN_SESSION_SECRET), id);
  if (!timingSafeEqual(expected, signature)) return null;
  const row = await env.DB.prepare(`SELECT id, email FROM member_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`)
    .bind(id, new Date(now).toISOString())
    .first<MemberSession>();
  return row ?? null;
}

export async function revokeSession(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE member_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(new Date().toISOString(), id).run();
}

/** Écritures de l'espace membre : uniquement depuis le site lui-même (défense CSRF en plus de SameSite). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

// --- Niveau et profil ----------------------------------------------------------------

export type MemberLevel = "candidate" | "activated" | "represented";

export function levelOf(statuses: string[]): MemberLevel {
  if (statuses.includes("REPRESENTED")) return "represented";
  if (statuses.some((s) => s === "SELECTED" || s === "TALENT_POOL")) return "activated";
  return "candidate";
}

/**
 * Libellé visible par la personne. Les étapes internes de tri ne sont pas
 * exposées une à une ; les notes internes ne le sont jamais.
 */
export function publicStatus(status: string): string {
  switch (status) {
    case "RECEIVED":
      return "received";
    case "REVIEWING":
    case "TO_CONTACT":
      return "in_review";
    case "INFO_REQUESTED":
      return "info_requested";
    case "SHORTLISTED":
    case "INTERVIEW":
    case "SELECTED":
      return "in_progress";
    case "TALENT_POOL":
      return "talent_pool";
    case "REPRESENTED":
      return "represented";
    case "REJECTED":
      return "not_selected";
    default:
      return "archived";
  }
}

export interface MemberApplicationView {
  reference: string;
  createdAt: string;
  status: string;
  category: string | null;
  firstName: string;
  lastName: string;
  city: string;
  country: string;
  phone: string;
  instagram: string | null;
  portfolioLinks: string[];
  availability: string | null;
  contactPref: string | null;
  updatedByMemberAt: string | null;
}

interface AppRow {
  id: string;
  created_at: string;
  status: string;
  talent_category: string | null;
  first_name: string;
  last_name: string;
  city: string;
  country: string;
  phone: string;
  instagram: string | null;
  portfolio_links: string | null;
  member_availability: string | null;
  member_contact_pref: string | null;
  member_updated_at: string | null;
}

export async function memberApplications(db: D1Database, email: string): Promise<{ rows: AppRow[]; views: MemberApplicationView[] }> {
  const { results } = await db
    .prepare(
      `SELECT id, created_at, status, talent_category, first_name, last_name, city, country, phone, instagram, portfolio_links, member_availability, member_contact_pref, member_updated_at
       FROM applications WHERE lower(email) = ? ORDER BY created_at DESC`,
    )
    .bind(normalizeEmail(email))
    .all<AppRow>();
  const rows = results ?? [];
  return {
    rows,
    views: rows.map((r) => ({
      reference: r.id.slice(0, 8).toUpperCase(),
      createdAt: r.created_at,
      status: publicStatus(r.status),
      category: r.talent_category,
      firstName: r.first_name,
      lastName: r.last_name,
      city: r.city,
      country: r.country,
      phone: r.phone,
      instagram: r.instagram,
      portfolioLinks: (r.portfolio_links ?? "").split("\n").filter(Boolean),
      availability: r.member_availability,
      contactPref: r.member_contact_pref,
      updatedByMemberAt: r.member_updated_at,
    })),
  };
}

export const CONTACT_PREFS = ["email", "phone", "none"] as const;
export const AVAILABILITY_MAX = 280;

export interface ProfileUpdate {
  phone?: string;
  city?: string;
  instagram?: string | null;
  portfolioLinks?: string[];
  availability?: string | null;
  contactPref?: string;
}

/** Valide une mise à jour de profil. Renvoie les colonnes à écrire, ou les erreurs par champ. */
export function parseProfileUpdate(raw: unknown): { ok: true; sets: Record<string, string | null> } | { ok: false; errors: { field: string; reason: string }[] } {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const errors: { field: string; reason: string }[] = [];
  const sets: Record<string, string | null> = {};
  const clean = (v: string) => v.replace(/[\u0000-\u001F\u007F]/g, " ").trim();

  if (body.phone !== undefined) {
    const phone = typeof body.phone === "string" ? normalizePhone(clean(body.phone)) : "";
    if (!E164_RE.test(phone)) errors.push({ field: "phone", reason: "format" });
    else sets.phone = phone;
  }
  if (body.city !== undefined) {
    const city = typeof body.city === "string" ? clean(body.city) : "";
    if (!city) errors.push({ field: "city", reason: "required" });
    else if (city.length > TEXT_LIMITS.city) errors.push({ field: "city", reason: "too_long" });
    else sets.city = city;
  }
  if (body.instagram !== undefined) {
    const ig = typeof body.instagram === "string" ? clean(body.instagram) : "";
    if (ig && (ig.length > TEXT_LIMITS.instagram || !INSTAGRAM_RE.test(ig))) errors.push({ field: "instagram", reason: "format" });
    else sets.instagram = ig || null;
  }
  if (body.portfolioLinks !== undefined) {
    const links = Array.isArray(body.portfolioLinks) ? body.portfolioLinks.filter((l): l is string => typeof l === "string").map(clean).filter(Boolean) : null;
    if (!links || links.length > TEXT_LIMITS.portfolioLinksCount || links.some((l) => l.length > TEXT_LIMITS.portfolioLink || !isHttpUrl(l))) {
      errors.push({ field: "portfolioLinks", reason: "format" });
    } else sets.portfolio_links = links.join("\n") || null;
  }
  if (body.availability !== undefined) {
    const a = typeof body.availability === "string" ? clean(body.availability) : "";
    if (a.length > AVAILABILITY_MAX) errors.push({ field: "availability", reason: "too_long" });
    else sets.member_availability = a || null;
  }
  if (body.contactPref !== undefined) {
    if (typeof body.contactPref !== "string" || !(CONTACT_PREFS as readonly string[]).includes(body.contactPref)) errors.push({ field: "contactPref", reason: "invalid" });
    else sets.member_contact_pref = body.contactPref;
  }
  if (errors.length) return { ok: false, errors };
  if (!Object.keys(sets).length) return { ok: false, errors: [{ field: "_", reason: "no_changes" }] };
  return { ok: true, sets };
}
