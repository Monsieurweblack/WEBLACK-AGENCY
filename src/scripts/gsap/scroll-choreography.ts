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
        if (el.hasAttribute("data-split")) splitWords(el);
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

  reveals.forEach((el) => observer.observe(el));

  // Manifeste lu au défilement (motion.css, .mq-word) : quand la citation a
  // franchi la ligne médiane de l'écran vers le haut, chaque mot est à son
  // état final — qui est aussi son état naturel. Les 26 animations liées au
  // défilement sont alors retirées : plus aucun calcul pour un texte déjà lu.
  // L'observateur ne regarde qu'une ligne (marges -50 %) : il se déclenche à
  // l'entrée et à la sortie de la citation, jamais entre les deux.
  const manifesto = document.querySelector<HTMLElement>(".mq-word")?.closest("section");
  let read: IntersectionObserver | undefined;
  if (manifesto) {
    read = new IntersectionObserver(
      ([entry]) => {
        const passed = !entry.isIntersecting && entry.rootBounds !== null && entry.boundingClientRect.bottom <= entry.rootBounds.top;
        if (!passed) return;
        manifesto.classList.add("mq-read");
        read?.disconnect();
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    read.observe(manifesto);
  }

  // bfcache : la page restaurée garde son état, les observateurs n'ont plus rien à faire.
  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      read?.disconnect();
    },
    { once: true },
  );
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
