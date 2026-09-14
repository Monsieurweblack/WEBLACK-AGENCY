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
