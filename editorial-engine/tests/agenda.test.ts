import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStatus,
  effectiveStatus,
  isAgendaEligible,
  isAgendaEventActive,
  isAgendaEventUpcoming,
  isAgendaEventExpired,
  ESSENTIAL_FIELDS,
  type AgendaEvent,
} from "../agenda/types.ts";
import { eventIdentity, mergeEvent, isStaleMissingFieldReview, applyControlMode, normalizeLegacyEvent } from "../agenda/store.ts";
import { rankSource, dateAppears, settleTerritory, resolveGeographicPriority } from "../agenda/verify.ts";
import { planSearches } from "../agenda/discover.ts";
import { AFRICA_CITIES, AFRO_DIASPORA_CITIES, INTERNATIONAL_CITIES, timezoneForCity, cityPriorityHint } from "../agenda/geography.ts";
import { refersToSameEvent } from "../agenda/resolve.ts";
import { resolveKnownEvent, reconcileEventList } from "../agenda/runAgendaCycle.ts";
import { eventSlug, toEventDocument, preserveSlug, applySanityControlMode, type ExistingEventDocument } from "../sanity/events.ts";

function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  const base: AgendaEvent = {
    id: "",
    eventName: "Barthélémy Toguo — The Nomadic Studio",
    eventType: "exposition",
    discipline: "art contemporain",
    disciplineEn: "contemporary art",
    artistOrCreator: "Barthélémy Toguo",
    institution: "Galerie Lelong",
    startDate: "2026-09-10",
    endDate: "2026-10-10",
    time: "",
    venue: "Galerie Lelong",
    city: "Paris",
    country: "France",
    countryEn: "France",
    organizer: "Galerie Lelong",
    officialUrl: "https://www.galerie-lelong.com/fr/expo/toguo",
    sourceUrls: ["https://www.galerie-lelong.com/fr/expo/toguo"],
    sourceRank: "OFFICIAL",
    verificationStatus: "VERIFIED",
    verifiedFields: ["eventName", "venue", "city", "startDate", "endDate"],
    missingFields: [],
    note: "",
    lastVerifiedAt: "2026-09-15T00:00:00.000Z",
    status: "UPCOMING",
    editorialRelevance: 80,
    territory: "ART_CULTURE",
    editorialValue: "Une exposition personnelle dans une galerie de référence.",
    descriptionFr: "Une exposition personnelle de Barthélémy Toguo à la Galerie Lelong.",
    descriptionEn: "A solo exhibition by Barthélémy Toguo at Galerie Lelong.",
    fieldSources: {},
    geographicPriority: "INTERNATIONAL",
    geographicJustification: "",
    timezone: "Europe/Paris",
    controlMode: "AUTOMATED",
    ...overrides,
  };
  // Comme en production : verifyEventPage part de la page qu'il vient de lire.
  const sourceUrls = overrides.sourceUrls ?? [base.officialUrl];
  const fieldSources = overrides.fieldSources ?? Object.fromEntries(base.verifiedFields.map((f) => [f, base.officialUrl]));
  return { ...base, sourceUrls, fieldSources, id: base.id || eventIdentity(base) };
}

// --- Expiration ------------------------------------------------------------

test("un événement passé n'est plus présenté comme à venir", () => {
  const now = new Date("2026-11-01T00:00:00.000Z");
  assert.equal(computeStatus("2026-09-10", "2026-10-10", now), "EXPIRED");
  assert.equal(computeStatus("2026-12-01", "2026-12-20", now), "UPCOMING");
  assert.equal(computeStatus("2026-10-20", "2026-11-20", now), "ONGOING");
});

test("sans date, rien ne permet d'annoncer un événement à venir", () => {
  assert.equal(computeStatus("", "", new Date("2026-11-01T00:00:00.000Z")), "EXPIRED");
});

test("une date de fin absente fait foi de la date de début", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  assert.equal(computeStatus("2026-09-20", "", now), "UPCOMING");
  assert.equal(computeStatus("2026-09-01", "", now), "EXPIRED");
});

// --- Déduplication ---------------------------------------------------------

test("la même exposition annoncée par plusieurs médias ne produit qu'une entrée", () => {
  const parMedia = event({ officialUrl: "https://www.lemonde.fr/culture/toguo", sourceRank: "MEDIA" });
  const parGalerie = event();
  assert.equal(parMedia.id, parGalerie.id, "l'identité tient à l'événement, pas à qui l'annonce");
});

test("deux événements différents au même lieu gardent des identités distinctes", () => {
  const autre = event({ eventName: "Une toute autre exposition", startDate: "2026-11-02" });
  assert.notEqual(autre.id, event().id);
});

// --- resolveKnownEvent — identité résiliente à un venue absent -------------
//
// Cas réel observé en production : « Mariko Mori : All That Shines » publiée
// à la fois par une reprise média (venue renseigné) et par le musée
// lui-même (venue absent sur sa propre page). eventIdentity() hache
// `venue || city` : les deux annonces produisent deux identités distinctes,
// et le cycle suivant republie indéfiniment les deux — c'est la cause
// racine de la réapparition. resolveKnownEvent() ajoute un repli sur
// refersToSameEvent() (déjà écrit, déjà testé plus bas) pour les reconnaître
// comme un seul événement sans changer eventIdentity() elle-même.

function marikoMori(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return event({
    eventName: "Mariko Mori: All That Shines",
    artistOrCreator: "Mariko Mori",
    institution: "Mori Art Museum",
    venue: "Mori Art Museum",
    city: "Tokyo",
    country: "Japon",
    countryEn: "Japan",
    startDate: "2026-10-31",
    endDate: "2027-03-28",
    officialUrl: "https://www.mori.art.museum/en/exhibitions/marikomori/index.html",
    sourceRank: "OFFICIAL",
    ...overrides,
  });
}

test("1. Mariko Mori — doublon exact observé : venue absent d'un côté, présent de l'autre", () => {
  const parLeMusee = marikoMori({ venue: "", verifiedFields: ["eventName", "city", "artistOrCreator", "institution", "startDate", "endDate"] });
  const parLaReprise = marikoMori({
    eventName: "Mariko Mori : All That Shines",
    officialUrl: "https://hypebeast.com/2026/7/mariko-mori-all-that-shines-retrospective-exhibition-mori-art-museum-tokyo-info",
    sourceRank: "MEDIA",
  });

  // La cause racine, démontrée : eventIdentity() seule les distingue.
  assert.notEqual(parLeMusee.id, parLaReprise.id, "venue absent -> repli sur la ville -> hash différent, c'est le bug");

  // Le correctif : resolveKnownEvent() les reconnaît malgré tout.
  const trouve = resolveKnownEvent(parLaReprise, [parLeMusee]);
  assert.equal(trouve?.id, parLeMusee.id, "même événement réel, reconnu malgré l'identité divergente");
});

test("2. même événement, URL différente — chemin rapide (eventIdentity suffit déjà)", () => {
  const connu = event();
  const reprise = event({ officialUrl: "https://www.lemonde.fr/culture/toguo", sourceRank: "MEDIA" });
  const trouve = resolveKnownEvent(reprise, [connu]);
  assert.equal(trouve?.id, connu.id);
});

