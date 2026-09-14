import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "./env.ts";

const BIBLE_PATH = path.join(ENGINE_ROOT, "config", "weblack-editorial-bible.json");

export interface EditorialBible {
  generatedAt: string;
  source: string;
  sampleSize: number;
  positioning: string;
  territories: string[];
  tone: string[];
  categoriesInUse: Record<string, number>;
  categoriesDeclaredButUnused: string[];
  titleLength: { minChars: number; maxChars: number; avgChars: number };
  excerptLength: { minChars: number; maxChars: number; avgChars: number };
  bodyLength: { minWords: number; maxWords: number; avgWords: number; note: string };
  authorObservations: { distinctValues: (string | null)[]; nullCount: number; note: string };
  authorPolicy: string;
  expressionsToAvoid: string[];
  seoRules: { titleMinChars: number; titleMaxChars: number; descriptionMinChars: number; descriptionMaxChars: number };
}

/** Returns undefined (never throws, never fabricates a bible) if the file hasn't been generated yet — callers fall back to the hand-written WRITING_RULES only. */
export function loadEditorialBible(): EditorialBible | undefined {
  if (!fs.existsSync(BIBLE_PATH)) return undefined;
  return JSON.parse(fs.readFileSync(BIBLE_PATH, "utf8")) as EditorialBible;
}

export function saveEditorialBible(bible: EditorialBible): void {
  fs.writeFileSync(BIBLE_PATH, JSON.stringify(bible, null, 2), "utf8");
}

/** Turns the bible into prompt text appended to the generation system prompt — only observed facts and explicit project rules, no invented style guidance. */
export function bibleToPromptRules(bible: EditorialBible): string {
  return `Repères déduits de l'analyse des ${bible.sampleSize} articles réels déjà publiés sur le Journal WEBLACK (${bible.source}) :
- Longueur de titre observée : ${bible.titleLength.minChars}-${bible.titleLength.maxChars} caractères (moyenne ${bible.titleLength.avgChars}).
- Longueur d'excerpt observée : ${bible.excerptLength.minChars}-${bible.excerptLength.maxChars} caractères (moyenne ${bible.excerptLength.avgChars}).
- Longueur de corps observée : ${bible.bodyLength.note}
- Catégories effectivement utilisées : ${Object.entries(bible.categoriesInUse).map(([c, n]) => `${c} (${n})`).join(", ")}.
- ${bible.authorPolicy}

Expressions à éviter explicitement (fournies par WEBLACK) : ${bible.expressionsToAvoid.map((e) => `"${e}"`).join(", ")}.`;
}
