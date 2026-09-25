import { test } from "node:test";
import assert from "node:assert/strict";
import { toPublicLive, primaryLive, archiveLives, liveFacets, type LivePublicData } from "./live-public.ts";

const NOW = new Date("2026-09-25T18:00:00.000Z");

function doc(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: "live-abc",
    slug: { current: "vernissage-septembre-2026" },
    title: "Vernissage — septembre 2026",
    description: "Diffusion en direct du vernissage.",
    youtubeVideoId: "dQw4w9WgXcQ",
    controlMode: "AUTOMATED",
    visibility: "public",
    scheduledStart: "2026-09-25T19:00:00.000Z",
    replayEnabled: true,
    chatEnabled: true,
    featured: false,
    ...overrides,
  };
}

// --- toPublicLive ------------------------------------------------------------

test("toPublicLive refuse un document sans slug", () => {
  assert.equal(toPublicLive(doc({ slug: undefined }), NOW), undefined);
  assert.equal(toPublicLive(doc({ slug: { current: "" } }), NOW), undefined);
});

test("toPublicLive refuse un document sans youtubeVideoId", () => {
  assert.equal(toPublicLive(doc({ youtubeVideoId: undefined }), NOW), undefined);
});

test("toPublicLive disparaît quand l'état calculé est DRAFT", () => {
  assert.equal(toPublicLive(doc({ visibility: "draft" }), NOW), undefined);
});

test("toPublicLive expose l'état public calculé pour un document valide", () => {
  // scheduledStart est à 19h, NOW à 18h : une heure d'écart, hors de la
  // fenêtre PRELIVE (30 min) — SCHEDULED est donc l'état correct ici.
  const result = toPublicLive(doc(), NOW);
  assert.ok(result);
  assert.equal(result!.state, "SCHEDULED");
  assert.equal(result!.slug, "vernissage-septembre-2026");
});

test("toPublicLive passe en PRELIVE une fois dans la fenêtre des 30 minutes", () => {
  const result = toPublicLive(doc({ scheduledStart: "2026-09-25T18:15:00.000Z" }), NOW);
  assert.equal(result?.state, "PRELIVE");
});

test("toPublicLive retombe sur EDITORIAL par défaut pour un controlMode absent ou invalide, comme les documents historiques", () => {
  const result = toPublicLive(doc({ controlMode: undefined, manualStatus: "ON_AIR" }), NOW);
  assert.equal(result?.state, "ON_AIR");
});

test("toPublicLive n'invente jamais un champ optionnel absent", () => {
  const result = toPublicLive(doc({ description: undefined, discipline: undefined, location: undefined }), NOW);
  assert.equal(result?.description, undefined);
  assert.equal(result?.discipline, undefined);
  assert.equal(result?.location, undefined);
});

// --- primaryLive — règle de priorité (§3) -----------------------------------

function publicLive(overrides: Partial<LivePublicData> = {}): LivePublicData {
  return {
    id: "id",
    slug: "slug",
    title: "Titre",
    youtubeVideoId: "abc",
    chatEnabled: false,
    featured: false,
    state: "SCHEDULED",
    controlMode: "AUTOMATED",
    replayEnabled: true,
    ...overrides,
  };
}

test("CAS 1 — un ON_AIR l'emporte toujours, même s'il existe aussi un SCHEDULED ou un REPLAY", () => {
  const onAir = publicLive({ id: "on-air", state: "ON_AIR" });
  const scheduled = publicLive({ id: "scheduled", state: "SCHEDULED" });
  const replay = publicLive({ id: "replay", state: "REPLAY" });
  assert.equal(primaryLive([scheduled, replay, onAir])?.id, "on-air");
});

test("ENDING compte comme priorité 1, au même titre que ON_AIR", () => {
  const ending = publicLive({ id: "ending", state: "ENDING" });
  const scheduled = publicLive({ id: "scheduled", state: "SCHEDULED" });
  assert.equal(primaryLive([scheduled, ending])?.id, "ending");
});

test("CAS 2 — sans ON_AIR, le SCHEDULED/PRELIVE le plus proche dans le temps gagne", () => {
  const loin = publicLive({ id: "loin", state: "SCHEDULED", scheduledStart: "2026-12-01T00:00:00.000Z" });
  const proche = publicLive({ id: "proche", state: "PRELIVE", scheduledStart: "2026-09-25T19:00:00.000Z" });
  assert.equal(primaryLive([loin, proche])?.id, "proche");
});

test("CAS 3 — sans ON_AIR ni futur, le REPLAY le plus récent gagne", () => {
  const ancien = publicLive({ id: "ancien", state: "REPLAY", scheduledStart: "2026-01-01T00:00:00.000Z" });
  const recent = publicLive({ id: "recent", state: "REPLAY", scheduledStart: "2026-09-01T00:00:00.000Z" });
  assert.equal(primaryLive([ancien, recent])?.id, "recent");
});

test("CAS 4 — rien de public : undefined, jamais une page vide fabriquée ici (c'est à la page de décider quoi montrer)", () => {
  assert.equal(primaryLive([]), undefined);
  assert.equal(primaryLive([publicLive({ state: "ARCHIVED" })]), undefined);
});

test("featured départage deux candidats à égalité de priorité et de proximité temporelle", () => {
  const a = publicLive({ id: "a", state: "ON_AIR", featured: false });
  const b = publicLive({ id: "b", state: "ON_AIR", featured: true });
  assert.equal(primaryLive([a, b])?.id, "b");
});

// --- archiveLives / liveFacets -----------------------------------------------

test("archiveLives ne contient que REPLAY et ARCHIVED, triés du plus récent au plus ancien", () => {
  const entries = [
    publicLive({ id: "on-air", state: "ON_AIR" }),
    publicLive({ id: "r1", state: "REPLAY", scheduledStart: "2026-01-01T00:00:00.000Z" }),
    publicLive({ id: "r2", state: "REPLAY", scheduledStart: "2026-06-01T00:00:00.000Z" }),
    publicLive({ id: "arch", state: "ARCHIVED", scheduledStart: "2025-01-01T00:00:00.000Z" }),
  ];
  const archive = archiveLives(entries);
  assert.deepEqual(archive.map((e) => e.id), ["r2", "r1", "arch"]);
});

test("liveFacets ne propose que des valeurs réellement présentes, triées", () => {
  const entries = [
    publicLive({ discipline: "Mode", scheduledStart: "2026-03-01T00:00:00.000Z" }),
    publicLive({ discipline: "Art", scheduledStart: "2025-11-01T00:00:00.000Z" }),
    publicLive({ discipline: undefined, scheduledStart: "2025-11-01T00:00:00.000Z" }),
  ];
  const facets = liveFacets(entries);
  assert.deepEqual(facets.disciplines, ["Art", "Mode"]);
  assert.deepEqual(facets.years, ["2026", "2025"]);
});
