import { test } from "node:test";
import assert from "node:assert/strict";
import { checkYoutubeVideo } from "./live-youtube.ts";

// Ces tests font un vrai appel réseau à l'endpoint oEmbed public de
// YouTube — volontairement : c'est la seule façon de vérifier que la garde
// anti-régression (Phase 19, vidéo YouTube absente/indisponible) fonctionne
// contre le comportement réel de l'API, pas contre une simulation de ce
// qu'on suppose qu'elle renvoie. La vidéo utilisée est réelle et publique :
// ZE DÉFILÉ by WAXFASHION, la diffusion WEBLACK déjà en production.

// Réseau coupé ou trop lent : le test est signalé « ignoré », jamais compté
// comme réussi (un ID inexistant passerait à tort) ni comme une régression.
const UNREACHABLE = "YouTube injoignable depuis cette machine (réseau) — vérification non effectuée";

test("une vidéo réelle et publique est reconnue disponible, avec son titre réel", async (t) => {
  const result = await checkYoutubeVideo("Kcs4n93lS60");
  if (result.unreachable) return t.skip(UNREACHABLE);
  assert.equal(result.available, true);
  assert.ok(result.title && result.title.length > 0);
  assert.equal(result.authorName, "WAXFASHION | ZE DEFILE");
});

test("un ID de vidéo inexistant est reconnu indisponible, sans jamais planter", async (t) => {
  const result = await checkYoutubeVideo("thisIsNotARealVideoId9999");
  if (result.unreachable) return t.skip(UNREACHABLE);
  assert.equal(result.available, false);
});

test("une chaîne vide est refusée immédiatement, sans appel réseau", async () => {
  const result = await checkYoutubeVideo("");
  assert.equal(result.available, false);
});
