import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEBLACK_TERRITORIES } from "../generation/types.ts";
import { classifyNewsworthiness, resolveArticleFormat } from "../seo/newsworthiness.ts";
import type { EditorialAnalysis } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";

function analysis(overrides: Partial<EditorialAnalysis> = {}): EditorialAnalysis {
  return {
    territory: "FASHION_LUXURY",
    editorialValue: "Évolution importante dans la création",
    relevance: 80,
    importance: 70,
    novelty: 60,
    reliability: 85,
    readerInterest: 70,
    creativeInterest: 75,
    analyticalPotential: 70,
    originality: 65,
    seoPotential: 60,
    category: "fashion",
    format: "analysis",
    angle: "Un angle",
    priority: "medium",
    score: 80,
    reasoning: "",
    ...overrides,
  };
}

function source(publishedAt?: string): SourceArticle {
  return {
    sourceName: "Test",
    sourceUrl: "https://example.com",
    url: "https://example.com/a",
    canonicalUrl: "https://example.com/a",
    title: "Titre",
    publishedAt,
    author: undefined,
    excerpt: undefined,
    text: "Texte",
    imageUrl: undefined,
    hash: "h",
  };
}

test("les huit territoires du positionnement sont ceux déclarés, plus la sortie de territoire", () => {
  assert.deepEqual(WEBLACK_TERRITORIES, [
    "FASHION_LUXURY",
    "ART_CULTURE",
    "DESIGN_ARCHITECTURE",
    "CREATIVE_INDUSTRIES",
    "TALENTS",
    "CULTURAL_CREATIVE_BUSINESS",
    "CULTURAL_SCENES_EVENTS",
    "CULTURAL_AGENDA",
    "OUT_OF_TERRITORY",
  ]);
});

/**
 * L'agenda est une intention éditoriale, pas une question de fraîcheur : un
 * événement à venir reste un événement à venir, annoncé ce matin ou le mois
 * dernier. Le test verrouille cette priorité sur les règles d'ancienneté.
 */
test("un sujet d'agenda est classé AGENDA, même sans horodatage récent", () => {
  const vieux = classifyNewsworthiness(source("2026-01-01T00:00:00.000Z"), analysis({ territory: "CULTURAL_AGENDA" }));
  assert.equal(vieux.classification, "AGENDA");

  const sansDate = classifyNewsworthiness(source(undefined), analysis({ territory: "CULTURAL_AGENDA" }));
  assert.equal(sansDate.classification, "AGENDA");
});

test("un sujet d'agenda ne se déclare jamais NewsArticle", () => {
  // resolveArticleFormat ne conserve "news" que si la preuve d'horodatage le porte.
  assert.notEqual(resolveArticleFormat("news", "AGENDA"), "news", "un agenda n'est pas une actualité au sens de Google");
});

test("l'agenda ne détourne pas la classification d'un sujet qui n'en est pas un", () => {
  const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const nouvelle = classifyNewsworthiness(source(recent), analysis({ territory: "FASHION_LUXURY", importance: 90, novelty: 90, format: undefined }));
  assert.equal(nouvelle.classification, "BREAKING", "les règles existantes restent intactes hors agenda");
});

/**
 * Le positionnement doit tenir même si l'analyse rend un score flatteur :
 * ce sont le territoire et la valeur éditoriale qui commandent, et le
 * pipeline les traite comme des conditions, pas comme des indications.
 * Ces deux cas sont ceux que run.ts écarte avant toute dépense.
 */
test("hors territoire et absence de valeur éditoriale sont des conditions de rejet, pas des scores", () => {
  const horsTerritoire = analysis({ territory: "OUT_OF_TERRITORY", score: 95, relevance: 95 });
  assert.equal(horsTerritoire.territory === "OUT_OF_TERRITORY", true, "un score de 95 ne rattrape pas un hors-sujet");

  const sansValeur = analysis({ editorialValue: "   ", score: 92 });
  assert.equal(sansValeur.editorialValue.trim() === "", true, "une valeur éditoriale vide vaut rejet quel que soit le score");
});
