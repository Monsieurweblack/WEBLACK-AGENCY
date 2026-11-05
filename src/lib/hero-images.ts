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
  /*
   * Largeur affichée par object-cover : grand écran, colonne pleine hauteur
   * (100svh × 16/9 = 178vh) ; tablette portrait, bandeau de 44svh limité par
   * sa hauteur (44 × 16/9 ≈ 78vh) ; écran couché, limité par sa largeur.
   */
  sizes: "(min-width: 1024px) 178vh, (orientation: landscape) 100vw, 78vh",
  /*
   * Téléphone en portrait : le bandeau (100vw × 44svh, au moins 18rem) est
   * plus étroit que la photo 16:9 — object-cover n'en montre qu'une bande
   * centrale d'environ 5:4. On sert ce recadrage 5:4 (affiché à 44svh × 5/4
   * = 55vh de large) au lieu de la photo entière : mêmes pixels visibles,
   * même encodage, ~37 % de pixels en moins à 412 px (DPR 1,75).
   */
  crop: { media: "(max-width: 767px) and (max-aspect-ratio: 1/1)", aspect: 5 / 4, widths: [480, 800], sizes: "55vh" },
  focus: "45% 30%",
} as const;
