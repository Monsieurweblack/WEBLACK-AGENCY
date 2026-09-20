import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyImageUrl, isKnownWorkSlug, computeExitCode } from "./content-checks.mjs";

// --- Étape 7, tests 1-5: galleryImages / image url rules --------------------

test("1. valid external URL passes", () => {
  assert.equal(classifyImageUrl("https://cdn.sanity.io/images/pzpm4xjp/production/abc-800x600.jpg").valid, true);
});

test("2. empty url is an error", () => {
  const result = classifyImageUrl("");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "empty");
});

test("3. undefined url is an error", () => {
  const result = classifyImageUrl(undefined);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "empty");
});

test("4. Windows local path is an error", () => {
  const result = classifyImageUrl("C:\\Users\\deo-g\\Downloads\\CLAUDE CODE\\WEBSITE WEBLACK\\logo-assets\\photo.jpeg");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "windows-path");
});

test("5. incomplete image object (no url field) is an error", () => {
  const image = { _key: "abc", _type: "externalImage" }; // no url
  const result = classifyImageUrl(image.url);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "empty");
});

test("bonus: Unix absolute local path is an error, but a real site-relative path is not", () => {
  assert.equal(classifyImageUrl("/Users/someone/Downloads/photo.jpg").valid, false);
  assert.equal(classifyImageUrl("/photos/ze-defile-by-waxfashion-gallery-1.jpg").valid, true);
});

// --- Étape 7, tests 6-7: relatedWorkSlug rules ------------------------------

test("6. an existing relatedWorkSlug passes", () => {
  const knownWorkSlugs = new Map([["ze-defile-by-waxfashion-paris", {}]]);
  assert.equal(isKnownWorkSlug("ze-defile-by-waxfashion-paris", knownWorkSlugs), true);
});

test("7. a nonexistent relatedWorkSlug fails", () => {
  const knownWorkSlugs = new Map([["ze-defile-by-waxfashion-paris", {}]]);
  assert.equal(isKnownWorkSlug("ze-defile-by-waxfashion", knownWorkSlugs), false);
});

// --- Étape 7, tests 9-10: the integrity → build gate -------------------------

test("9. any ERROR-level finding forces a non-zero exit code (blocks the build)", () => {
  const findings = [
    { level: "WARNING", scope: "x", message: "y" },
    { level: "ERROR", scope: "x", message: "y" },
  ];
  assert.equal(computeExitCode(findings), 1);
});

test("10. no ERROR-level finding allows a zero exit code (build proceeds)", () => {
  const findings = [
    { level: "WARNING", scope: "x", message: "y" },
    { level: "INFO", scope: "x", message: "y" },
  ];
  assert.equal(computeExitCode(findings), 0);
});

test("10b. no findings at all allows a zero exit code", () => {
  assert.equal(computeExitCode([]), 0);
});
