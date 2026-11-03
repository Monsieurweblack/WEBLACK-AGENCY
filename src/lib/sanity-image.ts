/**
 * Variantes responsives des images Sanity, par paramètres d'URL du CDN
 * Sanity générés avec l'image builder officiel (@sanity/image-url) — aucune
 * conversion locale, aucune transformation hors du CDN.
 *
 * Mêmes règles que les photographies locales (voir local-photos.ts) :
 * paliers de largeur jamais au-delà de l'original (largeur lue dans le nom
 * du fichier, `{id}-{w}x{h}.{ext}`), fit=max pour que le CDN n'agrandisse
 * jamais, auto=format (AVIF/WebP selon le navigateur), qualité plancher
 * retenue contre le banding.
 */
import { createImageUrlBuilder } from "@sanity/image-url";
import { localVariantWidths, LOCAL_PHOTO_QUALITY } from "./local-photos.ts";

const SANITY_IMAGE = /^https:\/\/cdn\.sanity\.io\/images\/([^/]+)\/([^/]+)\/[a-f0-9]+-(\d+)x(\d+)\.\w+$/;

export const SANITY_IMAGE_QUALITY = LOCAL_PHOTO_QUALITY.avif;

export interface SanityImageInfo {
  /** URL nue, sans paramètres (l'image builder refuse une URL qui en porte). */
  baseUrl: string;
  projectId: string;
  dataset: string;
  width: number;
  height: number;
}

/** Reconnaît une URL d'image du CDN Sanity et en lit projet, dataset et dimensions d'origine. */
export function parseSanityImageUrl(url: string): SanityImageInfo | null {
  const baseUrl = url.split(/[?#]/)[0];
  const match = baseUrl.match(SANITY_IMAGE);
  if (!match) return null;
  const [, projectId, dataset, w, h] = match;
  return { baseUrl, projectId, dataset, width: Number(w), height: Number(h) };
}

function sanityUrl(info: SanityImageInfo, width: number): string {
  return createImageUrlBuilder({ projectId: info.projectId, dataset: info.dataset })
    .image(info.baseUrl)
    .width(width)
    .fit("max")
    .auto("format")
    .quality(SANITY_IMAGE_QUALITY)
    .url();
}

/**
 * srcset et src de repli pour une image Sanity affichée à `displayWidth` px
 * (largeur CSS déclarée par le composant). null si l'URL n'est pas une
 * image du CDN Sanity reconnue.
 */
export function sanityResponsiveImage(url: string, displayWidth: number): { src: string; srcset: string } | null {
  const info = parseSanityImageUrl(url);
  if (!info) return null;
  const widths = localVariantWidths(info.width);
  return {
    src: sanityUrl(info, Math.min(Math.round(displayWidth), info.width)),
    srcset: widths.map((w) => `${sanityUrl(info, w)} ${w}w`).join(", "),
  };
}
