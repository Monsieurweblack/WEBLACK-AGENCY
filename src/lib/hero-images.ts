/**
 * Visuels d'ouverture codés en dur dans un composant ET préchargés par la
 * page qui l'utilise (BaseLayout `lcpImage`) : une seule déclaration, pour
 * que le préchargement ne puisse pas diverger de l'image réellement affichée.
 */
/**
 * `portrait` : rapport de viewport sous lequel le bandeau est à coup sûr plus
 * haut que large — sa hauteur minimale (70vh ici, 60vh pour les études de
 * cas) dépasse alors 100vw. Voir responsiveImage().
 */
export const TALENT_HERO = { src: "/photos/ze-defile-2026-cover.jpg", width: 1600, height: 900, sizes: "100vw", portrait: "7/10" } as const;

/** Bandeau des études de cas (WorkDetail) : la couverture est demandée à cette largeur. */
export const WORK_HERO_WIDTH = 2400;
export const WORK_HERO_PORTRAIT = "3/5";

/**
 * Écran d'accueil de la candidature (/talent/candidature) : la même
 * photographie ZÉ DÉFILÉ que /talent, cadrée sur le mannequin (au centre de
 * l'image d'origine). Le cadre est plus haut que large rapporté au 16:9 de
 * la photo, qui est donc dimensionnée par sa hauteur : bandeau ≈ 0,9 × la
 * largeur d'écran sur téléphone (rendu ≈ 160 vw), colonne pleine hauteur
 * sur grand écran (rendu ≈ 178 vh). `sizes` le dit au navigateur, qui
 * choisit une variante nette. Pas de recadrage carré pour écran portrait :
 * centré, il coupait le mannequin.
 */
export const TALENT_APPLICATION_IMAGE = {
  src: TALENT_HERO.src,
  width: TALENT_HERO.width,
  height: TALENT_HERO.height,
  sizes: "(min-width: 1024px) 178vh, 160vw",
  focus: "45% 30%",
} as const;
