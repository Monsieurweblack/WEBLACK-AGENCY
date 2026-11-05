/**
 * Brief WEBLACK — comportement du formulaire de demande commerciale.
 *
 * - Présélection depuis l'URL (?division=, ?service=, ?from=) relue contre
 *   les listes fermées embarquées (data-services) : une valeur inconnue est
 *   ignorée.
 * - Canal d'origine : utm_source, sinon domaine référent externe, sinon
 *   "direct". Jamais l'URL complète ni une donnée personnelle.
 * - Confirmation et business_inquiry_success UNIQUEMENT sur réponse
 *   serveur ok + référence. Un échec réseau n'est jamais présenté comme un
 *   succès ; le même submissionId rend un nouvel essai sans doublon.
 */
import { captureOrigin, trackEvent } from "../analytics";

interface Config {
  lang: "fr" | "en";
  errors: Record<string, string>;
  errorSummary: string;
  submit: string;
  submitting: string;
  retry: string;
  descriptionMin: number;
}

type ServicesMap = Record<string, { value: string; label: string }[]>;

let initialized = false;

export function initBusinessInquiry() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("inquiry-form") as HTMLFormElement | null;
  if (!form) return;
  const config = JSON.parse(form.dataset.config ?? "{}") as Config;
  const services = JSON.parse(form.dataset.services ?? "{}") as ServicesMap;
  const serviceSelect = form.querySelector<HTMLSelectElement>("#service")!;
  const submitBtn = form.querySelector<HTMLButtonElement>("[data-inquiry-submit]")!;
  const statusEl = form.querySelector<HTMLElement>("[data-inquiry-status]")!;
  const summary = form.querySelector<HTMLElement>("[data-error-summary]")!;
  const summaryList = form.querySelector<HTMLElement>("[data-error-list]")!;
  const success = document.querySelector<HTMLElement>("[data-inquiry-success]")!;
  const description = form.querySelector<HTMLTextAreaElement>("#description")!;
  const counter = form.querySelector<HTMLElement>("[data-description-count]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const submissionId = crypto.randomUUID();
  const params = new URLSearchParams(window.location.search);
  const entryPoint = (params.get("from") ?? "").toLowerCase().slice(0, 40) || undefined;
  const origin = captureOrigin();

  const divisionValue = () => form.querySelector<HTMLInputElement>('input[name="division"]:checked')?.value ?? "";

  function fillServices(division: string, preselect?: string) {
    const list = services[division] ?? [];
    const placeholder = serviceSelect.options[0]!;
    serviceSelect.replaceChildren(placeholder);
    for (const item of list) serviceSelect.add(new Option(item.label, item.value));
    serviceSelect.disabled = list.length === 0;
    if (list.length === 1) serviceSelect.value = list[0]!.value;
    else if (preselect && list.some((s) => s.value === preselect)) serviceSelect.value = preselect;
    else serviceSelect.value = "";
  }

  // Présélection
  const requestedDivision = params.get("division") ?? "";
  if (services[requestedDivision]) {
    const radio = form.querySelector<HTMLInputElement>(`input[name="division"][value="${requestedDivision}"]`);
    if (radio) {
      radio.checked = true;
      fillServices(requestedDivision, params.get("service") ?? undefined);
    }
  }

  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === "division") {
      fillServices(target.value);
      clearError("division");
    }
  });

  // Intention réelle : première saisie ou premier choix, une fois par page vue.
  const markStart = () => trackEvent("business_inquiry_start", { division: divisionValue() || undefined, entry_point: entryPoint }, "page");
  form.addEventListener("input", markStart, { once: true });
  form.addEventListener("change", markStart, { once: true });

  // Compteur et effacement des erreurs au fil de la saisie
  const updateCount = () => {
    if (counter) counter.textContent = `${description.value.length} / ${description.maxLength}`;
  };
  description.addEventListener("input", updateCount);
  form.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name) clearError(target.name);
  });

  // Disponibilité de la réception sur cette adresse
  void fetch("/api/business-inquiry", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((data: { configured?: boolean }) => {
      if (data.configured === false) document.querySelector<HTMLElement>("[data-inquiry-offline]")!.hidden = false;
    })
    .catch(() => undefined);

  function fieldOf(name: string) {
    return form!.querySelector<HTMLElement>(`[data-field="${name}"]`);
  }
  function focusTarget(name: string): HTMLElement | null {
    return form!.querySelector<HTMLElement>(name === "division" ? 'input[name="division"]' : `#${name}`);
  }
  function setError(name: string, message: string) {
    const el = form!.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
    fieldOf(name)?.setAttribute("data-invalid", "");
    focusTarget(name)?.setAttribute("aria-invalid", "true");
  }
  function clearError(name: string) {
    const el = form!.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    if (el) {
      el.hidden = true;
      el.textContent = "";
    }
    fieldOf(name)?.removeAttribute("data-invalid");
    focusTarget(name)?.removeAttribute("aria-invalid");
  }

  const value = (name: string) => ((form!.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "").trim();

  function validate(): { name: string; message: string }[] {
    const e = config.errors;
    const out: { name: string; message: string }[] = [];
    if (!divisionValue()) out.push({ name: "division", message: e.required! });
    else if (!value("service")) out.push({ name: "service", message: e.required! });
    const desc = value("description");
    if (!desc) out.push({ name: "description", message: e.required! });
    else if (desc.length < config.descriptionMin) out.push({ name: "description", message: e.descriptionShort! });
    if (!value("fullName")) out.push({ name: "fullName", message: e.required! });
    const email = value("email");
    if (!email) out.push({ name: "email", message: e.required! });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) out.push({ name: "email", message: e.invalidEmail! });
    if (!value("country")) out.push({ name: "country", message: e.required! });
    return out;
  }

  function labelFor(name: string): string {
    if (name === "division") return document.getElementById("division-label")?.firstChild?.textContent?.trim() ?? name;
    return form!.querySelector(`label[for="${name}"]`)?.firstChild?.textContent?.trim() ?? name;
  }

  function showErrors(errors: { name: string; message: string }[]) {
    for (const { name, message } of errors) setError(name, message);
    summaryList.replaceChildren(
      ...errors.map(({ name, message }) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `#${name === "division" ? "division-label" : name}`;
        a.className = "underline underline-offset-4";
        a.textContent = `${labelFor(name)} — ${message}`;
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          focusTarget(name)?.focus();
        });
        li.append(a);
        return li;
      }),
    );
    summary.hidden = false;
    // Après le rendu : le défilement et le focus ne forcent pas un recalcul dans le gestionnaire.
    requestAnimationFrame(() =>
      setTimeout(() => {
        summary.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        summary.focus({ preventScroll: true });
      }, 0),
    );
  }

  const serverMessage = (reason: string, field: string) => {
    const e = config.errors;
    if (reason === "required") return e.required!;
    if (reason === "too_short") return e.descriptionShort!;
    if (reason === "too_long") return e.tooLong!;
    return field === "email" ? e.invalidEmail! : e.invalid!;
  };

  let sending = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    statusEl.textContent = "";
    summary.hidden = true;
    const errors = validate();
    if (errors.length) return showErrors(errors);

    sending = true;
    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.textContent = config.submitting;

    const payload = {
      submissionId,
      lang: config.lang,
      division: divisionValue(),
      service: value("service"),
      description: value("description"),
      timeline: value("timeline"),
      budget: value("budget"),
      fullName: value("fullName"),
      email: value("email"),
      organisation: value("organisation"),
      country: value("country"),
      website: value("website"),
      channel: origin.channel,
      utmMedium: origin.utmMedium,
      utmCampaign: origin.utmCampaign,
      entryPoint,
    };

    let data: { ok?: boolean; reference?: string; reason?: string; errors?: { field: string; reason: string }[] } | undefined;
    let networkFailure = false;
    try {
      const response = await fetch("/api/business-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      data = await response.json();
    } catch {
      networkFailure = true;
    } finally {
      sending = false;
      submitBtn.removeAttribute("aria-busy");
    }

    if (data?.ok && data.reference) {
      form.hidden = true;
      success.hidden = false;
      success.querySelector<HTMLElement>("[data-inquiry-reference]")!.textContent = data.reference;
      trackEvent("business_inquiry_success", { division: payload.division, service_type: payload.service, entry_point: entryPoint }, data.reference);
      requestAnimationFrame(() =>
        setTimeout(() => {
          success.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
          success.focus({ preventScroll: true });
        }, 0),
      );
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = config.retry;
    if (data?.reason === "validation" && data.errors?.length) {
      return showErrors(data.errors.map((err) => ({ name: err.field, message: serverMessage(err.reason, err.field) })));
    }
    const e = config.errors;
    statusEl.textContent = networkFailure
      ? e.network!
      : data?.reason === "rate_limited"
        ? e.rateLimited!
        : data?.reason === "not_configured" || data?.reason === "unavailable"
          ? e.unavailable!
          : e.generic!;
  });
}
