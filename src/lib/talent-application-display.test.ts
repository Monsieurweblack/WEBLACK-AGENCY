import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatApplicationField } from "./talent-application-display.ts";
import {
  EXPERIENCE_DURATIONS,
  EXPERIENCE_LEVELS,
  EYE_COLORS,
  HAIR_COLORS,
  MOBILITY_OPTIONS,
  PROJECT_TYPES,
  TALENT_CATEGORIES,
} from "../../functions/lib/talentOptions.ts";

const dictionary: Record<string, string> = {
  "talentApplication.option.category.runway": "Mannequin runway / défilé",
  "talentApplication.option.mobility.international": "Internationale",
  "talentApplication.option.project.runway": "Défilés de mode",
  "talentApplication.option.project.editorial": "Éditoriaux et magazines",
};
const translate = (key: string) => dictionary[key];

// 15 — compatibilité avec les dossiers existants
test("un code connu est rendu par son libellé", () => {
  assert.equal(formatApplicationField("talent_category", "runway", translate), "Mannequin runway / défilé");
  assert.equal(formatApplicationField("mobility", "international", translate), "Internationale");
  assert.equal(formatApplicationField("desired_projects", '["runway","editorial"]', translate), "Défilés de mode, Éditoriaux et magazines");
  assert.equal(formatApplicationField("country", "SN", translate), "Sénégal");
  assert.equal(formatApplicationField("languages", '["fr","wo"]', translate), "français, wolof");
});

test("une valeur ancienne en texte libre reste affichée telle quelle, jamais masquée", () => {
  assert.equal(formatApplicationField("languages", "Français, Wolof", translate), "Français, Wolof");
  assert.equal(formatApplicationField("mobility", "Partout en Afrique de l'Ouest", translate), "Partout en Afrique de l'Ouest");
  assert.equal(formatApplicationField("country", "Sénégal", translate), "Sénégal");
  assert.equal(formatApplicationField("desired_projects", "Défilés, shootings", translate), "Défilés, shootings");
  assert.equal(formatApplicationField("talent_category", null, translate), "");
});

// 13 — affichage français et anglais : chaque option proposée a son libellé dans les deux langues
test("chaque valeur autorisée a un libellé en français ET en anglais", () => {
  const source = readFileSync(new URL("../i18n/ui.ts", import.meta.url), "utf8");
  const lines = source.split("\n");
  const frStart = lines.findIndex((line) => /^ {2}fr: \{/.test(line));
  const enStart = lines.findIndex((line) => /^ {2}en: \{/.test(line));
  const keysIn = (from: number, to: number) => new Set([...lines.slice(from, to).join("\n").matchAll(/"(talentApplication\.[^"]+)":/g)].map((m) => m[1]));
  const fr = keysIn(frStart, enStart);
  const en = keysIn(enStart, lines.length);

  const expected = [
    ...TALENT_CATEGORIES.map((v) => `category.${v}`),
    ...EXPERIENCE_LEVELS.map((v) => `level.${v}`),
    ...EXPERIENCE_DURATIONS.map((v) => `duration.${v}`),
    ...MOBILITY_OPTIONS.map((v) => `mobility.${v}`),
    ...MOBILITY_OPTIONS.map((v) => `mobilityHint.${v}`),
    ...PROJECT_TYPES.map((v) => `project.${v}`),
    ...EYE_COLORS.map((v) => `eye.${v}`),
    ...HAIR_COLORS.map((v) => `hair.${v}`),
  ].map((suffix) => `talentApplication.option.${suffix}`);

  for (const key of expected) {
    assert.ok(fr.has(key), `libellé FR manquant : ${key}`);
    assert.ok(en.has(key), `libellé EN manquant : ${key}`);
  }
  assert.deepEqual([...fr].sort(), [...en].sort(), "les blocs FR et EN du formulaire ont exactement les mêmes clés");
});
