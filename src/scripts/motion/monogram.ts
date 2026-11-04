/**
 * Le monogramme vivant — réponse du W à la main qui l'approche.
 *
 * Souris (survol réel, pointeur fin) : une perspective limitée (±9° en
 * lacet, ±6° en tangage) qui suit le curseur ; les tranches dorées en
 * retrait révèlent alors l'épaisseur du W, et la lame de lumière glisse sur
 * sa face du côté du curseur. Le curseur sort : tout revient au repos.
 * Toucher : un appui fait pencher le W vers le doigt et allume son reflet,
 * puis il revient au repos.
 *
 * Coût maîtrisé :
 *  - le script écrit directement `transform` / `opacity` sur deux éléments
 *    (l'enveloppe 3D, le reflet) — jamais de propriété personnalisée héritée,
 *    qui forcerait le recalcul de style de tout le sous-arbre à chaque image ;
 *  - la position du W est lue une fois à l'entrée du pointeur, puis gardée
 *    jusqu'au prochain défilement ou redimensionnement — aucune lecture de
 *    mise en page par mouvement ;
 *  - la boucle ne vit que le temps de rejoindre la cible, s'arrête hors
 *    écran, et tout est détaché à pagehide.
 * Mouvement réduit : le script ne fait rien, le W reste dans son état stable.
 */

const MAX_YAW = 9;
const MAX_PITCH = 6;
/** Part de l'écart rattrapée en 1/60 s ; le calcul suit le temps réel, pas la cadence d'affichage. */
const EASE = 0.1;
/** En dessous de cet écart, la valeur rejoint sa cible et la boucle s'arrête. */
const SNAP = 0.01;
/** Durée pendant laquelle le W reste penché vers le doigt avant de revenir. */
const TOUCH_HOLD_MS = 320;

type Pose = { yaw: number; pitch: number; sheen: number; glow: number };
const REST: Pose = { yaw: 0, pitch: 0, sheen: -45, glow: 0 };

/**
 * Le réveil du W : ses tranches se déploient et une lame de lumière le
 * traverse (CSS, [data-awake]) — seulement une fois la page chargée et le
 * navigateur au repos, jamais pendant l'analyse du document, où chaque
 * animation lancée alourdissait les trames les plus longues (mesuré).
 * Mouvement réduit : l'épaisseur est posée d'emblée, sans lame.
 */
function scheduleAwakening(section: HTMLElement, immediate: boolean): void {
  const awake = () => section.setAttribute("data-awake", "");
  if (immediate) return awake();
  const whenIdle = () =>
    "requestIdleCallback" in window ? requestIdleCallback(awake, { timeout: 1200 }) : setTimeout(awake, 200);
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}

export function initMonogram(section: HTMLElement): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scheduleAwakening(section, reduced);
  if (reduced) return;
  const tilt = section.querySelector<HTMLElement>("[data-mark-tilt]");
  const sheen = section.querySelector<HTMLElement>("[data-mark-sheen]");
  if (!tilt || !sheen) return;

  const hover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const target: Pose = { ...REST };
  const now: Pose = { ...REST };
  let raf = 0;
  let last = 0;
  let inView = true;
  let box: DOMRect | null = null;
  let touched = false;

  const render = (time: number) => {
    raf = 0;
    const factor = 1 - Math.pow(1 - EASE, last ? Math.min(time - last, 100) / (1000 / 60) : 1);
    last = time;
    let moving = false;
    for (const key of Object.keys(target) as (keyof Pose)[]) {
      const delta = target[key] - now[key];
      if (Math.abs(delta) < SNAP) now[key] = target[key];
      else {
        now[key] += delta * factor;
        moving = true;
      }
    }
    tilt.style.transform = `perspective(1100px) rotateX(${now.pitch.toFixed(2)}deg) rotateY(${now.yaw.toFixed(2)}deg)`;
    // Tant que le W n'a pas été touché, le reflet reste à l'ouverture CSS (sa lame unique).
    if (touched) {
      sheen.style.transform = `translateX(${now.sheen.toFixed(1)}%)`;
      sheen.style.opacity = now.glow.toFixed(3);
    }
    if (moving && inView) raf = requestAnimationFrame(render);
    else last = 0;
  };
  const wake = () => {
    if (!raf && inView) raf = requestAnimationFrame(render);
  };

  /** Oriente le W vers un point de l'écran (curseur ou doigt). */
  const aim = (clientX: number, clientY: number) => {
    box ??= tilt.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (clientX - (box.left + box.width / 2)) / (box.width / 2 + 160)));
    const y = Math.max(-1, Math.min(1, (clientY - (box.top + box.height / 2)) / (box.height / 2 + 160)));
    touched = true;
    target.yaw = x * MAX_YAW;
    target.pitch = -y * MAX_PITCH;
    target.sheen = x * 14; // en % de la lame (2,4 × la largeur du W) : le reflet reste sur la face
    target.glow = 0.55 + Math.abs(x) * 0.35;
    wake();
  };
  const rest = () => {
    Object.assign(target, REST, { sheen: target.sheen > 0 ? 45 : -45 });
    wake();
  };
  const forget = () => {
    box = null;
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    aim(event.clientX, event.clientY);
  };
  let release = 0;
  const onDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    forget(); // un doigt arrive souvent après un défilement : position relue
    aim(event.clientX, event.clientY);
    clearTimeout(release);
    release = window.setTimeout(rest, TOUCH_HOLD_MS);
  };

  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (!inView) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(section);

  if (hover) {
    section.addEventListener("pointerenter", forget, { passive: true });
    section.addEventListener("pointermove", onMove, { passive: true });
    section.addEventListener("pointerleave", rest, { passive: true });
  }
  section.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("scroll", forget, { passive: true });
  window.addEventListener("resize", forget, { passive: true });

  window.addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return; // bfcache : la page revient telle quelle
      cancelAnimationFrame(raf);
      clearTimeout(release);
      io.disconnect();
      section.removeEventListener("pointerenter", forget);
      section.removeEventListener("pointermove", onMove);
      section.removeEventListener("pointerleave", rest);
      section.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", forget);
      window.removeEventListener("resize", forget);
    },
    { once: true },
  );
}
