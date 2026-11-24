/**
 * Actions externes — jamais sans validation explicite.
 *
 * La seule action de la V1 est de PRÉPARER la transmission d'une demande à
 * l'équipe WEBLACK. Le serveur ne l'envoie pas : après confirmation, il
 * renvoie un brouillon `mailto:` que l'utilisateur doit encore envoyer
 * depuis son propre client mail (même mécanisme que les formulaires du
 * site). Deux validations humaines, donc.
 */
import type { ActionProposal } from "./types.ts";
import { LIMITS, cleanText, singleLine } from "./safety.ts";

export const HANDOFF_RECIPIENT = "weblackconsulting@gmail.com";

export async function digestOf(draft: string): Promise<string> {
  const bytes = new TextEncoder().encode(draft);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function proposeHandoff(draft: string, lang: "fr" | "en"): Promise<ActionProposal | null> {
  const clean = cleanText(draft).slice(0, LIMITS.draftChars);
  if (clean.length < 10) return null;
  return {
    kind: "transmit_request",
    digest: await digestOf(clean),
    recipient: HANDOFF_RECIPIENT,
    summary: lang === "fr"
      ? `Préparer un e-mail à ${HANDOFF_RECIPIENT} avec ce contenu. Rien n'est envoyé tant que vous n'avez pas validé puis envoyé le message depuis votre messagerie.`
      : `Prepare an email to ${HANDOFF_RECIPIENT} with this content. Nothing is sent until you confirm and then send the message from your own mail app.`,
  };
}

/** Vérifie que ce qui est confirmé est exactement ce qui a été proposé. */
export async function confirmHandoff(draft: string, digest: string, lang: "fr" | "en"): Promise<{ mailto: string } | null> {
  const clean = cleanText(draft).slice(0, LIMITS.draftChars);
  if (clean.length < 10) return null;
  if ((await digestOf(clean)) !== digest) return null;
  const subject = singleLine(lang === "fr" ? "Demande via MALYA — WEBLACK" : "Request via MALYA — WEBLACK");
  const body = clean.slice(0, 1800);
  return { mailto: `mailto:${HANDOFF_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}