test("3. même événement, libellé de ville différent — le lieu (identique) suffit", () => {
  const connu = event({ city: "Paris" });
  const variante = event({ city: "Paris, France", officialUrl: "https://media.example/toguo-2" });
  const trouve = resolveKnownEvent(variante, [connu]);
  assert.equal(trouve?.id, connu.id, "eventIdentity ne hache que venue||city : la ville seule ne bouge pas la clé tant que le venue concorde");
});

test("4. même événement, titre reformulé — repli sur refersToSameEvent", () => {
  const connu = event();
  const reformule = event({
    eventName: "Barthélémy Toguo : The Nomadic Studio, une exposition personnelle",
    officialUrl: "https://media.example/toguo-reformule",
    sourceRank: "MEDIA",
  });
  assert.notEqual(connu.id, reformule.id, "le titre a changé, eventIdentity ne les fait plus concorder");
  const trouve = resolveKnownEvent(reformule, [connu]);
  assert.equal(trouve?.id, connu.id, "nom partiellement partagé + institution commune = même événement");
});

test("5. événements différents, même titre générique — ne doivent jamais fusionner", () => {
  const premiere = event({ eventName: "Exposition", venue: "Galerie Lelong", artistOrCreator: "Barthélémy Toguo", startDate: "2026-09-10" });
  const seconde = event({
    eventName: "Exposition",
    venue: "Palais de Tokyo",
    artistOrCreator: "Une autre créatrice",
    institution: "Palais de Tokyo",
    startDate: "2026-11-20",
    officialUrl: "https://www.palaisdetokyo.com/expo",
  });
  const trouve = resolveKnownEvent(seconde, [premiere]);
  assert.equal(trouve, undefined, "un titre partagé seul ne suffit pas — aucun second identifiant ne concorde");
});

test("6. nouvel événement du même artiste — ne doit pas fusionner avec une exposition antérieure", () => {
  const ancienne = event();
  const nouvelle = event({
    eventName: "Barthélémy Toguo — Sculptures récentes",
    venue: "Centre Pompidou",
    institution: "Centre Pompidou",
    startDate: "2027-02-01",
    endDate: "2027-04-01",
    officialUrl: "https://www.centrepompidou.fr/toguo-2027",
  });
  const trouve = resolveKnownEvent(nouvelle, [ancienne]);
  assert.equal(trouve, undefined, "même artiste ne veut pas dire même exposition — moins de deux racines de nom partagées");
});

test("7. événement retiré de Sanity mais toujours connu du moteur — redétecté comme mise à jour, jamais comme nouveau", () => {
  // Le retrait ne vaut que côté Sanity (withdrawEvent) ; le stock local, lui,
  // garde l'entrée. Une redécouverte doit donc s'y raccrocher — pas créer
  // une seconde identité que le prochain cycle republierait comme neuve.
  const connu = marikoMori({ venue: "" });
  const redecouverte = marikoMori({ officialUrl: "https://another-outlet.example/mariko-mori", sourceRank: "MEDIA" });
  const trouve = resolveKnownEvent(redecouverte, [connu]);
  assert.equal(trouve?.id, connu.id);
});

test("8. mise à jour légitime — un report confirmé par une source mieux placée reste rattaché à l'événement existant", () => {
  const connu = event({ startDate: "2026-09-10", endDate: "2026-10-10", sourceRank: "MEDIA", officialUrl: "https://media.example/toguo" });
  const reporte = event({
    startDate: "2026-10-15",
    endDate: "2026-11-15",
    officialUrl: "https://www.galerie-lelong.com/fr/expo/toguo",
    sourceRank: "OFFICIAL",
  });
  const trouve = resolveKnownEvent(reporte, [connu]);
  assert.equal(trouve?.id, connu.id, "institution et venue inchangés : un report reste le même événement, pas un nouveau");
  const fusion = mergeEvent(connu, { ...reporte, id: connu.id });
  assert.equal(fusion.startDate, "2026-10-15", "la source mieux placée fait foi, la mise à jour est acceptée — pas de blocage éternel");
  assert.equal(fusion.verificationStatus, "VERIFIED", "un report légitime n'est pas une contradiction");
});

test("9. une redécouverte ne se rattache jamais à une identité déjà fusionnée (MERGED) — observé en test réel", () => {
  // Reproduit exactement ce que le cycle réel a révélé après la première
  // version du correctif : le stock append-only garde l'ancienne identité
  // MEDIA (désormais MERGED) *avant* la canonique dans son ordre naturel —
  // Array.find renvoyait donc l'entrée retirée, pas celle qui fait foi.
  const media = marikoMori({ id: "media-id", venue: "Mori Art Museum", sourceRank: "MEDIA" });
  const officielle = marikoMori({ id: "official-id", venue: "", sourceRank: "OFFICIAL" });
  const mediaFusionnee: AgendaEvent = { ...media, verificationStatus: "MERGED", mergedInto: officielle.id };
  const stock = [mediaFusionnee, officielle]; // ordre du stock : la fusionnée en premier

  // Redécouverte de la page officielle, à l'identique : passe par le chemin rapide (id exact).
  const trouveParId = resolveKnownEvent(officielle, stock);
  assert.equal(trouveParId?.id, officielle.id, "l'identité exacte pointe déjà sur la canonique");

  // Redécouverte de la page média, à l'identique : id exact = l'entrée MERGED, doit rediriger.
  const trouveMediaRedecouvert = resolveKnownEvent(media, stock);
  assert.equal(trouveMediaRedecouvert?.id, officielle.id, "une identité MERGED redirige vers ce qui fait foi, jamais elle-même");

  // Redécouverte par une TROISIÈME page (id différent des deux), rattachable seulement par repli flou.
  const troisiemeSource = marikoMori({ id: "troisieme-id", officialUrl: "https://autre-media.example/mariko-mori", sourceRank: "SECONDARY" });
  const trouveParRepli = resolveKnownEvent(troisiemeSource, stock);
  assert.equal(trouveParRepli?.id, officielle.id, "le repli flou ignore les entrées MERGED et converge sur la canonique");
});

test("10. relecture de la même page, titre tronqué par l'extraction — l'URL suffit là où le nom ne suffit plus", () => {
  // Observé en test réel : la même page hypebeast relue plus tard a produit
  // eventName="All That Shines" (sans « Mariko Mori »), sous le seuil de deux
  // racines de nom que refersToSameEvent exige. L'URL, elle, n'a pas bougé.
  const connu = marikoMori({
    id: "official-id",
    venue: "",
    sourceRank: "OFFICIAL",
    officialUrl: "https://www.mori.art.museum/en/exhibitions/marikomori/index.html",
    sourceUrls: [
      "https://www.mori.art.museum/en/exhibitions/marikomori/index.html",
      "https://hypebeast.com/2026/7/mariko-mori-all-that-shines-retrospective-exhibition-mori-art-museum-tokyo-info",
    ],
  });
  const relectureTronquee = marikoMori({
    id: "nouvelle-id-a-cause-du-titre-tronque",
    eventName: "All That Shines",
    officialUrl: "https://hypebeast.com/2026/7/mariko-mori-all-that-shines-retrospective-exhibition-mori-art-museum-tokyo-info",
    sourceRank: "MEDIA",
  });

  assert.equal(refersToSameEvent(connu, relectureTronquee), false, "moins de deux racines de nom partagées — le repli flou seul ne suffit plus");
  const trouve = resolveKnownEvent(relectureTronquee, [connu]);
  assert.equal(trouve?.id, connu.id, "même URL déjà tracée dans sourceUrls : reconnu sans dépendre du texte extrait");
});

