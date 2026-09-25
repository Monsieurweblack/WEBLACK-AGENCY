/**
 * WEBLACK LIVE — la machine d'état, et rien d'autre.
 *
 * Un seul calcul, utilisé par toutes les surfaces (page /live, archive,
 * page détail, Header, JSON-LD) : aucune page ne doit réécrire sa propre
 * comparaison de dates ou son propre découpage d'états. Module sans
 * dépendance Node — il s'exécute aussi bien côté build (Astro/Vite) que
 * côté client (script embarqué dans le navigateur), qui l'utilise pour
 * affiner l'état pendant que le visiteur regarde la page, sans recharger.
 *
 * Ce fichier ne fait AUCUN accès réseau, ne lit aucune variable
 * d'environnement, ne connaît pas Sanity. Il reçoit des données déjà lues,
 * et un instant déjà déterminé par l'appelant — jamais `new Date()` en
 * interne, pour rester testable avec une horloge contrôlée.
 */

/** Les huit états publics. DRAFT n'apparaît jamais sur le site : c'est un état interne, "pas encore prêt à être montré". */
export const LIVE_STATES = [
  "DRAFT",
  "SCHEDULED",
  "PRELIVE",
  "ON_AIR",
  "ENDING",
  "REPLAY",
  "ARCHIVED",
  "CANCELLED",
] as const;
export type LiveState = (typeof LIVE_STATES)[number];

export type ControlMode = "AUTOMATED" | "EDITORIAL" | "HYBRID";

/**
 * Ce que le lecteur YouTube (IFrame Player API, embarqué côté client) peut
 * réellement rapporter — la seule source qui distingue "programmé" de
 * "réellement en train de jouer" sans clé API. "unknown" est la valeur par
 * défaut : au build, et tant que le lecteur n'a pas été monté côté client,
 * on ne sait rien de plus que l'heure programmée elle-même.
 */
export type YoutubePlayerState = "unknown" | "cued" | "buffering" | "playing" | "paused" | "ended";

/**
 * Un statut posé à la main par un éditeur — n'est consulté que si
 * controlMode n'est pas AUTOMATED. Mêmes huit noms que LiveState, sans
 * DRAFT : un éditeur qui reprend la main choisit un état PUBLIC, jamais
 * "pas encore prêt", qui est le silence (aucun document ne matche).
 */
export type ManualLiveStatus = Exclude<LiveState, "DRAFT">;

export interface LiveStateInput {
  controlMode: ControlMode;
  manualStatus?: ManualLiveStatus;
  visibility: "public" | "draft";
  youtubeVideoId?: string;
  scheduledStart?: string; // ISO 8601, instant réel (Sanity datetime = toujours UTC)
  scheduledEnd?: string;
  replayEnabled: boolean;
}

/**
 * Combien de temps avant scheduledStart la page bascule de SCHEDULED
 * (juste une date à venir, lointaine) à PRELIVE (l'expérience immersive,
 * "starting soon" — Phase 5). Choisi une fois, pas par page : c'est ce qui
 * rend la fenêtre identique partout.
 */
export const PRELIVE_WINDOW_MS = 30 * 60_000; // 30 minutes

/**
 * Au-delà de ce délai après scheduledStart, sans confirmation YouTube que
 * la diffusion a réellement commencé, on cesse de prétendre "sur le point
 * de commencer" — jamais ON_AIR (jamais affirmé sans preuve), mais plus
 * PRELIVE non plus, qui mentirait par optimisme. Le statut retombe sur
 * SCHEDULED avec un simple retard visible, jamais un état inventé.
 */
export const LATE_START_GRACE_MS = 45 * 60_000; // 45 minutes

/**
 * Combien de temps un ON_AIR sans confirmation de fin reste affiché comme
 * "en train de se terminer" (ENDING) avant de basculer sur REPLAY par
 * défaut, si aucune confirmation explicite (ended côté player, ou
 * scheduledEnd dépassée) n'est jamais arrivée — pour ne pas rester bloqué
 * en ENDING indéfiniment si le visiteur ne regarde plus le player.
 */
