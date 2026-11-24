/**
 * Base de connaissances MALYA.
 *
 * Règle absolue (CLAUDE.md, discipline de non-fabrication) : rien n'entre ici
 * sans source, date, niveau de fiabilité et provenance. Le jeu de départ ne
 * contient QUE des faits fournis par le fondateur dans le brief du projet ou
 * déjà publiés sur weblack.fr. Les domaines sectoriels du brief MALYA (mode
 * internationale, luxe, marchés, fashion weeks…) sont déclarés dans la
 * taxonomie mais restent VIDES tant qu'aucune source primaire n'a été
 * ingérée : MALYA répond alors qu'elle n'a pas de connaissance vérifiée,
 * plutôt que d'inventer.
 */
import type { Citation, KnowledgeEntry, Lang, Reliability } from "./types.ts";

export const DOMAINS = [
  "weblack",
  "mode-internationale-africaine",
  "haute-couture-pret-a-porter",
  "luxe-maisons",
  "createurs-designers",
  "mannequinat",
  "fashion-business",
  "direction-artistique-communication",
  "branding-strategie",
  "evenementiel-defiles",
  "salons-fashion-weeks",
  "marches-internationaux-africains",
  "partenariats-institutions-sponsoring",
  "industries-creatives",
] as const;

const BRIEF = { label: "Brief WEBLACK (fondateur)", kind: "owner-brief" as const };
const INGESTED = "2026-11-24";
const PROVENANCE = "Fourni par le fondateur dans le brief du projet ; repris sans modification de sens le 2026-11-24.";