// --- Propagation des champs essentiels à la fusion --------------------------

test("mergeEvent complète la ville manquante côté autoritaire depuis l'autre source, si elle l'a vérifiée", () => {
  // Cas réel : la page du Mori Art Museum ne redit pas « Tokyo », une
  // reprise média fiable si. Avant ce correctif, mergeEvent ne recopiait que
  // endDate/time/organizer — jamais un champ essentiel — et l'événement
  // restait bloqué en REVIEW malgré une ville pourtant vérifiée ailleurs.
  const officielSansVille = event({ city: "", venue: "", sourceRank: "OFFICIAL", verifiedFields: ["eventName", "startDate"], missingFields: ["city"] });
  const repriseAvecVille = event({ city: "Tokyo", venue: "Mori Art Museum", sourceRank: "MEDIA", officialUrl: "https://media.example/mori" });

  const fusion = mergeEvent(officielSansVille, repriseAvecVille);
  assert.equal(fusion.sourceRank, "OFFICIAL", "la source officielle reste autoritaire");
  assert.equal(fusion.city, "Tokyo", "la ville vérifiée ailleurs est reprise");
  assert.equal(fusion.missingFields.includes("city"), false, "la ville comblée ne bloque plus l'éligibilité");
  assert.equal(fusion.fieldSources.city, repriseAvecVille.officialUrl, "la provenance de la ville pointe vers qui l'a réellement établie");
});

test("mergeEvent ne comble jamais une ville que l'autre source n'a pas elle-même vérifiée", () => {
  const officielSansVille = event({ city: "", sourceRank: "OFFICIAL", verifiedFields: ["eventName", "startDate"], missingFields: ["city"] });
  const autreNonVerifiee = event({ city: "Tokyo", sourceRank: "MEDIA", verifiedFields: ["eventName", "startDate"] }); // "city" absent de verifiedFields
  const fusion = mergeEvent(officielSansVille, autreNonVerifiee);
  assert.equal(fusion.city, "", "une valeur non vérifiée par sa propre source ne se propage pas");
});

// --- Repêchage des revues dont la cause a disparu ---------------------------
//
// Cas réel observé dans le stock de production : cinq entrées restées en
// REVIEW avec missingFields désormais vide — un durcissement passé exigeait
// « venue » comme champ essentiel (retiré depuis, commit 5156005), ou une
// fusion antérieure au correctif de mergeEvent avait comblé la donnée sans
// jamais repasser le statut. « Mariko Mori : All That Shines » en fait
// partie : missingFields vide, note encore « city manquant ».

test("isStaleMissingFieldReview reconnaît une revue dont la cause a disparu", () => {
  const perime = event({ verificationStatus: "REVIEW", missingFields: [], note: "Donnée(s) essentielle(s) absente(s) de la page : city." });
  assert.equal(isStaleMissingFieldReview(perime), true);
});

test("isStaleMissingFieldReview ignore une revue encore justifiée", () => {
  const encoreIncomplet = event({ verificationStatus: "REVIEW", missingFields: ["city"], note: "Donnée(s) essentielle(s) absente(s) de la page : city." });
  assert.equal(isStaleMissingFieldReview(encoreIncomplet), false, "le champ manque toujours");
});

test("isStaleMissingFieldReview ignore une revue dont la cause n'est pas un champ manquant", () => {
  const pageAccueil = event({ verificationStatus: "REVIEW", missingFields: [], note: "L'événement n'a été lu que sur une page d'accueil, qui ne peut pas faire foi." });
  assert.equal(isStaleMissingFieldReview(pageAccueil), false, "cette revue n'a jamais eu de champ manquant pour cause");
});

test("isStaleMissingFieldReview ne touche jamais à ce qui n'est pas en revue", () => {
  assert.equal(isStaleMissingFieldReview(event({ verificationStatus: "VERIFIED", missingFields: [] })), false);
  assert.equal(isStaleMissingFieldReview(event({ verificationStatus: "CANCELLED", missingFields: [], note: "essentielle" })), false);
});

// --- reconcileEventList — doublons déjà divergents dans le stock -----------
//
// resolveKnownEvent protège la découverte de NOUVEAUX candidats, mais une
// fois deux entrées créées séparément, rien ne les rapproche plus jamais.
// Observé en production sur deux cas réels : « DESIGNART TOKYO 2026 »
// publiée deux fois (deux pages du même site, venues formulées différemment)
// et « Mariko Mori : All That Shines » dont le titre tronqué ne partage plus
// assez de racines de nom avec le titre complet.

test("reconcileEventList fusionne deux entrées déjà divergentes du même événement (cas réel DESIGNART TOKYO)", () => {
  const a = event({
    eventName: "DESIGNART TOKYO 2026",
    venue: "Omotesando, Gaienmae/ Harajuku/ Shibuya/ Roppongi/ Ginza",
    city: "Tokyo",
    organizer: "DESIGNART TOKYO COMMITTEE",
    sourceRank: "ORGANIZER",
    officialUrl: "https://www.designart.jp/en/entry2026/",
    startDate: "2026-10-30",
  });
  const b = event({
    eventName: "DESIGNART TOKYO 2026",
    venue: "Ginza / Tokyo / Roppongi / Gaienmae / Omotesando / Harajuku / Shibuya / Daikanyama / Ikejiri",
    city: "Tokyo",
    institution: "DESIGNART TOKYO 実行委員会",
    organizer: "DESIGNART TOKYO COMMITTEE",
    sourceRank: "OFFICIAL",
    officialUrl: "https://www.designart.jp/designarttokyo2026/",
    startDate: "2026-10-30",
  });
  assert.notEqual(a.id, b.id, "deux venues différemment formulées produisent bien deux identités distinctes — c'est la cause du doublon");

  const { toSave, pairs } = reconcileEventList([a, b]);
  assert.equal(pairs.length, 1);
  assert.equal(toSave.length, 2, "le gagnant mis à jour et le perdant marqué MERGED");
  const survivor = toSave.find((e) => e.verificationStatus !== "MERGED")!;
  const merged = toSave.find((e) => e.verificationStatus === "MERGED")!;
  assert.equal(survivor.id, b.id, "la source OFFICIAL l'emporte sur ORGANIZER");
  assert.equal(merged.mergedInto, survivor.id);
});

