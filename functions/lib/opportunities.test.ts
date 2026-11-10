import { test } from "node:test";
import assert from "node:assert/strict";
import { closedNow, parseOpportunityPath, shouldShow } from "./opportunities.ts";

const DEADLINE = "2026-12-01T22:59:59.000Z";

test("passerelle : en ligne = ouverte jusqu'à la date limite incluse, puis clôturée d'elle-même", () => {
  assert.equal(closedNow("published", DEADLINE, Date.parse("2026-12-01T22:59:00Z")), false);
  assert.equal(closedNow("published", DEADLINE, Date.parse("2026-12-01T23:00:00Z")), true);
});

test("passerelle : clôturée, archivée, statut ou date illisible → clôturée", () => {
  assert.equal(closedNow("closed", DEADLINE, 0), true);
  assert.equal(closedNow("archived", DEADLINE, 0), true);
  assert.equal(closedNow(null, DEADLINE, 0), true);
  assert.equal(closedNow("published", null, 0), true);
  assert.equal(closedNow("published", "pas une date", 0), true);
});

test("passerelle : seuls les blocs open/closed sont pilotés à la requête", () => {
  assert.equal(shouldShow("open", { closed: false }), true);
  assert.equal(shouldShow("closed", { closed: false }), false);
  assert.equal(shouldShow("closed", { closed: true }), true);
  assert.equal(shouldShow("verified", { closed: true }), null);
  assert.equal(shouldShow("pending", { closed: false }), null);
});

test("passerelle : chemins", () => {
  assert.deepEqual(parseOpportunityPath("/opportunities/"), { lang: "fr", slug: undefined });
  assert.deepEqual(parseOpportunityPath("/en/opportunities/zedefile-2027/"), { lang: "en", slug: "zedefile-2027" });
  assert.equal(parseOpportunityPath("/opportunities/a/b/"), null);
  assert.equal(parseOpportunityPath("/journal/"), null);
});
