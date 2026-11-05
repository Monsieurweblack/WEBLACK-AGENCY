import { getImage } from "astro:assets";
import { isValidImageSrc, isRemoteImageSrc } from "./image-src";
import { localVariantWidths, LOCAL_PHOTO_QUALITY } from "./local-photos";
import { sanityResponsiveImage } from "./sanity-image";

/**
 * Source unique des variantes d'une image affichée : RemoteImage les rend
 * dans le <body>, BaseLayout en tire le préchargement de l'image LCP dans le
 * <head>. Les deux appellent cette fonction avec les mêmes arguments, donc
 * les URL préchargées sont exactement celles que le navigateur choisira — un
 * préchargement qui diverge d'un octet télécharge l'image deux fois.
 *
 * Les 23 photographies de public/photos/ restent versionnées et servies
 * telles quelles à leur URL /photos/… (images de partage, liens externes,
 * valeurs saisies dans Sanity). Pour l'affichage, elles sont relues ici par
 * l'outil d'images d'Astro, qui en génère À LA COMPILATION des variantes
 * AVIF et WebP aux largeurs utiles — jamais au-delà de l'original.
 */
const LOCAL_PHOTOS = import.meta.glob<{ default: ImageMetadata }>("/public/photos/*.{jpg,jpeg,png}", { eager: true });

export interface ImageSource {
  type: string;
  srcset: string;
  /** Présents sur les sources portrait seulement (voir `portrait` ci-dessous). */
  media?: string;
  sizes?: string;
}

/**
 * Recadrage dirigé d'une photo locale paysage (art direction), pour un cadre
 * dont on connaît la forme sur une plage d'écrans : sous `media`, le
 * <picture> sert un recadrage centré au rapport `aspect`, aux largeurs
 * `widths` (jamais au-delà de la hauteur de l'original), décrit par `sizes`.
 * Même encodage, même densité : seules les marges que le cadre rogne de
 * toute façon ne sont plus téléchargées.
 */
export interface ImageCrop {
  media: string;
  aspect: number;
  widths: readonly number[];
  sizes: string;
}

export type ResponsiveImage =
  | { kind: "local"; src: string; sources: ImageSource[] }
  | { kind: "remote"; src: string; srcset?: string }
  | { kind: "plain"; src: string };

/** Unsplash : srcset construit à partir de ses propres paramètres de redimensionnement. */
function withWidth(url: string, w: number) {
  const u = new URL(url);
  u.searchParams.set("w", String(w));
  u.searchParams.set("q", "80");
  u.searchParams.set("auto", "format");
  u.searchParams.set("fit", "crop");
  return u.toString();
}

/**
 * null quand la source est invalide (champ Sanity vide ou mal saisi) : l'appelant n'affiche pas d'image.
 *
 * `portrait` — bandeau plein cadre (object-cover, centré) d'une photo locale
 * paysage : le rapport largeur/hauteur de viewport (« 3/5 ») sous lequel le
 * cadre est à coup sûr plus haut que large. Dans ce cadre, object-cover
 * n'affiche jamais qu'une bande centrale de la photo, sur toute sa hauteur.
 * Pour chaque variante servie jusqu'ici (largeur w, hauteur h), on génère le
 * carré centré h × h qui contient cette bande en entier : mêmes pixels
 * affichés, même densité, même cadrage, même encodage — seules les marges
 * latérales que le cadre rognait ne sont plus téléchargées (44 % de pixels en moins
 * sur une photo 16:9, en pixels).
 *
 * Les `sizes` de ces sources (100vw ÷ rapport de la photo, soit 56.25vw en
 * 16:9) ne décrivent pas la largeur CSS du cadre : ils reproduisent
 * exactement la sélection faite jusqu'ici (variante w ≥ 100vw × DPR, donc
 * carré h = w ÷ rapport). Le navigateur choisit le carré de la variante
 * qu'il choisissait déjà, jamais un plus petit.
 */
export async function responsiveImage(src: string, width: number, portrait?: string, crop?: ImageCrop): Promise<ResponsiveImage | null> {
  if (!isValidImageSrc(src)) return null;

  if (isRemoteImageSrc(src)) {
    // Images Sanity : paliers de largeur par l'image builder, jamais au-delà
    // de l'original (voir sanity-image.ts). Autres hôtes distants : Unsplash.
    const sanity = sanityResponsiveImage(src, width);
    if (sanity) return { kind: "remote", src: sanity.src, srcset: sanity.srcset };
    const widths = [Math.round(width * 0.75), width, Math.min(width * 1.5, 3200)];
    return { kind: "remote", src: withWidth(src, width), srcset: widths.map((w) => `${withWidth(src, w)} ${w}w`).join(", ") };
  }

  // Photo locale connue : variantes responsives AVIF puis WebP, l'original
  // intact en dernier repli (navigateurs sans AVIF ni WebP).
  const photo = LOCAL_PHOTOS[`/public${src.split("?")[0]}`]?.default;
  if (!photo) return { kind: "plain", src };
  const ratio = photo.width / photo.height;
  const portraitSources =
    portrait && ratio > 1
      ? await Promise.all(
          (["avif", "webp"] as const).map(async (format) => {
            const squares = await Promise.all(
              localVariantWidths(photo.width).map((w) => {
                const side = Math.round(w / ratio);
                return getImage({ src: photo, width: side, height: side, fit: "cover", position: "center", format, quality: LOCAL_PHOTO_QUALITY[format] });
              }),
            );
            return {
              type: `image/${format}`,
              media: `(max-aspect-ratio: ${portrait})`,
              sizes: `${Math.round((100 / ratio) * 100) / 100}vw`,
              srcset: squares.map((v) => `${v.src} ${v.attributes.width}w`).join(", "),
            };
          }),
        )
      : [];
  const cropSources =
    crop && ratio > crop.aspect
      ? await Promise.all(
          (["avif", "webp"] as const).map(async (format) => {
            const maxWidth = Math.floor(photo.height * crop.aspect);
            const widths = [...new Set([...crop.widths.filter((w) => w < maxWidth), maxWidth])];
            const variants = await Promise.all(
              widths.map((w) =>
                getImage({ src: photo, width: w, height: Math.round(w / crop.aspect), fit: "cover", position: "center", format, quality: LOCAL_PHOTO_QUALITY[format] }),
              ),
            );
            return {
              type: `image/${format}`,
              media: crop.media,
              sizes: crop.sizes,
              srcset: variants.map((v) => `${v.src} ${v.attributes.width}w`).join(", "),
            };
          }),
        )
      : [];
  const sources = await Promise.all(
    (["avif", "webp"] as const).map(async (format) => {
      const variants = await Promise.all(
        localVariantWidths(photo.width).map((w) => getImage({ src: photo, width: w, format, quality: LOCAL_PHOTO_QUALITY[format] })),
      );
      return { type: `image/${format}`, srcset: variants.map((v) => `${v.src} ${v.attributes.width}w`).join(", ") };
    }),
  );
  return { kind: "local", src, sources: [...cropSources, ...portraitSources, ...sources] };
}
