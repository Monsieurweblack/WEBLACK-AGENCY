import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, isAgendaEligible, ESSENTIAL_FIELDS, type AgendaEvent } from "../agenda/types.ts";
import { eventIdentity, mergeEvent } from "../agenda/store.ts";
import { rankSource } from "../agenda/verify.ts";
import { planSearches } from "../agenda/discover.ts";

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
    ...overrides,
  };
  // Comme en production : verifyEventPage part de la page qu'il vient de lire.
  const sourceUrls = overrides.sourceUrls ?? [base.officialUrl];
  return { ...base, sourceUrls, id: base.id || eventIdentity(base) };
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
  const correct = event({ editorialRelevance: 65 });
  assert.equal(isAgendaEligible(correct), true, "65 suffit pour une entrée d'agenda vérifiée");

  const faible = event({ editorialRelevance: 40 });
  assert.equal(isAgendaEligible(faible), false, "l'Agenda n'est pas un annuaire");
});

test("ni un événement non vérifié ni un événement expiré ne sont éligibles", () => {
  assert.equal(isAgendaEligible(event({ verificationStatus: "UNVERIFIED" })), false);
  assert.equal(isAgendaEligible(event({ verificationStatus: "CANCELLED" })), false);
  assert.equal(isAgendaEligible(event({ status: "EXPIRED" })), false);
});

// --- Couverture géographique ----------------------------------------------

test("la rotation des recherches couvre l'international sans quota imposé", () => {
  const plans = planSearches(40, 0);
  const villes = ["Lomé", "Lagos", "Dakar", "Paris", "Londres", "New York", "Tokyo", "Dubaï"];
  const couvertes = villes.filter((v) => plans.some((p) => p.includes(v)));
  assert.ok(couvertes.length >= 6, `couverture trop étroite : ${couvertes.join(", ")}`);
  assert.ok(plans.some((p) => p.includes("exposition")) || plans.some((p) => p.includes("festival")));
});
