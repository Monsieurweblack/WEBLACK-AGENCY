import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, effectiveStatus, isAgendaEligible, ESSENTIAL_FIELDS, type AgendaEvent } from "../agenda/types.ts";
import { eventIdentity, mergeEvent } from "../agenda/store.ts";
import { rankSource, dateAppears, settleTerritory } from "../agenda/verify.ts";
import { planSearches } from "../agenda/discover.ts";
import { refersToSameEvent } from "../agenda/resolve.ts";
import { resolveKnownEvent } from "../agenda/runAgendaCycle.ts";
import { eventSlug, toEventDocument, preserveSlug } from "../sanity/events.ts";

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

test("la rotation couvre l'international, l'Europe et l'Afrique en premier", () => {
  const plans = planSearches(40, 0);
  const villes = ["Lomé", "Lagos", "Dakar", "Paris", "Londres", "New York", "Tokyo", "Dubaï"];
  const couvertes = villes.filter((v) => plans.some((p) => p.includes(v)));
  assert.ok(couvertes.length >= 6, `couverture trop étroite : ${couvertes.join(", ")}`);
  assert.ok(plans.some((p) => p.includes("exposition")) || plans.some((p) => p.includes("festival")));
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

test("l'Europe et l'Afrique dominent la liste interrogée", () => {
  // Un choix éditorial assumé, qui porte sur ce qui est CHERCHÉ : il ne
  // garantit à aucune région d'être publiée, la vérification reste la même
  // pour tous.
  const europeAfrique = ["Paris", "Londres", "Milan", "Berlin", "Anvers", "Lisbonne", "Lomé", "Lagos", "Dakar", "Le Cap", "Tunis", "Casablanca"];
  const ailleurs = ["Tokyo", "Séoul", "New York", "Dubaï", "Montréal", "São Paulo"];

  const villes: string[] = [];
  for (let cycle = 0; cycle < 24; cycle++) {
    for (const plan of planSearches(3, cycle)) villes.push(plan.split(" à ")[1]!);
  }
  const proches = villes.filter((v) => europeAfrique.includes(v)).length;
  const lointaines = villes.filter((v) => ailleurs.includes(v)).length;
  assert.ok(proches > lointaines * 2, `Europe+Afrique ${proches} vs ailleurs ${lointaines}`);
  assert.ok(lointaines > 0, "le reste du monde ne disparaît pas pour autant");
});
