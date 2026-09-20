import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidImageSrc } from "./image-src.ts";

// Test 8 (Étape 7): RemoteImage must never crash on a malformed src — this
// is the guard that replaced the unguarded `src.startsWith(...)` call.
test("undefined src is rejected without throwing", () => {
  assert.doesNotThrow(() => isValidImageSrc(undefined));
  assert.equal(isValidImageSrc(undefined), false);
});

test("empty string src is rejected", () => {
  assert.equal(isValidImageSrc(""), false);
});

test("a Windows local path is rejected", () => {
  assert.equal(isValidImageSrc("C:\\Users\\deo-g\\Downloads\\photo.jpg"), false);
});

test("a valid root-relative path is accepted", () => {
  assert.equal(isValidImageSrc("/photos/ze-defile-by-waxfashion-gallery-1.jpg"), true);
});

test("a valid https URL is accepted", () => {
  assert.equal(isValidImageSrc("https://cdn.sanity.io/images/pzpm4xjp/production/abc-800x600.jpg"), true);
});