test("reconcileEventList fusionne le cas réel Mariko Mori et comble la ville manquante au passage", () => {
  const hypebeastUrl = "https://hypebeast.com/2026/7/mariko-mori-all-that-shines-retrospective-exhibition-mori-art-museum-tokyo-info";
  const officielSansVille = marikoMori({
    id: "official-id",
    venue: "",
    city: "",
    sourceRank: "OFFICIAL",
    verifiedFields: ["eventName", "startDate", "endDate", "artistOrCreator", "institution"],
    missingFields: ["city"],
    verificationStatus: "REVIEW",
    officialUrl: "https://www.mori.art.museum/en/exhibitions/marikomori/index.html",
    // Réel : une tentative antérieure de resolveMissingFields a déjà essayé
    // la page hypebeast comme voisine, sans en tirer la ville — mais l'URL
    // est restée tracée dans sourceUrls. C'est elle qui permet au repli par
    // URL de reconnaître la reprise, là où le nom seul ne suffit plus.
    sourceUrls: ["https://www.mori.art.museum/en/exhibitions/marikomori/index.html", hypebeastUrl],
  });
  const repriseTitreTronque = event({
    id: "media-id",
    eventName: "All That Shines",
    artistOrCreator: "Mariko Mori",
    institution: "Mori Art Museum",
    venue: "Mori Art Museum",
    city: "Tokyo",
    startDate: "2026-10-31",
    endDate: "2027-03-28",
    sourceRank: "MEDIA",
    officialUrl: hypebeastUrl,
  });

  const { toSave, pairs } = reconcileEventList([officielSansVille, repriseTitreTronque]);
  assert.equal(pairs.length, 1, "reconnu malgré un titre tronqué qui ne partage plus assez de racines de nom");
  const survivor = toSave.find((e) => e.verificationStatus !== "MERGED")!;
  assert.equal(survivor.id, officielSansVille.id, "la source OFFICIAL reste l'identité qui survit");
  assert.equal(survivor.city, "Tokyo", "la ville vérifiée par la reprise comble le vide de la page officielle");
  assert.equal(survivor.missingFields.includes("city"), false);
  assert.equal(survivor.verificationStatus, "VERIFIED", "la cause de la revue — ville manquante — a disparu, l'événement redevient publiable");
});

test("reconcileEventList ne promeut jamais une revue dont la cause n'était pas une donnée manquante", () => {
  // Une entrée en revue pour une autre raison (ici une contradiction déjà
  // tranchée par mergeEvent) ne doit pas être promue simplement parce que
  // missingFields est vide — ce n'est pas de là que venait le problème.
  const enRevuePourAutreRaison = event({
    id: "site-root-id",
    verificationStatus: "REVIEW",
    missingFields: [], // pas de champ manquant : la revue vient d'ailleurs
    note: "L'événement n'a été lu que sur une page d'accueil.",
  });
  const reprise = event({ id: "reprise-id", officialUrl: "https://media.example/reprise", sourceRank: "MEDIA" });
  const { toSave } = reconcileEventList([enRevuePourAutreRaison, reprise]);
  const survivor = toSave.find((e) => e.verificationStatus !== "MERGED");
  assert.equal(survivor?.verificationStatus, "REVIEW", "la revue persiste : sa cause réelle n'a pas été traitée par la fusion");
});

test("reconcileEventList est idempotent — un second passage sur son propre résultat ne fusionne plus rien", () => {
  const a = event({ eventName: "DESIGNART TOKYO 2026", venue: "A B C", city: "Tokyo", sourceRank: "ORGANIZER", officialUrl: "https://a.example/1" });
  const b = event({ eventName: "DESIGNART TOKYO 2026", venue: "B C D", city: "Tokyo", sourceRank: "OFFICIAL", officialUrl: "https://b.example/2" });

  const premierPassage = reconcileEventList([a, b]);
  assert.equal(premierPassage.pairs.length, 1);

  const survivor = premierPassage.toSave.find((e) => e.verificationStatus !== "MERGED")!;
  const merged = premierPassage.toSave.find((e) => e.verificationStatus === "MERGED")!;
  const secondPassage = reconcileEventList([survivor, merged]);
  assert.equal(secondPassage.pairs.length, 0, "l'entrée déjà MERGED n'est jamais reconsidérée");
  assert.equal(secondPassage.toSave.length, 0, "rien à réécrire une deuxième fois");
});

test("reconcileEventList ne fusionne jamais deux événements réellement distincts", () => {
  const a = event({ eventName: "Exposition A", venue: "Galerie Un", city: "Paris", startDate: "2026-09-10" });
  const b = event({ eventName: "Exposition B", venue: "Galerie Deux", city: "Lyon", startDate: "2026-11-20", officialUrl: "https://b.example/2" });
  const { toSave, pairs } = reconcileEventList([a, b]);
  assert.equal(pairs.length, 0);
  assert.equal(toSave.length, 0);
});

// --- Priorité des sources --------------------------------------------------

test("la page de l'institution prime sur la reprise média", () => {
  const officiel = rankSource("https://www.galerie-lelong.com/fr/expo/toguo", {
    venue: "Galerie Lelong", institution: "Galerie Lelong", organizer: "", artistOrCreator: "",
  });
  assert.equal(officiel, "OFFICIAL");

  const media = rankSource("https://www.francetelevisions.fr/culture/toguo", {
    venue: "Galerie Lelong", institution: "Galerie Lelong", organizer: "", artistOrCreator: "",
  });
  assert.equal(media, "MEDIA", "une reprise n'est pas une source officielle");
});

test("une reprise média n'écrase pas les dates lues sur la page officielle", () => {
  const officiel = event({ startDate: "2026-09-10", endDate: "2026-10-10", sourceRank: "OFFICIAL" });
  const media = event({ startDate: "2026-09-11", endDate: "", sourceRank: "MEDIA", officialUrl: "https://media.example/toguo" });

  const fusion = mergeEvent(officiel, media);
  assert.equal(fusion.startDate, "2026-09-10", "la source la mieux placée fait foi");
  assert.equal(fusion.sourceUrls.length, 2, "les deux pages consultées restent tracées");
});

// --- Contradiction ---------------------------------------------------------

test("deux sources de même rang qui se contredisent passent en revue, sans publication", () => {
  const a = event({ startDate: "2026-09-10", sourceRank: "MEDIA", officialUrl: "https://a.example/x" });
  const b = event({ startDate: "2026-09-17", sourceRank: "MEDIA", officialUrl: "https://b.example/x" });

  const fusion = mergeEvent(a, b);
  assert.equal(fusion.verificationStatus, "REVIEW");
  assert.match(fusion.note, /contradictoires/);
  assert.equal(isAgendaEligible(fusion), false, "rien de contradictoire ne devient éligible");
});

// --- Donnée essentielle absente --------------------------------------------

test("une donnée essentielle absente interdit l'éligibilité — elle n'est jamais déduite", () => {
  for (const field of ESSENTIAL_FIELDS) {
    const incomplet = event({ missingFields: [field], verificationStatus: "REVIEW" });
    assert.equal(isAgendaEligible(incomplet), false, `${field} manquant doit bloquer`);
  }
});

// --- Éligibilité Agenda, distincte du seuil 90 des articles ----------------

test("l'Agenda a son propre seuil : un événement vérifié n'a pas à valoir 90", () => {
  const correct = event({ editorialRelevance: 75 });
  assert.equal(isAgendaEligible(correct), true, "75 suffit pour une entrée d'agenda vérifiée : l'Agenda n'exige pas les 90 d'un article");

  const faible = event({ editorialRelevance: 40 });
  assert.equal(isAgendaEligible(faible), false, "l'Agenda n'est pas un annuaire");
});

test("ni un événement non vérifié ni un événement expiré ne sont éligibles", () => {
  assert.equal(isAgendaEligible(event({ verificationStatus: "UNVERIFIED" })), false);
  assert.equal(isAgendaEligible(event({ verificationStatus: "CANCELLED" })), false);
  assert.equal(isAgendaEligible(event({ status: "EXPIRED" })), false);
});

