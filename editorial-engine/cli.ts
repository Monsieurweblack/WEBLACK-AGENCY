#!/usr/bin/env node
import { fetchManualUrl } from "./ingestion/url.ts";
import { findSource } from "./sources/loadSources.ts";
import { fetchRssSource } from "./ingestion/rss.ts";
import { processArticle } from "./scheduler/run.ts";
import { runOneCycle, watchLoop } from "./scheduler/loop.ts";
import { publishDraft } from "./sanity/articles.ts";
import { testOpenAiConnection } from "./intelligence/testConnection.ts";
import { recentRuns } from "./database/db.ts";
import { buildDashboardData } from "./database/dashboard.ts";
import { detectStaleArticles } from "./seo/contentFreshness.ts";
import { isSearchConsoleConnected } from "./intelligence/searchConsole.ts";
import { loadConfig } from "./config/env.ts";
import { getSanityClient } from "./sanity/client.ts";
import { log } from "./logs/logger.ts";
import { parseArgs } from "./cliArgs.ts";

const [, , command, ...rest] = process.argv;
const { dryRun, watch, testLabel, positional } = parseArgs(rest);

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
        await processArticle(candidate, { dryRun, testLabel });
      }
      break;
    }

    case "url": {
      const url = positional[0];
      if (!url) throw new Error("Usage: npm run editorial:url -- <url> [--label TestA]");
      const article = await fetchManualUrl(url);
      const outcome = await processArticle(article, { dryRun, testLabel });
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

      console.log("4) Connexion OpenAI...");
      if (!config.openaiApiKey) {
        console.log("   ABSENT — les tests d'extraction/analyse/génération ne peuvent pas être exécutés. Voir editorial-engine/.env.example.");
      } else {
        const connection = await testOpenAiConnection();
        console.log(`   ${connection.ok ? "OK" : "ÉCHEC"} — ${connection.message}`);
        if (!connection.ok) process.exitCode = 1;
      }

      console.log("\n5) Auteur par défaut...");
      if (!config.defaultAuthor) {
        console.log("   ABSENT — la génération d'article sera refusée tant que EDITORIAL_DEFAULT_AUTHOR n'est pas renseigné.");
      } else {
        console.log(`   OK — signature configurée: "${config.defaultAuthor}"`);
      }

      console.log("\n6) Google Search Console...");
      console.log(`   ${isSearchConsoleConnected() ? "Configuré (non testé)" : "Non connecté — voir editorial-engine/intelligence/searchConsole.ts"}`);
      break;
    }

    case "dashboard": {
      console.log(JSON.stringify(buildDashboardData(), null, 2));
      break;
    }

    case "freshness": {
      const days = Number(positional[0] ?? 90);
      const flags = await detectStaleArticles(days);
      console.log(`${flags.length} article(s) signalé(s) (seuil ${days} jours) :`);
      console.log(JSON.stringify(flags, null, 2));
      break;
    }

    default:
      console.log(`Commande inconnue: "${command ?? ""}"\n`);
      console.log("Commandes disponibles:");
      console.log("  npm run editorial:run                    — un cycle sur toutes les sources RSS activées");
      console.log("  npm run editorial:run -- --watch          — boucle continue (voir EDITORIAL_ENGINE.md)");
      console.log("  npm run editorial:dry-run                 — comme run, sans jamais écrire dans Sanity");
      console.log("  npm run editorial:source -- <nom>         — une seule source");
      console.log("  npm run editorial:url -- <url> [--label X] — une URL fournie à la main (label optionnel pour test-results/)");
      console.log("  npm run editorial:test                    — vérifie la config et les connexions");
      console.log("  npm run editorial:dashboard                — données locales agrégées (sujets, scores, erreurs)");
      console.log("  npm run editorial:freshness -- [jours]     — articles Journal jamais mis à jour depuis N jours (défaut 90)");
      console.log("  npm run editorial:publish -- <documentId> — publie un brouillon déjà validé par un humain");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
