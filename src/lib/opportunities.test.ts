import { test } from "node:test";
import assert from "node:assert/strict";
import { isClosed, normalizeOpportunity } from "./opportunities.ts";

const T = { projectId: "pzpm4xjp", dataset: "production" };
const img = (id: string, w = 1080, h = 1350) => ({ _type: "opportunityImage", asset: { _ref: `image-${id}-${w}x${h}-jpg` }, altFr: "Affiche officielle de test, version violette", altEn: "Official test poster, purple version" });

/** Document complet, au format renvoyé par OPPORTUNITY_PROJECTION. */
const full = () => ({
  _id: "opportunity-test",
  status: "published",
  slug: "appel-test-2027",
  deadline: "2026-12-01T22:59:00.000Z",
  discipline: "fashion",
  profiles: ["designer"],
  titleFr: "Appel test — Appel à candidatures",
  titleEn: "Test call — Call for applications",
  summaryFr: "Résumé.",
  summaryEn: "Summary.",
  locationFr: "Paris, France",
  locationEn: "Paris, France",
  eventDateFr: "Avril 2027",
  eventDateEn: "April 2027",
  introFr: ["Paragraphe."],
  introEn: ["Paragraph."],
  criteriaFr: ["Critère."],
  criteriaEn: ["Criterion."],
  documentsFr: ["Pièce 1.", "Pièce 2."],
  documentsEn: ["Doc 1.", "Doc 2."],
  conditionsFr: "Conditions sur demande.",
  conditionsEn: "Terms on request.",
  mainImage: img("a1b2"),
  imageCredit: "© Organisateur",
  galleries: [{ _key: "g1", titleFr: "Visuels", titleEn: "Visuals", images: [img("c3d4"), { asset: { _ref: "image-e5f6-800x600-jpg" } }] }],
  contactEmail: "contact@example.org",
  contactPhones: [{ label: "+33 7 00 00 00 00", tel: "+33700000000" }, { label: "mauvais", tel: "07 00" }],
  organizerName: "Organisateur",
  organizerUrl: "https://example.org/",
  sourceUrl: "https://example.org/appel",
  lastVerifiedAt: "2026-11-10",
  organizerVerified: false,
});

test("opportunité complète : normalisée, catégorie dérivée, image CDN Sanity, OG 1200×630", () => {
  const r = normalizeOpportunity(full(), T);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const o = r.opportunity;
  assert.equal(o.text.fr.category, "Mode · Designers");
  assert.equal(o.text.en.category, "Fashion · Designers");
  assert.equal(o.image?.src, "https://cdn.sanity.io/images/pzpm4xjp/production/a1b2-1080x1350.jpg");
  assert.equal(o.image?.width, 1080);
  assert.match(o.ogImage ?? "", /\?w=1200&h=630&fit=fill&bg=0A0A0A/);
  assert.equal(o.broadcastPartner, "WEBLACK");
  assert.deepEqual(o.contact.phones, [{ label: "+33 7 00 00 00 00", tel: "+33700000000" }], "numéro mal formé écarté");
  assert.equal(o.galleries[0].items.length, 1, "image sans texte alternatif écartée");
  assert.equal(o.organizerVerified, false);
});

test("brouillon / en vérification / statut absent : jamais affichée", () => {
  for (const status of ["review", undefined, "draft"]) {
    const r = normalizeOpportunity({ ...full(), status }, T);
    assert.equal(r.ok, false);
  }
});

test("slug manquant ou invalide, contenu incomplet : écartée avec les raisons", () => {
  const noSlug = normalizeOpportunity({ ...full(), slug: undefined }, T);
  assert.equal(noSlug.ok, false);
  assert.ok(!noSlug.ok && noSlug.reasons.includes("slug manquant ou invalide"));
  const badSlug = normalizeOpportunity({ ...full(), slug: "Avec Espaces" }, T);
  assert.equal(badSlug.ok, false);
  const incomplete = normalizeOpportunity({ ...full(), titleEn: "", documentsFr: [], deadline: "demain" }, T);
  assert.equal(incomplete.ok, false);
  assert.ok(!incomplete.ok && incomplete.reasons.some((x) => x.startsWith("titre (en)")) && incomplete.reasons.some((x) => x.startsWith("pièces à fournir (fr)")) && incomplete.reasons.some((x) => x.startsWith("date limite")));
  const noContact = normalizeOpportunity({ ...full(), contactEmail: "pas-un-email" }, T);
  assert.equal(noContact.ok, false);
});

test("clôture : manuelle, archivée, ou date limite passée", () => {
  const r = normalizeOpportunity(full(), T);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(isClosed(r.opportunity, Date.parse("2026-11-10T00:00:00Z")), false);
  assert.equal(isClosed(r.opportunity, Date.parse("2026-12-02T00:00:00Z")), true);
  const closed = normalizeOpportunity({ ...full(), status: "closed" }, T);
  assert.ok(closed.ok && isClosed(closed.opportunity, 0));
  const archived = normalizeOpportunity({ ...full(), status: "archived" }, T);
  assert.ok(archived.ok && archived.opportunity.status === "archived" && isClosed(archived.opportunity, 0));
});

test("sans visuel : publiable, sans image de partage dédiée", () => {
  const r = normalizeOpportunity({ ...full(), mainImage: undefined, galleries: undefined }, T);
  assert.ok(r.ok && !r.opportunity.image && !r.opportunity.ogImage && r.opportunity.galleries.length === 0);
});
