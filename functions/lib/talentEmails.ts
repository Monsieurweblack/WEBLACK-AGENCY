/**
 * Modèles d'e-mails de la candidature Talent — HTML et texte brut, FR et EN.
 *
 * Ton : accusé de réception, rien de plus. Le message confirme que le
 * dossier est enregistré et donne sa référence ; il ne promet ni sélection,
 * ni casting, ni réponse individuelle — rien de ce que WEBLACK ne garantit
 * pas. Aucune pièce jointe, aucune photo, aucune donnée du dossier au-delà
 * du prénom et de la référence.
 *
 * Marque : « WEBLACK » / « WEBLACK TALENTS » uniquement — la raison
 * sociale ne figure que dans les mentions légales (voir CLAUDE.md).
 */
import { CONTACT_EMAIL } from "../../src/lib/contact.ts";
import type { SubmissionLang } from "./applicationTypes.ts";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const SITE_URL = "https://www.weblack.fr";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const COPY = {
  fr: {
    subject: (ref: string) => `Candidature reçue — WEBLACK TALENTS (réf. ${ref})`,
    preheader: (ref: string) => `Votre dossier est enregistré sous la référence ${ref}.`,
    greeting: (name: string) => `Bonjour ${name},`,
    thanks: "Merci pour votre candidature à WEBLACK TALENTS. Nous confirmons la bonne réception de votre dossier : il est enregistré et sera examiné par notre équipe.",
    referenceLabel: "Votre référence",
    referenceHint: "Rappelez-la dans tout échange au sujet de votre candidature.",
    nextTitle: "La suite",
    next: [
      "Chaque dossier est étudié au regard des projets et des recherches en cours.",
      "Si votre profil correspond à une opportunité, l'équipe vous contactera aux coordonnées indiquées dans votre candidature.",
      "Le dépôt d'une candidature ne garantit pas une sélection. Inutile de renvoyer votre dossier : il est bien enregistré.",
    ],
    contact: (email: string) => `Pour corriger une information, poser une question ou exercer vos droits sur vos données, écrivez à ${email} en indiquant votre référence.`,
    footer: "Vous recevez ce message parce qu'une candidature WEBLACK TALENTS a été déposée avec cette adresse sur weblack.fr. Si vous n'en êtes pas à l'origine, signalez-le-nous à l'adresse ci-dessus.",
    signature: "L'équipe WEBLACK TALENTS",
  },
  en: {
    subject: (ref: string) => `Application received — WEBLACK TALENTS (ref. ${ref})`,
    preheader: (ref: string) => `Your application is registered under reference ${ref}.`,
    greeting: (name: string) => `Hello ${name},`,
    thanks: "Thank you for applying to WEBLACK TALENTS. We confirm that your application has been received: it is registered and will be reviewed by our team.",
    referenceLabel: "Your reference",
    referenceHint: "Please quote it in any message about your application.",
    nextTitle: "What happens next",
    next: [
      "Every application is reviewed against current projects and searches.",
      "If your profile matches an opportunity, the team will contact you using the details provided in your application.",
      "Submitting an application does not guarantee selection. There is no need to send it again: it has been registered.",
    ],
    contact: (email: string) => `To correct any information, ask a question or exercise your data rights, write to ${email} and include your reference.`,
    footer: "You are receiving this message because a WEBLACK TALENTS application was submitted with this address on weblack.fr. If this was not you, please let us know at the address above.",
    signature: "The WEBLACK TALENTS team",
  },
} as const;

export function candidateConfirmationEmail(lang: SubmissionLang, firstName: string, reference: string): RenderedEmail {
  const c = COPY[lang];
  const text = [
    c.greeting(firstName),
    "",
    c.thanks,
    "",
    `${c.referenceLabel} : ${reference}`,
    c.referenceHint,
    "",
    c.nextTitle,
    ...c.next.map((line) => `- ${line}`),
    "",
    c.contact(CONTACT_EMAIL),
    "",
    c.signature,
    SITE_URL,
    "",
    "--",
    c.footer,
  ].join("\n");

  const name = escapeHtml(firstName);
  const mail = `<a href="mailto:${CONTACT_EMAIL}" style="color:#7a6544;">${CONTACT_EMAIL}</a>`;
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(c.subject(reference))}</title>
</head>
<body style="margin:0;padding:0;background:#efece4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(c.preheader(reference))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efece4;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f8f6f1;">
<tr><td style="background:#0a0a0a;padding:28px 32px;">
<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px;color:#f8f6f1;">WEBLACK</p>
<p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;color:#d9bc86;">TALENTS</p>
</td></tr>
<tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0a0a0a;">
<p style="margin:0 0 16px;">${c.greeting(name)}</p>
<p style="margin:0 0 24px;">${c.thanks}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #b8955f;margin:0 0 24px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a6544;">${c.referenceLabel}</p>
<p style="margin:4px 0 4px;font-family:'Courier New',Courier,monospace;font-size:24px;letter-spacing:3px;color:#0a0a0a;">${reference}</p>
<p style="margin:0;font-size:13px;color:#555;">${c.referenceHint}</p>
</td></tr>
</table>
<p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:18px;">${c.nextTitle}</p>
<ul style="margin:0 0 24px;padding-left:20px;">
${c.next.map((line) => `<li style="margin:0 0 8px;">${line}</li>`).join("\n")}
</ul>
<p style="margin:0 0 24px;">${c.contact(mail)}</p>
<p style="margin:0;">${c.signature}<br><a href="${SITE_URL}" style="color:#7a6544;">weblack.fr</a></p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e0dccf;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666;">${c.footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: c.subject(reference), text, html };
}

export interface NotificationFacts {
  reference: string;
  applicationId: string;
  category: string;
  country: string;
  lang: SubmissionLang;
  photoCount: number;
}

/**
 * Notification interne : distincte de la confirmation candidat, et
 * volontairement minimale — ni nom, ni coordonnées, ni date de naissance.
 * Le dossier complet ne se consulte que dans l'administration authentifiée.
 */
export function adminNotificationEmail(facts: NotificationFacts): RenderedEmail {
  const adminUrl = `${SITE_URL}/admin/candidatures/`;
  const lines = [
    "Nouvelle candidature WEBLACK TALENTS enregistrée.",
    "",
    `Référence : ${facts.reference}`,
    `Catégorie : ${facts.category}`,
    `Pays : ${facts.country}`,
    `Langue du formulaire : ${facts.lang.toUpperCase()}`,
    `Photos : ${facts.photoCount}`,
    "",
    `Dossier complet et photos (connexion requise) : ${adminUrl}`,
  ];
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0a0a0a;">
${lines
  .filter((line) => line !== "")
  .slice(0, -1)
  .map((line) => `<p style="margin:0 0 6px;">${escapeHtml(line)}</p>`)
  .join("\n")}
<p style="margin:16px 0 0;"><a href="${adminUrl}" style="color:#7a6544;">Ouvrir l'administration</a> (connexion requise)</p>
</body></html>`;
  return { subject: `Nouvelle candidature Talent — ${facts.reference}`, text: lines.join("\n"), html };
}
