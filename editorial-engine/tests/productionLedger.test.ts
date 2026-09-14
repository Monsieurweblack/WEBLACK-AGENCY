import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertRun, findRunByCanonicalUrl } from "../database/db.ts";

/**
 * Production regression: a held or rejected article used to be stored with
 * status "error", which the canonical-URL dedup lookup skips on purpose so
 * a genuinely crashed run can be retried. The effect was that every article
 * the gates turned down got re-fetched, re-analysed and re-billed on each
 * cycle — unbounded, for as long as it stayed in the feed.
 */
test("a needs-review article counts as already processed and is not picked up again next cycle", () => {
  insertRun({
    sourceUrl: "https://example.com/held-for-review",
    sourceName: "test",
    sourceTitle: "Held for a human decision",
    sourceHash: "hash-review-1",
    canonicalUrl: "https://example.com/held-for-review",
    status: "needs-review",
    error: "Quality Gate: reject",
  });

  const found = findRunByCanonicalUrl("https://example.com/held-for-review");
  assert.ok(found, "a reviewed/rejected article must be remembered, or the cycle pays for it again");
  assert.equal(found!.status, "needs-review", "it is a decision, not a crash — the two must stay distinguishable");
});

test("a genuine error is still retried — the two statuses did not get conflated", () => {
  insertRun({
    sourceUrl: "https://example.com/crashed",
    sourceName: "test",
    sourceTitle: "Crashed mid-pipeline",
    sourceHash: "hash-error-1",
    canonicalUrl: "https://example.com/crashed",
    status: "error",
    error: "ECONNRESET",
  });

  assert.equal(findRunByCanonicalUrl("https://example.com/crashed"), undefined, "a crash must remain retryable");
});
