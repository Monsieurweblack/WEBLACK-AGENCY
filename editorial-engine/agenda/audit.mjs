#!/usr/bin/env node
// Audit réel du stock Sanity `event` — lecture seule, aucune écriture.
// Usage: node --experimental-strip-types editorial-engine/agenda/audit.mjs
import { getSanityClient } from "../sanity/client.ts";

const client = getSanityClient();

const docs = await client.fetch(`*[_type == "event"]{
  _id, eventName, slug, startDate, endDate, venue, city, country,
  officialUrl, sourceUrls, verificationStatus, status, lastVerifiedAt,
  engineId, territory, editorialRelevance, editorialValue
} | order(startDate asc)`);

const today = new Date().toISOString().slice(0, 10);

function computeStatus(startDate, endDate) {
  const start = startDate || endDate;
  const end = endDate || startDate;
  if (!start) return "EXPIRED";
  if (end < today) return "EXPIRED";
  if (start > today) return "UPCOMING";
  return "ONGOING";
}

const staleActive = [];
const cancelled = [];
const review = [];
const invalid = [];
const byIdentity = new Map();
const dupes = [];

for (const d of docs) {
  const computed = computeStatus(d.startDate, d.endDate);
  const isVerified = d.verificationStatus === "VERIFIED";
  const isPublishedActive = d.status === "UPCOMING" || d.status === "ONGOING";

  if (d.verificationStatus === "CANCELLED") cancelled.push(d);
  else if (!isVerified) review.push(d);
  else if (computed === "EXPIRED" && isPublishedActive) staleActive.push(d);

  if (!d.eventName || !d.startDate || !d.city) invalid.push(d);

  const key = d.engineId || `${(d.eventName || "").toLowerCase().trim()}|${(d.venue || d.city || "").toLowerCase().trim()}|${d.startDate}`;
  if (byIdentity.has(key)) dupes.push({ key, a: byIdentity.get(key)._id, b: d._id, eventName: d.eventName });
  else byIdentity.set(key, d);
}

console.log(`TOTAL DOCUMENTS: ${docs.length}  (today=${today})\n`);

console.log(`-- ÉCART status publié vs date réelle : VERIFIED + calcul EXPIRED mais status encore actif (${staleActive.length}) --`);
for (const d of staleActive) console.log(`  [${d._id}] "${d.eventName}" ${d.startDate}->${d.endDate || "?"} status=${d.status} city=${d.city}`);

console.log(`\n-- CANCELLED (${cancelled.length}) --`);
for (const d of cancelled) console.log(`  [${d._id}] "${d.eventName}"`);

console.log(`\n-- REVIEW / non-VERIFIED (${review.length}) --`);
for (const d of review) console.log(`  [${d._id}] "${d.eventName}" verificationStatus=${d.verificationStatus} status=${d.status}`);

console.log(`\n-- INVALID — champ essentiel manquant (${invalid.length}) --`);
for (const d of invalid) console.log(`  [${d._id}] eventName="${d.eventName}" startDate="${d.startDate}" city="${d.city}"`);

console.log(`\n-- DOUBLONS POSSIBLES par identité (${dupes.length}) --`);
for (const dup of dupes) console.log(`  ${dup.a} <-> ${dup.b}  "${dup.eventName}"`);

console.log(`\n-- DÉTAIL COMPLET --`);
for (const d of docs) {
  const computed = computeStatus(d.startDate, d.endDate);
  console.log(`  [${d._id}] ver=${d.verificationStatus} pub=${d.status} calc=${computed} "${d.eventName}" ${d.startDate}->${d.endDate || "?"} @ ${d.city} (rel=${d.editorialRelevance} terr=${d.territory})`);
}
