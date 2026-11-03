/**
 * Variantes responsives des photographies locales (public/photos/),
 * générées à la compilation par l'outil d'images d'Astro.
 *
 * Règles (PR 0, photographie de mode sur fond #0A0A0A) :
 *  - l'original est la variante maximale : aucune largeur au-delà ;
 *  - qualités choisies par mesure du banding sur les deux photos les plus
 *    sombres du site (comparatifs joints à la PR 0) : AVIF 90 en 4:4:4,
 *    WebP 95 ; en dessous, des aplats apparaissent dans les ombres.
 */

/** Paliers de largeur proposés au navigateur (mobile → grand écran). */
export const WIDTH_LADDER = [480, 800, 1200, 1600, 2400] as const;

export const LOCAL_PHOTO_QUALITY = { avif: 90, webp: 95 } as const;

/** Largeurs à générer pour un original : paliers strictement inférieurs, puis l'original lui-même. */
export function localVariantWidths(originalWidth: number): number[] {
  if (!Number.isFinite(originalWidth) || originalWidth <= 0) return [];
  const widths = WIDTH_LADDER.filter((w) => w < originalWidth);
  return [...widths, Math.round(originalWidth)];
}
