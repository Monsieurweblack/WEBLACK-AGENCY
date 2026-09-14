import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { titleSimilarity, isBlockingDecision, checkDuplicate } from "../validation/dedupe.ts";
import { hashArticle, canonicalize, hashContent } from "../ingestion/normalize.ts";
import { loadConfig } from "../config/env.ts";

const hasRealKey = Boolean(loadConfig().openaiApiKey);

test("titleSimilarity — identical titles score 1", () => {
  assert.equal(titleSimilarity("Nordic Fashion Industry Summit", "Nordic Fashion Industry Summit"), 1);
});

test("titleSimilarity — unrelated titles score near 0", () => {
  const score = titleSimilarity("Nordic Fashion Industry Summit", "Semiconductor sales report Q2");
  assert.ok(score < 0.1, `expected near-zero similarity, got ${score}`);
});

test("isBlockingDecision — only duplicate_exact/duplicate_semantic block; sharing an entity never does", () => {
  assert.equal(isBlockingDecision("duplicate_exact"), true);
  assert.equal(isBlockingDecision("duplicate_semantic"), true);
  assert.equal(isBlockingDecision("same_event_new_information"), false);
  assert.equal(isBlockingDecision("same_entity_different_event"), false);
  assert.equal(isBlockingDecision("new_story"), false);
});

test("canonicalize — strips tracking params and trailing slash", () => {
  assert.equal(canonicalize("https://example.com/article/?utm_source=x&utm_campaign=y"), "https://example.com/article");
});

test("hashArticle — same canonical url + title always hashes identically (determinism required for Level 1/2 dedup)", () => {
  const a = hashArticle("https://example.com/x", "Some Title");
  const b = hashArticle("https://example.com/x", "Some Title");
  assert.equal(a, b);
});

test("hashContent — undefined for short/empty text (nothing meaningful to hash)", () => {
  assert.equal(hashContent(undefined), undefined);
  assert.equal(hashContent("too short"), undefined);
});

test("hashContent — same normalized text hashes identically regardless of whitespace/case", () => {
  const long = "Fashion week in Milan brought a record number of shows this season, with major houses unveiling new collections.";
  const a = hashContent(long);
  const b = hashContent(long.toUpperCase().replace(/\s+/g, "   "));
  assert.equal(a, b);
});

// Real Sanity read (production dataset, read-only) — verifies Level 3
// against the actual live Journal content, and Level 4's local
// entity-overlap fallback when no OpenAI key is configured (this test
// environment has none, which is itself the scenario this test exercises).
test("checkDuplicate — real Sanity data: near-identical title is flagged duplicate_semantic (Level 3)", async () => {
  const result = await checkDuplicate(
    {
      sourceName: "test",
      sourceUrl: "https://example.com/nordic-test",
      url: "https://example.com/nordic-test",
      canonicalUrl: "https://example.com/nordic-test-unique-a",
      title: "Nordic Fashion Industry Summit 2026 la mode nordique",
      publishedAt: undefined,
      author: undefined,
      excerpt: undefined,
      text: undefined,
      imageUrl: undefined,
      hash: "unit-test-hash-a",
    },
    "unit-test-run-a",
  );
  assert.equal(result.decision, "duplicate_semantic");
  assert.equal(isBlockingDecision(result.decision), true);
});

test("checkDuplicate — real Sanity data: unrelated title is new_story, no OpenAI cost incurred", async () => {
  const result = await checkDuplicate(
    {
      sourceName: "test",
      sourceUrl: "https://example.com/unrelated-test",
      url: "https://example.com/unrelated-test",
      canonicalUrl: "https://example.com/unrelated-test-unique-b",
      title: "Quarterly earnings report for a semiconductor manufacturer",
      publishedAt: undefined,
      author: undefined,
      excerpt: undefined,
      text: undefined,
      imageUrl: undefined,
      hash: "unit-test-hash-b",
    },
    "unit-test-run-b",
  );
  assert.equal(result.decision, "new_story");
  assert.equal(isBlockingDecision(result.decision), false);
});

test("checkDuplicate — ambiguous band without an OpenAI key falls back to needsReview, never a silent decision", async () => {
  const result = await checkDuplicate(
    {
      sourceName: "test",
      sourceUrl: "https://example.com/ambiguous-test",
      url: "https://example.com/ambiguous-test",
      canonicalUrl: "https://example.com/ambiguous-test-unique-c",
      title: "Nordic Fashion Industry Summit official event page",
      publishedAt: undefined,
      author: undefined,
      excerpt: undefined,
      text: undefined,
      imageUrl: undefined,
      hash: "unit-test-hash-c",
    },
    "unit-test-run-c",
  );
  if (hasRealKey) {
    // With a real key, Level 5 makes an actual LLM call for this genuinely
    // ambiguous case (an event's official page vs. WEBLACK's own coverage
    // of it) — real testing during the validation campaign showed this
    // specific borderline case is NOT deterministic across identical calls
    // (observed: duplicate_exact, same_event_new_information,
    // duplicate_exact across 3 runs) and can overclassify as
    // duplicate_exact even though the two sources are not literally
    // identical content. That instability is a real, documented limitation
    // (see the campaign report), not something to paper over with a
    // stricter assertion than the system actually guarantees today — only
    // check the response is well-formed.
    assert.ok(["duplicate_exact", "duplicate_semantic", "same_event_new_information", "same_entity_different_event", "new_story"].includes(result.decision));
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
  } else {
    assert.equal(result.needsReview, true);
    assert.equal(isBlockingDecision(result.decision), false, "an unresolved ambiguous case must never silently block either");
  }
});
