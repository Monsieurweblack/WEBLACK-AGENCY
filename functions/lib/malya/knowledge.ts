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
import { CORPUS } from "./corpus.ts";
import { detectInjection } from "./safety.ts";

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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    source: BRIEF, author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified", provenance: PROVENANCE,
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
    author: "WEBLACK (Deo-Gratias Kpodo)", consultedAt: INGESTED, verifiedAt: INGESTED, nextReviewAt: "2027-05-24", lang: "fr", validation: "human-validated", reliability: "verified",
    provenance: "Annonce publiée sur weblack.fr (source Sanity) ; organisateur non confirmé à la date de reprise.",
  },
];

/** Contrôle d'ingestion : toute entrée sans traçabilité complète est refusée. */
export function validateEntry(entry: Partial<KnowledgeEntry>): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const reliabilities: Reliability[] = ["verified", "historical", "estimate", "hypothesis"];
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (!entry.id) reasons.push("id manquant");
  if (!entry.domain || !(DOMAINS as readonly string[]).includes(entry.domain)) reasons.push("domaine inconnu");
  if (!entry.title?.fr || !entry.title?.en) reasons.push("titre FR/EN manquant");
  if (!entry.text?.fr || !entry.text?.en) reasons.push("texte FR/EN manquant");
  if (!entry.source?.label || !entry.source?.kind) reasons.push("source manquante");
  if (!entry.author) reasons.push("auteur ou institution manquant");
  if (entry.publishedAt !== undefined && !isDate(entry.publishedAt)) reasons.push("date de publication invalide");
  if (!isDate(entry.consultedAt)) reasons.push("date de consultation invalide");
  if (!isDate(entry.verifiedAt)) reasons.push("date de vérification invalide");
  if (!isDate(entry.nextReviewAt)) reasons.push("date de révision invalide");
  if (!entry.lang || !["fr", "en"].includes(entry.lang)) reasons.push("langue invalide");
  if (!entry.validation || !["draft", "machine-checked", "human-validated"].includes(entry.validation)) reasons.push("statut de validation invalide");
  if (!entry.reliability || !reliabilities.includes(entry.reliability)) reasons.push("niveau de fiabilité invalide");
  if (!entry.provenance || entry.provenance.trim().length < 10) reasons.push("provenance manquante");
  if (!entry.keywords || entry.keywords.length === 0) reasons.push("mots-clés manquants");
  if (entry.reliability === "verified" && entry.source && !entry.source.url && entry.source.kind !== "owner-brief") {
    reasons.push("une information « verified » hors brief du fondateur doit citer une URL de source");
  }
  if (entry.reliability === "verified" && entry.validation === "draft") reasons.push("un brouillon ne peut pas être « verified »");
  // Un document est une donnée : on refuse à l'ingestion tout contenu qui ressemble à une instruction (injection indirecte).
  if (entry.text && (detectInjection(entry.text.fr ?? "") || detectInjection(entry.text.en ?? ""))) reasons.push("le texte contient un motif d'instruction (injection indirecte)");
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "the", "of", "and", "a", "to", "is", "est", "pour", "avec", "sur", "que", "qui", "quoi", "comment", "what", "how", "you", "vous", "je", "ce", "cet", "ces", "au", "aux", "dans", "mon", "ma", "mes", "quel", "quelle", "quels", "quelles", "which", "are", "sont", "il", "elle", "ils", "d", "l", "s", "n", "c", "qu", "me", "moi", "tu", "ton", "ta", "plus", "tres", "very", "about", "parle", "tell", "dis",
  // verbes et mots-outils courants : ne comptent pas comme « concepts » d'une question
  "has", "have", "had", "do", "does", "did", "run", "ran", "can", "could", "would", "should", "will", "there", "their", "your", "yours", "an", "at", "by", "for", "from", "into", "on", "be", "been", "was", "were", "give", "get", "make", "need", "want", "like", "know", "use", "any", "some", "this", "that", "these", "those", "with", "not", "no", "yes", "please", "who", "whom", "when", "where", "why", "also", "just",
  "ont", "avez", "avons", "fait", "faire", "etre", "sont", "peut", "peux", "peuvent", "veux", "veut", "voudrais", "souhaite", "besoin", "avoir", "tout", "tous", "toute", "toutes", "cette", "cela", "ceci", "ici", "ca", "merci", "svp", "est", "es", "suis", "sois", "par", "ou", "mais", "donc", "car", "si", "ne", "pas", "non", "oui"]);

