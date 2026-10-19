/**
 * Envoi d'e-mails — même compte Resend que functions/api/newsletter.ts
 * (NEWSLETTER_API_KEY), pas un nouveau service. Le nom de la variable reste
 * celui déjà déployé ; le dépôt ne décide pas du domaine d'expédition, qui
 * doit être un expéditeur déjà vérifié dans Resend (sinon Resend refuse
 * l'envoi — voir RESEND_FROM ci-dessous, à définir côté Cloudflare).
 *
 * Échec d'envoi = ne jamais bloquer la candidature : le dossier est déjà
 * écrit en base avant que cette fonction soit appelée (voir submit.ts). Un
 * échec d'e-mail est journalisé côté Resend lui-même (tableau de bord),
 * jamais renvoyé au candidat comme une raison d'échec de sa candidature.
 */

interface SendArgs {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail({ apiKey, from, to, subject, text }: SendArgs): Promise<boolean> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
