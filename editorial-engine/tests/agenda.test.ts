import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, isAgendaEligible, ESSENTIAL_FIELDS, type AgendaEvent } from "../agenda/types.ts";
import { eventIdentity, mergeEvent } from "../agenda/store.ts";
import { rankSource, dateAppears } from "../agenda/verify.ts";
import { planSearches } from "../agenda/discover.ts";
import { refersToSameEvent } from "../agenda/resolve.ts";
import { eventSlug, toEventDocument } from "../sanity/events.ts";

function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  const base: AgendaEvent = {
    id: "",
    eventName: "Barthélémy Toguo — The Nomadic Studio",
    eventType: "exposition",
    discipline: "art contemporain",
    artistOrCreator: "Barthélémy Toguo",
    institution: "Galerie Lelong",
    startDate: "2026-09-10",
    endDate: "2026-10-10",
    time: "",
    venue: "Galerie Lelong",
    city: "Paris",
    country: "France",
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

// --- Document Sanity -------------------------------------------------------

test("le document Sanity ne porte que des données réellement lues", () => {
  const doc = toEventDocument(event({ endDate: "", time: "", organizer: "" }));
  assert.equal(doc._type, "event");
  assert.equal("endDate" in doc, false, "une date de fin absente ne s'écrit pas");
  assert.equal("time" in doc, false, "un horaire absent ne s'écrit pas");
  assert.equal("organizer" in doc, false);
  assert.equal(doc.venue, "Galerie Lelong");
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

// --- Couverture géographique ----------------------------------------------

test("la rotation des recherches couvre l'international sans quota imposé", () => {
  const plans = planSearches(40, 0);
  const villes = ["Lomé", "Lagos", "Dakar", "Paris", "Londres", "New York", "Tokyo", "Dubaï"];
  const couvertes = villes.filter((v) => plans.some((p) => p.includes(v)));
  assert.ok(couvertes.length >= 6, `couverture trop étroite : ${couvertes.join(", ")}`);
  assert.ok(plans.some((p) => p.includes("exposition")) || plans.some((p) => p.includes("festival")));
});
