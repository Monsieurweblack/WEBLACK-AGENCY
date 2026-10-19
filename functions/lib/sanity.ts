/**
 * Lecture Sanity depuis une fonction Cloudflare Pages — en requête HTTP
 * brute, pas via @sanity/client : ce paquet cible Node, pas forcément
 * l'environnement Workers, et une seule requête GROQ ne justifie pas la
 * dépendance. Lecture seule, dataset public (voir audit Agenda — ce
 * dataset est de toute façon lisible sans jeton), jamais d'écriture ici.
 */

export interface TalentApplicationSettings {
  /**
   * false = Sanity n'a pas pu être lu (panne, configuration absente). La
   * campagne est alors traitée comme fermée — jamais ouverte par accident —
   * mais le candidat reçoit « service momentanément indisponible », pas
   * « candidatures fermées », qui serait faux.
   */
  available: boolean;
  applicationsOpen: boolean;
  minorsAllowed: boolean;
  /** Destinataire des notifications internes, saisi par l'équipe dans le Studio. */
  internalNotificationEmail: string | null;
}

interface Env {
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
}

const SETTINGS_QUERY = `*[_id == "talentApplicationSettings"][0]{ applicationsOpen, minorsAllowed, internalNotificationEmail }`;
const SANITY_TIMEOUT_MS = 8000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const UNAVAILABLE: TalentApplicationSettings = {
  available: false,
  applicationsOpen: false,
  minorsAllowed: false,
  internalNotificationEmail: null,
};

export async function fetchTalentApplicationSettings(env: Env): Promise<TalentApplicationSettings> {
  if (!env.SANITY_PROJECT_ID || !env.SANITY_DATASET) return UNAVAILABLE;
  const url = `https://${env.SANITY_PROJECT_ID}.api.sanity.io/v2025-01-01/data/query/${env.SANITY_DATASET}?query=${encodeURIComponent(SETTINGS_QUERY)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SANITY_TIMEOUT_MS) });
    if (!response.ok) return UNAVAILABLE;
    const data = (await response.json()) as {
      result?: { applicationsOpen?: boolean; minorsAllowed?: boolean; internalNotificationEmail?: unknown } | null;
    };
    const notify = data.result?.internalNotificationEmail;
    return {
      available: true,
      // Strictement `true` : un document absent ou un champ vide = fermé.
      applicationsOpen: data.result?.applicationsOpen === true,
      minorsAllowed: data.result?.minorsAllowed === true,
      internalNotificationEmail: typeof notify === "string" && EMAIL_RE.test(notify.trim()) ? notify.trim() : null,
    };
  } catch {
    // Panne réseau/Sanity : on ne devine jamais "ouvert" par défaut.
    return UNAVAILABLE;
  }
}
