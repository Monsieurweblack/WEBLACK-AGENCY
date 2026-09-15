import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";

/**
 * Regression from the first real production cycle.
 *
 * A Lampoon article on industrial CBD extraction became a Sanity draft
 * automatically. Factually it was spotless — eight claims, none unverified,
 * none blocking — and it still had no business in the Journal of a creative
 * agency whose territory is talent, création and culture (CLAUDE.md).
 *
 * The relevance score was 43 against a single bar of 40. Every other article
 * generated in that same cycle scored between 68 and 82, so the marginal
 * band is genuinely where off-territory subjects land. Clearing "worth a
 * look" is now separated from clearing "publishable as WEBLACK": below 40 is
 * ignored, 40-59 goes to a human, 60 and above may be drafted.
 *
 * These thresholds are asserted against the source so neither can be quietly
 * lowered to raise output — the brief's standing rule.
 */
test("the relevance bands are the ones production was hardened to, and are not silently lowered", () => {
  const source = fs.readFileSync(path.join(ENGINE_ROOT, "scheduler", "run.ts"), "utf8");

  const ignoreBelow = Number(source.match(/const IGNORE_BELOW = (\d+)/)?.[1]);
  const autoDraftFrom = Number(source.match(/const AUTO_DRAFT_FROM = (\d+)/)?.[1]);

  assert.equal(ignoreBelow, 40, "the ignore bar must stay at 40");
  assert.equal(autoDraftFrom, 60, "the auto-draft bar must stay at 60 — the CBD article scored 43");
  assert.ok(autoDraftFrom > ignoreBelow, "a marginal band must exist between ignoring and drafting");

  // The band must actually catch the real case that motivated it, and must
  // not catch the legitimate articles of that same cycle.
  const cbdArticleScore = 43;
  const legitimateScores = [68, 69, 74, 78, 79, 80, 81, 82];
  assert.ok(cbdArticleScore >= ignoreBelow && cbdArticleScore < autoDraftFrom, "the CBD article must land in the human-review band");
  for (const score of legitimateScores) {
    assert.ok(score >= autoDraftFrom, `a genuinely relevant article scoring ${score} must still reach drafting`);
  }
});
