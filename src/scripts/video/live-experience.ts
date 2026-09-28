import { resolveLiveState, countdownParts, type LiveStateInput, type LiveState, type YoutubePlayerState } from "../../lib/live-state.ts";

/**
 * Ce script fait trois choses, et seulement trois :
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
 * 3. (WEBLACK LIVE PRIORITY EXPERIENCE) Il révèle/masque, sur la même
 *    confirmation et sans jamais recalculer l'état différemment, le bloc
 *    Live Priority de la homepage et l'indicateur "● LIVE" du Header — qui
 *    peuvent coexister sur une même page (homepage) ou apparaître seuls
 *    (Header sur les autres pages). Un seul document actif à la fois
 *    (primaryLive, déjà en amont) ; les widgets qui le référencent
 *    (Header + LivePriority + LivePlayer/live détail) sont regroupés par
 *    `data-live-key` pour ne jamais monter deux lecteurs YouTube pour le
 *    même direct sur la même page.
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

function shouldMountPlayer(state: LiveState): boolean {
  return state === "PRELIVE" || state === "ON_AIR" || state === "ENDING";
}

// Le bloc lecteur (conteneur visuel, LivePlayer sur /live) n'est visible que
// là où le rendu serveur l'affiche déjà — PRELIVE le pré-monte caché
// uniquement pour que l'IFrame Player API existe et puisse rapporter un
// vrai état, jamais pour être vu avant confirmation.
function shouldShowPlayerBlock(state: LiveState): boolean {
  return state === "ON_AIR" || state === "ENDING" || state === "REPLAY";
}

// La priorité homepage, elle, ne concerne jamais REPLAY (Phase 16 de la
// mission WEBLACK LIVE PRIORITY EXPERIENCE) — un replay reste accessible
// depuis /live, jamais présenté comme un direct en cours.
function shouldShowPriority(state: LiveState): boolean {
  return state === "ON_AIR" || state === "ENDING";
}

/**
 * Un groupe = un même document Live référencé par un ou plusieurs widgets
 * sur la même page (Header + LivePriority sur la homepage, Header +
 * LivePlayer sur /live/[slug], ou Header seul ailleurs). Un seul calcul, un
 * seul lecteur YouTube partagé — jamais deux lecteurs pour le même direct.
 */
