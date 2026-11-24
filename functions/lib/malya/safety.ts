/**
 * Défenses de MALYA — trois couches indépendantes :
 *  1. entrée : bornage, nettoyage, détection d'injection de prompt ;
 *  2. outils : chaque compétence n'appelle que les outils qu'elle déclare
 *     (voir skills.ts, assertToolAllowed) ;
 *  3. sortie : aucune image/lien arbitraire, aucun motif de secret.
 * Aucune de ces couches ne prétend rendre le système invulnérable : elles
 * réduisent la surface et sont couvertes par des tests (safety.test.ts).
 */
import type { ChatTurn } from "./types.ts";

export const LIMITS = {
  messageChars: 2000,
  historyTurns: 20,
  draftChars: 3000,
} as const;

/** Retire les caractères de contrôle et les séparateurs invisibles ; compacte les espaces. */
export function cleanText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateTurns(history: unknown): { ok: true; turns: ChatTurn[] } | { ok: false } {
  if (history === undefined) return { ok: true, turns: [] };
  if (!Array.isArray(history) || history.length > LIMITS.historyTurns) return { ok: false };
  const turns: ChatTurn[] = [];
  for (const t of history) {
    if (!t || typeof t !== "object") return { ok: false };
    const { role, content } = t as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || content.length > LIMITS.messageChars) return { ok: false };
    turns.push({ role, content: cleanText(content) });
  }
  return { ok: true, turns };
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s/<>\[\]:]/g, " ").replace(/\s+/g, " ");
}

const INJECTION_PATTERNS: RegExp[] = [
  /(ignore|ignorez|oublie|oubliez|disregard|forget|override|bypass|contourne)\b.{0,40}\b(instruction|instructions|consigne|consignes|regle|regles|rules|prompt|guideline|guidelines|previous|precedent|precedentes|above|ci dessus)/,
  /(reveal|show|print|display|affiche|montre|donne|revele|dis moi|repete|repeat|leak).{0,40}\b(system prompt|prompt systeme|instructions? systeme|tes instructions|your instructions|hidden instructions|initial prompt|developer message)/,
  /\b(system prompt|prompt systeme|developer mode|mode developpeur|jailbreak|dan mode)\b/,
  /\b(you are now|tu es maintenant|from now on you|a partir de maintenant tu|agis comme|act as|pretend to be|fais semblant)\b.{0,60}\b(without|sans|no)\b.{0,20}\b(rule|rules|restriction|restrictions|limite|limites|filter|filtre)/,
  /(api key|cle api|apikey|secret|token|password|mot de passe|credentials?|identifiants?)\b.{0,40}\b(give|show|send|donne|montre|envoie|affiche|reveal|revele|print)|\b(give|show|send|donne|montre|envoie|affiche|reveal|revele|print)\b.{0,40}\b(api key|cle api|apikey|secret|token|password|mot de passe|credentials?|identifiants?)/,
  /\b(other|another|autres?|someone else|quelqu un d autre)\s*(users?|utilisateurs?|clients?|customers?|personnes?|people)?\b.{0,80}\b(conversations?|data|donnees|messages?|emails?|history|historique|projects?|projets?)\b/,
  /\b(conversations?|data|donnees|messages?|emails?|history|historique)\b.{0,60}\b(other|another|autres?|someone else|quelqu un d autre)\s*(users?|utilisateurs?|clients?|customers?|personnes?|people)\b/,

  /!\[[^\]]*\]\(\s*https?:/,
  /<\s*(script|iframe|img|svg)\b/,
  /\[\s*(system|assistant)\s*\]|^\s*(system|assistant)\s*:/m,
];

export function detectInjection(text: string): boolean {
  const folded = fold(text);
  return INJECTION_PATTERNS.some((p) => p.test(folded)) || INJECTION_PATTERNS.some((p) => p.test(text.toLowerCase()));
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b[A-Za-z0-9+/]{48,}={0,2}\b/g,
];

/**
 * Filtre de sortie. `allowedUrls` = URL des sources citées + weblack.fr.
 * Toute autre URL est retirée : c'est la barrière contre l'exfiltration par
 * lien ou par image distante.
 */
export function sanitizeOutput(text: string, allowedUrls: string[] = []): string {
  let out = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  out = out.replace(/<[^>]*>/g, "");
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[masqué]");
  out = out.replace(/\bhttps?:\/\/[^\s)<>"']+/gi, (url) => {
    try {
      const u = new URL(url);
      const ok = allowedUrls.some((a) => {
        const allowed = new URL(a);
        return u.hostname === allowed.hostname && u.pathname.startsWith(allowed.pathname.replace(/\/$/, ""));
      });
      return ok || /^(www\.)?weblack\.fr$/.test(u.hostname) ? url : "[lien retiré]";
    } catch {
      return "[lien retiré]";
    }
  });
  return out.trim();
}

/** Retire les sauts de ligne d'un champ destiné à un en-tête (sujet de mail). */
export function singleLine(text: string, max = 120): string {
  return cleanText(text).replace(/[\r\n]+/g, " ").slice(0, max);
}
