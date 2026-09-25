import { resolveLiveState, countdownParts, type LiveStateInput, type LiveState, type YoutubePlayerState } from "../../lib/live-state.ts";

/**
 * Ce script fait deux choses, et seulement deux :
 *
 * 1. Il affiche un compte à rebours qui tourne réellement, seconde par
 *    seconde — jamais de décalage de mise en page (les chiffres occupent
 *    une largeur fixe, voir le CSS du composant).
 *
 * 2. Une fois dans la fenêtre où le direct peut avoir commencé, il monte
 *    le vrai lecteur YouTube (IFrame Player API officielle — aucun
 *    contournement) et écoute ce qu'il rapporte réellement. C'est cette
 *    confirmation, jamais l'heure seule, qui fait passer la page en
 *    ON_AIR — resolveLiveState() porte cette règle, ce script ne fait que
 *    lui fournir l'état du lecteur à chaque recalcul.
 *
 * Tout se passe sans recharger la page : le site est statique (build
 * périodique via le scheduler), ce script est ce qui le fait paraître
 * vivant entre deux builds.
 */

let initialized = false;

interface LiveWidgetData extends LiveStateInput {
  title: string;
  labels: { starting: string; live: string; ending: string; replaySoon: string; day: string; hour: string; minute: string; second: string };
}

function readData(el: HTMLElement): LiveWidgetData {
  const d = el.dataset;
  return {
    controlMode: (d.controlMode as LiveStateInput["controlMode"]) ?? "EDITORIAL",
    manualStatus: d.manualStatus as LiveStateInput["manualStatus"],
    visibility: d.visibility === "draft" ? "draft" : "public",
    youtubeVideoId: d.youtubeVideoId,
    scheduledStart: d.scheduledStart,
    scheduledEnd: d.scheduledEnd || undefined,
    replayEnabled: d.replayEnabled !== "false",
    title: d.title ?? "",
    labels: {
      starting: d.labelStarting ?? "",
      live: d.labelLive ?? "",
      ending: d.labelEnding ?? "",
      replaySoon: d.labelReplaySoon ?? "",
      day: d.labelDay ?? "j",
      hour: d.labelHour ?? "h",
      minute: d.labelMinute ?? "min",
      second: d.labelSecond ?? "s",
    },
  };
}

// --- YouTube IFrame Player API — chargée une seule fois pour toute la page ---

type YTPlayerCtor = new (
  elementId: string,
  options: { videoId: string; playerVars?: Record<string, unknown>; events?: Record<string, (event: { data: number }) => void> },
) => { destroy: () => void };

declare global {
  interface Window {
    YT?: { Player: YTPlayerCtor; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | undefined;

function loadYoutubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

const YT_STATE_MAP: Record<number, YoutubePlayerState> = {
  "-1": "cued", // UNSTARTED — le lecteur existe mais n'a encore rien rapporté de concret
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued",
};

/** Un widget = une diffusion sur la page. `initLiveExperience` en gère plusieurs sans conflit (archive avec plusieurs vignettes, par ex.). */
function setupWidget(el: HTMLElement) {
  const data = readData(el);
  const countdownEl = el.querySelector<HTMLElement>("[data-live-countdown]");
  const statusLabelEl = el.querySelector<HTMLElement>("[data-live-status-label]");
  const announceEl = el.querySelector<HTMLElement>("[data-live-announce]");
  const playerMount = el.querySelector<HTMLElement>("[data-live-player-mount]");
  const playerFrame = el.querySelector<HTMLIFrameElement>("[data-live-player-frame]");

  let youtubeState: YoutubePlayerState = "unknown";
  let currentState: LiveState | undefined;
  let ytPlayer: { destroy: () => void } | undefined;
  let ytMounted = false;

  function shouldMountPlayer(state: LiveState): boolean {
    return state === "PRELIVE" || state === "ON_AIR" || state === "ENDING";
  }

  async function mountYoutubePlayer() {
    if (ytMounted || !playerMount || !data.youtubeVideoId) return;
    ytMounted = true;
    await loadYoutubeIframeApi();
    if (!window.YT) return;
    const mountId = `yt-player-${Math.random().toString(36).slice(2, 9)}`;
    playerMount.id = mountId;
    ytPlayer = new window.YT.Player(mountId, {
      videoId: data.youtubeVideoId,
      playerVars: { autoplay: 0, playsinline: 1 },
      events: {
        onStateChange: (event: { data: number }) => {
          youtubeState = YT_STATE_MAP[event.data] ?? "unknown";
          render();
        },
      },
    });
  }

  function applyStateClasses(state: LiveState) {
    el.dataset.currentState = state;
    // Le player natif "youtube-nocookie" (sans JS API, chargé côté build
    // pour REPLAY et pour le rendu initial ON_AIR sans JS) reste affiché
    // tant que l'API n'a pas pris le relais — jamais un player vide.
    if (playerFrame) playerFrame.hidden = shouldMountPlayer(state) && ytMounted;
    if (playerMount) playerMount.hidden = !(shouldMountPlayer(state) && ytMounted);
  }

  function render() {
    const now = new Date();
    const state = resolveLiveState(data, now, shouldMountPlayer(currentState ?? "SCHEDULED") ? youtubeState : "unknown");

    if (countdownEl) {
      const remaining = data.scheduledStart ? new Date(data.scheduledStart).getTime() - now.getTime() : 0;
      const parts = countdownParts(remaining);
      countdownEl.textContent =
        remaining <= 0
          ? ""
          : parts.days > 0
            ? `${parts.days}${data.labels.day} ${parts.hours}${data.labels.hour}`
            : parts.hours > 0
              ? `${parts.hours}${data.labels.hour} ${parts.minutes}${data.labels.minute}`
              : `${parts.minutes}${data.labels.minute} ${parts.seconds}${data.labels.second}`;
    }

    if (state !== currentState) {
      currentState = state;
      applyStateClasses(state);
      if (statusLabelEl) {
        statusLabelEl.textContent =
          state === "ON_AIR" ? data.labels.live : state === "ENDING" ? data.labels.ending : state === "PRELIVE" ? data.labels.starting : "";
      }
      // Une seule annonce par CHANGEMENT d'état, jamais à chaque seconde —
      // c'est exactement ce que Phase 18 interdit pour les technologies
      // d'assistance.
      if (announceEl) announceEl.textContent = `${data.title} — ${statusLabelEl?.textContent ?? state}`;
      if (shouldMountPlayer(state)) void mountYoutubePlayer();
    }
  }

  render();
  const intervalId = window.setInterval(render, 1000);
  window.addEventListener(
    "pagehide",
    () => {
      window.clearInterval(intervalId);
      ytPlayer?.destroy();
    },
    { once: true },
  );
}

export function initLiveExperience() {
  if (initialized) return;
  initialized = true;
  document.querySelectorAll<HTMLElement>("[data-live-widget]").forEach(setupWidget);
}
