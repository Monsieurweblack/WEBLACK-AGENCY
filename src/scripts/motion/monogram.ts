/**
 * Le monogramme vivant — réponse du W à la main qui l'approche.
 *
 * Souris (survol réel, pointeur fin) : une perspective limitée (±7° en
 * lacet, ±5° en tangage) qui suit le curseur, et un reflet doré qui glisse
 * sur la face du W. Le curseur sort : tout revient au repos, sans ressort.
 * Toucher : aucun survol à attendre — un appui relance la lame de lumière.
 *
 * Rien ne tourne quand rien ne bouge : la boucle d'animation ne vit que le
 * temps de rejoindre la cible, s'arrête hors écran, et tout est détaché à
 * pagehide. Préférence de mouvement réduit : le script ne fait rien, le W
 * reste dans son état stable.
 */

const MAX_YAW = 7;
const MAX_PITCH = 5;
/** Part de l'écart rattrapée en 1/60 s ; le calcul suit le temps réel, pas la cadence d'affichage. */
const EASE = 0.09;
/** En dessous de cet écart (degrés, pour cent), la valeur rejoint sa cible et la boucle s'arrête. */
const SNAP = 0.05;

export function initMonogram(section: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tilt = section.querySelector<HTMLElement>("[data-mark-tilt]");
  const mark = section.querySelector<HTMLElement>("[data-hero-mark]");
  if (!tilt || !mark) return;

  const hover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const target = { yaw: 0, pitch: 0, lx: 35, ly: 28, lo: 0 };
  const now = { ...target };
  let raf = 0;
  let last = 0;
  let inView = true;

  const render = (time: number) => {
    raf = 0;
    const factor = 1 - Math.pow(1 - EASE, last ? Math.min(time - last, 100) / (1000 / 60) : 1);
    last = time;
    let moving = false;
    for (const key of Object.keys(target) as (keyof typeof target)[]) {
      const delta = target[key] - now[key];
      if (Math.abs(delta) < SNAP) now[key] = target[key];
      else {
        now[key] += delta * factor;
        moving = true;
      }
    }
    tilt.style.setProperty("--ry", `${now.yaw.toFixed(2)}deg`);
    tilt.style.setProperty("--rx", `${now.pitch.toFixed(2)}deg`);
    mark.style.setProperty("--lx", `${now.lx.toFixed(1)}%`);
    mark.style.setProperty("--ly", `${now.ly.toFixed(1)}%`);
    mark.style.setProperty("--lo", now.lo.toFixed(3));
    if (moving && inView) raf = requestAnimationFrame(render);
    else last = 0;
  };
  const wake = () => {
    if (!raf && inView) raf = requestAnimationFrame(render);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const box = mark.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / (box.width / 2 + 200)));
    const y = Math.max(-1, Math.min(1, (event.clientY - (box.top + box.height / 2)) / (box.height / 2 + 200)));
    target.yaw = x * MAX_YAW;
    target.pitch = -y * MAX_PITCH;
    target.lx = 50 + x * 40;
    target.ly = 50 + y * 40;
    target.lo = 1;
    wake();
  };
  const onLeave = () => {
    Object.assign(target, { yaw: 0, pitch: 0, lx: 35, ly: 28, lo: 0 });
    wake();
  };
  const onTap = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    mark.classList.remove("is-sweeping");
    void mark.offsetWidth; // relance l'animation CSS
    mark.classList.add("is-sweeping");
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
    section.addEventListener("pointermove", onMove, { passive: true });
    section.addEventListener("pointerleave", onLeave, { passive: true });
  }
  section.addEventListener("pointerdown", onTap, { passive: true });

  window.addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return; // bfcache : la page revient telle quelle
      cancelAnimationFrame(raf);
      io.disconnect();
      section.removeEventListener("pointermove", onMove);
      section.removeEventListener("pointerleave", onLeave);
      section.removeEventListener("pointerdown", onTap);
    },
    { once: true },
  );
}
