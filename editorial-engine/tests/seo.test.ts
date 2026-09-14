import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSeoOpportunity } from "../seo/opportunityEngine.ts";
import { classifyNewsworthiness } from "../seo/newsworthiness.ts";
import { combinePriority } from "../seo/priority.ts";
import { evaluateSeoQualityGate } from "../seo/seoQualityGate.ts";
import { checkSeoTitle, checkSeoDescription, slugify } from "../seo/seo.ts";
import type { GeneratedArticle, EditorialAnalysis } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";
import type { KeywordStrategy } from "../intelligence/keywordStrategy.ts";

function makeAnalysis(overrides: Partial<EditorialAnalysis> = {}): EditorialAnalysis {
  return {
    relevance: 80,
    importance: 70,
    novelty: 60,
    reliability: 90,
    readerInterest: 70,
    seoPotential: 65,
    category: "news",
    format: undefined,
    angle: "test angle",
    priority: "medium",
    score: 80,
    reasoning: "test",
    ...overrides,
  };
}

function makeSource(overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    sourceName: "test",
    sourceUrl: "https://example.com",
    url: "https://example.com",
    canonicalUrl: "https://example.com",
    title: "Test source",
    publishedAt: undefined,
    author: undefined,
    excerpt: undefined,
    text: undefined,
    imageUrl: undefined,
    hash: "h",
    ...overrides,
  };
}

test("SEO opportunity — searchDemand and competition are ALWAYS 'unknown', never a fabricated number", () => {
  const result = computeSeoOpportunity(makeSource(), makeAnalysis());
  assert.equal(result.searchDemand, "unknown");
  assert.equal(result.competition, "unknown");
});

test("SEO opportunity — a very recent source scores higher freshness than an old one", () => {
  const fresh = computeSeoOpportunity(makeSource({ publishedAt: new Date().toISOString() }), makeAnalysis());
  const old = computeSeoOpportunity(makeSource({ publishedAt: new Date(Date.now() - 90 * 86_400_000).toISOString() }), makeAnalysis());
  assert.ok(fresh.freshness > old.freshness);
});

test("news score — BREAKING requires both a real recent timestamp AND very high importance/novelty", () => {
  const recentButNotImportant = classifyNewsworthiness(
    makeSource({ publishedAt: new Date().toISOString() }),
    makeAnalysis({ importance: 50, novelty: 50 }),
  );
  assert.notEqual(recentButNotImportant.classification, "BREAKING");

  const importantButNoTimestamp = classifyNewsworthiness(makeSource({ publishedAt: undefined }), makeAnalysis({ importance: 95, novelty: 95 }));
  assert.notEqual(importantButNoTimestamp.classification, "BREAKING");

  const genuineBreaking = classifyNewsworthiness(
    makeSource({ publishedAt: new Date().toISOString() }),
    makeAnalysis({ importance: 90, novelty: 90 }),
  );
  assert.equal(genuineBreaking.classification, "BREAKING");
});

test("news score — an old, low-novelty source is classified EVERGREEN, not NEWS", () => {
  const result = classifyNewsworthiness(
    makeSource({ publishedAt: new Date(Date.now() - 365 * 86_400_000).toISOString() }),
    makeAnalysis({ novelty: 20, importance: 20, format: undefined }),
  );
  assert.equal(result.classification, "EVERGREEN");
});

test("combined priority — a subject below WEBLACK's own relevance bar is REJECT regardless of SEO/news scores", () => {
  const result = combinePriority(30, 95, 95);
  assert.equal(result.priority, "REJECT");
});

test("combined priority — high scores across all three dimensions reach CRITICAL", () => {
  const result = combinePriority(90, 90, 90);
  assert.equal(result.priority, "CRITICAL");
});

test("combined priority — never promises a ranking, only a priority level", () => {
  const result = combinePriority(70, 70, 70);
  assert.ok(["CRITICAL", "HIGH", "NORMAL", "LOW", "REJECT"].includes(result.priority));
});

test("SEO title/description checks — flags too-short and too-long values", () => {
  assert.equal(checkSeoTitle("short").ok, false);
  assert.equal(checkSeoTitle("A perfectly reasonable SEO title length here").ok, true);
  assert.equal(checkSeoDescription("short").ok, false);
});

test("slugify — deterministic, ASCII-safe, matches what generateArticle produces", () => {
  assert.equal(slugify("Nordic Fashion Industry Summit 2026"), "nordic-fashion-industry-summit-2026");
  assert.equal(slugify("Crise du luxe : les créateurs africains"), "crise-du-luxe-les-createurs-africains");
});

test("SEO quality gate — never blocks publication on its own", () => {
  const article: GeneratedArticle = {
    lang: "fr",
    title: "x",
    slug: "y",
    excerpt: "z",
    category: "news",
    publishDate: "2026-01-01",
    author: "Test",
    body: [],
    source: { name: "t", url: "https://example.com" },
    editorialScore: 10,
    confidenceScore: 10,
  };
  const result = evaluateSeoQualityGate(article, undefined, []);
  assert.equal(result.blocksPublication, false);
  assert.ok(result.seoScore < 100, "a deliberately bad article should score low, not perfect");
});

test("SEO quality gate — a well-formed article with matching keyword scores well", () => {
  const article: GeneratedArticle = {
    lang: "fr",
    title: "Nordic Fashion Industry Summit 2026",
    slug: slugify("Nordic Fashion Industry Summit 2026"),
    excerpt: "Un excerpt suffisamment long pour passer le contrôle SEO de base sur la longueur.",
    category: "news",
    publishDate: "2026-01-01",
    author: "Test Author",
    body: [
      { _type: "block", _key: "h1", style: "h3", children: [{ _type: "span", _key: "s0", text: "Un intertitre", marks: [] }], markDefs: [] },
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Un paragraphe suffisamment long avec plusieurs phrases pour dépasser le seuil de mots minimal requis par le contrôle de longueur du contenu généré.", marks: [] }],
        markDefs: [],
      },
    ],
    seo: { title: "Nordic Fashion Industry Summit 2026 — analyse WEBLACK", description: "Une meta description suffisamment longue pour passer le contrôle SEO de longueur minimale requis, environ quatre-vingts caractères ou plus." },
    source: { name: "t", url: "https://example.com" },
    editorialScore: 80,
    confidenceScore: 80,
  };
  const keywordStrategy: KeywordStrategy = {
    primaryKeyword: "Nordic Fashion Industry Summit",
    secondaryKeywords: ["mode nordique"],
    entities: [],
    searchIntent: "news",
    contentAngle: "test",
  };
  const result = evaluateSeoQualityGate(article, keywordStrategy, [{ title: "Autre article", url: "/journal/autre/", relevance: 0.5 }]);
  assert.ok(result.seoScore >= 80, `expected a high SEO score for a well-formed article, got ${result.seoScore}`);
});
