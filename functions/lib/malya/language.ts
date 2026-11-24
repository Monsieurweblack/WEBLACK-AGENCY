import type { Lang } from "./types.ts";

const FR_HINTS = [
  "le", "la", "les", "des", "une", "un", "est", "pour", "avec", "bonjour", "salut", "merci", "je", "vous", "nous",
  "quoi", "comment", "quel", "quelle", "que", "qui", "mon", "ma", "mes", "sur", "dans", "aux", "au", "pas", "c'est",
  "voudrais", "souhaite", "veux", "besoin", "projet", "marque", "créateur", "créatrice", "quels", "peux", "pouvez",
];
const EN_HINTS = [
  "the", "and", "is", "are", "for", "with", "hello", "hi", "thanks", "thank", "you", "we", "what", "how", "which",
  "who", "my", "our", "on", "in", "to", "of", "not", "i", "would", "like", "want", "need", "project", "brand",
  "designer", "can", "could", "please", "about", "does",
];

function words(text: string): string[] {
  return text.toLowerCase().normalize("NFC").split(/[^\p{L}']+/u).filter(Boolean);
}

/** Détection légère FR/EN. En cas d'égalité : la langue de la page, sinon FR. */
export function detectLanguage(text: string, fallback: Lang = "fr"): Lang {
  const ws = words(text);
  let fr = 0;
  let en = 0;
  for (const w of ws) {
    if (FR_HINTS.includes(w)) fr += 1;
    if (EN_HINTS.includes(w)) en += 1;
  }
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) fr += 2;
  if (fr === en) return fallback;
  return fr > en ? "fr" : "en";
}