function setupLiveGroup(widgets: HTMLElement[]) {
  const data = readData(widgets[0]!);
  const countdownEls = widgets.flatMap((w) => Array.from(w.querySelectorAll<HTMLElement>("[data-live-countdown]")));
  const statusLabelEls = widgets.flatMap((w) => Array.from(w.querySelectorAll<HTMLElement>("[data-live-status-label]")));
  const announceEls = widgets.flatMap((w) => Array.from(w.querySelectorAll<HTMLElement>("[data-live-announce]")));
  // `data-live-priority-block` et `data-live-indicator-link` marquent la
  // racine du widget elle-même (LivePriority, le lien Header), pas un
  // descendant — un filtre sur `widgets`, pas un querySelectorAll qui ne
  // verrait jamais l'élément sur lequel il est posé.
  const priorityBlocks = widgets.filter((w) => "livePriorityBlock" in w.dataset);
  const indicatorLinks = widgets.filter((w) => "liveIndicatorLink" in w.dataset);

  let playerBlock: HTMLElement | null = null;
  let playerMount: HTMLElement | null = null;
  let playerFrame: HTMLIFrameElement | null = null;
  for (const w of widgets) {
    playerBlock ??= w.querySelector<HTMLElement>("[data-live-player-block]");
    playerMount ??= w.querySelector<HTMLElement>("[data-live-player-mount]");
    playerFrame ??= w.querySelector<HTMLIFrameElement>("[data-live-player-frame]");
  }

  // Aucun widget présent sur cette page ne montre de lecteur visible (cas :
  // Header seul, sur une page sans /live ni Live Priority) — une confirmation
  // réelle reste nécessaire pour l'indicateur, donc un point d'ancrage minimal
  // et invisible est créé, jamais un second système de détection.
  let syntheticMount = false;
  if (!playerMount) {
    syntheticMount = true;
    playerMount = document.createElement("div");
    playerMount.className = "live-premount-offscreen";
    document.body.appendChild(playerMount);
  }

  let youtubeState: YoutubePlayerState = "unknown";
  let currentState: LiveState | undefined;
  let ytPlayer: { destroy: () => void } | undefined;
  let ytMounted = false;

  async function mountYoutubePlayer() {
    if (ytMounted || !playerMount || !data.youtubeVideoId) return;
    ytMounted = true;
    await loadYoutubeIframeApi();
    if (!window.YT) return;
    const mountId = `yt-player-${Math.random().toString(36).slice(2, 9)}`;
    playerMount.id = mountId;
    ytPlayer = new window.YT.Player(mountId, {
      videoId: data.youtubeVideoId,
      // Muet, mais en lecture automatique : c'est ce qui permet au lecteur de
      // rapporter réellement "buffering"/"playing" tout seul dès qu'une
      // diffusion réelle commence. Un lecteur laissé sur autoplay: 0 reste
      // "cued" indéfiniment — personne ne clique play sur un lecteur encore
      // masqué — et la confirmation YouTube que la mission exige avant
      // ON_AIR ne se produit alors jamais.
      playerVars: { autoplay: 1, mute: 1, playsinline: 1 },
      events: {
        onStateChange: (event: { data: number }) => {
          youtubeState = YT_STATE_MAP[event.data] ?? "unknown";
          render();
        },
      },
    });
  }

  function revealPriorityBlock(el: HTMLElement) {
    el.classList.remove("live-block-hidden", "live-premount-offscreen");
    el.classList.add("live-priority-enter");
    // Double rAF : force le navigateur à peindre l'état de départ avant
    // d'ajouter la classe de transition, sinon les deux styles arrivent dans
    // la même frame et rien ne s'anime (Phase 14 : jamais un saut brutal).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add("live-priority-enter-active");
      });
    });
  }

  // Trois états mutuellement exclusifs pour un bloc lecteur (LivePlayer sur
  // /live, LivePriority sur la homepage) : visible, hors-écran mais
  // décodable (un vrai lecteur y est ou va y être monté — PRELIVE), ou
  // entièrement masqué en display:none (rien n'est monté, coût nul —
  // SCHEDULED loin de l'échéance, ou tout autre état qui ne montre rien).
  //
  // Un document construit alors qu'il est encore SCHEDULED (le cas normal
  // sur un SSG si le dernier build a eu lieu bien avant l'heure programmée)
  // traverse SCHEDULED → PRELIVE → ON_AIR entièrement côté client, sans
  // reconstruction. Appliquer bêtement display:none à tout ce qui n'est pas
  // "montrable maintenant" — comme le faisait cette fonction avant —
  // suspend le lecteur qui vient d'être monté dès que l'état devient
  // PRELIVE : la confirmation YouTube réelle que la mission exige ne peut
  // alors plus jamais arriver, quelle que soit la durée d'attente.
  //
  // LivePlayer (playerBlock) n'a jamais eu de transition d'entrée — un
  // simple retrait de classe, comme avant cette correction, pour ne pas
  // changer son comportement visuel. LivePriority (priorityBlocks) garde sa
  // transition douce déjà en place (Phase 14, WEBLACK LIVE PRIORITY
  // EXPERIENCE).
  function setPlayerBlockVisibility(el: HTMLElement, mode: "visible" | "premount" | "hidden") {
    el.classList.remove("live-block-hidden", "live-premount-offscreen");
    if (mode === "premount") el.classList.add("live-premount-offscreen");
    else if (mode === "hidden") el.classList.add("live-block-hidden");
  }

  function setPriorityBlockVisibility(el: HTMLElement, mode: "visible" | "premount" | "hidden") {
    if (mode === "visible") {
      revealPriorityBlock(el);
      return;
    }
    el.classList.remove("live-priority-enter", "live-priority-enter-active");
    el.classList.remove("live-block-hidden", "live-premount-offscreen");
    el.classList.add(mode === "premount" ? "live-premount-offscreen" : "live-block-hidden");
  }

  function applyStateClasses(state: LiveState) {
    widgets.forEach((w) => (w.dataset.currentState = state));

    const premount = state === "PRELIVE";
    if (playerBlock) setPlayerBlockVisibility(playerBlock, shouldShowPlayerBlock(state) ? "visible" : premount ? "premount" : "hidden");
    // Le player natif "youtube-nocookie" (sans JS API, chargé côté build
    // pour REPLAY et pour le rendu initial ON_AIR sans JS) reste affiché
    // tant que l'API n'a pas pris le relais — jamais un player vide. Un
    // point d'ancrage synthétique (Header seul) n'a pas cette bascule : il
    // reste hors-écran en permanence, il ne sert qu'à la confirmation.
    if (playerFrame) playerFrame.hidden = shouldMountPlayer(state) && ytMounted;
    if (!syntheticMount && playerMount) playerMount.hidden = !(shouldMountPlayer(state) && ytMounted);

    const onAirForPriority = shouldShowPriority(state);
    priorityBlocks.forEach((el) => setPriorityBlockVisibility(el, onAirForPriority ? "visible" : premount ? "premount" : "hidden"));

    const onAirForIndicator = state === "ON_AIR" || state === "ENDING";
    indicatorLinks.forEach((link) => {
      link.classList.toggle("live-on-air", onAirForIndicator);
      const dot = link.querySelector<HTMLElement>("[data-live-indicator-dot]");
      if (dot) dot.hidden = !onAirForIndicator;
      const label = link.querySelector<HTMLElement>("[data-live-indicator-label]");
      if (label) label.textContent = onAirForIndicator ? (link.dataset.labelOnair ?? "") : (link.dataset.labelDefault ?? "");
    });
  }

  function render() {
    const now = new Date();
    const state = resolveLiveState(data, now, shouldMountPlayer(currentState ?? "SCHEDULED") ? youtubeState : "unknown");

    if (countdownEls.length) {
      const remaining = data.scheduledStart ? new Date(data.scheduledStart).getTime() - now.getTime() : 0;
      const parts = countdownParts(remaining);
      const text =
        remaining <= 0
          ? ""
          : parts.days > 0
            ? `${parts.days}${data.labels.day} ${parts.hours}${data.labels.hour}`
            : parts.hours > 0
              ? `${parts.hours}${data.labels.hour} ${parts.minutes}${data.labels.minute}`
              : `${parts.minutes}${data.labels.minute} ${parts.seconds}${data.labels.second}`;
      countdownEls.forEach((el) => (el.textContent = text));
    }

    if (state !== currentState) {
      currentState = state;
      applyStateClasses(state);
      const label = state === "ON_AIR" ? data.labels.live : state === "ENDING" ? data.labels.ending : state === "PRELIVE" ? data.labels.starting : "";
      statusLabelEls.forEach((el) => (el.textContent = label));
      // Une seule annonce par CHANGEMENT d'état, jamais à chaque seconde —
      // c'est exactement ce que Phase 18 interdit pour les technologies
      // d'assistance.
      announceEls.forEach((el) => (el.textContent = `${data.title} — ${label || state}`));
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
      if (syntheticMount) playerMount?.remove();
    },
    { once: true },
  );
}

export function initLiveExperience() {
  if (initialized) return;
  initialized = true;
  const widgets = Array.from(document.querySelectorAll<HTMLElement>("[data-live-widget]"));
  if (!widgets.length) return;

  const groups = new Map<string, HTMLElement[]>();
  widgets.forEach((w, i) => {
    const key = w.dataset.liveKey || w.dataset.youtubeVideoId || `unkeyed-${i}`;
    const group = groups.get(key);
    if (group) group.push(w);
    else groups.set(key, [w]);
  });
  groups.forEach((group) => setupLiveGroup(group));
}
