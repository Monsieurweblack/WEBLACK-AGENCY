/**
 * Contrôle post-build du site généré — voir scripts/lib/publicPages.mjs.
 *   node scripts/check-public-pages.mjs [dist]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkPublicPages, checkStructuredData, REQUIRED_PAGES } from "./lib/publicPages.mjs";

const dist = process.argv[2] ?? "dist";
const problems = checkPublicPages(dist);
if (problems.length > 0) {
  console.error(`Contrôle des pages publiques : ${problems.length} problème(s)`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Contrôle des pages publiques : OK (${REQUIRED_PAGES.length} pages publiques, aucun secret publié)`);
  // Bilan des données structurées Event sur tout le site généré.
  const html = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) walk(full); else if (name.endsWith(".html")) html.push(full); } };
  walk(dist);
  let events = 0, organizers = 0, pages = 0;
  for (const file of html) {
    const stats = checkStructuredData(readFileSync(file, "utf8"));
    if (stats.events) pages += 1;
    events += stats.events;
    organizers += stats.organizers;
  }
  console.log(`Données structurées : OK (${html.length} pages HTML, ${events} Event sur ${pages} pages, ${organizers} organisateur(s), tous avec url)`);
}
