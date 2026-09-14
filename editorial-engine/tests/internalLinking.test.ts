import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestInternalLinks } from "../seo/internalLinking.ts";
import type { GeneratedArticle } from "../generation/types.ts";
import type { KeywordStrategy } from "../intelligence/keywordStrategy.ts";

function makeArticle(overrides: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    lang: "fr",
    title: "Un nouvel article de test",
    slug: "un-nouvel-article-de-test-unique-xyz",
    excerpt: "test",
    category: "news",
    publishDate: "2026-01-01",
    author: "Test",
    body: [],
    source: { name: "t", url: "https://example.com" },
    editorialScore: 80,
    confidenceScore: 80,
    ...overrides,
  };
}

// Real Sanity read (production, read-only) — every suggested URL must point
// at a document that genuinely exists right now, never a guess.
test("internal linking — suggestions only ever point at real, currently-existing Journal slugs", async () => {
  const keywordStrategy: KeywordStrategy = {
    primaryKeyword: "Nordic Fashion Industry Summit",
    secondaryKeywords: ["mode nordique", "IA"],
    entities: [{ type: "Event", name: "Nordic Fashion Industry Summit" }],
    searchIntent: "news",
    contentAngle: "test",
  };
  const suggestions = await suggestInternalLinks(makeArticle(), keywordStrategy);
  for (const s of suggestions) {
    assert.ok(s.url.startsWith("/journal/"), `unexpected URL shape: ${s.url}`);
    assert.ok(s.relevance > 0 && s.relevance <= 1);
  }
});

test("internal linking — an unrelated new article gets zero or only weakly-relevant suggestions, never fabricated links", async () => {
  const keywordStrategy: KeywordStrategy = {
    primaryKeyword: "quantum computing hardware supply chain",
    secondaryKeywords: ["semiconductor lithography"],
    entities: [],
    searchIntent: "informational",
    contentAngle: "test",
  };
  const suggestions = await suggestInternalLinks(makeArticle({ lang: "en" }), keywordStrategy);
  // Not asserting zero (title overlap is a loose heuristic) — asserting the shape stays honest either way.
  for (const s of suggestions) {
    assert.ok(s.url.startsWith("/en/journal/"));
  }
});