// --- Résolution complémentaire sur le domaine officiel ---------------------

test("une page voisine ne complète l'événement que si elle parle bien du même", () => {
  const connu = event();

  const memeEvenement = event({
    eventName: "Toguo — The Nomadic Studio, informations pratiques",
    officialUrl: "https://www.galerie-lelong.com/fr/infos-pratiques",
  });
  assert.equal(refersToSameEvent(connu, memeEvenement), true, "nom concordant et institution partagée");

  const autreExpo = event({
    eventName: "Nocturne Tour au Grand Palais",
    artistOrCreator: "Autre artiste",
    institution: "Grand Palais",
    venue: "Grand Palais",
    startDate: "2027-01-05",
  });
  assert.equal(refersToSameEvent(connu, autreExpo), false, "un autre événement du même site ne doit rien compléter");
});

test("un nom proche ne suffit pas seul — il faut un second identifiant", () => {
  const connu = event();
  // Même intitulé générique, mais rien d'autre en commun.
  const homonyme = event({
    eventName: "Barthélémy Toguo — The Nomadic Studio",
    artistOrCreator: "",
    institution: "Institution sans rapport",
    venue: "Lieu sans rapport",
    startDate: "2027-05-05",
  });
  assert.equal(refersToSameEvent(connu, homonyme), false);
});

test("chaque donnée essentielle porte l'URL de la page qui l'établit", () => {
  const officialUrl = "https://www.galerie-lelong.com/fr/expo/toguo";
  const complet = event();
  for (const field of ESSENTIAL_FIELDS) {
    assert.equal(complet.fieldSources[field], officialUrl, `${field} doit citer la page qui le porte`);
  }

  // Une date comblée depuis la billetterie officielle cite CETTE page.
  const compléte = event({
    fieldSources: { ...complet.fieldSources, startDate: "https://www.galerie-lelong.com/fr/billetterie" },
  });
  assert.equal(compléte.fieldSources.startDate, "https://www.galerie-lelong.com/fr/billetterie");
  assert.equal(compléte.fieldSources.venue, officialUrl, "les autres champs gardent leur propre provenance");
});

// --- Barre éditoriale de l'Agenda -----------------------------------------

test("un événement vérifié mais hors territoire n'entre pas à l'Agenda", () => {
  // Factuellement irréprochable, éditorialement hors sujet : c'est le cas
  // réel qui a motivé cette barre — un atelier pour débutants, daté et
  // confirmé sur la page officielle.
  const atelier = event({
    eventName: "Trommel-Workshop für Anfänger:innen",
    territory: "OUT_OF_TERRITORY",
    editorialValue: "",
    editorialRelevance: 70,
  });
  assert.equal(atelier.verificationStatus, "VERIFIED", "la vérification factuelle, elle, a bien réussi");
  assert.equal(isAgendaEligible(atelier), false);
});

test("sans raison d'être annoncé, un événement en territoire reste non éligible", () => {
  assert.equal(isAgendaEligible(event({ editorialValue: "   " })), false);
});

test("la barre de pertinence de l'Agenda est de 70", () => {
  assert.equal(isAgendaEligible(event({ editorialRelevance: 70 })), true);
  assert.equal(isAgendaEligible(event({ editorialRelevance: 69 })), false);
});

// --- Confirmation de date, dans la langue de la page ----------------------

test("une date est confirmée quelle que soit la langue de la page", () => {
  const iso = "2026-09-13";
  for (const page of [
    "Ausstellung vom 13. September 2026 bis 20. September 2026",
    "Opening 13 September 2026 at the gallery",
    "September 13, 2026 - private view",
    "van 13 september 2026 tot 5 oktober",
    "del 13 de septiembre de 2026",
    "13 septembre 2026",
    "13/09/2026 au Grand Palais",
    "13.9.2026 Vernissage",
    "09/13/2026 opening night",
  ]) {
    assert.equal(dateAppears(iso, page), true, `non confirmée : ${page}`);
  }
});

test("élargir les formes acceptées ne confirme pas une date que la page ne porte pas", () => {
  assert.equal(dateAppears("2026-10-13", "13 September 2026"), false, "mois différent");
  assert.equal(dateAppears("2026-09-13", "14 September 2026"), false, "jour différent");
  assert.equal(dateAppears("2026-09-13", "13 September 2025"), false, "année différente");
  assert.equal(dateAppears("2026-09-13", "13 September"), false, "sans année, on ne sait pas de quelle année il s'agit");
  assert.equal(dateAppears("2026-09-13", "exhibition running through autumn 2026"), false, "aucune date");
  assert.equal(dateAppears("2026-05-13", "13 maisons ouvertes en 2026"), false, "un mot n'est pas un mois");
  assert.equal(dateAppears("2026-09-13", "130 September 2026"), false, "le jour ne doit pas être un fragment de nombre");
});

// --- Statut publié ---------------------------------------------------------

test("seuls un événement à venir ou en cours peuvent paraître", () => {
  assert.equal(effectiveStatus(event({ startDate: "2099-01-01", endDate: "2099-01-05" })), "UPCOMING");
  assert.equal(effectiveStatus(event({ startDate: "2000-01-01", endDate: "2000-01-05" })), "EXPIRED");
  assert.equal(effectiveStatus(event({ verificationStatus: "CANCELLED" })), "CANCELLED");
});

test("tout ce qui n'est pas établi aboutit à REVIEW, quel que soit le motif", () => {
  for (const statut of ["REVIEW", "UNVERIFIED", "GONE"] as const) {
    assert.equal(effectiveStatus(event({ verificationStatus: statut })), "REVIEW", statut);
  }
  assert.equal(
    effectiveStatus(event({ missingFields: ["city"], startDate: "2099-01-01" })),
    "REVIEW",
    "une donnée essentielle absente empêche l'annonce, même pour un événement futur",
  );
});

// --- Territoire instable ---------------------------------------------------

test("un événement qui change de territoire entre deux lectures passe en revue", () => {
  const premier = event({ territory: "CREATIVE_INDUSTRIES", territoryHistory: ["CREATIVE_INDUSTRIES"] });
  const relu = event({ territory: "OUT_OF_TERRITORY" });

  const tranche = settleTerritory(premier, relu);
  assert.equal(tranche.verificationStatus, "REVIEW");
  assert.match(tranche.note, /ambig/);
  assert.equal(isAgendaEligible(tranche), false, "un cas limite ne se publie pas");
});

test("une lecture qui confirme la précédente ne déclenche rien", () => {
  const premier = event({ territory: "ART_CULTURE", territoryHistory: ["ART_CULTURE"] });
  const relu = event({ territory: "ART_CULTURE" });

  const tranche = settleTerritory(premier, relu);
  assert.equal(tranche.verificationStatus, "VERIFIED");
  assert.equal(isAgendaEligible(tranche), true);
  assert.deepEqual(tranche.territoryHistory, ["ART_CULTURE"]);
});

// --- Document Sanity -------------------------------------------------------

test("le document Sanity ne porte que des données réellement lues", () => {
  const doc = toEventDocument(event({ endDate: "", time: "", organizer: "" }));
  assert.equal(doc._type, "event");
  assert.equal("endDate" in doc, false, "une date de fin absente ne s'écrit pas");
  assert.equal("time" in doc, false, "un horaire absent ne s'écrit pas");
  assert.equal("organizer" in doc, false);
  assert.equal(doc.venue, "Galerie Lelong");
  assert.equal(doc.status, "EXPIRED", "le statut publié est calculé, jamais recopié");
  assert.deepEqual(doc.sourceUrls, ["https://www.galerie-lelong.com/fr/expo/toguo"]);
});

