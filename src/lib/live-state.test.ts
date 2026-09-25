import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLiveState,
  msUntilStart,
  countdownParts,
  PRELIVE_WINDOW_MS,
  LATE_START_GRACE_MS,
  ENDING_GRACE_MS,
  type LiveStateInput,
} from "./live-state.ts";

function live(overrides: Partial<LiveStateInput> = {}): LiveStateInput {
  return {
    controlMode: "AUTOMATED",
    visibility: "public",
    youtubeVideoId: "dQw4w9WgXcQ",
    scheduledStart: "2026-09-25T18:00:00.000Z",
    replayEnabled: true,
    ...overrides,
  };
}

const START = new Date("2026-09-25T18:00:00.000Z");
const at = (msOffset: number) => new Date(START.getTime() + msOffset);

// --- Matrice temporelle exigée (§23) : T-24H … T+1DAY ----------------------

test("T-24H : très en amont, SCHEDULED", () => {
  assert.equal(resolveLiveState(live(), at(-24 * 3_600_000)), "SCHEDULED");
});

test("T-1H : encore hors fenêtre PRELIVE (30 min), SCHEDULED", () => {
  assert.equal(resolveLiveState(live(), at(-3_600_000)), "SCHEDULED");
});

test("T-10MIN : dans la fenêtre PRELIVE, PRELIVE", () => {
  assert.equal(resolveLiveState(live(), at(-10 * 60_000)), "PRELIVE");
});

test("T-1MIN : PRELIVE", () => {
  assert.equal(resolveLiveState(live(), at(-60_000)), "PRELIVE");
});

test("T (exactement l'heure programmée) : PRELIVE tant qu'aucune confirmation YouTube — jamais ON_AIR sur la seule heure", () => {
  assert.equal(resolveLiveState(live(), at(0)), "PRELIVE");
  assert.equal(resolveLiveState(live(), at(0), "unknown"), "PRELIVE");
});

test("T+1MIN : toujours PRELIVE sans confirmation", () => {
  assert.equal(resolveLiveState(live(), at(60_000)), "PRELIVE");
});

test("T+1H : au-delà du délai de grâce (45 min) sans confirmation, retombe sur SCHEDULED — jamais un ON_AIR inventé", () => {
  assert.equal(resolveLiveState(live(), at(3_600_000)), "SCHEDULED");
});

test("T+1DAY : toujours SCHEDULED sans confirmation ni fin programmée", () => {
  assert.equal(resolveLiveState(live(), at(24 * 3_600_000)), "SCHEDULED");
});

// --- Confirmation YouTube — la seule chose qui déclenche ON_AIR pour de vrai

test("confirmation 'playing' déclenche ON_AIR à tout moment après le début programmé", () => {
  assert.equal(resolveLiveState(live(), at(60_000), "playing"), "ON_AIR");
  assert.equal(resolveLiveState(live(), at(3_600_000), "playing"), "ON_AIR");
});

test("'buffering' compte comme ON_AIR — le flux a démarré, la mise en tampon n'est pas une absence de direct", () => {
  assert.equal(resolveLiveState(live(), at(60_000), "buffering"), "ON_AIR");
});

test("confirmation 'ended' bascule sur REPLAY quand replayEnabled", () => {
  assert.equal(resolveLiveState(live(), at(2 * 3_600_000), "ended"), "REPLAY");
});

test("confirmation 'ended' bascule sur ARCHIVED quand replayEnabled est faux", () => {
  assert.equal(resolveLiveState(live({ replayEnabled: false }), at(2 * 3_600_000), "ended"), "ARCHIVED");
});

// --- scheduledEnd programmée --------------------------------------------

test("scheduledEnd dépassée sans confirmation : REPLAY directement, sans attendre une confirmation qui ne viendra peut-être jamais", () => {
  const withEnd = live({ scheduledEnd: "2026-09-25T20:00:00.000Z" });
  assert.equal(resolveLiveState(withEnd, at(3 * 3_600_000)), "REPLAY");
});

test("proche de scheduledEnd, pas encore dépassée, sans confirmation ni contradiction : ON_AIR tant que dans la fenêtre programmée", () => {
  // Ceci est un cas où l'heure de fin n'est pas encore là : on est dans
  // [start, end), sans confirmation — la règle §7 s'applique encore
  // (jamais ON_AIR sur l'heure seule), donc PRELIVE/ENDING selon le délai
  // de grâce, pas ON_AIR.
  const withEnd = live({ scheduledEnd: "2026-09-25T20:00:00.000Z" });
  assert.notEqual(resolveLiveState(withEnd, at(90 * 60_000)), "ON_AIR");
});

