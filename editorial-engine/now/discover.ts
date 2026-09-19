import type { SourceArticle } from "../sources/types.ts";
import type { NowSignal, SourceRank } from "./types.ts";
import type { AgendaEvent } from "../agenda/types.ts";
import { enabledSources } from "../sources/loadSources.ts";
import { fetchRssSource } from "../ingestion/rss.ts";
import { extractFacts } from "../extraction/facts.ts";
import { buildVerifiedFactSet } from "../generation/verifiedFacts.ts";
import { analyzeArticle } from "../intelligence/analyze.ts";
import { checkAntiFabrication } from "../validation/antiFabrication.ts";
import { checkNowDuplicate } from "./dedupe.ts";
import { generateSignalText } from "./generateSignal.ts";
import { scoreSignal } from "./relevance.ts";
import { freshnessBand } from "./freshness.ts";
import { evaluateNowGate } from "./qualityGate.ts";
import { signalIdentity } from "./store.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import type { GeneratedArticle } from "../generation/types.ts";

/**
 * Chaîne complète pour UN candidat RSS : extraction (réutilisée telle
 * quelle), Evidence Pack (réutilisé tel quel), analyse éditoriale
 * (réutilisée telle quelle — territoire, pertinence, rang implicite via la
 * source), rédaction courte (propre à NOW), anti-fabrication (réutilisée
 * telle quelle, sur un objet minimal qui satisfait sa signature sans
 * dupliquer sa logique), doublon (propre à NOW), Quality Gate (propre à
 * NOW, composé de vérifications existantes).
 *
 * Rien n'est écrit dans Sanity ici — voir runNowCycle.ts, qui ne publie
 * que ce que ce module renvoie avec le statut "published".
 */
export async function discoverEditorialSignal(article: SourceArticle, sourceRank: SourceRank, runId: string): Promise<NowSignal | undefined> {
  const config = loadConfig();

  const duplicate = checkNowDuplicate(article);
  if (duplicate.isDuplicate) {
    log("DUPLICATE CHECK", `NOW — écarté avant tout appel modèle : ${duplicate.reason}`);
    return undefined; // §11 (cost control, même principe que le reste du moteur) : jamais payer un appel pour un doublon déjà détecté sans lui.
  }

  const facts = await extractFacts(article, runId);
  const pack = buildVerifiedFactSet(facts, article);
  const analysis = await analyzeArticle(article, runId);

  if (analysis.territory === "OUT_OF_TERRITORY") {
    log("EDITORIAL SCORE", `NOW — hors territoire, écarté : "${article.title}"`);
    return undefined;
  }

  const text = await generateSignalText(article, pack, runId);
  if (!text) return undefined;

  // Objet minimal, au seul usage de checkAntiFabrication() — jamais publié
  // tel quel, jamais montré à un lecteur. Un seul bloc portant le résumé
  // français : c'est la langue de publication par défaut du moteur (voir
  // config/env.ts EDITORIAL_DEFAULT_AUTHOR et le reste du pipeline Journal).
  const fabricationCheckSubject: GeneratedArticle = {
    lang: "fr",
    title: text.titleFr,
    slug: "now-signal-check",
    excerpt: text.summaryFr,
    category: "news",
    publishDate: new Date().toISOString().slice(0, 10),
    author: config.defaultAuthor ?? "WEBLACK",
    body: [{ _type: "block", _key: "b1", style: "normal", children: [{ _type: "span", _key: "s1", text: text.summaryFr, marks: [] }], markDefs: [] }],
    source: { name: article.sourceName, url: article.url },
    editorialScore: analysis.score,
    confidenceScore: analysis.reliability,
  };
  const antiFabrication = await checkAntiFabrication(fabricationCheckSubject, pack, runId);

  const band = freshnessBand({ sourcePublishedAt: article.publishedAt, discoveredAt: new Date().toISOString() });
  const relevance = scoreSignal({ analysis, sourceRank, freshnessBand: band });

  const gate = evaluateNowGate({
    title: text.titleFr,
    summary: text.summaryFr,
    territory: analysis.territory,
    date: text.dateIfStated,
    dateRequired: false, // une actualité créative (nomination, collaboration, collection) n'a pas systématiquement une "date du fait" isolable — §4 : ne pas la confondre avec l'Agenda, qui lui exige une date.
    sourceUrl: article.url,
    compositeRelevance: relevance.composite,
    freshnessBand: band,
    duplicate,
    antiFabrication,
  });

  const signal: NowSignal = {
    id: signalIdentity({ title: text.titleFr, sourceUrl: article.url }),
    origin: "editorial-signal",
    title: text.titleFr,
    titleEn: text.titleEn,
    territory: analysis.territory,
    summary: text.summaryFr,
    summaryEn: text.summaryEn,
    relevanceReason: analysis.editorialValue,
    date: text.dateIfStated,
    source: {
      name: article.sourceName,
      rank: sourceRank,
      url: article.url,
      publisher: article.sourceName,
      publishedAt: article.publishedAt,
    },
    discoveredAt: new Date().toISOString(),
    language: facts.sourceLanguage || "en",
    relevance,
    status: gate.decision,
    statusReason: gate.reasons.join(" | "),
    imageUrl: article.imageUrl,
  };

  return signal;
}

