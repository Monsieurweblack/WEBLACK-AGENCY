#!/usr/bin/env node
// Campagnes de découverte réelles — Afrique, Afro-Diaspora, Sources
// sociales, International. Chaque candidate traverse le pipeline complet
// (verifyEventPage -> resolveKnownEvent -> Quality Gate) exactement comme un
// cycle normal. Rien n'est simulé ; chaque appel consomme de vrais crédits
// OpenAI et écrit dans le stock réel si une candidate est retenue.
import { discoverPages } from "./discover.ts";
import { verifyEventPage } from "./verify.ts";
import { resolveKnownEvent } from "./runAgendaCycle.ts";
import { currentEvents, mergeEvent, saveEvent, applyControlMode } from "./store.ts";
import { isAgendaEligible } from "./types.ts";
import { isSocialUrl, socialPlatform } from "./social.ts";
import { newRunId } from "../logs/runId.ts";

const campaignName = process.argv[2];
const queries = JSON.parse(process.argv[3]);

const runId = newRunId();
const summary = { campaign: campaignName, queries: queries.length, pagesConsulted: 0, socialPagesFound: 0, eventsFound: 0, eventsNew: 0, eventsMerged: 0, eligible: 0, candidates: [] };

for (const query of queries) {
  console.log(`\n>> ${query}`);
  const pages = await discoverPages(query, runId);
  summary.pagesConsulted += pages.length;
  for (const page of pages) {
    if (isSocialUrl(page.url)) {
      summary.socialPagesFound++;
      console.log(`   [SOCIAL:${socialPlatform(page.url)}] ${page.url}`);
    } else {
      console.log(`   [WEB] ${page.url}`);
    }
  }

  for (const page of pages) {
    const event = await verifyEventPage(page.url, runId);
    if (!event) continue;
    summary.eventsFound++;

    const existing = resolveKnownEvent(event, currentEvents());
    let stored = event;
    if (existing) {
      stored = applyControlMode(existing, mergeEvent(existing, { ...event, id: existing.id }));
      saveEvent(stored);
      summary.eventsMerged++;
    } else {
      saveEvent(event);
      summary.eventsNew++;
    }

    const eligible = isAgendaEligible(stored);
    if (eligible) summary.eligible++;
    summary.candidates.push({
      eventName: stored.eventName,
      city: stored.city,
      geographicPriority: stored.geographicPriority,
      geographicJustification: stored.geographicJustification,
      sourceRank: stored.sourceRank,
      sourcePlatform: stored.sourcePlatform ?? null,
      verificationStatus: stored.verificationStatus,
      eligible,
      officialUrl: stored.officialUrl,
    });
    console.log(`   -> "${stored.eventName}" @ ${stored.city} | ${stored.geographicPriority} | ${stored.verificationStatus} | ${eligible ? "ELIGIBLE" : "not eligible"}`);
  }
}

console.log(`\n=== CAMPAGNE ${campaignName} ===`);
console.log(JSON.stringify(summary, null, 2));