export const ENDING_GRACE_MS = 20 * 60_000; // 20 minutes

/**
 * Le cœur du calcul. Pur : mêmes entrées, même sortie, toujours — c'est ce
 * qui le rend appelable aussi bien au build qu'en re-calcul client toutes
 * les secondes sans jamais diverger dans sa logique.
 */
export function resolveLiveState(live: LiveStateInput, now: Date, youtube: YoutubePlayerState = "unknown"): LiveState {
  if (live.visibility !== "public") return "DRAFT";

  // EDITORIAL : le calcul automatique ne s'applique pas du tout — l'éditeur
  // a explicitement repris la main (voir Phase 12, même principe que
  // controlMode dans l'Agenda).
  if (live.controlMode === "EDITORIAL") {
    return live.manualStatus ?? "DRAFT";
  }

  // HYBRID : les états terminaux qu'un éditeur pose à la main (annulation,
  // mise en archive) l'emportent toujours sur le calcul — l'automatisation
  // ne doit jamais ressusciter un live que l'éditeur a explicitement arrêté.
  if (live.controlMode === "HYBRID" && (live.manualStatus === "CANCELLED" || live.manualStatus === "ARCHIVED")) {
    return live.manualStatus;
  }

  // AUTOMATED (ou HYBRID sans override terminal) : tout vient des données et de l'heure.
  if (!live.youtubeVideoId || !live.scheduledStart) return "DRAFT";

  const start = new Date(live.scheduledStart).getTime();
  if (Number.isNaN(start)) return "DRAFT";
  const end = live.scheduledEnd ? new Date(live.scheduledEnd).getTime() : undefined;
  const nowMs = now.getTime();

  // Confirmation explicite du lecteur, dans les deux sens : elle prime sur
  // toute estimation par l'heure, c'est exactement le point de youtube.
  if (youtube === "playing" || youtube === "buffering") return "ON_AIR";
  if (youtube === "ended") {
    return live.replayEnabled && live.youtubeVideoId ? "REPLAY" : "ARCHIVED";
  }

  if (end !== undefined && !Number.isNaN(end) && nowMs >= end) {
    // La programmation dit elle-même que c'est fini — pas besoin d'attendre
    // une confirmation qui ne viendra peut-être jamais (personne ne regarde
    // le player à cet instant précis pour la déclencher côté client).
    return live.replayEnabled ? "REPLAY" : "ARCHIVED";
  }

  if (nowMs < start - PRELIVE_WINDOW_MS) return "SCHEDULED";
  if (nowMs < start) return "PRELIVE";

  // now >= start, mais aucune confirmation YouTube (le cas le plus fréquent
  // au premier rendu serveur, ou côté client avant que le lecteur ne soit
  // monté) : jamais ON_AIR sur la seule foi de l'heure — c'est la règle
  // explicite de la mission (Phase 7). On distingue seulement "encore
  // plausible" de "manifestement en retard".
  if (nowMs - start <= LATE_START_GRACE_MS) return "PRELIVE";

  // Repli propre : si une fin était programmée et qu'elle est proche/dépassée
  // sans jamais avoir été confirmée en direct, ENDING plutôt que de rester
  // indéfiniment sur "sur le point de commencer".
  if (end !== undefined && !Number.isNaN(end) && nowMs < end + ENDING_GRACE_MS) return "ENDING";

  return "SCHEDULED";
}

/** Millisecondes avant scheduledStart — négatif une fois l'instant passé. Utilisé par le countdown, jamais recalculé ailleurs. */
export function msUntilStart(live: Pick<LiveStateInput, "scheduledStart">, now: Date): number | undefined {
  if (!live.scheduledStart) return undefined;
  const start = new Date(live.scheduledStart).getTime();
  if (Number.isNaN(start)) return undefined;
  return start - now.getTime();
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Découpe une durée en jours/heures/minutes/secondes — jamais négatif, s'arrête net à zéro (Phase 4). */
export function countdownParts(ms: number): CountdownParts {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}
