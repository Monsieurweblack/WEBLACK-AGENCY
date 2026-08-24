const STORAGE_KEY = "weblack-consent";

type ConsentStatus = "accepted" | "rejected" | "custom";

interface ConsentState {
  status: ConsentStatus;
  analytics: boolean;
  timestamp: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __weblackLoadGA4?: () => void;
  }
}

/**
 * Mirrors the schema the blocking inline script in BaseLayout.astro reads
 * to set GA4's default consent state before gtag.js ever loads. Keep the
 * two in sync — this module can't import into that inline script, since
 * that one must stay dependency-free to run synchronously pre-gtag.js.
 */
function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.analytics === "boolean" && typeof parsed.status === "string") {
      return parsed as ConsentState;
    }
    return null;
  } catch {
    return null;
  }
}

function writeConsent(status: ConsentStatus, analytics: boolean) {
  const state: ConsentState = { status, analytics, timestamp: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage unavailable (private mode, etc.) — consent still applies for this load */
  }
}

/**
 * Basic Consent Mode: GA4's script is only ever requested through
 * window.__weblackLoadGA4 (defined in BaseLayout.astro), and only once
 * analytics is true. Turning analytics off never had a script to remove —
 * if gtag.js already loaded earlier in this same page view (the visitor
 * accepted, then changed their mind without reloading), this best-effort
 * denies it going forward; a full return to "no tag present" needs the
 * reload that happens naturally on the next visit anyway.
 */
function setAnalytics(analytics: boolean) {
  if (analytics) {
    window.__weblackLoadGA4?.();
  } else if (window.gtag) {
    window.gtag("consent", "update", { analytics_storage: "denied" });
  }
}

let initialized = false;

export function initConsent() {
  if (initialized) return;
  initialized = true;

  const banner = document.querySelector<HTMLElement>("[data-consent-banner]");
  const panel = document.querySelector<HTMLElement>("[data-consent-preferences]");
  const analyticsToggle = document.querySelector<HTMLInputElement>("[data-consent-analytics-toggle]");
  if (!banner || !panel || !analyticsToggle) return;

  const dom = { banner, panel, analyticsToggle };

  function showBanner() {
    dom.banner.classList.remove("hidden");
  }
  function hideBanner() {
    dom.banner.classList.add("hidden");
  }

  function openPanel() {
    const existing = readConsent();
    dom.analyticsToggle.checked = existing ? existing.analytics : false;
    hideBanner();
    dom.panel.classList.remove("pointer-events-none", "opacity-0");
    dom.panel.classList.add("opacity-100");
    dom.panel.removeAttribute("inert");
    dom.panel.setAttribute("aria-hidden", "false");
  }

  function closePanel() {
    dom.panel.classList.add("pointer-events-none", "opacity-0");
    dom.panel.classList.remove("opacity-100");
    dom.panel.setAttribute("inert", "");
    dom.panel.setAttribute("aria-hidden", "true");
    // No choice was ever made — never treat a dismissed panel as consent.
    if (!readConsent()) showBanner();
  }

  function applyChoice(status: ConsentStatus, analytics: boolean) {
    writeConsent(status, analytics);
    setAnalytics(analytics);
    hideBanner();
    dom.panel.classList.add("pointer-events-none", "opacity-0");
    dom.panel.classList.remove("opacity-100");
    dom.panel.setAttribute("inert", "");
    dom.panel.setAttribute("aria-hidden", "true");
  }

  if (!readConsent()) showBanner();

  document.querySelectorAll("[data-consent-accept]").forEach((btn) => btn.addEventListener("click", () => applyChoice("accepted", true)));
  document.querySelectorAll("[data-consent-reject]").forEach((btn) => btn.addEventListener("click", () => applyChoice("rejected", false)));
  document.querySelectorAll("[data-consent-customize], [data-open-consent-preferences]").forEach((btn) => btn.addEventListener("click", openPanel));
  document.querySelectorAll("[data-consent-close]").forEach((btn) => btn.addEventListener("click", closePanel));
  document.querySelectorAll("[data-consent-save]").forEach((btn) =>
    btn.addEventListener("click", () => applyChoice("custom", dom.analyticsToggle.checked)),
  );
  document.querySelectorAll("[data-consent-accept-all]").forEach((btn) =>
    btn.addEventListener("click", () => {
      dom.analyticsToggle.checked = true;
      applyChoice("accepted", true);
    }),
  );

  dom.panel.addEventListener("click", (event) => {
    if (event.target === dom.panel) closePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.panel.getAttribute("aria-hidden") === "false") closePanel();
  });
}
