import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPublicEvent,
  isStillRunning,
  agendaFacets,
  type AgendaEventData,
} from "../../src/lib/agenda-public.ts";

/**
 * Ce que le site a le droit d'afficher.
 *
 * Le moteur ne publie déjà que du vérifié ; ces tests portent sur le second
 * tri, celui du site, qui ne fait pas confiance au premier. Un document peut
 * être modifié à la main dans le Studio : la page publique doit tomber
 * d'elle-même, sans que personne ait à y penser.
 */

function doc(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: "event-editorial-engine-abc",
    slug: { current: "barthelemy-toguo-the-nomadic-studio-2026-09-10" },
    eventName: "Barthélémy Toguo — The Nomadic Studio",
    discipline: "art contemporain",
    startDate: "2026-09-10",
    endDate: "2026-10-10",
    venue: "Galerie Lelong",
    city: "Paris",
    country: "France",
    officialUrl: "https://www.galerie-lelong.com/fr/expo/toguo",
    sourceUrls: ["https://www.galerie-lelong.com/fr/expo/toguo"],
    status: "UPCOMING",
    verificationStatus: "VERIFIED",
    lastVerifiedAt: "2026-09-15T00:00:00.000Z",
    editorialRelevance: 80,
    ...overrides,
  };
}

// --- Ce qui ne doit jamais paraître ----------------------------------------

test("un événement en revue n'existe pas publiquement", () => {
  assert.equal(toPublicEvent(doc({ status: "REVIEW", verificationStatus: "REVIEW" })), undefined);
});

test("ni un événement annulé, ni un événement terminé", () => {
  assert.equal(toPublicEvent(doc({ status: "CANCELLED" })), undefined);
  assert.equal(toPublicEvent(doc({ status: "EXPIRED" })), undefined);
});

test("un statut public posé à la main sur un document non vérifié ne suffit pas", () => {
  // Les deux conditions sont exigées ensemble, précisément parce qu'un
  // éditeur peut corriger l'une sans l'autre dans le Studio.
  for (const verification of ["REVIEW", "UNVERIFIED", "GONE", "CANCELLED"]) {
    assert.equal(
      toPublicEvent(doc({ status: "UPCOMING", verificationStatus: verification })),
      undefined,
      verification,
    );
  }
});

test("une donnée essentielle effacée fait disparaître l'événement du site", () => {
  for (const champ of ["eventName", "startDate", "venue", "city", "officialUrl"]) {
    assert.equal(toPublicEvent(doc({ [champ]: "" })), undefined, `${champ} vide`);
    assert.equal(toPublicEvent(doc({ [champ]: undefined })), undefined, `${champ} absent`);
  }
  assert.equal(toPublicEvent(doc({ slug: undefined })), undefined, "sans slug, aucune URL propre");
});

test("une ville faite d'espaces n'est pas une ville", () => {
  assert.equal(toPublicEvent(doc({ city: "   " })), undefined);
});

// --- Ce qui doit paraître ---------------------------------------------------

test("un événement vérifié et à venir est publiable, sans rien inventer", () => {
  const event = toPublicEvent(doc());
  assert.ok(event);
  assert.equal(event.eventName, "Barthélémy Toguo — The Nomadic Studio");
  assert.equal(event.status, "UPCOMING");
  assert.equal(event.city, "Paris");
});

test("un champ que la source n'a pas donné reste absent, jamais rempli", () => {
  const event = toPublicEvent(doc({ country: undefined, time: "", organizer: undefined }));
  assert.ok(event);
  assert.equal(event.country, undefined, "un pays absent ne se déduit pas de la ville");
  assert.equal(event.time, undefined);
  assert.equal(event.organizer, undefined);
});

test("un événement en cours paraît aussi", () => {
  const event = toPublicEvent(doc({ status: "ONGOING" }));
  assert.equal(event?.status, "ONGOING");
});

// --- Expiration au moment du build -----------------------------------------

test("un événement cesse d'être annoncé après sa date de fin, même s'il est écrit à venir", () => {
  const event = toPublicEvent(doc({ startDate: "2026-09-10", endDate: "2026-10-10" }))!;
  assert.equal(isStillRunning(event, "2026-10-10"), true, "le dernier jour compte encore");
  assert.equal(isStillRunning(event, "2026-10-11"), false);
});

test("sans date de fin, c'est la date de début qui fait foi — elle n'est pas prolongée", () => {
  const event = toPublicEvent(doc({ endDate: undefined }))!;
  assert.equal(isStillRunning(event, "2026-09-10"), true);
  assert.equal(isStillRunning(event, "2026-09-11"), false);
});

// --- Filtres ----------------------------------------------------------------

test("les filtres ne proposent que des valeurs réellement présentes", () => {
  const events = [
    toPublicEvent(doc()),
    toPublicEvent(doc({ slug: { current: "b" }, city: "Lagos", country: "Nigeria", discipline: undefined })),
    toPublicEvent(doc({ slug: { current: "c" }, city: "Paris", country: "France" })),
  ].filter((e): e is AgendaEventData => Boolean(e));

  const facets = agendaFacets(events);
  assert.deepEqual(facets.cities, ["Lagos", "Paris"], "dédoublonné et trié");
  assert.deepEqual(facets.countries, ["France", "Nigeria"]);
  assert.deepEqual(facets.disciplines, ["art contemporain"], "une discipline absente ne crée pas d'entrée vide");
});
