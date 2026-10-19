/**
 * Mise en forme lisible d'un champ de dossier de candidature pour
 * l'administration. Les dossiers récents stockent des codes (catégorie,
 * mobilité, langues ISO, pays ISO…) ; les éventuels dossiers plus anciens
 * portaient du texte libre dans les mêmes colonnes. Toute valeur qui n'est
 * pas un code connu est donc rendue telle quelle — jamais masquée, jamais
 * "corrigée".
 *
 * Module pur : le traducteur est injecté, pour rester testable hors
 * navigateur (src/lib/talent-application-display.test.ts).
 */

export type Translate = (key: string) => string | undefined;

const CODE_GROUPS: Record<string, string> = {
  talent_category: "category",
  experience_level: "level",
  experience_duration: "duration",
  mobility: "mobility",
  eye_color: "eye",
  hair_color: "hair",
};

function parseJsonArray(raw: string): string[] | undefined {
  if (!raw.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function formatApplicationField(key: string, raw: unknown, translate: Translate, locale = "fr"): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const text = String(raw);

  const group = CODE_GROUPS[key];
  if (group) return translate(`talentApplication.option.${group}.${text}`) ?? text;

  if (key === "desired_projects") {
    const codes = parseJsonArray(text);
    return codes ? codes.map((code) => translate(`talentApplication.option.project.${code}`) ?? code).join(", ") : text;
  }

  if (key === "languages") {
    const codes = parseJsonArray(text);
    if (!codes) return text;
    const names = new Intl.DisplayNames([locale], { type: "language" });
    return codes.map((code) => names.of(code) ?? code).join(", ");
  }

  if (key === "country" && /^[A-Z]{2}$/.test(text)) {
    return new Intl.DisplayNames([locale], { type: "region" }).of(text) ?? text;
  }

  if (key === "portfolio_links") return text.split("\n").filter(Boolean).join(", ");
  if (key === "submission_lang") return text.toUpperCase();
  return text;
}
