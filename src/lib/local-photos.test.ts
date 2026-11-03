import { test } from "node:test";
import assert from "node:assert/strict";
import { localVariantWidths, LOCAL_PHOTO_QUALITY, WIDTH_LADDER } from "./local-photos.ts";

test("variantes : jamais au-delà de l'original, l'original toujours inclus comme variante maximale", () => {
  assert.deepEqual(localVariantWidths(1440), [480, 800, 1200, 1440]);
  assert.deepEqual(localVariantWidths(2400), [480, 800, 1200, 1600, 2400]);
  assert.deepEqual(localVariantWidths(950), [480, 800, 950]);
  assert.deepEqual(localVariantWidths(300), [300]);
  for (const w of [300, 950, 1100, 1440, 1619, 2000, 2400]) {
    const widths = localVariantWidths(w);
    assert.equal(Math.max(...widths), w, "maximum = original");
    assert.ok(widths.every((x) => x <= w), "aucun agrandissement");
  }
  assert.deepEqual(localVariantWidths(0), []);
  assert.deepEqual(localVariantWidths(Number.NaN), []);
});

test("qualités plancher retenues contre le banding (ne pas abaisser sans nouveau comparatif)", () => {
  assert.ok(LOCAL_PHOTO_QUALITY.avif >= 90);
  assert.ok(LOCAL_PHOTO_QUALITY.webp >= 95);
  assert.deepEqual([...WIDTH_LADDER], [...WIDTH_LADDER].sort((a, b) => a - b));
});
