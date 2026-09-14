import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAntiCopy } from "../validation/antiCopy.ts";
import type { GeneratedArticle } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";

function makeArticle(paragraphs: string[]): GeneratedArticle {
  return {
    lang: "fr",
    title: "Test",
    slug: "test",
    excerpt: "Test excerpt",
    category: "news",
    publishDate: "2026-01-01",
    author: "Test Author",
    body: paragraphs.map((text) => ({
      _type: "block" as const,
      _key: Math.random().toString(36),
      style: "normal" as const,
      children: [{ _type: "span" as const, _key: Math.random().toString(36), text, marks: [] }],
      markDefs: [] as [],
    })),
    source: { name: "test", url: "https://example.com" },
    editorialScore: 80,
    confidenceScore: 80,
  };
}

function makeSource(text: string): SourceArticle {
  return {
    sourceName: "test",
    sourceUrl: "https://example.com",
    url: "https://example.com",
    canonicalUrl: "https://example.com",
    title: "Source title",
    publishedAt: undefined,
    author: undefined,
    excerpt: undefined,
    text,
    imageUrl: undefined,
    hash: "h",
  };
}

test("copy detection — a fully rewritten article scores low risk and passes", () => {
  const source = makeSource(
    "The Milan fashion show opened Tuesday with a record number of designers presenting their spring collections to international buyers and press.",
  );
  const article = makeArticle([
    "À Milan, la rentrée mode s'annonce dense : jamais autant de créateurs n'avaient présenté leurs collections printemps devant acheteurs et presse internationale réunis.",
    "Cette affluence traduit un regain de confiance du secteur, porté par une nouvelle génération de maisons indépendantes.",
  ]);
  const result = checkAntiCopy(article, source);
  assert.ok(result.copyRiskScore < 40, `expected low risk, got ${result.copyRiskScore}`);
  assert.equal(result.pass, true);
});

test("copy detection — a lightly reworded near-copy scores high risk and fails", () => {
  const sourceText =
    "The Milan fashion show opened Tuesday with a record number of designers presenting their spring collections to international buyers and press in attendance.";
  const source = makeSource(sourceText);
  // Same structure, same word order, only a couple of words swapped — exactly what §4 asks to catch.
  const article = makeArticle([
    "The Milan fashion show opened Tuesday with a huge number of designers presenting their spring collections to international buyers and press in attendance.",
  ]);
  const result = checkAntiCopy(article, source);
  assert.ok(result.copyRiskScore >= 40, `expected high risk for a near-copy, got ${result.copyRiskScore}`);
  assert.equal(result.pass, false);
});

test("copy detection — one verbatim lifted sentence inside an otherwise original article still triggers the structural signal", () => {
  const liftedSentence =
    "The Milan fashion show opened Tuesday with a record number of designers presenting their spring collections to international buyers and press in attendance this year.";
  const source = makeSource(
    `${liftedSentence} Analysts noted strong attendance figures compared to last year, with several major houses expanding their runway slots.`,
  );
  const article = makeArticle([
    "Cette semaine, la mode internationale reprend ses marques avec un calendrier particulièrement chargé.",
    liftedSentence, // copied verbatim, unchanged
    "Les observateurs y voient un signe de la vitalité retrouvée du secteur après plusieurs saisons difficiles.",
  ]);
  const result = checkAntiCopy(article, source);
  assert.ok(result.longestSharedRunWords >= 15, `expected the lifted sentence to be detected, got run length ${result.longestSharedRunWords}`);
  assert.equal(result.pass, false, "a single verbatim lifted sentence must fail even inside a mostly-original article");
});
