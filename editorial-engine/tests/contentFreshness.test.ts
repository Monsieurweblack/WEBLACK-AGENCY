import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectStaleArticles } from "../seo/contentFreshness.ts";

// Real Sanity read (production, read-only — this module has no write path
// at all, see seo/contentFreshness.ts, so there is nothing to mock: it
// cannot touch `publishDate` even accidentally).
test("content freshness — runs against real data and returns a well-formed array", async () => {
  const flags = await detectStaleArticles(90);
  assert.ok(Array.isArray(flags));
  for (const flag of flags) {
    assert.ok(flag.documentId);
    assert.ok(flag.daysSinceUpdate >= 90);
  }
});

test("content freshness — a threshold of 0 never returns MORE flags than a threshold of 90 would exclude", async () => {
  const strict = await detectStaleArticles(90);
  const loose = await detectStaleArticles(0);
  assert.ok(loose.length >= strict.length);
});
