/**
 * Jetons de mouvement côté script — mêmes valeurs que motion.css et
 * --ease-signature (@theme, global.css). Un geste animé en JavaScript ne
 * doit jamais avoir une autre courbe ou une autre durée que son équivalent CSS.
 */
export const SIGNATURE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
export const REVEAL_DURATION_MS = 800;

/** Fondu montant des blocs [data-reveal] : 28 px, l'amplitude historique du site. */
export const revealKeyframes: Keyframe[] = [
  { opacity: 0, transform: "translateY(28px)" },
  { opacity: 1, transform: "none" },
];

/** Titres [data-split] : chaque mot se lève à son tour, 45 ms d'écart. */
export const WORD_STAGGER_MS = 45;
export const wordKeyframes: Keyframe[] = [
  { opacity: 0, transform: "translateY(0.45em)" },
  { opacity: 1, transform: "none" },
];
