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
import { reviewQueue, readLedger } from "./logs/productionLedger.ts";
import { currentQueue } from "./newsletter/queue.ts";
import { upcomingEvents, reviewEvents, currentEvents } from "./agenda/store.ts";
import { runAgendaCycle } from "./agenda/runAgendaCycle.ts";
import { currentSignals, reviewSignals, publishedSignals } from "./now/store.ts";
import { runNowCycle } from "./now/runNowCycle.ts";
import { dispatchDue, buildDigest, providerProblem } from "./newsletter/dispatch.ts";
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

    case "review": {
      const queue = reviewQueue();
      console.log(`== File de revue — ${queue.length} article(s) en attente d'un humain ==\n`);
      for (const entry of queue) {
        console.log(`[${entry.timestamp.slice(0, 16).replace("T", " ")}] ${entry.source.name} — arrêté à: ${entry.stoppedAt}`);
        console.log(`  Source : ${entry.source.title}`);
        console.log(`  URL    : ${entry.source.url}`);
        console.log(`  Motif  : ${entry.reason ?? "(non précisé)"}`);
        console.log(`  run_id : ${entry.runId}\n`);
      }
      if (queue.length === 0) console.log("Rien en attente.");
      break;
    }

    case "ledger": {
      const entries = readLedger();
      const cycles = new Map<string, typeof entries>();
      for (const e of entries) {
        if (!cycles.has(e.cycleId)) cycles.set(e.cycleId, []);
        cycles.get(e.cycleId)!.push(e);
      }
      console.log(`== Registre de production — ${entries.length} article(s) sur ${cycles.size} cycle(s) ==\n`);
      for (const [cycleId, items] of cycles) {
        const count = (d: string) => items.filter((i) => i.decision === d).length;
        const usd = items.reduce((sum, i) => sum + i.cost.estimatedUsd, 0);
        const tokens = items.reduce((sum, i) => sum + i.cost.totalTokens, 0);
        const ms = items.reduce((sum, i) => sum + i.durationMs, 0);
        console.log(`${cycleId}`);
        console.log(
          `  ${items.length} article(s) — PUBLIÉ ${count("PUBLISHED")} | PASS ${count("PASS")} | REVIEW ${count("REVIEW")} | REJECT ${count("REJECT")} — ${tokens} tokens, ~${usd.toFixed(4)} USD estimés, ${Math.round(ms / 1000)}s`,
        );
        for (const i of items.filter((x) => x.decision === "PUBLISHED" || x.decision === "PASS")) {
          console.log(`    ${i.decision} → ${i.sanityDraftId}  "${i.article?.title ?? ""}"`);
        }
      }
      break;
    }

    case "newsletter": {
      const action = positional[0] ?? "list";
      if (action === "list") {
        const queue = currentQueue();
        const problem = providerProblem();
        console.log(`== Newsletter — ${queue.length} numéro(s) ==`);
        console.log(`Envoi: ${problem ? `IMPOSSIBLE (${problem})` : "configuré"}\n`);
        for (const entry of queue) {
          const when = entry.status === "sent" ? `envoyé ${entry.sentAt?.slice(0, 16).replace("T", " ")}` : entry.sendAfter ? `après ${entry.sendAfter.slice(0, 16).replace("T", " ")}` : "en attente";
          console.log(`[${entry.status}] ${entry.mode.padEnd(9)} ${when}`);
          console.log(`  ${entry.newsletter.subject}`);
          console.log(`  ${entry.newsletter.articleUrl}`);
          if (entry.error) console.log(`  erreur: ${entry.error}`);
          console.log(`  id: ${entry.id}\n`);
        }
        if (queue.length === 0) console.log("File vide.");
        break;
      }
      if (action === "preview") {
        const id = positional[1];
        const entry = currentQueue().find((x) => x.id === id) ?? currentQueue()[0];
        if (!entry) {
          console.log("File vide — rien à prévisualiser.");
          break;
        }
        console.log(`Objet     : ${entry.newsletter.subject}`);
        console.log(`Preheader : ${entry.newsletter.preheader}`);
        console.log(`Lien      : ${entry.newsletter.articleUrl}\n`);
        console.log(entry.newsletter.text);
        break;
      }
      if (action === "digest") {
        const digest = buildDigest();
        if (!digest) {
          console.log("Aucun numéro en attente en mode digest.");
          break;
        }
        console.log(`Digest — ${digest.issues.length} article(s)\nObjet : ${digest.subject}\n`);
        console.log(digest.text);
        break;
      }
      if (action === "send") {
        const result = await dispatchDue();
        if (result.blocked) {
          console.log(`Envoi refusé — ${result.blocked}`);
          console.log("Aucun numéro n'a été marqué comme envoyé.");
          process.exitCode = 1;
          break;
        }
        console.log(`${result.sent} envoyé(s), ${result.failed} échec(s) sur ${result.attempted} dû(s).`);
        break;
      }
      console.log(`Action inconnue "${action}". Utiliser: list | preview [id] | digest | send`);
      process.exitCode = 1;
      break;
    }

    case "agenda": {
      if (positional[0] === "search") {
        const result = await runAgendaCycle(dryRun);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      const upcoming = upcomingEvents();
      const review = reviewEvents();
      console.log(`== Agenda culturel — ${currentEvents().length} événement(s) en stock ==`);
      console.log(`${upcoming.length} vérifié(s) à venir ou en cours · ${review.length} en attente de décision humaine\n`);
      for (const e of upcoming) {
        console.log(`[${e.status}] ${e.startDate}${e.endDate ? " → " + e.endDate : ""} — ${e.eventName}`);
        console.log(`  ${e.venue}, ${e.city}${e.country ? " (" + e.country + ")" : ""} · ${e.discipline || e.eventType}`);
        console.log(`  source ${e.sourceRank} : ${e.officialUrl}`);
        console.log(`  pertinence ${e.editorialRelevance} · vérifié le ${e.lastVerifiedAt.slice(0, 10)}\n`);
      }
      if (review.length > 0) {
        console.log("-- en attente de décision humaine --");
        for (const e of review) console.log(`  ${e.eventName} — ${e.note}`);
      }
      if (currentEvents().length === 0) console.log("Stock vide.");
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

    case "now": {
      if (positional[0] === "run") {
        const result = await runNowCycle(dryRun);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      const published = publishedSignals();
      const review = reviewSignals();
      console.log(`== WEBLACK NOW — ${currentSignals().length} signal(aux) en stock ==`);
      console.log(`${published.length} publiable(s) · ${review.length} en attente de décision humaine\n`);
      for (const s of published) {
        console.log(`[${s.origin}] ${s.territory} — ${s.title}`);
        console.log(`  ${s.source.name} (${s.source.rank}) · pertinence ${s.relevance.composite} · ${s.discoveredAt.slice(0, 10)}`);
        console.log(`  ${s.source.url}\n`);
      }
      if (review.length > 0) {
        console.log("-- en attente de décision humaine --");
        for (const s of review) console.log(`  ${s.title} — ${s.statusReason}`);
      }
      if (currentSignals().length === 0) console.log("Stock vide — aucun cycle exécuté (npm run editorial:now -- run).");
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
      console.log("  npm run editorial:review                   — file de revue: ce qui attend une décision humaine");
      console.log("  npm run editorial:ledger                   — registre de production: cycles, décisions, coûts");
      console.log("  npm run editorial:agenda                    — événements culturels vérifiés en stock");
      console.log("  npm run editorial:agenda -- search          — un passage de recherche (--dry-run pour ne rien stocker)");
      console.log("  npm run editorial:now                       — signaux WEBLACK NOW en stock");
      console.log("  npm run editorial:now -- run                — un passage de découverte (--dry-run pour ne rien stocker/écrire)");
      console.log("  npm run editorial:newsletter -- [list|preview|digest|send] — file des numéros");
      console.log("  npm run editorial:publish -- <documentId> — publie un brouillon déjà validé par un humain");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
