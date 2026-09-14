import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../cliArgs.ts";

test("parseArgs — a positional argument survives when --label is absent (regression: was silently dropped)", () => {
  const result = parseArgs(["0"]);
  assert.deepEqual(result.positional, ["0"]);
});

test("parseArgs — a positional argument survives alongside --label", () => {
  const result = parseArgs(["https://example.com", "--label", "TestA"]);
  assert.deepEqual(result.positional, ["https://example.com"]);
  assert.equal(result.testLabel, "TestA");
});

test("parseArgs — --dry-run and --watch are recognized as flags, not positional", () => {
  const result = parseArgs(["--dry-run", "--watch"]);
  assert.equal(result.dryRun, true);
  assert.equal(result.watch, true);
  assert.deepEqual(result.positional, []);
});

test("parseArgs — multiple positional arguments all survive without --label", () => {
  const result = parseArgs(["a", "b", "c"]);
  assert.deepEqual(result.positional, ["a", "b", "c"]);
});
