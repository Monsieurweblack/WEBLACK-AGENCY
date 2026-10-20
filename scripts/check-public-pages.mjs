/**
 * Contrôle post-build du site généré — voir scripts/lib/publicPages.mjs.
 *   node scripts/check-public-pages.mjs [dist]
 */
import { checkPublicPages, REQUIRED_PAGES } from "./lib/publicPages.mjs";

const dist = process.argv[2] ?? "dist";
const problems = checkPublicPages(dist);
if (problems.length > 0) {
  console.error(`Contrôle des pages publiques : ${problems.length} problème(s)`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Contrôle des pages publiques : OK (${REQUIRED_PAGES.length} pages publiques, aucun secret publié)`);
}
