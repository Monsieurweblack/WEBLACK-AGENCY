/**
 * Visuels d'ouverture codés en dur dans un composant ET préchargés par la
 * page qui l'utilise (BaseLayout `lcpImage`) : une seule déclaration, pour
 * que le préchargement ne puisse pas diverger de l'image réellement affichée.
 */
export const TALENT_HERO = { src: "/photos/ze-defile-2026-cover.jpg", width: 1600, height: 900, sizes: "100vw" } as const;

/** Bandeau des études de cas (WorkDetail) : la couverture est demandée à cette largeur. */
export const WORK_HERO_WIDTH = 2400;
