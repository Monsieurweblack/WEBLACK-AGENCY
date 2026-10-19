/**
 * Envoi d'e-mails — même compte Resend que functions/api/newsletter.ts
 * (NEWSLETTER_API_KEY), pas un nouveau service. Le dépôt ne décide pas du
 * domaine d'expédition : RESEND_FROM doit être une adresse d'un domaine
 * vérifié dans Resend, sinon Resend refuse l'envoi (et ce refus est
 * enregistré tel quel, jamais maquillé en succès — voir talentOutbox.ts).
 *
 * Résultat structuré plutôt qu'un booléen : l'appelant doit pouvoir
 * distinguer « accepté par le fournisseur » d'un refus, et garder une trace
 * exploitable du refus SANS donnée personnelle. Seuls le code HTTP et le
 * `name` d'erreur Resend (ex. validation_error) sont conservés — jamais le
 * `message`, qui peut recopier l'adresse du destinataire.
 */

export interface SendArgs {
  apiKey: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Clé d'idempotence Resend : deux appels portant la même clé dans les 24 h
   * ne produisent qu'un seul e-mail. Protège contre un renvoi après une
   * réponse perdue (le fournisseur avait accepté, on ne l'a pas su).
   */
  idempotencyKey?: string;
}

export type SendResult = { ok: true; providerId: string | null } | { ok: false; error: string };

const SEND_TIMEOUT_MS = 10_000;

export async function sendEmail({ apiKey, from, to, replyTo, subject, text, html, idempotencyKey }: SendArgs): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }

  let body: { id?: unknown; name?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Corps illisible : le code HTTP suffit à qualifier le résultat.
  }

  if (response.ok) return { ok: true, providerId: typeof body.id === "string" ? body.id.slice(0, 64) : null };
  const name = typeof body.name === "string" && /^[a-z_]{1,48}$/.test(body.name) ? body.name : "unknown";
  return { ok: false, error: `http_${response.status}:${name}` };
}