test("la provenance de chaque donnée voyage avec le document", () => {
  const billetterie = "https://www.galerie-lelong.com/fr/billetterie";
  const base = event();
  const doc = toEventDocument(event({ fieldSources: { ...base.fieldSources, startDate: billetterie } }));
  const sources = doc.sources as { field: string; url: string }[];
  assert.equal(sources.find((s) => s.field === "startDate")?.url, billetterie);
  assert.equal(sources.find((s) => s.field === "venue")?.url, base.officialUrl);
});

test("l'identité moteur ancre le document : deux cycles ne créent pas deux événements", () => {
  const premier = toEventDocument(event());
  const relu = toEventDocument(event({ lastVerifiedAt: "2026-09-20T00:00:00.000Z" }));
  assert.equal(premier.engineId, relu.engineId);
  assert.equal(premier.slug && (premier.slug as { current: string }).current, (relu.slug as { current: string }).current);
});

test("le slug reste lisible et daté", () => {
  assert.equal(eventSlug(event()), "barthelemy-toguo-the-nomadic-studio-2026-09-10");
});

test("l'URL publique ne bouge pas quand une relecture reformule le nom", () => {
  // Cas réel : « Berlin Fashion Week 2027 » relu « Berlin Fashion Week ».
  // La page était déjà en ligne et déjà partageable.
  const relu = toEventDocument(event({ eventName: "Berlin Fashion Week", startDate: "2027-01-29" }));
  const fige = preserveSlug(relu, "berlin-fashion-week-2027-2027-01-29");

  assert.equal((fige.slug as { current: string }).current, "berlin-fashion-week-2027-2027-01-29");
  assert.equal(fige.eventName, "Berlin Fashion Week", "le nom affiché, lui, se met bien à jour");
});

test("un événement encore jamais publié reçoit le slug déduit de son nom", () => {
  const neuf = toEventDocument(event());
  assert.equal((preserveSlug(neuf, undefined).slug as { current: string }).current, eventSlug(event()));
});

// --- Couverture géographique ----------------------------------------------

test("la rotation couvre l'Afrique, la diaspora et l'international", () => {
  const plans = planSearches(60, 0);
  const afrique = Object.keys(AFRICA_CITIES).filter((v) => plans.some((p) => p.includes(v)));
  const diaspora = Object.keys(AFRO_DIASPORA_CITIES).filter((v) => plans.some((p) => p.includes(v)));
  const international = Object.keys(INTERNATIONAL_CITIES).filter((v) => plans.some((p) => p.includes(v)));
  assert.ok(afrique.length >= 6, `couverture Afrique trop étroite : ${afrique.join(", ")}`);
  assert.ok(diaspora.length >= 1, `aucune ville de diaspora interrogée`);
  assert.ok(international.length >= 1, `aucune ville internationale interrogée`);
});

test("la rotation ne se limite pas aux six métropoles africaines les plus documentées", () => {
  // La mission le dit explicitement : Lagos, Johannesburg, Dakar, Accra,
  // Nairobi, Le Cap ne doivent pas monopoliser la découverte africaine —
  // la diversité doit couvrir aussi l'Afrique du Nord, centrale et les
  // capitales moins souvent citées.
  const grandesMetropoles = new Set(["Lagos", "Johannesburg", "Dakar", "Accra", "Nairobi", "Le Cap"]);
  const villes = new Set<string>();
  for (let cycle = 0; cycle < 40; cycle++) {
    for (const plan of planSearches(6, cycle)) {
      const ville = plan.split(" à ")[1]!;
      if (ville in AFRICA_CITIES) villes.add(ville);
    }
  }
  const horsGrandesMetropoles = [...villes].filter((v) => !grandesMetropoles.has(v));
  assert.ok(horsGrandesMetropoles.length >= 8, `couverture africaine trop concentrée : ${[...villes].join(", ")}`);
});

test("une requête de diaspora nomme explicitement le lien africain — la ville seule n'oriente pas la recherche", () => {
  // "expositions dans les musées à New York" ne remonterait que de l'art
  // contemporain générique : sans l'angle diaspora dans la requête
  // elle-même, la ville ne suffit à rien orienter.
  const plans = planSearches(80, 0);
  const requetesDiaspora = plans.filter((p) => Object.keys(AFRO_DIASPORA_CITIES).some((v) => p.endsWith(`à ${v}`)));
  assert.ok(requetesDiaspora.length > 0, "aucune requête de diaspora dans cet échantillon");
  for (const requete of requetesDiaspora) {
    assert.match(requete, /africain|afro-|afro/i, `requête de diaspora sans angle africain explicite : « ${requete} »`);
  }
});

test("la rotation avance d'un cycle à l'autre au lieu de tirer au hasard", () => {
  // Semée sur l'horodatage à la milliseconde, la rotation s'était arrêtée six
  // fois de suite sur Tokyo et l'agenda public était devenu japonais. Une
  // graine qui avance d'un cran par cycle est ce qui garantit la couverture.
  const premier = planSearches(3, 100);
  const suivant = planSearches(3, 101);
  assert.notDeepEqual(premier, suivant, "deux cycles consécutifs ne doivent pas interroger la même chose");

  const villes = new Set<string>();
  for (let cycle = 0; cycle < 12; cycle++) {
    for (const plan of planSearches(3, 100 + cycle)) villes.add(plan.split(" à ")[1]!);
  }
  assert.ok(villes.size >= 20, `douze cycles ne couvrent que ${villes.size} ville(s)`);
});

test("l'Afrique domine structurellement la liste interrogée, la diaspora avant le reste du monde", () => {
  // WEBLACK AGENDA est un radar culturel africain et afro-diasporique avant
  // d'être un agenda généraliste : la priorité Afrique → diaspora →
  // international doit se lire dans ce qui est CHERCHÉ, pas seulement
  // espérée "en moyenne". Elle ne garantit à aucune région d'être publiée,
  // la vérification reste la même pour tous.
  const tiers = { AFRICA: 0, AFRO_DIASPORA: 0, INTERNATIONAL: 0 } as Record<string, number>;
  for (let cycle = 0; cycle < 60; cycle++) {
    for (const plan of planSearches(6, cycle)) {
      const ville = plan.split(" à ")[1]!;
      if (ville in AFRICA_CITIES) tiers.AFRICA++;
      else if (ville in AFRO_DIASPORA_CITIES) tiers.AFRO_DIASPORA++;
      else if (ville in INTERNATIONAL_CITIES) tiers.INTERNATIONAL++;
    }
  }
  assert.ok(tiers.AFRICA! > tiers.AFRO_DIASPORA! + tiers.INTERNATIONAL!, `Afrique ${tiers.AFRICA} devrait dominer diaspora+international ${tiers.AFRO_DIASPORA! + tiers.INTERNATIONAL!}`);
  assert.ok(tiers.AFRO_DIASPORA! > 0, "la diaspora ne disparaît pas pour autant");
  assert.ok(tiers.INTERNATIONAL! > 0, "le reste du monde ne disparaît pas pour autant");
});

