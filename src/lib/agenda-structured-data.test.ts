import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEventJsonLd, organizerUrlStatus } from "./agenda-structured-data.ts";
import type { AgendaEventData } from "./agenda-public.ts";

const base: AgendaEventData = {
  id: "e1",
  slug: "test",
  eventName: "Exposition",
  startDate: "2026-11-01",
  city: "Paris",
  officialUrl: "https://example.org/expo",
  sourceUrls: [],
  status: "UPCOMING",
};

// Paires organisateur / page officielle réellement publiées dans l'Agenda (Sanity, 31/10/2026).
const REAL_CASES: [string, string, string | undefined, string][] = [
  ["COGEMODE", "https://cogemode.com/", "https://cogemode.com/", "verified-domain"],
  ["Mori Art Museum", "https://www.mori.art.museum/en/exhibitions/marikomori/index.html", "https://www.mori.art.museum/", "verified-domain"],
  ["DESIGNART TOKYO COMMITTEE", "https://www.designart.jp/designarttokyo2026/", "https://www.designart.jp/", "verified-domain"],
  ["Brussels Airlines", "https://press.brusselsairlines.com/brussels-airlines-launches-a-traveling-exhibition", "https://press.brusselsairlines.com/", "verified-domain"],
  ["NADA", "https://www.newartdealers.org/fairs/nada-new-york-2027", undefined, "domain-mismatch"],
  ["AIA Middle East", "https://www.aiainternational.org/calendar-upload/2026/11/11/x", undefined, "domain-mismatch"],
  ["Fondazione Torino Musei", "https://artexpoworld.com/artissima_2026", undefined, "domain-mismatch"],
  ["Muholi Art Institute and WiSER", "https://wiser.wits.ac.za/event/20-years", undefined, "multiple-organizers"],
  ["Mori Contemporary Art Foundation (MoriCAF) et Mori Art Museum", "https://www.tokyoartbeat.com/en/events/x", undefined, "multiple-organizers"],
];

test("organizer.url : uniquement quand le domaine de la page officielle vérifiée porte le nom de l'organisateur", () => {
  for (const [organizer, officialUrl, url, reason] of REAL_CASES) {
    const status = organizerUrlStatus({ organizer, officialUrl });
    assert.equal(status.url, url, organizer);
    assert.equal(status.reason, reason, organizer);
  }
});

test("organizer.url : jamais un réseau social, jamais une URL invalide, rien sans organisateur", () => {
  assert.equal(organizerUrlStatus({ organizer: "Printemps", officialUrl: "https://re.linkedin.com/company/printemps" }).reason, "social-or-aggregator");
  assert.equal(organizerUrlStatus({ organizer: "Galerie", officialUrl: "pas une url" }).reason, "invalid-url");
  assert.equal(organizerUrlStatus({ organizer: undefined, officialUrl: "https://example.org" }).reason, "no-organizer");
  assert.equal(organizerUrlStatus({ organizer: "  ", officialUrl: "https://example.org" }).reason, "no-organizer");
  // Nom trop court pour une correspondance fiable : pas d'URL.
  assert.equal(organizerUrlStatus({ organizer: "MEP", officialUrl: "https://www.mep-fr.org/event/x" }).url, undefined);
});

test("JSON-LD : un organisateur déclaré a TOUJOURS une url absolue https (anomalie Search Console impossible)", () => {
  const organizers = [...REAL_CASES.map(([o, u]) => [o, u]), ["Printemps", "https://re.linkedin.com/company/printemps"], [undefined, "https://x.org/"]];
  for (const [organizer, officialUrl] of organizers) {
    const data = buildEventJsonLd({ ...base, organizer, officialUrl: officialUrl! }, { inLanguage: "fr-FR" })!;
    if ("organizer" in data) {
      assert.match(data.organizer!.url, /^https:\/\/[^/]+\/$/, String(organizer));
      assert.equal(data.organizer!.name, organizer);
      assert.equal(data.organizer!["@type"], "Organization");
    }
  }
});

test("JSON-LD : propriétés Event requises et valeurs schema.org, aucun champ inventé", () => {
  const data = buildEventJsonLd({ ...base, venue: "MoMu", country: "Belgique", endDate: "2026-12-01", artistOrCreator: "X" }, { inLanguage: "fr-FR", description: "Desc" })!;
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(data["@type"], "Event");
  assert.equal(data.name, "Exposition");
  assert.equal(data.startDate, "2026-11-01");
  assert.equal(data.endDate, "2026-12-01");
  assert.equal(data.eventStatus, "https://schema.org/EventScheduled");
  assert.equal(data.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
  assert.deepEqual(data.location, { "@type": "Place", name: "MoMu", address: { "@type": "PostalAddress", addressLocality: "Paris", addressCountry: "Belgique" } });
  assert.equal(data.url, "https://example.org/expo");
  // Sans lieu ni pays : la ville n'est pas promue en nom de salle.
  const minimal = buildEventJsonLd(base, { inLanguage: "en" })!;
  assert.deepEqual(minimal.location, { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Paris" } });
  assert.ok(!("organizer" in minimal) && !("endDate" in minimal) && !("description" in minimal));
  // Sans ville : aucun JSON-LD plutôt qu'un événement incomplet.
  assert.equal(buildEventJsonLd({ ...base, city: "" }, { inLanguage: "fr-FR" }), undefined);
});
