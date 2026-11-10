/**
 * WEBLACK Opportunities — modèle du site et normalisation des documents
 * Sanity `opportunity` (source unique de vérité, schéma dans le dépôt
 * WEBLACK-STUDIO : schemaTypes/documents/opportunity.ts).
 *
 * Lu UNIQUEMENT au build, via src/lib/content.ts (perspective « published » :
 * un brouillon n'est jamais lu). Un document publié mais incomplet ou
 * incohérent est écarté avec un avertissement de build — jamais une page
 * à moitié remplie, jamais un build cassé.
 *
 * Statuts : review → aucune page ; published → ouverte jusqu'à la date
 * limite puis clôturée ; closed → lisible sans appel à candidater ;
 * archived → page conservée (clôturée), rangée dans « Archives ».
 */
import type { Lang } from "../i18n/utils";

export type OpportunityStatus = "published" | "closed" | "archived";

export interface OpportunityImage {
  src: string;
  width: number;
  height: number;
  alt: Record<Lang, string>;
  caption?: Record<Lang, string>;
}

export interface OpportunityText {
  title: string;
  summary: string;
  category: string;
  location: string;
  eventDate?: string;
  intro: string[];
  criteria: string[];
  documents: string[];
  specialOffer?: string;
  notice?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface Opportunity {
  slug: string;
  status: OpportunityStatus;
  /** Fin de dépôt incluse (ISO 8601). Au-delà, l'annonce est affichée clôturée. */
  deadline: string;
  organizer: { name: string; url?: string };
  sourceUrl: string;
  lastVerifiedAt: string;
  organizerVerified: boolean;
  /** Diffusion : toujours la marque, jamais la raison sociale. */
  broadcastPartner: "WEBLACK";
  contact: { email: string; phones: { label: string; tel: string }[] };
  image?: OpportunityImage;
  /** Image de partage 1200×630 (visuel principal entier sur le noir du site, par le CDN Sanity). */
  ogImage?: string;
  imageCredit?: string;
  galleries: { id: string; title: Record<Lang, string>; items: OpportunityImage[] }[];
  text: Record<Lang, OpportunityText>;
}

/** Projection GROQ — seuls les champs lus par le site. */
export const OPPORTUNITY_PROJECTION = `{
  _id, status, "slug": slug.current, deadline, discipline, profiles,
  titleFr, titleEn, summaryFr, summaryEn, locationFr, locationEn, eventDateFr, eventDateEn,
  introFr, introEn, criteriaFr, criteriaEn, documentsFr, documentsEn,
  conditionsFr, conditionsEn, noticeFr, noticeEn,
  mainImage, imageCredit, galleries[]{ _key, titleFr, titleEn, images },
  contactEmail, contactPhones[]{ label, tel },
  organizerName, organizerUrl, sourceUrl, lastVerifiedAt, organizerVerified,
  seo
}`;

const DISCIPLINE: Record<string, Record<Lang, string>> = {
  fashion: { fr: "Mode", en: "Fashion" },
  art: { fr: "Art", en: "Art" },
  design: { fr: "Design", en: "Design" },
  photography: { fr: "Photographie", en: "Photography" },
  music: { fr: "Musique", en: "Music" },
  film: { fr: "Cinéma", en: "Film" },
  culture: { fr: "Culture", en: "Culture" },
};

const PROFILE: Record<string, Record<Lang, string>> = {
  designer: { fr: "Designers", en: "Designers" },
  model: { fr: "Mannequins", en: "Models" },
  photographer: { fr: "Photographes", en: "Photographers" },
  stylist: { fr: "Stylistes", en: "Stylists" },
  beauty: { fr: "Maquillage & coiffure", en: "Hair & make-up" },
  artist: { fr: "Artistes", en: "Artists" },
  brand: { fr: "Marques créatives", en: "Creative brands" },
  other: { fr: "Profils créatifs", en: "Creative profiles" },
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEL_RE = /^\+[1-9]\d{6,14}$/;
const ASSET_RE = /^image-([a-f0-9]+)-(\d+)x(\d+)-(\w+)$/;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => Boolean(s)) : []);
const httpUrl = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

export interface SanityTarget {
  projectId: string;
  dataset: string;
}

function image(raw: any, target: SanityTarget): OpportunityImage | undefined {
  const m = ASSET_RE.exec(raw?.asset?._ref ?? "");
  const altFr = str(raw?.altFr);
  const altEn = str(raw?.altEn);
  if (!m || !altFr || !altEn) return undefined;
  const [, id, w, h, ext] = m;
  const captionFr = str(raw?.captionFr);
  const captionEn = str(raw?.captionEn);
  return {
    src: `https://cdn.sanity.io/images/${target.projectId}/${target.dataset}/${id}-${w}x${h}.${ext}`,
    width: Number(w),
    height: Number(h),
    alt: { fr: altFr, en: altEn },
    caption: captionFr || captionEn ? { fr: captionFr ?? captionEn!, en: captionEn ?? captionFr! } : undefined,
  };
}

export type NormalizeResult = { ok: true; opportunity: Opportunity } | { ok: false; id: string; reasons: string[] };