// --- Géographie : timezone et classification -------------------------------

test("timezoneForCity renvoie l'IANA connu pour une ville répertoriée, jamais UTC ni une timezone serveur par défaut", () => {
  assert.equal(timezoneForCity("Lagos"), "Africa/Lagos");
  assert.equal(timezoneForCity("Tokyo"), "Asia/Tokyo");
  assert.equal(timezoneForCity("Paris"), "Europe/Paris");
});

test("timezoneForCity ne fabrique rien pour une ville non répertoriée", () => {
  assert.equal(timezoneForCity("Trifouillis-les-Oies"), "");
  assert.equal(timezoneForCity(""), "");
});

test("cityPriorityHint classe une ville dans son palier, sans jamais rien décider d'un événement précis", () => {
  assert.equal(cityPriorityHint("Lagos"), "AFRICA");
  assert.equal(cityPriorityHint("Paris"), "AFRO_DIASPORA");
  assert.equal(cityPriorityHint("Tokyo"), "INTERNATIONAL");
  assert.equal(cityPriorityHint("Trifouillis-les-Oies"), undefined);
});

test("resolveGeographicPriority — AFRO_DIASPORA sans justification retombe sur INTERNATIONAL", () => {
  // §12 de la mission : jamais déduit de l'apparence physique. Une
  // classification que le modèle n'a pas su rattacher à un fait écrit dans
  // la page n'est pas une classification vérifiée.
  assert.equal(resolveGeographicPriority({ geographicPriority: "AFRO_DIASPORA", geographicJustification: "" }), "INTERNATIONAL");
  assert.equal(resolveGeographicPriority({ geographicPriority: "AFRO_DIASPORA", geographicJustification: "   " }), "INTERNATIONAL");
});

test("resolveGeographicPriority — AFRO_DIASPORA avec justification écrite est retenue", () => {
  assert.equal(
    resolveGeographicPriority({ geographicPriority: "AFRO_DIASPORA", geographicJustification: "L'artiste, née à Dakar, expose ses œuvres sur l'héritage wolof." }),
    "AFRO_DIASPORA",
  );
});

test("resolveGeographicPriority — AFRICA n'a besoin d'aucune justification, la géographie suffit", () => {
  assert.equal(resolveGeographicPriority({ geographicPriority: "AFRICA", geographicJustification: "" }), "AFRICA");
});

test("resolveGeographicPriority — INTERNATIONAL n'est jamais rehaussé", () => {
  assert.equal(resolveGeographicPriority({ geographicPriority: "INTERNATIONAL", geographicJustification: "" }), "INTERNATIONAL");
});

// --- Report (POSTPONED) -----------------------------------------------------

test("un événement reporté sans nouvelle date passe en POSTPONED, distinct de CANCELLED et de REVIEW", () => {
  const reporte = event({ verificationStatus: "POSTPONED", note: "La page indique un report, sans nouvelle date confirmée." });
  assert.equal(effectiveStatus(reporte), "POSTPONED");
  assert.equal(isAgendaEligible(reporte), false, "un report n'est jamais publiable tant qu'aucune nouvelle date n'est confirmée");
});

test("un report avec nouvelle date confirmée est une mise à jour normale, pas un POSTPONED", () => {
  // Couvert par verify.ts : "postponed" ne se coche que si la page NE donne
  // PAS de nouvelle date. Ici, côté types, on vérifie seulement qu'un
  // événement VERIFIED avec une date à jour n'est pas traité comme reporté.
  const reprogramme = event({ verificationStatus: "VERIFIED", startDate: "2026-11-15" });
  assert.equal(effectiveStatus(reprogramme), computeStatus(reprogramme.startDate, reprogramme.endDate));
});

// --- Fonctions temporelles centrales ---------------------------------------
//
// isAgendaEventActive/Upcoming/Expired sont les noms d'usage que toute
// surface du site (homepage, /agenda, WEBLACK NOW, sitemap, JSON-LD) doit
// interroger — elles ne font que déléguer à computeStatus, seul calcul réel.

test("isAgendaEventExpired / isAgendaEventUpcoming / isAgendaEventActive délèguent au même calcul que computeStatus", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const passe = { startDate: "2026-01-01", endDate: "2026-01-05" };
  const futur = { startDate: "2026-12-01", endDate: "2026-12-05" };
  const enCours = { startDate: "2026-09-20", endDate: "2026-09-30" };

  assert.equal(isAgendaEventExpired(passe, now), true);
  assert.equal(isAgendaEventUpcoming(passe, now), false);
  assert.equal(isAgendaEventActive(passe, now), false);

  assert.equal(isAgendaEventExpired(futur, now), false);
  assert.equal(isAgendaEventUpcoming(futur, now), true);
  assert.equal(isAgendaEventActive(futur, now), true);

  assert.equal(isAgendaEventExpired(enCours, now), false);
  assert.equal(isAgendaEventUpcoming(enCours, now), false);
  assert.equal(isAgendaEventActive(enCours, now), true, "en cours = actif, même si pas 'à venir'");
});

// --- Contrôle manuel (AUTOMATED / EDITORIAL / HYBRID) -----------------------

test("applyControlMode — AUTOMATED laisse passer le recalcul du moteur sans restriction", () => {
  const existant = event({ controlMode: "AUTOMATED", eventName: "Ancien nom" });
  const frais = event({ controlMode: "AUTOMATED", eventName: "Nom mis à jour par le moteur" });
  const resultat = applyControlMode(existant, frais);
  assert.equal(resultat.eventName, "Nom mis à jour par le moteur");
});

test("applyControlMode — EDITORIAL fige tout le contenu, ne recalcule que le statut temporel", () => {
  const existant = event({
    controlMode: "EDITORIAL",
    eventName: "Titre corrigé à la main",
    startDate: "2020-01-01",
    endDate: "2020-01-05",
    status: "UPCOMING", // volontairement périmé, pour vérifier que le recalcul a bien lieu
  });
  const frais = event({ controlMode: "AUTOMATED", eventName: "Le moteur voudrait réécrire ceci", startDate: "2020-01-01", endDate: "2020-01-05" });
  const resultat = applyControlMode(existant, frais);
  assert.equal(resultat.eventName, "Titre corrigé à la main", "le contenu éditorial n'est jamais écrasé");
  assert.equal(resultat.controlMode, "EDITORIAL", "le mode lui-même reste sous contrôle éditorial");
  assert.equal(resultat.status, "EXPIRED", "le statut temporel, lui, continue d'être recalculé — §17 ne souffre aucune exception");
});

test("applyControlMode — HYBRID reprend le factuel du moteur, garde l'éditorial de l'existant", () => {
  const existant = event({
    controlMode: "HYBRID",
    eventName: "Titre corrigé à la main",
    editorialValue: "Valeur éditoriale décidée par un humain",
    startDate: "2026-09-10",
    endDate: "2026-09-20",
  });
  const frais = event({
    controlMode: "AUTOMATED",
    eventName: "Nom lu sur la page",
    editorialValue: "Valeur que le moteur proposerait",
    startDate: "2026-10-15", // report confirmé par la page officielle
    endDate: "2026-10-25",
    verificationStatus: "VERIFIED",
  });
  const resultat = applyControlMode(existant, frais);
  assert.equal(resultat.eventName, "Titre corrigé à la main", "l'éditorial reste celui de l'existant");
  assert.equal(resultat.editorialValue, "Valeur éditoriale décidée par un humain");
  assert.equal(resultat.startDate, "2026-10-15", "le factuel — ici un report confirmé — vient bien de la fraîche lecture");
  assert.equal(resultat.controlMode, "HYBRID", "le mode ne redevient jamais AUTOMATED de son propre chef");
});