/** Synonymes FR/EN : une requête dans une langue retrouve une source dans l'autre. */
const SYNONYMS: string[][] = [
  ["mode", "fashion"], ["luxe", "luxury"], ["defile", "show", "runway", "catwalk"], ["createur", "designer", "creator"],
  ["couture", "haute couture"], ["maison", "maisons", "house", "houses"], ["propriete intellectuelle", "intellectual property", "ompi", "wipo"],
  ["marque", "trademark", "brand"], ["ecole", "school", "formation", "training", "education"], ["mannequin", "model", "mannequinat", "modeling"],
  ["calendrier", "calendar", "dates"], ["africaine", "african", "afrique", "africa"], ["semaine de la mode", "semaines de la mode", "fashion week", "fashion weeks"],
  ["partenariat", "partnership", "sponsoring", "sponsorship"], ["durabilite", "sustainability", "esg"], ["culture", "cultural", "creative"],
];

/** Racinisation minimale FR/EN : pluriels en -s / -x (« divisions » ~ « division »). */
export function stem(w: string): string {
  return w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w;
}

export function tokens(text: string): string[] {
  return normalize(text).split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

/** Un « concept » = un mot de la question avec ses synonymes FR/EN. */
function conceptsOf(query: string): { terms: Set<string>; phrases: string[]; concepts: { words: string[]; phrases: string[] }[] } {
  const q = normalize(query);
  const terms = new Set<string>();
  const phrases: string[] = [];
  const concepts: { words: string[]; phrases: string[] }[] = [];
  const toks = [...new Set(tokens(q))];
  // « WEBLACK » est le sujet de tout le site : non discriminant dès qu'il y a un autre concept.
  const useful = toks.length > 1 ? toks.filter((t) => t !== "weblack") : toks;
  for (const tok of useful) {
    const words = [tok];
    const ph: string[] = [];
    for (const group of SYNONYMS) {
      if (group.some((g) => !g.includes(" ") && stem(g) === tok)) for (const g of group) (g.includes(" ") ? ph : words).push(g.includes(" ") ? g : stem(g));
    }
    for (const w of words) terms.add(w);
    phrases.push(...ph);
    concepts.push({ words, phrases: ph });
  }
  // Expressions de la question présentes telles quelles dans un groupe de synonymes (ex. « semaine de la mode »).
  for (const group of SYNONYMS) {
    for (const g of group) if (g.includes(" ") && q.includes(g)) {
      phrases.push(...group.filter((x) => x.includes(" ")));
      const words = group.filter((x) => !x.includes(" ")).map(stem);
      for (const w of words) terms.add(w);
      concepts.push({ words, phrases: group.filter((x) => x.includes(" ")) });
      break;
    }
  }
  return { terms, phrases, concepts };
}

export interface Retrieved {
  entry: KnowledgeEntry;
  score: number;
  outdated: boolean;
}

export function isOutdated(entry: KnowledgeEntry, now: Date): boolean {
  return Date.parse(entry.nextReviewAt) < now.getTime();
}

/**
 * Attributs que l'on demande souvent sans qu'une fiche « thématiquement proche » y réponde
 * (« taille du marché africain de la mode » ne trouve pas la fiche sur une fashion week).
 * Si la question demande l'un de ces attributs, une fiche n'est retenue que si elle le traite.
 */
const ATTRIBUTE_GROUPS: string[][] = [
  ["marche", "market"], ["chiffre", "affaires", "revenue", "revenu", "turnover", "ca"], ["taille", "size"], ["prix", "price", "tarif", "cout", "cost", "budget"],
  ["salaire", "salary", "gagne", "earn", "remuneration", "cachet", "fee"], ["croissance", "growth"], ["statistique", "statistic", "pourcentage", "percent", "part"],
  ["combien", "how"], ["disponibilite", "availability", "disponible", "available"],
];
const ATTR_STEMS = ATTRIBUTE_GROUPS.map((g) => g.map(stem));

const vocabCache = new WeakMap<KnowledgeEntry[], Set<string>>();

/** Vocabulaire de la base : les mots de la question inconnus de toute la base (« menées », « chiffre ») ne comptent pas comme concepts à couvrir. */
function vocabularyOf(entries: KnowledgeEntry[]): Set<string> {
  let v = vocabCache.get(entries);
  if (!v) {
    v = new Set<string>();
    for (const e of entries) {
      for (const k of e.keywords) for (const w of normalize(k).split(" ")) v.add(stem(w));
      for (const w of tokens(e.title.fr + " " + e.title.en + " " + e.text.fr + " " + e.text.en)) v.add(w);
    }
    vocabCache.set(entries, v);
  }
  return v;
}

const FRESHNESS = /\b(actualite|actualites|actuel|actuelle|actuellement|recent|recente|dernier|derniere|aujourd|2026|2027|news|latest|current|currently|recently|today)\b/;

/**
 * Recherche lexicale hybride (aucune infrastructure vectorielle payante) :
 * mots-clés + titre + synonymes FR/EN + expressions + texte intégral pondéré.
 * Une entrée obsolète est pénalisée, et écartée quand la question porte sur l'actualité.
 */
export function retrieve(query: string, entries: KnowledgeEntry[] = KNOWLEDGE, limit = 3, now: Date = new Date()): Retrieved[] {
  const parsed = conceptsOf(query);
  const vocab = vocabularyOf(entries);
  const { terms, phrases } = parsed;
  const concepts = parsed.concepts.filter((c) => c.words.some((w) => vocab.has(w)) || c.phrases.length > 0);
  if (terms.size === 0 || concepts.length === 0) return [];
  // Précision : une fiche doit couvrir au moins deux concepts distincts de la question (un seul si elle n'en contient qu'un).
  const needed = Math.min(2, concepts.length);
  const wantsFresh = FRESHNESS.test(normalize(query));
  const qTokens = new Set(tokens(query));
  // « combien » / « how much|many » : demande chiffrée ; « how » seul est trop courant → on ne l'active qu'avec much/many.
  const asked = ATTR_STEMS.filter((g, i) => (ATTRIBUTE_GROUPS[i][0] === "combien" ? qTokens.has("combien") || (qTokens.has("how") && (qTokens.has("much") || qTokens.has("many"))) : g.some((w) => qTokens.has(w))));
  const scored: Retrieved[] = entries
    .filter((e) => e.validation !== "draft")
    .map((entry) => {
      const kw = new Set(entry.keywords.flatMap((k) => normalize(k).split(" ").map(stem)));
      const titleTerms = new Set(tokens(entry.title.fr + " " + entry.title.en));
      const body = new Set(tokens(entry.text.fr + " " + entry.text.en));
      let score = 0;
      for (const t of terms) {
        if (kw.has(t)) score += 3;
        if (titleTerms.has(t)) score += 2;
        if (body.has(t)) score += 1;
      }
      const hay = normalize(entry.title.fr + " " + entry.title.en + " " + entry.keywords.join(" "));
      for (const p of new Set(phrases)) if (hay.includes(p)) score += 4;
      const outdated = isOutdated(entry, now);
      if (outdated) score = Math.floor(score * 0.5);
      const hasAttrs = asked.every((g) => g.some((w) => kw.has(w) || titleTerms.has(w) || body.has(w)) || (g.includes("combien") && /\d/.test(entry.text.fr)));
      if (!hasAttrs) return { entry, score: 0, outdated };
      const covered = concepts.filter((c) => c.words.some((w) => kw.has(w) || titleTerms.has(w) || body.has(w)) || c.phrases.some((p) => hay.includes(p))).length;
      return { entry, score: covered >= needed ? score : 0, outdated };
    })
    .filter((s) => s.score >= 2 && !(wantsFresh && s.outdated))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function toCitation(entry: KnowledgeEntry, lang: Lang, now: Date = new Date()): Citation {
  return {
    id: entry.id,
    title: entry.title[lang],
    source: entry.source.label,
    ...(entry.source.url ? { url: entry.source.url } : {}),
    verifiedAt: entry.verifiedAt,
    reliability: entry.reliability,
    ...(isOutdated(entry, now) ? { outdated: true } : {}),
  };
}

/** Couverture par domaine : sert au rapport, à l'administration et au refus honnête de répondre. */
export function coverage(entries: KnowledgeEntry[] = SEED): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(DOMAINS.map((d) => [d, 0]));
  for (const e of entries) out[e.domain] = (out[e.domain] ?? 0) + 1;
  return out;
}

export function reviewReport(entries: KnowledgeEntry[], now: Date = new Date()) {
  return {
    total: entries.length,
    outdated: entries.filter((e) => isOutdated(e, now)).map((e) => e.id),
    pendingHumanReview: entries.filter((e) => e.validation !== "human-validated").map((e) => e.id),
    contradictions: entries.filter((e) => e.contradicts?.length).map((e) => e.id),
  };
}

/** Base complète exposée à MALYA : jeu de départ du fondateur + corpus sectoriel sourcé. */
export const KNOWLEDGE: KnowledgeEntry[] = [...SEED, ...CORPUS];
