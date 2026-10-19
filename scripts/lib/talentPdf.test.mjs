/**
 * Dossiers PDF de candidature (public/downloads/) : présents, à jour avec
 * leur générateur, remplissables, complets dans les deux langues.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFCheckBox, PDFDocument, PDFRadioGroup, PDFTextField } from "pdf-lib";
import { buildPdf, OUTPUTS } from "../talent-pdf/generate.mjs";

const PUBLIC = new URL("../../public/downloads/", import.meta.url);
const REQUIRED_TEXT = ["profile.firstName", "profile.lastName", "profile.birthDate", "profile.city", "profile.country", "profile.email", "profile.phone", "availability.languages", "signature.name", "signature.date"];
const REQUIRED_CHOICES = ["professional.category", "professional.experienceLevel", "professional.experienceDuration", "availability.mobility"];
const DECLARATIONS = ["confirmation.adult", "confirmation.accuracy", "confirmation.privacyNotice"];

for (const lang of ["fr", "en"]) {
  test(`PDF ${lang} — le fichier publié correspond exactement au générateur (pas de version périmée en ligne)`, async () => {
    const published = readFileSync(new URL(OUTPUTS[lang], PUBLIC));
    const fresh = Buffer.from(await buildPdf(lang));
    assert.ok(published.equals(fresh), `régénérer : node --experimental-strip-types scripts/talent-pdf/generate.mjs`);
  });

  test(`PDF ${lang} — champs remplissables : obligatoires marqués, choix fermés, déclarations dont la majorité`, async () => {
    const doc = await PDFDocument.load(readFileSync(new URL(OUTPUTS[lang], PUBLIC)));
    const form = doc.getForm();
    const byName = new Map(form.getFields().map((f) => [f.getName(), f]));

    for (const name of REQUIRED_TEXT) {
      assert.ok(byName.get(name) instanceof PDFTextField, name);
      assert.ok(byName.get(name).isRequired(), `${name} obligatoire`);
    }
    for (const name of REQUIRED_CHOICES) {
      const group = byName.get(name);
      assert.ok(group instanceof PDFRadioGroup, name);
      assert.ok(group.isRequired(), `${name} obligatoire`);
    }
    assert.deepEqual(form.getRadioGroup("professional.category").getOptions(), ["runway", "commercial", "photo", "editorial", "creative", "other"]);
    assert.deepEqual(form.getRadioGroup("availability.mobility").getOptions(), ["local", "national", "international"]);
    for (const name of DECLARATIONS) {
      assert.ok(byName.get(name) instanceof PDFCheckBox, name);
      assert.ok(byName.get(name).isRequired(), `${name} obligatoire`);
    }
    assert.equal([...byName.keys()].filter((n) => n.startsWith("availability.desiredProjects.")).length, 6);

    // Remplissage effectif : un lecteur peut écrire dans chaque champ texte et cocher chaque case.
    form.getTextField("profile.lastName").setText("Ñ'DIAYE-ŒUVRE Élodie");
    form.getCheckBox("confirmation.adult").check();
    form.getRadioGroup("professional.category").select("other");
    const reloaded = (await PDFDocument.load(await doc.save())).getForm();
    assert.equal(reloaded.getTextField("profile.lastName").getText(), "Ñ'DIAYE-ŒUVRE Élodie");
    assert.ok(reloaded.getCheckBox("confirmation.adult").isChecked());
    assert.equal(reloaded.getRadioGroup("professional.category").getSelected(), "other");
  });

  test(`PDF ${lang} — métadonnées dans la bonne langue, marque WEBLACK uniquement`, async () => {
    const bytes = readFileSync(new URL(OUTPUTS[lang], PUBLIC));
    const doc = await PDFDocument.load(bytes);
    assert.match(doc.getTitle() ?? "", lang === "fr" ? /^Dossier de candidature WEBLACK TALENTS/ : /^WEBLACK TALENTS application form/);
    assert.equal(doc.getAuthor(), "WEBLACK");
    // Le texte des pages est compressé dans le PDF : on vérifie la source des textes (générateur + libellés relus dans ui.ts).
    const generator = readFileSync(new URL("../talent-pdf/generate.mjs", import.meta.url), "utf8");
    const labels = readFileSync(new URL("../../src/i18n/ui.ts", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes('"talentApplication.'));
    assert.ok(!/AFRICA/.test(generator.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) && !labels.some((l) => /AFRICA/.test(l)), "jamais la raison sociale dans le dossier");
    assert.ok(doc.getPageCount() <= 3, "tient sur 3 pages A4");
  });
}