export const SEED: KnowledgeEntry[] = [
  {
    id: "weblack-identite",
    domain: "weblack",
    title: { fr: "WEBLACK, agence créative", en: "WEBLACK, a creative agency" },
    text: {
      fr: "WEBLACK est une agence créative indépendante et internationale, fondée en 2010 par Deo-Gratias Kpodo (Founder & Creative Director). Elle relie talents, vision créative et pertinence culturelle pour construire des opportunités qui comptent, pour les marques comme pour les personnes.",
      en: "WEBLACK is an independent, international creative agency founded in 2010 by Deo-Gratias Kpodo (Founder & Creative Director). It connects talent, creative vision and cultural relevance to build opportunities that matter, for brands and people alike.",
    },
    keywords: ["weblack", "agence", "agency", "fondee", "founded", "2010", "fondateur", "founder", "kpodo", "qui", "who", "about", "propos"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "weblack-vision",
    domain: "weblack",
    title: { fr: "Vision africaine et afro-descendante", en: "African and Afro-descendant vision" },
    text: {
      fr: "WEBLACK porte une vision africaine et afro-descendante, tournée vers l'international : de l'Afrique vers le monde. C'est une origine culturelle et un point de vue créatif assumés, pas une restriction d'audience ni de marché : l'agence travaille avec des marques, des institutions et des talents partout.",
      en: "WEBLACK carries an African and Afro-descendant vision, turned toward the world: from Africa to the world. It is a cultural origin and a creative point of view, not a restriction of audience or market: the agency works with brands, institutions and talent everywhere.",
    },
    keywords: ["vision", "afrique", "africa", "african", "africaine", "afro", "international", "monde", "world", "positionnement", "positioning"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "division-talent",
    domain: "weblack",
    title: { fr: "Division Talent", en: "Talent division" },
    text: {
      fr: "Talent : management, représentation et développement de talents (mannequins, créateurs, artistes, photographes, stylistes…). Les candidatures se déposent sur la page Talent du site.",
      en: "Talent: management, representation and development of talent (models, designers, artists, photographers, stylists…). Applications are submitted on the Talent page of the site.",
    },
    keywords: ["talent", "talents", "mannequin", "model", "management", "representation", "candidature", "application", "photographe", "photographer", "styliste", "stylist", "artiste", "artist", "createur", "designer"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "division-creative",
    domain: "weblack",
    title: { fr: "Division Creative", en: "Creative division" },
    text: {
      fr: "Creative : direction créative, campagnes, production de contenu, mode, événements.",
      en: "Creative: creative direction, campaigns, content production, fashion, events.",
    },
    keywords: ["creative", "creatif", "direction", "campagne", "campaign", "contenu", "content", "production", "mode", "fashion", "evenement", "event", "evenementiel", "defile", "show"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "division-consulting",
    domain: "weblack",
    title: { fr: "Division Consulting", en: "Consulting division" },
    text: {
      fr: "Consulting : stratégie de marque, positionnement, intelligence culturelle.",
      en: "Consulting: brand strategy, positioning, cultural intelligence.",
    },
    keywords: ["consulting", "conseil", "strategie", "strategy", "marque", "brand", "positionnement", "positioning", "intelligence", "culturelle", "cultural", "branding"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "methode-perspective",
    domain: "weblack",
    title: { fr: "Méthode WEBLACK Perspective", en: "The WEBLACK Perspective method" },
    text: {
      fr: "WEBLACK Perspective suit cinq temps : Potential → Talent → Value → Opportunity → Impact. Il s'agit d'identifier, développer, structurer, connecter et construire une pertinence durable. C'est la seule méthode institutionnelle de WEBLACK.",
      en: "WEBLACK Perspective follows five stages: Potential → Talent → Value → Opportunity → Impact. It means identifying, developing, structuring, connecting and building lasting relevance. It is WEBLACK's only institutional method.",
    },
    keywords: ["methode", "method", "perspective", "potential", "value", "opportunity", "impact", "approche", "approach", "demarche", "process"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "collaborations-verifiees",
    domain: "weblack",
    title: { fr: "Collaborations vérifiées", en: "Verified collaborations" },
    text: {
      fr: "Collaborations réelles et vérifiées : ZÉ DÉFILÉ by WAXFASHION (Paris), Nuit du Textile Africain / NTA (Bamako), Carrousel International de la Mode (République du Congo).",
      en: "Real, verified collaborations: ZÉ DÉFILÉ by WAXFASHION (Paris), Nuit du Textile Africain / NTA (Bamako), Carrousel International de la Mode (Republic of the Congo).",
    },
    keywords: ["collaboration", "collaborations", "references", "reference", "clients", "projets", "projects", "ze", "defile", "waxfashion", "nta", "nuit", "textile", "bamako", "carrousel", "congo", "paris", "realisations", "work"],
    source: BRIEF, verifiedAt: INGESTED, reliability: "verified", provenance: PROVENANCE,
  },
  {
    id: "opportunite-zedefile-2027",
    domain: "weblack",
    title: { fr: "Opportunité ZEDEFILE 2027", en: "ZEDEFILE 2027 opportunity" },
    text: {
      fr: "Une annonce ZEDEFILE 2027 est publiée sur la page Opportunities de WEBLACK ; la date limite de candidature affichée est le 1er décembre 2026. L'organisateur n'a pas encore confirmé l'annonce et le mandat de diffusion : elle n'est donc pas présentée comme vérifiée par l'organisateur.",
      en: "A ZEDEFILE 2027 listing is published on WEBLACK's Opportunities page; the application deadline shown is 1 December 2026. The organizer has not yet confirmed the listing or the broadcast mandate, so it is not presented as organizer-verified.",
    },
    keywords: ["zedefile", "opportunite", "opportunities", "opportunity", "candidature", "deadline", "date", "limite", "2027", "appel", "call", "postuler", "apply"],
    source: { label: "Page Opportunities — weblack.fr", kind: "primary", url: "https://weblack.fr/opportunities/zedefile-2027/" },
    verifiedAt: INGESTED, reliability: "verified",
    provenance: "Annonce publiée sur weblack.fr (source Sanity) ; organisateur non confirmé à la date de reprise.",
  },
];

/** Contrôle d'ingestion : toute entrée sans traçabilité complète est refusée. */
export function validateEntry(entry: Partial<KnowledgeEntry>): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const reliabilities: Reliability[] = ["verified", "historical", "estimate", "hypothesis"];
  if (!entry.id) reasons.push("id manquant");
  if (!entry.domain || !(DOMAINS as readonly string[]).includes(entry.domain)) reasons.push("domaine inconnu");
  if (!entry.title?.fr || !entry.title?.en) reasons.push("titre FR/EN manquant");
  if (!entry.text?.fr || !entry.text?.en) reasons.push("texte FR/EN manquant");
  if (!entry.source?.label || !entry.source?.kind) reasons.push("source manquante");
  if (!entry.verifiedAt || !/^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedAt)) reasons.push("date de vérification invalide");
  if (!entry.reliability || !reliabilities.includes(entry.reliability)) reasons.push("niveau de fiabilité invalide");
  if (!entry.provenance || entry.provenance.trim().length < 10) reasons.push("provenance manquante");
  if (entry.reliability === "verified" && entry.source && !entry.source.url && entry.source.kind !== "owner-brief") {
    reasons.push("une information « verified » hors brief du fondateur doit citer une URL de source");
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ");
}

const STOP = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "the", "of", "and", "a", "to", "is", "est", "pour", "avec", "sur", "que", "qui", "quoi", "comment", "what", "how", "you", "vous", "je", "ce", "cet", "ces", "au", "aux", "dans", "mon", "ma", "mes"]);

export function tokens(text: string): string[] {
  return normalize(text).split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
}

export interface Retrieved {
  entry: KnowledgeEntry;
  score: number;
}

export function retrieve(query: string, entries: KnowledgeEntry[] = SEED, limit = 3): Retrieved[] {
  const q = new Set(tokens(query));
  if (q.size === 0) return [];
  const scored = entries.map((entry) => {
    let score = 0;
    for (const k of entry.keywords) if (q.has(normalize(k).trim())) score += 3;
    for (const w of tokens(entry.title.fr + " " + entry.title.en)) if (q.has(w)) score += 2;
    return { entry, score };
  });
  return scored.filter((s) => s.score >= 3).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function toCitation(entry: KnowledgeEntry, lang: Lang): Citation {
  return {
    id: entry.id,
    title: entry.title[lang],
    source: entry.source.label,
    ...(entry.source.url ? { url: entry.source.url } : {}),
    verifiedAt: entry.verifiedAt,
    reliability: entry.reliability,
  };
}

/** Couverture par domaine : sert au rapport et au refus honnête de répondre. */
export function coverage(entries: KnowledgeEntry[] = SEED): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(DOMAINS.map((d) => [d, 0]));
  for (const e of entries) out[e.domain] = (out[e.domain] ?? 0) + 1;
  return out;
}
