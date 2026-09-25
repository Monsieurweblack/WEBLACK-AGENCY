/**
 * Reconnaissance des sources sociales — Instagram, Facebook, LinkedIn, X,
 * YouTube — et rien de plus que la reconnaissance.
 *
 * Ce module ne cherche jamais rien lui-même : il n'ouvre aucune session, ne
 * contourne aucune authentification, aucun CAPTCHA, aucune protection
 * technique. Il répond à une seule question, à partir d'une URL déjà
 * rencontrée par la découverte normale (recherche web, voir discover.ts) :
 * s'agit-il d'une plateforme sociale, et si oui, le compte qui publie
 * correspond-il à l'institution, au lieu, à l'organisateur ou à l'artiste
 * déjà connus pour l'événement ?
 *
 * C'est cette seconde question — jamais la plateforme seule — qui décide du
 * rang de la source (voir verify.ts, rankSource) : un compte Instagram
 * officiel d'un musée vaut la page officielle de ce même musée, pas moins,
 * parce que l'identité de l'émetteur est la même. Un compte social qui ne
 * correspond à rien de connu reste une source secondaire, exactement comme
 * un site tiers sans rapport démontré.
 *
 * Ce que ce module ne fait PAS, et ne fera jamais : deviner une URL de
 * publication à partir d'un nom de compte, transformer une URL de profil en
 * URL de publication supposée, ou traiter un extrait de résultat de
 * recherche comme une preuve. Ce que verify.ts ne peut pas lire dans le
 * texte réellement téléchargé (voir fetchManualUrl) n'est jamais retenu —
 * une plateforme qui bloque la lecture non authentifiée fournit une piste
 * de découverte, jamais une preuve.
 */

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "linkedin", "x", "youtube", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const PLATFORM_HOSTS: Record<string, SocialPlatform> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "linkedin.com": "linkedin",
  "x.com": "x",
  "twitter.com": "x",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "tiktok.com": "tiktok",
};

/** La plateforme sociale d'une URL, si elle en désigne une — jamais devinée, seulement lue dans le nom d'hôte. */
export function socialPlatform(url: string): SocialPlatform | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
  } catch {
    return undefined;
  }
  return PLATFORM_HOSTS[host];
}

export function isSocialUrl(url: string): boolean {
  return socialPlatform(url) !== undefined;
}

/**
 * Le compte (ou la chaîne) qui publie, tel qu'il apparaît dans l'URL — le
 * premier segment de chemin pour Instagram/X/TikTok, "company" ou le nom
 * qui suit pour LinkedIn, la page pour Facebook, "@handle" ou "channel"
 * pour YouTube. Vide si l'URL ne porte pas de compte identifiable (une
 * simple URL de plateforme, un lien de recherche, etc.).
 */
export function socialAccountHandle(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "";

  const platform = socialPlatform(url);
  if (platform === "linkedin") {
    // /company/nom/ ou /in/nom/ — le compte est le segment APRÈS le type.
    const idx = segments.findIndex((s) => s === "company" || s === "in" || s === "school");
    return idx >= 0 ? (segments[idx + 1] ?? "") : (segments[0] ?? "");
  }
  if (platform === "youtube") {
    const handle = segments.find((s) => s.startsWith("@"));
    if (handle) return handle.slice(1);
    const idx = segments.findIndex((s) => s === "channel" || s === "c" || s === "user");
    return idx >= 0 ? (segments[idx + 1] ?? "") : (segments[0] ?? "");
  }
  // Instagram, Facebook, X, TikTok : le compte est le premier segment,
  // sauf s'il s'agit d'un chemin de publication ("/p/", "/reel/", "/status/",
  // "/watch/"…) qui ne porte pas de nom de compte du tout.
  const first = segments[0] ?? "";
  if (["p", "reel", "reels", "status", "watch", "stories", "photo.php", "events", "share"].includes(first)) return "";
  return first;
}

/**
 * Le compte qui publie correspond-il à un nom déjà connu pour l'événement
 * — institution, lieu, organisateur, artiste ? C'est cette correspondance,
 * pas la plateforme, qui fait qu'un compte social vaut une source officielle
 * (voir verify.ts, rankSource). Comparaison normalisée et tolérante aux
 * séparateurs (« Mori Art Museum » / « moriartmuseum » / « mori.art.museum »),
 * exactement comme rankSource() le fait déjà pour un nom de domaine.
 */
export function socialAccountMatches(url: string, ...names: string[]): boolean {
  const handle = socialAccountHandle(url);
  if (!handle) return false;
  const compact = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const compactHandle = compact(handle);
  if (compactHandle.length < 4) return false; // un handle trop court (ex. "x") produirait des faux positifs
  return names.some((name) => {
    const compactName = compact(name);
    return compactName.length >= 4 && (compactHandle.includes(compactName) || compactName.includes(compactHandle));
  });
}
