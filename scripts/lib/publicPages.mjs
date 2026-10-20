/**
 * Contrôle du site généré (dist/) — pages publiques exigées par Google Auth
 * Platform (page d'accueil de l'application, politique de confidentialité),
 * accessibles sans connexion, et aucune fuite de secret dans ce qui est
 * publié. Lancé après chaque build (npm run postbuild) : un échec bloque le
 * déploiement Cloudflare au lieu de laisser partir une page légale cassée.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SITE = "https://weblack.fr";
const PRIVACY_FR = "/politique-de-confidentialite";
const PRIVACY_EN = "/en/politique-de-confidentialite";
const LIMITED_USE = /Limited Use/;

/** Pages publiques requises : chemin, langue, longueur minimale de texte, exigences propres. */
export const REQUIRED_PAGES = [
  { path: "/", lang: "fr", minText: 1500, privacyLink: PRIVACY_FR },
  { path: "/en/", lang: "en", minText: 1500, privacyLink: PRIVACY_EN },
  { path: "/talent/plateforme/", lang: "fr", minText: 3000, privacyLink: PRIVACY_FR, limitedUse: true, mentions: ["Google Drive", "drive.file", "18 ans"] },
  { path: "/en/talent/plateforme/", lang: "en", minText: 3000, privacyLink: PRIVACY_EN, limitedUse: true, mentions: ["Google Drive", "drive.file", "18"] },
  { path: "/politique-de-confidentialite/", lang: "fr", minText: 8000, limitedUse: true, mentions: ["Google Drive", "Resend", "Cloudflare", "Durées de conservation", "CNIL"] },
  { path: "/en/politique-de-confidentialite/", lang: "en", minText: 8000, limitedUse: true, mentions: ["Google Drive", "Resend", "Cloudflare", "Retention periods", "CNIL"] },
  { path: "/mentions-legales/", lang: "fr", minText: 1000, privacyLink: PRIVACY_FR },
  { path: "/en/mentions-legales/", lang: "en", minText: 1000, privacyLink: PRIVACY_EN },
  { path: "/talent/candidature/", lang: "fr", minText: 1000 },
  { path: "/en/talent/candidature/", lang: "en", minText: 1000 },
];

/** Motifs de secrets qui ne doivent jamais apparaître dans un fichier publié. */
export const SECRET_PATTERNS = [
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, "secret client OAuth Google"],
  [/ya29\.[A-Za-z0-9_-]{20,}/, "jeton d'accès Google"],
  [/\b1\/\/0[A-Za-z0-9_-]{20,}/, "jeton de renouvellement Google"],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, "clé API Resend"],
  [/\bsk[A-Za-z]{0,2}[A-Za-z0-9]{40,}/, "jeton Sanity"],
  [/(ADMIN_PASSWORD|ADMIN_SESSION_SECRET|NEWSLETTER_API_KEY|GOOGLE_DRIVE_REFRESH_TOKEN|GOOGLE_OAUTH_CLIENT_SECRET)\s*[=:]\s*["'][^"']{6,}/, "affectation de secret"],
];

/**
 * Pages où la raison sociale « WEBLACK AFRICA » est admise, chacune avec sa
 * raison. Toute autre page qui l'afficherait fait échouer le contrôle.
 */
export const BRAND_EXCEPTIONS = [
  { path: "/mentions-legales/", reason: "mentions légales (règle CLAUDE.md)" },
  { path: "/talent/candidature/", reason: "notice de confidentialité Sanity : identification légale du responsable du traitement" },
];

function fileFor(dist, path) {
  return join(dist, ...path.split("/").filter(Boolean), "index.html");
}

export function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function checkPage(html, page) {
  const problems = [];
  const lang = html.match(/<html[^>]*\blang="([^"]+)"/i)?.[1] ?? "";
  if (!lang.startsWith(page.lang)) problems.push(`langue <html lang="${lang}"> au lieu de ${page.lang}`);
  if (!/<h1[\s>]/i.test(html)) problems.push("aucun titre <h1>");
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  if (canonical !== `${SITE}${page.path}`) problems.push(`canonical ${canonical ?? "absent"} au lieu de ${SITE}${page.path}`);
  if (/<meta name="robots" content="[^"]*noindex/i.test(html)) problems.push("page marquée noindex");
  if (/type="password"/i.test(html)) problems.push("champ de mot de passe sur une page publique");
  if (/http-equiv="refresh"[^>]*(admin|login|connexion)/i.test(html)) problems.push("redirection vers une connexion");
  const text = textOf(html);
  if (text.length < page.minText) problems.push(`contenu trop court (${text.length} caractères < ${page.minText})`);
  if (page.privacyLink && !new RegExp(`href="${page.privacyLink}/?"`).test(html)) problems.push(`aucun lien vers ${page.privacyLink}`);
  if (page.limitedUse && !LIMITED_USE.test(text)) problems.push("déclaration Google « Limited Use » absente");
  for (const word of page.mentions ?? []) if (!text.includes(word)) problems.push(`mention absente : ${word}`);
  return problems;
}

/** Renvoie la liste des problèmes trouvés dans dist/ (vide = conforme). */
export function checkPublicPages(dist) {
  const problems = [];
  if (!existsSync(dist)) return [`dossier introuvable : ${dist}`];
  for (const page of REQUIRED_PAGES) {
    const file = fileFor(dist, page.path);
    if (!existsSync(file)) {
      problems.push(`${page.path} : page absente du build`);
      continue;
    }
    for (const problem of checkPage(readFileSync(file, "utf8"), page)) problems.push(`${page.path} : ${problem}`);
  }

  for (const file of walk(dist)) {
    if (!/\.(html|js|mjs|css|json|txt|xml)$/i.test(file)) continue;
    const content = readFileSync(file, "utf8");
    const rel = `/${relative(dist, file).split(sep).join("/")}`;
    for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(content)) problems.push(`${rel} : ${label} détecté`);
    // Contact données personnelles unique : weblackconsulting@gmail.com (décision du responsable,
    // 20/10/2026). security.txt (signalement de failles, fonction distincte) n'est pas une page HTML.
    if (rel.endsWith(".html") && /weblackmedias@gmail\.com/.test(content)) problems.push(`${rel} : ancienne adresse de contact weblackmedias@gmail.com`);
    // Marque : la raison sociale n'apparaît que dans les mentions légales (CLAUDE.md).
    if (rel.endsWith(".html") && !BRAND_EXCEPTIONS.some(({ path }) => rel.includes(path)) && /WEBLACK AFRICA/.test(textOf(content))) {
      problems.push(`${rel} : « WEBLACK AFRICA » hors des mentions légales`);
    }
  }
  return problems;
}