/**
 * §4 — un événement Agenda actuellement ONGOING est un signal NOW légitime
 * ("événement culturel actuellement en cours" figure explicitement dans la
 * liste du brief). Aucune nouvelle vérification, aucune nouvelle écriture :
 * l'Agenda a déjà fait ce travail. Cette fonction ne fait que reformuler un
 * AgendaEvent déjà VERIFIED en NowSignal, pour l'unifier dans la même liste
 * que les signaux éditoriaux au moment de l'affichage (voir runNowCycle.ts).
 *
 * Le rang de source d'un événement Agenda est toujours au moins INSTITUTION
 * en pratique (c'est une condition de son éligibilité — isAgendaEligible
 * exige verificationStatus VERIFIED, obtenu en lisant la page officielle) ;
 * on relit son sourceRank réel plutôt que de le supposer.
 */
export function deriveFromOngoingEvent(event: AgendaEvent): NowSignal {
  const band = freshnessBand({ discoveredAt: event.lastVerifiedAt });
  const relevance = scoreSignal({
    analysis: { relevance: event.editorialRelevance, reliability: 90, importance: event.editorialRelevance },
    sourceRank: event.sourceRank,
    freshnessBand: band === "EXPIRED" ? "CURRENT" : band, // un événement ONGOING reste montrable tant qu'il est ONGOING, indépendamment de la date de sa dernière vérification — sa fraîcheur d'affichage est gouvernée par son statut temporel (agenda/types.ts computeStatus), pas par freshness.ts.
  });

  return {
    id: `agenda-${event.id}`,
    origin: "ongoing-event",
    title: event.eventName,
    titleEn: event.eventName, // un nom d'événement ne se traduit pas (§16) — la même forme sert les deux langues.
    territory: event.territory,
    summary: event.descriptionFr || event.editorialValue,
    summaryEn: event.descriptionEn || event.editorialValue,
    relevanceReason: event.editorialValue,
    date: event.startDate,
    source: { name: event.institution || event.organizer, rank: event.sourceRank, url: event.officialUrl, publisher: event.institution || event.organizer },
    discoveredAt: event.lastVerifiedAt,
    language: "fr",
    relevance,
    status: "published",
    statusReason: "",
    sourceEventEngineId: event.id,
  };
}

/**
 * Un passage de découverte RSS pour NOW — même sources que le Journal
 * (sources/sources.json, déjà vérifiées : robots.txt, licence, richesse du
 * texte — voir le commentaire en tête de ce fichier), aucune nouvelle
 * source ajoutée pour ce chantier. `maxCandidates` garde un cycle borné,
 * même principe que maxItemsPerCycle par source.
 */
export async function discoverEditorialSignals(runId: string, maxCandidates = 6): Promise<NowSignal[]> {
  const signals: NowSignal[] = [];
  const sources = enabledSources();

  for (const source of sources) {
    if (signals.length >= maxCandidates) break;
    let articles: SourceArticle[];
    try {
      articles = await fetchRssSource(source);
    } catch (error) {
      log("FETCH", `NOW — source "${source.name}" indisponible : ${error instanceof Error ? error.message : String(error)}`);
      continue; // une source indisponible n'interrompt jamais le cycle — voir editorial-engine/tests/now.test.ts "source indisponible".
    }
    const capped = articles.slice(0, source.maxItemsPerCycle ?? 3);
    // Rang de source déterministe depuis sources.json — une RSS de média
    // spécialisé vaut MEDIA, jamais plus, quel que soit son ancienneté ou sa
    // réputation : cohérent avec agenda/verify.ts, qui déduit le rang de la
    // page réellement lue plutôt que d'une liste tenue à la main.
    const rank: SourceRank = "MEDIA";
    for (const article of capped) {
      if (signals.length >= maxCandidates) break;
      try {
        const signal = await discoverEditorialSignal(article, rank, runId);
        if (signal) signals.push(signal);
      } catch (error) {
        log("EXTRACT", `NOW — échec sur "${article.title}" : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return signals;
}
