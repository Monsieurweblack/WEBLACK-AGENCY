import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runQualityCheck } from "../validation/qualityCheck.ts";
import type { ExtractedFacts, GeneratedArticle } from "../generation/types.ts";

function emptyFacts(): ExtractedFacts {
  return {
    people: [], brands: [], organizations: [], locations: [], dates: [], numbers: [],
    events: [], claims: [], keyFacts: [], quotes: [], sourceLanguage: "en", factEvidence: [],
  };
}

function articleTitled(title: string): GeneratedArticle {
  const paragraph = (text: string, key: string) => ({
    _type: "block" as const,
    _key: key,
    style: "normal" as const,
    children: [{ _type: "span" as const, _key: key + "s", text, marks: [] }],
    markDefs: [] as [],
  });
  return {
    lang: "fr",
    title,
    slug: "un-slug",
    excerpt: "Un excerpt français de longueur raisonnable pour passer le contrôle de longueur.",
    category: "fashion",
    publishDate: "2026-09-15",
    author: "Monsieur W.",
    body: [
      paragraph(
        "La collection présentée cette saison prolonge un travail engagé depuis plusieurs années, dans une continuité que les commentateurs de la maison avaient déjà relevée lors des présentations précédentes.",
        "k1",
      ),
      paragraph(
        "Ce paragraphe complémentaire porte la longueur du texte au-delà du minimum exigé par le contrôle qualité, sans introduire la moindre donnée chiffrée dans le corps analysé.",
        "k2",
      ),
    ],
    source: { name: "Test Wire", url: "https://example.com/a" },
    editorialScore: 80,
    confidenceScore: 80,
  };
}

const flaggedForEnglish = (title: string) =>
  runQualityCheck(articleTitled(title), emptyFacts()).errors.some((e) => e.includes("Titre en anglais"));

/**
 * Regression from the first production cycle: an article with lang "fr", a
 * French body and a French excerpt reached Sanity titled "Analyzing Public
 * School's SS27 Collection: Urban Fashion and Identity".
 */
test("an untranslated English title is rejected in a French article", () => {
  assert.equal(flaggedForEnglish("Analyzing Public School's SS27 Collection: Urban Fashion and Identity"), true);
  assert.equal(flaggedForEnglish("Why beer mats beat billboards when you want to crack a taboo"), true);
});

test("French titles carrying English names are left alone", () => {
  // English nouns are normal in French fashion writing — only grammar betrays an untranslated title.
  assert.equal(flaggedForEnglish("Les tendances clés de Lagos Fashion Week SS26 : mémoire culturelle"), false);
  assert.equal(flaggedForEnglish("Public School SS27 : l'identité urbaine comme matière première"), false);
  assert.equal(flaggedForEnglish("Le retour de The Row sur le calendrier parisien"), false, "one stray article is usually part of a real name");
  assert.equal(flaggedForEnglish("Innovations de la chaîne d'approvisionnement dans la mode"), false);
});
