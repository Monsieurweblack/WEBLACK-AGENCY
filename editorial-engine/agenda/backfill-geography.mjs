#!/usr/bin/env node
// Backfill réel : geographicPriority / controlMode / timezone sur les
// documents `event` déjà en Sanity, écrits avant l'introduction de ces
// champs. Dérivé uniquement de la ville/du pays déjà vérifiés — jamais une
// nouvelle affirmation, seulement l'application mécanique de la même règle
// géographique que verify.ts applique aux nouvelles découvertes.
//
// AFRO_DIASPORA n'est JAMAIS assigné ici : cette classification exige une
// justification lue sur la page (voir resolveGeographicPriority), que ce
// script ne relit pas. Un événement hors d'Afrique reste donc INTERNATIONAL
// tant qu'une re-vérification réelle ne l'a pas classé autrement — c'est la
// même prudence que le filet de sécurité du moteur : en l'absence de preuve
// écrite, jamais de lien africain supposé.
import { getSanityClient } from "../sanity/client.ts";
import { cityPriorityHint, timezoneForCity } from "./geography.ts";

const client = getSanityClient();
const docs = await client.fetch(`*[_type == "event" && !defined(geographicPriority)]{ _id, city, eventName }`);

console.log(`${docs.length} document(s) sans geographicPriority.\n`);

let africa = 0;
let international = 0;

for (const doc of docs) {
  const hint = cityPriorityHint(doc.city ?? "");
  const geographicPriority = hint === "AFRICA" ? "AFRICA" : "INTERNATIONAL";
  const timezone = timezoneForCity(doc.city ?? "");
  if (geographicPriority === "AFRICA") africa++; else international++;

  await client
    .patch(doc._id)
    .setIfMissing({ controlMode: "AUTOMATED" })
    .set({ geographicPriority, ...(timezone ? { timezone } : {}) })
    .commit();
  console.log(`  [${doc._id}] "${doc.eventName}" @ ${doc.city} -> ${geographicPriority}${timezone ? ` (${timezone})` : ""}`);
}

console.log(`\nAFRICA: ${africa}  INTERNATIONAL: ${international}`);
console.log(`Note : AFRO_DIASPORA jamais assigné par ce backfill — exige une justification que seule une re-vérification réelle de la page peut établir.`);
