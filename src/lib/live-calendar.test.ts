import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcsEvent } from "./live-calendar.ts";

const base = {
  title: "Vernissage — septembre 2026",
  description: "Diffusion en direct du vernissage.",
  location: "Paris, France",
  url: "https://weblack.fr/live/vernissage-septembre-2026/",
  scheduledStart: "2026-09-25T19:00:00.000Z",
};

test("produit un VCALENDAR bien formé avec DTSTART/DTEND/SUMMARY/URL", () => {
  const ics = buildIcsEvent(base, "live-abc@weblack.fr");
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
  assert.match(ics, /DTSTART:20260925T190000Z/);
  assert.match(ics, /SUMMARY:Vernissage — septembre 2026/);
  assert.match(ics, /URL:https:\/\/weblack\.fr\/live\/vernissage-septembre-2026\//);
});

test("sans scheduledEnd, une durée d'une heure est appliquée — jamais devinée autrement", () => {
  const ics = buildIcsEvent(base, "live-abc@weblack.fr");
  assert.match(ics, /DTEND:20260925T200000Z/);
});

test("avec scheduledEnd fourni, elle est reprise telle quelle", () => {
  const ics = buildIcsEvent({ ...base, scheduledEnd: "2026-09-25T21:30:00.000Z" }, "live-abc@weblack.fr");
  assert.match(ics, /DTEND:20260925T213000Z/);
});

test("échappe correctement virgules, points-virgules et retours à la ligne dans le texte", () => {
  const ics = buildIcsEvent({ ...base, description: "Ligne 1\nLigne 2; avec, ponctuation" }, "uid");
  assert.match(ics, /DESCRIPTION:Ligne 1\\nLigne 2\\; avec\\, ponctuation/);
});

test("un champ optionnel absent (location, description) ne produit pas de ligne vide", () => {
  const ics = buildIcsEvent({ title: base.title, url: base.url, scheduledStart: base.scheduledStart }, "uid");
  assert.doesNotMatch(ics, /^LOCATION:/m);
  assert.doesNotMatch(ics, /^DESCRIPTION:/m);
});

test("les lignes de plus de 75 caractères sont repliées selon RFC 5545", () => {
  const longTitle = "Un titre délibérément très long pour vérifier le repli de ligne conforme à la RFC 5545 sur les calendriers";
  const ics = buildIcsEvent({ ...base, title: longTitle }, "uid");
  const summaryLine = ics.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
  assert.ok(summaryLine, "la première ligne SUMMARY doit exister");
  assert.ok(summaryLine!.length <= 75);
});

test("deux appels successifs produisent des UID identiques pour le même live (stabilité, pas de doublon dans les calendriers des visiteurs)", () => {
  const a = buildIcsEvent(base, "live-abc@weblack.fr");
  const b = buildIcsEvent(base, "live-abc@weblack.fr");
  const uidOf = (ics: string) => ics.match(/UID:(.+)/)?.[1];
  assert.equal(uidOf(a), uidOf(b));
});
