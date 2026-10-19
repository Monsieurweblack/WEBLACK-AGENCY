/**
 * Lecture Sanity depuis une fonction Cloudflare Pages — en requête HTTP
 * brute, pas via @sanity/client : ce paquet cible Node, pas forcément
 * l'environnement Workers, et une seule requête GROQ ne justifie pas la
 * dépendance. Lecture seule, dataset public (voir audit Agenda — ce
 * dataset est de toute façon lisible sans jeton), jamais d'écriture ici.
 */

export interface TalentApplicationSettings {
  applicationsOpen: boolean;
  minorsAllowed: boolean;
}

interface Env {
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
}

const SETTINGS_QUERY = `*[_id == "talentApplicationSettings"][0]{ applicationsOpen, minorsAllowed }`;

export async function fetchTalentApplicationSettings(env: Env): Promise<TalentApplicationSettings> {
  if (!env.SANITY_PROJECT_ID || !env.SANITY_DATASET) {
    // Configuration absente : fermé par défaut, jamais ouvert par accident.
    return { applicationsOpen: false, minorsAllowed: false };
  }
  const url = `https://${env.SANITY_PROJECT_ID}.api.sanity.io/v2025-01-01/data/query/${env.SANITY_DATASET}?query=${encodeURIComponent(SETTINGS_QUERY)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return { applicationsOpen: false, minorsAllowed: false };
    const data = (await response.json()) as { result?: { applicationsOpen?: boolean; minorsAllowed?: boolean } };
    return {
      applicationsOpen: data.result?.applicationsOpen === true,
      minorsAllowed: data.result?.minorsAllowed === true,
    };
  } catch {
    // Panne réseau/Sanity : on ne devine jamais "ouvert" par défaut.
    return { applicationsOpen: false, minorsAllowed: false };
  }
}
