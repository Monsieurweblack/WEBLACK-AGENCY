import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertRun, findRunByCanonicalUrl, findRunByContentHash, findRunByHash } from "../database/db.ts";

test("duplicate exact — Level 1 (canonical URL) finds a prior successful run", () => {
  insertRun({
    sourceUrl: "https://example.com/a?utm_source=x",
    sourceName: "test",
    sourceTitle: "Some title",
    sourceHash: "hash-1",
    canonicalUrl: "https://example.com/a",
    status: "draft",
    sanityDocumentId: "doc-1",
  });
  const found = findRunByCanonicalUrl("https://example.com/a");
  assert.ok(found, "expected a matching run");
  assert.equal(found!.sanityDocumentId, "doc-1");
});

test("duplicate exact — Level 2 (content hash) finds a prior successful run under a different URL", () => {
  insertRun({
    sourceUrl: "https://example.com/b",
    sourceName: "test",
    sourceTitle: "Different title, same content",
    sourceHash: "hash-2",
    canonicalUrl: "https://example.com/b",
    contentHash: "content-hash-shared",
    status: "draft",
    sanityDocumentId: "doc-2",
  });
  const found = findRunByContentHash("content-hash-shared");
  assert.ok(found, "expected a matching run by content hash");
  assert.equal(found!.sanityDocumentId, "doc-2");
});

test("idempotency — a failed (error) run must NOT count as a duplicate on retry", () => {
  insertRun({
    sourceUrl: "https://example.com/c",
    sourceName: "test",
    sourceTitle: "Errored attempt",
    sourceHash: "hash-3",
    canonicalUrl: "https://example.com/c-unique",
    status: "error",
    error: "transient failure",
  });
  const found = findRunByCanonicalUrl("https://example.com/c-unique");
  assert.equal(found, undefined, "an errored run must be retryable, not treated as an existing duplicate");
});

test("findRunByHash still resolves the legacy url+title hash", () => {
  insertRun({
    sourceUrl: "https://example.com/d",
    sourceName: "test",
    sourceTitle: "Legacy hash lookup",
    sourceHash: "hash-legacy-4",
    status: "published",
  });
  const found = findRunByHash("hash-legacy-4");
  assert.ok(found);
  assert.equal(found!.status, "published");
});
