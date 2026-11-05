/**
 * Événements de conversion GA4 — un seul point d'émission pour tout le site.
 *
 * Trois règles, appliquées ici et nulle part ailleurs :
 * 1. Consentement : rien n'est émis sans consentement analytique enregistré
 *    (même clé que consent.ts). Le stub gtag de BaseLayout met en file tout
 *    appel — un événement émis avant consentement partirait au chargement
 *    ultérieur de gtag.js ; on ne l'émet donc tout simplement pas.
 * 2. Aucune donnée personnelle : seuls des paramètres de LISTE FERMÉE sont
 *    transmis (division, prestation, emplacement, langue). Nom, e-mail,
 *    téléphone, message, photo, pays ou organisation ne passent jamais.
 * 3. Pas de doublon : un événement « start » une fois par page vue et par
 *    division ; un « success » une fois par référence, même après un retour
 *    arrière ou un renvoi du même formulaire.
 */
const CONSENT_KEY = "weblack-consent";

export type ConversionEvent =
  | "service_cta_click"
  | "business_inquiry_start"
  | "business_inquiry_success"
  | "talent_application_start"
  | "talent_application_success";

/** Paramètres autorisés — rien d'autre ne franchit cette frontière. */
const ALLOWED_PARAMS = new Set(["division", "service_type", "cta_location", "language", "entry_point"]);
const SAFE_VALUE = /^[a-z0-9_-]{1,40}$/;

const sentOnce = new Set<string>();

function analyticsConsented(): boolean {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { analytics?: unknown };
    return parsed.analytics === true;
  } catch {
    return false;
  }
}

function sanitize(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_PARAMS.has(key) || typeof value !== "string") continue;
    const v = value.toLowerCase();
    if (SAFE_VALUE.test(v)) out[key] = v;
  }
  return out;
}

/** Vrai si l'événement a été transmis (utile aux tests de bout en bout via window.dataLayer). */
export function trackEvent(name: ConversionEvent, params: Record<string, string | undefined> = {}, dedupeKey?: string): boolean {
  if (dedupeKey) {
    const key = `${name}:${dedupeKey}`;
    if (sentOnce.has(key)) return false;
    try {
      if (name.endsWith("_success") && sessionStorage.getItem(`weblack-ev:${key}`)) return false;
    } catch {
      /* stockage indisponible : la déduplication en mémoire suffit pour la page */
    }
    sentOnce.add(key);
    try {
      if (name.endsWith("_success")) sessionStorage.setItem(`weblack-ev:${key}`, "1");
    } catch {
      /* idem */
    }
  }
  if (!analyticsConsented() || typeof window.gtag !== "function") return false;
  window.gtag("event", name, { ...sanitize({ language: document.documentElement.lang || undefined, ...params }) });
  return true;
}

const TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ORIGIN_KEY = "weblack-origin";

export interface Origin {
  channel: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/**
 * Canal d'origine d'une visite, retenu pour la session de navigation :
 * utm_source s'il est présent (il l'emporte toujours), sinon l'origine déjà
 * retenue, sinon le domaine référent externe, sinon "direct". Appelé sur
 * les pages d'offre et sur le brief : un visiteur arrivé d'Instagram sur
 * /creative reste « instagram » quand il ouvre le brief. Jamais l'URL
 * complète, jamais de donnée personnelle — un libellé technique court.
 */
export function captureOrigin(): Origin {
  const params = new URLSearchParams(window.location.search);
  const clean = (v: string | null) => {
    const lower = (v ?? "").trim().toLowerCase();
    return TOKEN_RE.test(lower) ? lower : undefined;
  };
  let origin: Origin | null = null;
  const utm = clean(params.get("utm_source"));
  if (utm) origin = { channel: utm, utmMedium: clean(params.get("utm_medium")), utmCampaign: clean(params.get("utm_campaign")) };
  if (!origin) {
    try {
      origin = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) ?? "null") as Origin | null;
    } catch {
      origin = null;
    }
  }
  if (!origin?.channel) {
    let ref = "";
    try {
      ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
    } catch {
      ref = "";
    }
    origin = ref && !ref.endsWith("weblack.fr") && !ref.endsWith("pages.dev") ? { channel: clean(ref) ?? "referral" } : { channel: "direct" };
  }
  try {
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    /* stockage indisponible : l'origine vaut pour cette page */
  }
  return origin;
}

let ctaBound = false;

/**
 * Délégation unique : tout lien marqué data-cta-division émet
 * service_cta_click (division + emplacement), sans retarder la navigation —
 * gtag envoie en transport beacon.
 */
export function initServiceCtaTracking() {
  if (ctaBound) return;
  ctaBound = true;
  captureOrigin();
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest<HTMLElement>("[data-cta-division]");
      if (!link) return;
      trackEvent("service_cta_click", {
        division: link.dataset.ctaDivision,
        cta_location: link.dataset.ctaLocation,
      });
    },
    { capture: true },
  );
}
