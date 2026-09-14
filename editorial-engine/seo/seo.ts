export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export interface SeoCheck {
  ok: boolean;
  issues: string[];
}

export function checkSeoTitle(title: string): SeoCheck {
  const issues: string[] = [];
  if (title.length < 20) issues.push("Titre SEO trop court (< 20 caractères)");
  if (title.length > 70) issues.push("Titre SEO trop long (> 70 caractères, risque de troncature)");
  return { ok: issues.length === 0, issues };
}

export function checkSeoDescription(description: string): SeoCheck {
  const issues: string[] = [];
  if (description.length < 70) issues.push("Meta description trop courte (< 70 caractères)");
  if (description.length > 160) issues.push("Meta description trop longue (> 160 caractères, risque de troncature)");
  return { ok: issues.length === 0, issues };
}

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

/**
 * Brings an overlong SEO field back under its limit by dropping trailing
 * words at a word boundary. It only ever REMOVES text, so what survives
 * still says exactly what the writer wrote — no rewording, no padding, and
 * deliberately no fix for a field that is too SHORT, since lengthening one
 * would mean inventing copy to hit a character count.
 */
export function trimToLimit(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const atBoundary = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return atBoundary.replace(/[\s,;:–—-]+$/u, "");
}
