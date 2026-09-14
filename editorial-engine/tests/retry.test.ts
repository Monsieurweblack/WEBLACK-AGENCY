import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryable, getOpenAiClient, structuredCompletion } from "../intelligence/openaiClient.ts";

test("retry — 429 rate limit is retryable", () => {
  assert.equal(isRetryable({ status: 429 }), true);
});

test("retry — 500/502/503 server errors are retryable", () => {
  assert.equal(isRetryable({ status: 500 }), true);
  assert.equal(isRetryable({ status: 503 }), true);
});

test("retry — 400/401/404 client errors are NOT retryable (would never succeed on retry)", () => {
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable({ status: 401 }), false);
  assert.equal(isRetryable({ status: 404 }), false);
});

test("retry — a plain network error with no status is treated as retryable", () => {
  assert.equal(isRetryable(new Error("ECONNRESET")), true);
});

test("failed OpenAI call — getOpenAiClient throws a clear error when no key is configured", () => {
  // This test's environment intentionally has no OPENAI_API_KEY (see EDITORIAL_ENGINE.md) —
  // exercising exactly the real "no key" failure path rather than a mocked one.
  assert.throws(() => getOpenAiClient(), /OPENAI_API_KEY absent/);
});

test("failed OpenAI call — structuredCompletion surfaces the same clear error without ever retrying a missing-key failure", async () => {
  await assert.rejects(
    () =>
      structuredCompletion({
        system: "test",
        user: "test",
        schemaName: "test_schema",
        schema: { type: "object", properties: {} },
        step: "analysis",
        runId: "test-run",
      }),
    /OPENAI_API_KEY absent/,
  );
});