/**
 * Document Sanity → annonce affichable, ou la liste des raisons de l'écarter.
 * `review` (ou statut absent) n'est jamais affichable.
 */
export function normalizeOpportunity(raw: any, target: SanityTarget): NormalizeResult {
  const id = String(raw?._id ?? "?");
  const reasons: string[] = [];
  const status = raw?.status;
  if (status !== "published" && status !== "closed" && status !== "archived") return { ok: false, id, reasons: [`statut ${status ?? "absent"} : non publié sur le site`] };

  const slug = str(raw?.slug);
  if (!slug || !SLUG_RE.test(slug)) reasons.push("slug manquant ou invalide");
  const deadline = str(raw?.deadline);
  if (!deadline || Number.isNaN(Date.parse(deadline))) reasons.push("date limite manquante ou invalide");
  const discipline = DISCIPLINE[raw?.discipline];
  if (!discipline) reasons.push("discipline manquante");
  const profiles = list(raw?.profiles).filter((p) => PROFILE[p]);
  if (profiles.length === 0) reasons.push("profils concernés manquants");
  const email = str(raw?.contactEmail);
  if (!email || !EMAIL_RE.test(email)) reasons.push("e-mail de contact manquant ou invalide");
  const organizerName = str(raw?.organizerName);
  if (!organizerName) reasons.push("organisateur manquant");
  const sourceUrl = httpUrl(raw?.sourceUrl);
  if (!sourceUrl) reasons.push("source manquante");
  const lastVerifiedAt = str(raw?.lastVerifiedAt);
  if (!lastVerifiedAt) reasons.push("date de vérification manquante");

  const text = {} as Record<Lang, OpportunityText>;
  for (const lang of ["fr", "en"] as const) {
    const sfx = lang === "fr" ? "Fr" : "En";
    const title = str(raw?.[`title${sfx}`]);
    const summary = str(raw?.[`summary${sfx}`]);
    const location = str(raw?.[`location${sfx}`]);
    const intro = list(raw?.[`intro${sfx}`]);
    const criteria = list(raw?.[`criteria${sfx}`]);
    const documents = list(raw?.[`documents${sfx}`]);
    for (const [name, ok] of [
      ["titre", title],
      ["résumé", summary],
      ["lieu", location],
      ["présentation", intro.length],
      ["critères", criteria.length],
      ["pièces à fournir", documents.length],
    ] as const) {
      if (!ok) reasons.push(`${name} (${lang}) manquant`);
    }
    text[lang] = {
      title: title ?? "",
      summary: summary ?? "",
      category: [discipline?.[lang], ...profiles.map((p) => PROFILE[p][lang])].filter(Boolean).join(" · "),
      location: location ?? "",
      eventDate: str(raw?.[`eventDate${sfx}`]),
      intro,
      criteria,
      documents,
      specialOffer: str(raw?.[`conditions${sfx}`]),
      notice: str(raw?.[`notice${sfx}`]),
      seoTitle: lang === "fr" ? str(raw?.seo?.title) : undefined,
      seoDescription: lang === "fr" ? str(raw?.seo?.description) : undefined,
    };
  }
  if (reasons.length) return { ok: false, id, reasons };

  const phones = (Array.isArray(raw?.contactPhones) ? raw.contactPhones : [])
    .map((p: any) => ({ label: str(p?.label), tel: str(p?.tel) }))
    .filter((p: { label?: string; tel?: string }): p is { label: string; tel: string } => Boolean(p.label && p.tel && TEL_RE.test(p.tel)));
  const main = image(raw?.mainImage, target);
  const galleries = (Array.isArray(raw?.galleries) ? raw.galleries : [])
    .map((g: any, i: number) => ({
      id: String(g?._key ?? i),
      title: { fr: str(g?.titleFr) ?? "", en: str(g?.titleEn) ?? "" },
      items: (Array.isArray(g?.images) ? g.images : []).map((im: any) => image(im, target)).filter(Boolean) as OpportunityImage[],
    }))
    .filter((g: { title: Record<Lang, string>; items: OpportunityImage[] }) => g.title.fr && g.title.en && g.items.length > 0);

  return {
    ok: true,
    opportunity: {
      slug: slug!,
      status,
      deadline: new Date(deadline!).toISOString(),
      organizer: { name: organizerName!, url: httpUrl(raw?.organizerUrl) },
      sourceUrl: sourceUrl!,
      lastVerifiedAt: lastVerifiedAt!,
      organizerVerified: raw?.organizerVerified === true,
      broadcastPartner: "WEBLACK",
      contact: { email: email!, phones },
      image: main,
      ogImage: main ? `${main.src}?w=1200&h=630&fit=fill&bg=0A0A0A&fm=jpg&q=90` : undefined,
      imageCredit: str(raw?.imageCredit),
      galleries,
      text,
    },
  };
}

/** Clôturée à l'instant `now` : manuellement, archivée, ou date limite passée. */
export function isClosed(o: Pick<Opportunity, "status" | "deadline">, now: number = Date.now()): boolean {
  return o.status !== "published" || now > Date.parse(o.deadline);
}
