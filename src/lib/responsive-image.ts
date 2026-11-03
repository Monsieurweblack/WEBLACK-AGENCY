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

export type ResponsiveImage =
  | { kind: "local"; src: string; sources: { type: string; srcset: string }[] }
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

/** null quand la source est invalide (champ Sanity vide ou mal saisi) : l'appelant n'affiche pas d'image. */
export async function responsiveImage(src: string, width: number): Promise<ResponsiveImage | null> {
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
  const sources = await Promise.all(
    (["avif", "webp"] as const).map(async (format) => {
      const variants = await Promise.all(
        localVariantWidths(photo.width).map((w) => getImage({ src: photo, width: w, format, quality: LOCAL_PHOTO_QUALITY[format] })),
      );
      return { type: `image/${format}`, srcset: variants.map((v) => `${v.src} ${v.attributes.width}w`).join(", ") };
    }),
  );
  return { kind: "local", src, sources };
}
