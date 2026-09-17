/**
 * Inscription à la newsletter — fonction Cloudflare Pages.
 *
 * Le site est statique : il n'a pas de serveur pour recevoir un formulaire.
 * Les autres formulaires du site contournent ce point en construisant un
 * lien `mailto:`, ce qui convient pour une prise de contact mais pas pour
 * une inscription — personne ne veut ouvrir son client mail pour donner son
 * adresse, et rien ne se retrouverait dans une liste exploitable.
 *
 * Les fonctions Pages s'exécutent sans rien changer à la sortie statique
 * d'Astro : ce fichier devient l'URL /api/newsletter au déploiement. C'est
 * ce qui permet à la clé Resend de rester côté serveur ; appelée depuis le
 * navigateur, elle serait lisible par n'importe qui.
 *
 * L'inscription alimente la MÊME audience Resend que celle vers laquelle le
 * moteur éditorial expédie ses digests (NEWSLETTER_AUDIENCE_ID) : un seul
 * endroit où vit la liste, pas deux.
 */

/**
 * Le contrat d'une fonction Pages, déclaré ici plutôt qu'importé.
 *
 * `PagesFunction` vit dans @cloudflare/workers-types. Installer ce paquet
 * entier pour trois noms de types alourdirait les dépendances du projet
 * sans rien apporter au build : Cloudflare ne regarde que le nom de
 * l'export, pas son type.
 */
interface PagesContext {
  request: Request;
  env: Env;
}

type PagesHandler = (context: PagesContext) => Promise<Response>;

interface Env {
  /** Même clé que le moteur d'envoi. À définir dans les variables d'environnement Cloudflare Pages, jamais dans le dépôt. */
  NEWSLETTER_API_KEY?: string;
  /** L'audience Resend qui reçoit les digests. */
  NEWSLETTER_AUDIENCE_ID?: string;
}

interface Payload {
  email?: unknown;
  /** Champ leurre : rempli par un robot, vide chez un humain. */
  company?: unknown;
  lang?: unknown;
}

/**
 * Validation volontairement simple. Une expression rationnelle ne prouve
 * pas qu'une adresse existe — seul un envoi le fait. Elle écarte les fautes
 * de frappe évidentes, et c'est tout ce qu'on lui demande.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Rien ici n'est mis en cache : chaque inscription est un acte unique.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Le service est-il en état de fonctionner ?
 *
 * La fenêtre d'inscription interroge cette adresse avant de s'afficher.
 * Interrompre un visiteur pour lui répondre ensuite « service indisponible »
 * est pire que ne rien lui proposer : tant que les variables ne sont pas
 * définies, la fenêtre ne s'arme pas.
 *
 * Aucun secret ne transite : la réponse est un booléen, jamais une clé ni
 * un identifiant d'audience.
 */
export const onRequestGet: PagesHandler = async ({ env }) =>
  json({ configured: Boolean(env.NEWSLETTER_API_KEY && env.NEWSLETTER_AUDIENCE_ID) }, 200);

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  // Le leurre est traité comme un succès côté robot : lui répondre « refusé »
  // lui apprendrait à le contourner.
  if (typeof payload.company === "string" && payload.company.trim() !== "") {
    return json({ ok: true }, 200);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!looksLikeEmail(email)) return json({ ok: false, reason: "invalid" }, 400);

  // Sans configuration, on le DIT. Répondre « merci, vous êtes inscrit »
  // alors que rien n'est enregistré serait un mensonge à l'utilisateur, et
  // une liste d'abonnés qui n'existe pas.
  if (!env.NEWSLETTER_API_KEY || !env.NEWSLETTER_AUDIENCE_ID) {
    return json({ ok: false, reason: "unconfigured" }, 503);
  }

  let response: Response;
  try {
    response = await fetch(`https://api.resend.com/audiences/${env.NEWSLETTER_AUDIENCE_ID}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NEWSLETTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
  } catch {
    return json({ ok: false, reason: "provider" }, 502);
  }

  if (response.ok) return json({ ok: true }, 200);

  // Une adresse déjà présente n'est pas une erreur pour qui s'inscrit : il
  // voulait être sur la liste, il y est. On le remercie sans le corriger.
  if (response.status === 409 || response.status === 422) return json({ ok: true, already: true }, 200);

  // Le corps de la réponse peut renvoyer des détails de la requête. Il n'est
  // ni transmis au navigateur ni journalisé : la clé ne doit fuir nulle part.
  return json({ ok: false, reason: "provider" }, 502);
};

// Seul POST est exporté : Cloudflare Pages répond 405 de lui-même aux autres
// méthodes. Ajouter un `onRequest` générique à côté intercepterait tout et
// court-circuiterait ce handler.
