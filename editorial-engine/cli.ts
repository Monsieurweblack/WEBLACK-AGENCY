#!/usr/bin/env node
import { fetchManualUrl } from "./ingestion/url.ts";
import { findSource } from "./sources/loadSources.ts";
import { fetchRssSource } from "./ingestion/rss.ts";
import { processArticle } from "./scheduler/run.ts";
import { runOneCycle, watchLoop } from "./scheduler/loop.ts";
import { publishDraft } from "./sanity/articles.ts";
import { recentRuns } from "./database/db.ts";
import { loadConfig } from "./config/env.ts";
import { getSanityClient } from "./sanity/client.ts";
import { log } from "./logs/logger.ts";

const [, , command, ...rest] = process.argv;
const dryRun = rest.includes("--dry-run");
const watch = rest.includes("--watch");
const positional = rest.filter((a) => !a.startsWith("--"));

async function main() {
  switch (command) {
    case "run": {
      if (watch) {
        await watchLoop();
      } else {
        await runOneCycle(dryRun);
      }
      break;
    }

    case "source": {
      const name = positional[0];
      if (!name) throw new Error("Usage: npm run editorial:source -- <nom-de-source>");
      const source = findSource(name);
      const candidates = await fetchRssSource(source);
      log("SOURCE FOUND", `${candidates.length} article(s) — ${source.name}`);
      for (const candidate of candidates) {
        await processArticle(candidate, { dryRun });
      }
      break;
    }

    case "url": {
      const url = positional[0];
      if (!url) throw new Error("Usage: npm run editorial:url -- <url>");
      const article = await fetchManualUrl(url);
      const outcome = await processArticle(article, { dryRun });
      console.log(JSON.stringify(outcome, null, 2));
      break;
    }

    case "publish": {
      const documentId = positional[0];
      if (!documentId) {
        console.log("Usage: npm run editorial:publish -- <drafts.journal-editorial-engine-...>");
        console.log("\nBrouillons récents générés par le moteur :");
        for (const run of recentRuns(20)) {
          if (run.status === "draft" && run.sanityDocumentId) {
            console.log(`  ${run.sanityDocumentId}  —  "${run.generatedTitle}"  (score ${run.editorialScore})`);
          }
        }
        break;
      }
      const result = await publishDraft(documentId);
      console.log(`Publié: ${result.documentId}`);
      break;
    }

    case "test": {
      console.log("== editorial:test ==");
      console.log("1) Config...");
      const config = loadConfig();
      console.log(`   Mode: ${config.mode} | OpenAI: ${config.openaiApiKey ? "configuré" : "ABSENT"} | Auteur par défaut: ${config.defaultAuthor ?? "ABSENT"}`);

      console.log("2) Connexion Sanity (lecture)...");
      const client = getSanityClient();
      const count: number = await client.fetch(`count(*[_type == "journal"])`);
      console.log(`   OK — ${count} articles journal existants dans le dataset "${config.sanityDataset}"`);

      console.log("3) Historique local...");
      const runs = recentRuns(5);
      console.log(`   OK — ${runs.length} run(s) récents en base locale`);

      if (!config.openaiApiKey) {
        console.log("\nOPENAI_API_KEY absent — les tests d'extraction/analyse/génération ne peuvent pas être exécutés. Voir editorial-engine/.env.example.");
      } else {
        console.log("\nOPENAI_API_KEY présent — utilisez `npm run editorial:url -- <url réelle>` pour un test bout-en-bout.");
      }
      break;
    }

    default:
      console.log(`Commande inconnue: "${command ?? ""}"\n`);
      console.log("Commandes disponibles:");
      console.log("  npm run editorial:run                    — un cycle sur toutes les sources RSS activées");
      console.log("  npm run editorial:run -- --watch          — boucle continue (voir EDITORIAL_ENGINE.md)");
      console.log("  npm run editorial:dry-run                 — comme run, sans jamais écrire dans Sanity");
      console.log("  npm run editorial:source -- <nom>         — une seule source");
      console.log("  npm run editorial:url -- <url>            — une URL fournie à la main");
      console.log("  npm run editorial:test                    — vérifie la config et les connexions");
      console.log("  npm run editorial:publish -- <documentId> — publie un brouillon déjà validé par un humain");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
