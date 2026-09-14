import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSearchConsoleConnected, loadSearchConsoleConfig } from "../intelligence/searchConsole.ts";
import { fetchSearchPerformance } from "../intelligence/searchConsole.ts";

test("Search Console — reports NOT connected in this environment (no credentials in .env)", () => {
  assert.equal(isSearchConsoleConnected(), false);
  const config = loadSearchConsoleConfig();
  assert.equal(config.credentialsJson, undefined);
  assert.equal(config.siteUrl, undefined);
});

test("Search Console — fetchSearchPerformance refuses to run without a real connection (never fabricates rows)", async () => {
  await assert.rejects(() => fetchSearchPerformance("2026-01-01"), /non connecté/);
});