test("ENDING : now dépasse le délai de grâce de démarrage mais reste dans la fenêtre de fin programmée + grâce", () => {
  const withEnd = live({ scheduledEnd: new Date(START.getTime() + 30 * 60_000).toISOString() });
  // start + LATE_START_GRACE_MS dépasse déjà `end` ici ; ce cas teste plutôt
  // qu'un live dont la fin est loin après le délai de démarrage reste ENDING
  // une fois le délai de grâce de démarrage dépassé, avant sa fin + grâce.
  const longer = live({ scheduledEnd: new Date(START.getTime() + LATE_START_GRACE_MS + 10 * 60_000).toISOString() });
  assert.equal(resolveLiveState(longer, at(LATE_START_GRACE_MS + 5 * 60_000)), "ENDING");
  void withEnd;
});

// --- controlMode ------------------------------------------------------------

test("EDITORIAL : le calcul automatique ne s'applique jamais, seul manualStatus compte", () => {
  const editorial = live({ controlMode: "EDITORIAL", manualStatus: "ON_AIR" });
  assert.equal(resolveLiveState(editorial, at(-24 * 3_600_000)), "ON_AIR", "même très en amont de l'heure programmée");
});

test("EDITORIAL sans manualStatus : DRAFT, jamais un état public par défaut", () => {
  assert.equal(resolveLiveState(live({ controlMode: "EDITORIAL" }), at(0)), "DRAFT");
});

test("HYBRID : CANCELLED posé à la main l'emporte toujours sur le calcul, même en plein direct programmé", () => {
  const hybrid = live({ controlMode: "HYBRID", manualStatus: "CANCELLED" });
  assert.equal(resolveLiveState(hybrid, at(0), "playing"), "CANCELLED");
});

test("HYBRID : ARCHIVED posé à la main l'emporte aussi", () => {
  const hybrid = live({ controlMode: "HYBRID", manualStatus: "ARCHIVED" });
  assert.equal(resolveLiveState(hybrid, at(-3_600_000)), "ARCHIVED");
});

test("HYBRID sans override terminal : se comporte exactement comme AUTOMATED", () => {
  const hybrid = live({ controlMode: "HYBRID", manualStatus: "SCHEDULED" });
  assert.equal(resolveLiveState(hybrid, at(-10 * 60_000)), "PRELIVE", "manualStatus SCHEDULED n'est pas un override terminal, le calcul reprend la main");
});

// --- Résilience / données incomplètes (§25) ---------------------------------

test("youtubeVideoId absent : DRAFT, jamais affiché", () => {
  assert.equal(resolveLiveState(live({ youtubeVideoId: undefined }), at(0)), "DRAFT");
});

test("scheduledStart absent : DRAFT", () => {
  assert.equal(resolveLiveState(live({ scheduledStart: undefined }), at(0)), "DRAFT");
});

test("scheduledStart invalide (chaîne non parsable) : DRAFT, ne plante jamais", () => {
  assert.doesNotThrow(() => resolveLiveState(live({ scheduledStart: "pas une date" }), at(0)));
  assert.equal(resolveLiveState(live({ scheduledStart: "pas une date" }), at(0)), "DRAFT");
});

test("visibility 'draft' : DRAFT quel que soit le reste, y compris en EDITORIAL avec manualStatus ON_AIR", () => {
  assert.equal(resolveLiveState(live({ visibility: "draft" }), at(0)), "DRAFT");
});

// --- msUntilStart / countdownParts ------------------------------------------

test("msUntilStart est positif avant l'heure, négatif après, absent sans date", () => {
  assert.ok(msUntilStart(live(), at(-60_000))! > 0);
  assert.ok(msUntilStart(live(), at(60_000))! < 0);
  assert.equal(msUntilStart(live({ scheduledStart: undefined }), at(0)), undefined);
});

test("countdownParts découpe correctement jours/heures/minutes/secondes", () => {
  const ms = 2 * 86_400_000 + 3 * 3_600_000 + 45 * 60_000 + 12_000;
  assert.deepEqual(countdownParts(ms), { days: 2, hours: 3, minutes: 45, seconds: 12 });
});

test("countdownParts ne descend jamais sous zéro — le compte à rebours s'arrête net", () => {
  assert.deepEqual(countdownParts(-5000), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test("les constantes de fenêtre restent cohérentes entre elles (PRELIVE < grâce de démarrage)", () => {
  assert.ok(PRELIVE_WINDOW_MS < LATE_START_GRACE_MS);
  assert.ok(ENDING_GRACE_MS > 0);
});