test("applyControlMode — une entrée sans controlMode (stock antérieur à ce champ) se comporte comme AUTOMATED", () => {
  const existant = event({ eventName: "Ancien nom" });
  delete (existant as Partial<AgendaEvent>).controlMode;
  const frais = event({ eventName: "Nom mis à jour" });
  const resultat = applyControlMode(existant, frais);
  assert.equal(resultat.eventName, "Nom mis à jour");
});

// --- applySanityControlMode — la même protection côté document Sanity -----
//
// C'est le pendant réel d'applyControlMode : le stock local du moteur n'a
// aucune vue sur une modification faite directement dans le Studio, donc
// c'est CE module — celui qui écrit vraiment dans Sanity — qui doit lire le
// controlMode déjà posé sur le document avant d'écraser quoi que ce soit.

function existingDoc(overrides: Partial<ExistingEventDocument> = {}): ExistingEventDocument {
  return {
    _id: "event-editorial-engine-abc",
    slug: { current: "un-evenement-2026-09-10" },
    controlMode: "AUTOMATED",
    startDate: "2026-09-10",
    endDate: "2026-10-10",
    eventName: "Nom déjà en ligne",
    editorialValue: "Valeur déjà en ligne",
    ...overrides,
  };
}

test("applySanityControlMode — AUTOMATED ou absent (documents antérieurs au champ) écrit le frais tel quel", () => {
  const fresh = { eventName: "Nom recalculé", status: "UPCOMING" };
  assert.deepEqual(applySanityControlMode(existingDoc({ controlMode: "AUTOMATED" }), fresh), fresh);
  assert.deepEqual(applySanityControlMode(existingDoc({ controlMode: undefined }), fresh), fresh);
});

test("applySanityControlMode — EDITORIAL n'écrit que le statut recalculé depuis les dates déjà dans Sanity", () => {
  const fresh = { eventName: "Le moteur voudrait réécrire ceci", status: "REVIEW" };
  const resultat = applySanityControlMode(existingDoc({ controlMode: "EDITORIAL", startDate: "2020-01-01", endDate: "2020-01-05" }), fresh);
  assert.equal("eventName" in resultat, false, "aucun champ de contenu n'est écrit");
  assert.equal(resultat.status, "EXPIRED", "le statut est bien recalculé, depuis les dates DANS SANITY");
});

test("applySanityControlMode — HYBRID reprend l'éditorial déjà dans Sanity, écrit le factuel du frais", () => {
  const fresh = { eventName: "Nom lu sur la page", startDate: "2026-10-15", status: "UPCOMING", editorialValue: "Valeur que le moteur proposerait" };
  const resultat = applySanityControlMode(existingDoc({ controlMode: "HYBRID", eventName: "Nom corrigé par un éditeur", editorialValue: "Valeur corrigée par un éditeur" }), fresh);
  assert.equal(resultat.eventName, "Nom corrigé par un éditeur", "l'éditorial vient de ce qui est déjà dans Sanity");
  assert.equal(resultat.editorialValue, "Valeur corrigée par un éditeur");
  assert.equal(resultat.startDate, "2026-10-15", "le factuel vient bien de la fraîche écriture");
  assert.equal(resultat.status, "UPCOMING");
});

test("applySanityControlMode — HYBRID ne fabrique pas un champ éditorial que Sanity n'a jamais eu", () => {
  const fresh = { eventName: "Nom lu sur la page", institution: "Institution lue sur la page" };
  const resultat = applySanityControlMode(existingDoc({ controlMode: "HYBRID", institution: undefined }), fresh);
  assert.equal(resultat.institution, "Institution lue sur la page", "rien à préserver côté Sanity : le frais s'applique pour ce champ précis");
});

test("toEventDocument écrit la priorité géographique et le mode de contrôle", () => {
  const doc = toEventDocument(event({ geographicPriority: "AFRICA", geographicJustification: "", timezone: "Africa/Lagos", controlMode: "AUTOMATED", city: "Lagos" }));
  assert.equal(doc.geographicPriority, "AFRICA");
  assert.equal(doc.controlMode, "AUTOMATED");
  assert.equal(doc.timezone, "Africa/Lagos");
  assert.equal("geographicJustification" in doc, false, "une justification vide ne s'écrit pas, comme les autres champs optionnels");
});

test("toEventDocument écrit la justification quand le palier en porte une", () => {
  const doc = toEventDocument(event({ geographicPriority: "AFRO_DIASPORA", geographicJustification: "Artiste sénégalaise exposée à Paris." }));
  assert.equal(doc.geographicJustification, "Artiste sénégalaise exposée à Paris.");
});

// --- normalizeLegacyEvent — régression sur bug réel observé en cycle réel --
//
// Le journal est append-only : il contient des lignes écrites avant
// l'introduction de geographicPriority/timezone/controlMode. Sans
// normalisation à la lecture, toEventDocument plantait sur `.trim()` d'un
// timezone undefined dès le premier cycle réel exécuté après ce correctif —
// observé sur la quasi-totalité du stock existant.

test("normalizeLegacyEvent comble les champs absents d'une entrée écrite avant leur existence", () => {
  const legacy = event({ city: "Lagos" });
  delete (legacy as Partial<AgendaEvent>).geographicPriority;
  delete (legacy as Partial<AgendaEvent>).geographicJustification;
  delete (legacy as Partial<AgendaEvent>).timezone;
  delete (legacy as Partial<AgendaEvent>).controlMode;

  const normalise = normalizeLegacyEvent(legacy);
  assert.equal(normalise.geographicPriority, "AFRICA", "la géographie de la ville, déjà vérifiée, suffit à ce palier");
  assert.equal(normalise.geographicJustification, "");
  assert.equal(normalise.timezone, "Africa/Lagos");
  assert.equal(normalise.controlMode, "AUTOMATED");

  // Ce qui a fait planter toEventDocument en conditions réelles : un
  // timezone manquant faisait échouer .trim().
  assert.doesNotThrow(() => toEventDocument(normalise));
});

test("normalizeLegacyEvent ne suppose jamais AFRO_DIASPORA depuis la seule ville d'une entrée ancienne", () => {
  const legacy = event({ city: "Paris" }); // ville de diaspora, mais sans justification écrite
  delete (legacy as Partial<AgendaEvent>).geographicPriority;
  const normalise = normalizeLegacyEvent(legacy);
  assert.equal(normalise.geographicPriority, "INTERNATIONAL", "aucune justification héritée : jamais de lien africain supposé après coup");
});

test("normalizeLegacyEvent laisse une entrée déjà complète parfaitement intacte", () => {
  const complet = event({ geographicPriority: "AFRO_DIASPORA", geographicJustification: "Justification déjà établie.", timezone: "Europe/Paris", controlMode: "EDITORIAL" });
  assert.deepEqual(normalizeLegacyEvent(complet), complet);
});
