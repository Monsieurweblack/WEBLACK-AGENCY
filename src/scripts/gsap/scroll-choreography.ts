import { revealKeyframes, REVEAL_DURATION_MS, SIGNATURE_EASING, WORD_STAGGER_MS, wordKeyframes } from "../motion/tokens";

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

  const reveals = [...document.querySelectorAll<HTMLElement>("[data-reveal], [data-split]")];
  if (!reveals.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        if (el.hasAttribute("data-reveal")) {
          el.animate(revealKeyframes, {
            duration: REVEAL_DURATION_MS,
            delay: Number(el.dataset.revealDelay || 0) * 1000,
            easing: SIGNATURE_EASING,
            fill: "backwards",
          });
        }
        if (el.hasAttribute("data-split")) {
          el.querySelectorAll<HTMLElement>("[data-word]").forEach((word, i) =>
            word.animate(wordKeyframes, {
              duration: REVEAL_DURATION_MS,
              delay: 120 + i * WORD_STAGGER_MS,
              easing: SIGNATURE_EASING,
              fill: "backwards",
            }),
          );
        }
      }
    },
    // 40 px sous le bord : l'animation démarre juste avant le premier pixel visible,
    // jamais un bloc qui s’affiche puis disparaît pour réapparaître.
    { rootMargin: "0px 0px 40px 0px", threshold: 0 },
  );

  // Les blocs déjà dans l'écran sont laissés tels quels : les animer ferait
  // clignoter un contenu déjà lu. Une seule lecture de mise en page pour tous.
  const visible = reveals.map((el) => el.getBoundingClientRect().top < window.innerHeight);
  reveals.forEach((el, i) => {
    if (visible[i]) return;
    if (el.hasAttribute("data-split")) splitWords(el);
    observer.observe(el);
  });

  // bfcache : la page restaurée garde son état, l'observateur n'a plus rien à faire.
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}

/**
 * Titres [data-split] : chaque mot devient un <span> en ligne, découpé au
 * dernier moment et seulement pour un titre encore hors écran. Le texte ne
 * change pas — mêmes mots, mêmes espaces —, il reste un seul titre pour les
 * technologies d'assistance.
 */
function splitWords(el: HTMLElement) {
  for (const node of [...el.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    const fragment = document.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.append(part);
        continue;
      }
      const word = document.createElement("span");
      word.dataset.word = "";
      word.style.display = "inline-block";
      word.textContent = part;
      fragment.append(word);
    }
    node.replaceWith(fragment);
  }
}
