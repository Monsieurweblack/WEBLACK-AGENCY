/**
 * Espace membre — demande d'un lien de connexion.
 *
 * Réponse IDENTIQUE que l'adresse soit connue ou non : impossible de savoir,
 * depuis l'extérieur, qui a déposé une candidature. Un lien n'est créé et
 * envoyé que si l'adresse correspond à au moins une candidature.
 * Protections : même origine, garde-fou d'environnement, débit par IP
 * (5/h) et par adresse (3/h).
 */
import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { writesAllowed } from "../../lib/environment.ts";
import { sendEmail } from "../../lib/email.ts";
import { normalizeEmail } from "../../lib/contacts.ts";
import { createLoginToken, sameOrigin, sha256, type MemberEnv } from "../../lib/member.ts";

interface Env extends MemberEnv {
  PHOTOS: KVNamespace;
  APP_ENV?: string;
  NEWSLETTER_API_KEY?: string;
  RESEND_FROM?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const COPY = {
  fr: {
    subject: "Votre lien de connexion — WEBLACK",
    text: (link: string) =>
      `Bonjour,\n\nVoici votre lien de connexion à votre espace WEBLACK TALENT :\n${link}\n\nIl est valable 15 minutes et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne change sans ce lien.\n\nWEBLACK`,
  },
  en: {
    subject: "Your sign-in link — WEBLACK",
    text: (link: string) =>
      `Hello,\n\nHere is your sign-in link to your WEBLACK TALENT space:\n${link}\n\nIt is valid for 15 minutes and works only once. If you did not request it, ignore this message: nothing changes without this link.\n\nWEBLACK`,
  },
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.PHOTOS || !env.ADMIN_SESSION_SECRET || !writesAllowed(env, request)) return json({ ok: false, reason: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const rate = await checkRateLimit(env.PHOTOS, request, "member-link", 5, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  let body: { email?: unknown; lang?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ ok: false, reason: "invalid_email" }, 400);
  const lang = body.lang === "en" ? "en" : "fr";

  // Débit par adresse, sous empreinte (l'adresse n'apparaît pas dans les clés KV).
  const emailKey = `ratelimit:member-email:${(await sha256(email)).slice(0, 24)}`;
  const sent = Number((await env.PHOTOS.get(emailKey)) ?? "0");
  if (sent >= 3) return json({ ok: true }, 200);

  const known = await env.DB.prepare(`SELECT COUNT(*) AS n FROM applications WHERE lower(email) = ?`).bind(email).first<{ n: number }>();
  if (!known?.n) return json({ ok: true }, 200);

  await env.PHOTOS.put(emailKey, String(sent + 1), { expirationTtl: 60 * 60 });
  const token = await createLoginToken(env.DB, email);
  const origin = new URL(request.url).origin;
  const link = `${origin}${lang === "en" ? "/en" : ""}/espace/#t=${token}`;

  // Développement local uniquement : le lien est renvoyé pour les tests de bout en bout.
  // Jamais sur un domaine public, quelle que soit la configuration.
  if (LOCAL_HOSTS.has(new URL(request.url).hostname)) return json({ ok: true, devLink: link }, 200);

  if (env.NEWSLETTER_API_KEY && env.RESEND_FROM) {
    await sendEmail({
      apiKey: env.NEWSLETTER_API_KEY,
      from: env.RESEND_FROM,
      to: email,
      subject: COPY[lang].subject,
      text: COPY[lang].text(link),
      idempotencyKey: `member-link-${await sha256(token)}`,
    }).catch(() => undefined);
  }
  return json({ ok: true }, 200);
};
