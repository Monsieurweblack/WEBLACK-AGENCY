import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldIncludeReferences, buildReferencesBlock } from "../generation/references.ts";
import type { RegisteredSource, RegisteredClaim } from "../validation/claimRegistry.ts";
import type { SourceArticle } from "../sources/types.ts";

function makeSource(overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    sourceName: "Real Publication Name",
    sourceUrl: "https://example.com/feed",
    url: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    title: "A real article title",
    publishedAt: "2026-09-10T12:00:00Z",
    author: undefined,
    excerpt: undefined,
    text: undefined,
    imageUrl: undefined,
    hash: "h",
    ...overrides,
  };
}

test("references — never renders the old literal 'manual' placeholder; uses the real resolved source name", () => {
  const registered: RegisteredSource[] = [{ source: makeSource({ sourceName: "startupfashion.com" }) }];
  const blocks = buildReferencesBlock(registered);
  const text = blocks.map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : "")).join("\n");
  assert.ok(text.includes("startupfashion.com"));
  assert.ok(!/\bmanual\b/i.test(text), "the literal placeholder 'manual' must never appear in a references block");
});

test("references — includes source title and formatted date when available", () => {
  const registered: RegisteredSource[] = [{ source: makeSource() }];
  const blocks = buildReferencesBlock(registered);
  const text = blocks.map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : "")).join("\n");
  assert.ok(text.includes("A real article title"));
  assert.ok(text.includes("2026-09-10"));
  assert.ok(text.includes("https://example.com/article"));
});

test("references — omits date gracefully when not available, never fabricates one", () => {
  const registered: RegisteredSource[] = [{ source: makeSource({ publishedAt: undefined }) }];
  const blocks = buildReferencesBlock(registered);
  const text = blocks.map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : "")).join("\n");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), "no date string should appear when none was provided");
});

test("shouldIncludeReferences — true for 2+ sources, true for a critical/quote/statistic claim, false otherwise", () => {
  const oneSource: RegisteredSource[] = [{ source: makeSource() }];
  const twoSources: RegisteredSource[] = [{ source: makeSource() }, { source: makeSource({ url: "https://other.example.com" }) }];
  const minorClaim: RegisteredClaim[] = [{ claim: "x", type: "general", importance: "minor", verificationStatus: "VERIFIED", confidence: 80, sources: [], reasoning: "" }];
  const criticalClaim: RegisteredClaim[] = [{ claim: "x", type: "general", importance: "critical", verificationStatus: "VERIFIED", confidence: 80, sources: [], reasoning: "" }];

  assert.equal(shouldIncludeReferences(oneSource, minorClaim), false);
  assert.equal(shouldIncludeReferences(twoSources, minorClaim), true);
  assert.equal(shouldIncludeReferences(oneSource, criticalClaim), true);
});
