import { revealKeyframes, REVEAL_DURATION_MS, SIGNATURE_EASING } from "../motion/tokens";

let initialized = false;

/**
 * Apparition des blocs [data-reveal] (46 pages l'appellent).
 *
 * Ce module chargeait GSAP + ScrollTrigger (~46 Ko compressés, mesurés sur
 * l'aperçu PR 0) sur chaque page pour un seul effet : un fondu montant à
 * l'entrée dans l'écran. Un IntersectionObserver et l'API Web Animations du
 * navigateur font exactement ce geste, sans téléchargement ni évaluation :
 * c'est l'essentiel du temps de blocage (TBT) mesuré sur l'accueil.
 *
 * Contrat inchangé : rien n'est jamais masqué d'avance. Un bloc déjà visible
 * au chargement ne bouge pas ; un bloc plus bas reste rendu tel quel jusqu'à
 * son premier pixel visible, puis s'anime depuis l'état initial
 * (fill: "backwards" couvre le délai éventuel). Si ce script échoue, la page
 * est simplement immobile. Les compteurs [data-counter] ont été retirés :
 * aucune page ne les utilisait plus.
 */
export function initScrollChoreography() {
  if (initialized) return;
  initialized = true;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window) || !("animate" in Element.prototype)) return;

  const reveals = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (!reveals.length) return;

  // Premier rapport de l'observateur = état au chargement, calculé après la
  // mise en page : un bloc déjà dans l'écran est laissé tel quel (l'animer
  // ferait clignoter un contenu déjà lu). Aucune lecture synchrone de
  // position ici — getBoundingClientRect() sur chaque bloc forçait un
  // recalcul de style et de mise en page de tout le document au chargement.
  const seen = new WeakSet<Element>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const first = !seen.has(el);
        seen.add(el);
        if (!entry.isIntersecting) continue;
        observer.unobserve(el);
        if (first) continue;
        el.animate(revealKeyframes, {
          duration: REVEAL_DURATION_MS,
          delay: Number(el.dataset.revealDelay || 0) * 1000,
          easing: SIGNATURE_EASING,
          fill: "backwards",
        });
      }
    },
    // 40 px sous le bord : l'animation démarre juste avant le premier pixel visible,
    // jamais un bloc qui s’affiche puis disparaît pour réapparaître.
    { rootMargin: "0px 0px 40px 0px", threshold: 0 },
  );

  reveals.forEach((el) => observer.observe(el));

  // bfcache : la page restaurée garde son état, l'observateur n'a plus rien à faire.
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}

