import { test } from "node:test";
import assert from "node:assert/strict";
import { isKnownOpportunity, isOpportunityStatus, parseOpportunityPath, publicState, shouldShow, type OpportunityRow } from "./opportunities.ts";
import { OPPORTUNITIES } from "../../src/data/opportunities.ts";

const row = (status: OpportunityRow["status"], verified = 0): OpportunityRow => ({ slug: "zedefile-2027", status, organizer_verified: verified, updated_at: "x" });
const BEFORE = Date.parse("2026-11-10T12:00:00+01:00");
const AFTER = Date.parse("2026-12-02T00:00:01+01:00");

test("opportunités : brouillon, vérification, ligne absente ou slug inconnu → non servie", () => {
  assert.equal(publicState("zedefile-2027", row("draft"), BEFORE), null);
  assert.equal(publicState("zedefile-2027", row("review"), BEFORE), null);
  assert.equal(publicState("zedefile-2027", undefined, BEFORE), null);
  assert.equal(publicState("inconnue", row("published"), BEFORE), null);
});

test("opportunités : publiée = ouverte jusqu'à la date limite incluse, puis clôturée d'elle-même", () => {
  assert.deepEqual(publicState("zedefile-2027", row("published"), BEFORE), { closed: false, verified: false });
  assert.deepEqual(publicState("zedefile-2027", row("published"), Date.parse("2026-12-01T23:59:00+01:00")), { closed: false, verified: false });
  assert.deepEqual(publicState("zedefile-2027", row("published"), AFTER), { closed: true, verified: false });
  assert.deepEqual(publicState("zedefile-2027", row("closed", 1), BEFORE), { closed: true, verified: true });
});

test("opportunités : blocs data-when", () => {
  const open = { closed: false, verified: false };
  assert.equal(shouldShow("open", open), true);
  assert.equal(shouldShow("closed", open), false);
  assert.equal(shouldShow("pending", open), true);
  assert.equal(shouldShow("verified", open), false);
  assert.equal(shouldShow("verified", { closed: true, verified: true }), true);
});

test("opportunités : chemins et validations", () => {
  assert.deepEqual(parseOpportunityPath("/opportunities/"), { lang: "fr", slug: undefined });
  assert.deepEqual(parseOpportunityPath("/en/opportunities/zedefile-2027/"), { lang: "en", slug: "zedefile-2027" });
  assert.equal(parseOpportunityPath("/opportunities/a/b/"), null);
  assert.equal(isOpportunityStatus("published"), true);
  assert.equal(isOpportunityStatus("verified"), false);
  assert.equal(isKnownOpportunity("zedefile-2027"), true);
  assert.equal(isKnownOpportunity("../x"), false);
});

test("opportunités : contenu — FR/EN complets, jamais la raison sociale, aucune mention chiffrée inventée", () => {
  for (const o of OPPORTUNITIES) {
    assert.equal(o.broadcastPartner, "WEBLACK");
    assert.ok(!Number.isNaN(Date.parse(o.deadline)));
    for (const lang of ["fr", "en"] as const) {
      const all = JSON.stringify(o.text[lang]);
      assert.ok(!/WEBLACK AFRICA/i.test(all));
      assert.ok(!/[€$]/.test(all), "aucun montant");
      assert.equal(o.text[lang].documents.length, 4);
    }
  }
});
