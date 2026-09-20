/**
 * Whether `src` is safe to hand to an `<img>` tag. Extracted from
 * RemoteImage.astro so the rule (and its regression tests) don't depend on
 * rendering an Astro component — `src` traces back to Sanity's
 * `externalImage.url`, a free-text field that has shipped undefined, empty,
 * and local-filesystem-path values to production before (see
 * content-integrity.mjs's image checks, which catch the same data problem
 * independently — this is the render-time safety net, not a replacement).
 */
export function isValidImageSrc(src: unknown): src is string {
  return typeof src === "string" && (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/"));
}

export function isRemoteImageSrc(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}
