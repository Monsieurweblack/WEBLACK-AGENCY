import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSanityImageUrl, sanityResponsiveImage, SANITY_IMAGE_QUALITY } from "./sanity-image.ts";

const URL_1600 = "https://cdn.sanity.io/images/pzpm4xjp/production/198061df2c1fdde994b99322eb82fa45e36595fc-1600x1068.jpg";

test("lit projet, dataset et dimensions d'origine, en ignorant les paramètres déjà présents", () => {
  assert.deepEqual(parseSanityImageUrl(`${URL_1600}?w=1600&auto=format`), {
    baseUrl: URL_1600,
    projectId: "pzpm4xjp",
    dataset: "production",
    width: 1600,
    height: 1068,
  });
  assert.equal(parseSanityImageUrl("https://images.unsplash.com/photo-1?w=800"), null);
  assert.equal(parseSanityImageUrl("/photos/hero-home.jpg"), null);
  assert.equal(parseSanityImageUrl("https://cdn.sanity.io/files/pzpm4xjp/production/abc.pdf"), null);
});

test("srcset : jamais au-delà de l'original, fit=max, auto=format, qualité plancher", () => {
  const r = sanityResponsiveImage(`${URL_1600}?w=1600&auto=format`, 1440);
  assert.ok(r);
  const entries = r.srcset.split(", ").map((e) => e.split(" "));
  assert.deepEqual(entries.map(([, w]) => w), ["480w", "800w", "1200w", "1600w"]);
  for (const [u, w] of entries) {
    const p = new URL(u).searchParams;
    assert.equal(p.get("w"), w.replace("w", ""));
    assert.equal(p.get("fit"), "max");
    assert.equal(p.get("auto"), "format");
    assert.equal(p.get("q"), String(SANITY_IMAGE_QUALITY));
  }
  assert.equal(new URL(r.src).searchParams.get("w"), "1440");
  assert.equal(new URL(sanityResponsiveImage(URL_1600, 3000)!.src).searchParams.get("w"), "1600", "repli plafonné à l'original");
  assert.ok(SANITY_IMAGE_QUALITY >= 90);
});
