/**
 * Formulaire de candidature Talent — une seule page, 5 étapes affichées et
 * masquées en JS. Rien n'est retiré du DOM entre deux étapes : les réponses
 * survivent nativement dans les champs, sans localStorage. Seul un départ de
 * la page les perdrait : une confirmation est alors demandée (beforeunload).
 *
 * Les messages d'erreur sont écrits ici, dans la langue de la page — jamais
 * par la bulle de validation native du navigateur, qui suit la langue du
 * système et mélangerait français et anglais. Ce contrôle guide la saisie ;
 * la validation qui fait foi reste celle du serveur (functions/lib/validation.ts),
 * dont les erreurs sont reprises champ par champ.
 */

interface Config {
  lang: "fr" | "en";
  minorsAllowed: boolean;
  minorsMessage: string;
  confirmationMessage: string;
  privacyNoticeVersion: string;
  dialCodes: Record<string, string>;
  modelCategories: string[];
  measurementLimits: Record<string, [number, number]>;
  shoeSizeLimits: [number, number];
  textLimits: Record<string, number>;
  upload: { originalMaxBytes: number; maxDimension: number; acceptedTypes: string[] };
}

interface Strings {
  progress: string;
  stepTitles: string[];
  navContinue: string;
  navSubmit: string;
  navSubmitting: string;
  navRetry: string;
  photoChoose: string;
  photoReplace: string;
  photoUploading: string;
  photoUploaded: string;
  photoRetry: string;
  photoError: string;
  photoInvalidType: string;
  photoTooLarge: string;
  reviewEdit: string;
  reviewPhotos: string;
  languagesSelected: string;
  charactersLeft: string;
  successDefault: string;
  successEmailSent: string;
  successEmailPending: string;
  errors: Record<
    | "required"
    | "email"
    | "phone"
    | "country"
    | "date"
    | "url"
    | "instagram"
    | "range"
    | "tooLong"
    | "invalidChoice"
    | "languages"
    | "photoRequired"
    | "photoPending"
    | "photoExpired"
    | "shoeSystem"
    | "rateLimited"
    | "generic"
    | "validation"
    | "closed"
    | "unavailable"
    | "network"
    | "photoReused",
    string
  >;
}

type FieldControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const TOTAL_STEPS = 5;
const JPEG_QUALITY = 0.85;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const INSTAGRAM_RE = /^(@?[A-Za-z0-9._]{1,30}|https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?)$/;

let initialized = false;

export function initTalentApplicationForm() {
  if (initialized) return;
  initialized = true;

  const formEl = document.getElementById("talent-application-form") as HTMLFormElement | null;
  if (!formEl) return;
  const form: HTMLFormElement = formEl;

  const config = JSON.parse(form.dataset.config || "{}") as Config;
  const i18n = JSON.parse(form.dataset.i18n || "{}") as Strings;

  const q = <T extends Element>(selector: string) => form.querySelector<T>(selector);
  const steps = Array.from(form.querySelectorAll<HTMLFieldSetElement>("fieldset[data-step]"));
  const progressEl = q<HTMLElement>("[data-step-progress]")!;
  const barEl = q<HTMLElement>("[data-step-bar]")!;
  const titleEl = q<HTMLElement>("[data-step-title]")!;
  const backBtn = q<HTMLButtonElement>("[data-nav-back]")!;
  const continueBtn = q<HTMLButtonElement>("[data-nav-continue]")!;
  const statusEl = q<HTMLElement>("[data-form-status]")!;
  const navControls = q<HTMLElement>("[data-nav-controls]")!;

  let currentStep = 1;
  let dirty = false;
  let submitted = false;
  let pendingUploads = 0;
  // Tiré une fois pour ce formulaire : chaque nouvel essai d'envoi porte le
  // même identifiant, le serveur reconnaît un dossier déjà enregistré.
  const submissionId = crypto.randomUUID();

  // --- Utilitaires de champ ---------------------------------------------------

  /**
   * Toujours un élément, jamais une RadioNodeList : pour un groupe de cases
   * (langues, projets, mobilité), namedItem() renvoie la liste entière, qui
   * n'a ni focus() ni setAttribute() — on prend alors sa première case.
   */
  const control = (name: string): FieldControl | null => {
    const named = form.elements.namedItem(name);
    if (named instanceof RadioNodeList) return (named[0] as FieldControl | undefined) ?? null;
    return (named as FieldControl | null) ?? form.querySelector<FieldControl>(`#${CSS.escape(name)}`);
  };

  const value = (name: string): string => {
    const element = form.elements.namedItem(name);
    if (element instanceof RadioNodeList) return element.value;
    return (element as FieldControl | null)?.value.trim() ?? "";
  };

  const checkedValues = (name: string): string[] =>
    Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)).map((input) => input.value);

  /** L'élément qui reçoit le focus et aria-invalid pour un nom d'erreur donné. */
  function focusTargetFor(name: string): HTMLElement | null {
    if (name === "phone") return q("#phoneNumber");
    if (name === "country") return q("#countrySearch");
    if (name === "languages") return q("#languagesSearch");
    if (name === "mobility") return q('input[name="mobility"]');
    if (name.startsWith("photo.")) return q(`.photo-slot[data-photo-role="${name.slice(6)}"] [data-photo-trigger]`);
    return control(name);
  }

  function setError(name: string, message: string) {
    const target = q<HTMLElement>(`[data-error-for="${name}"]`);
    if (target) {
      target.textContent = message;
      target.hidden = false;
    }
    focusTargetFor(name)?.setAttribute("aria-invalid", "true");
    if (name === "phone") q("#phoneDialCode")?.setAttribute("aria-invalid", "true");
  }

  function clearError(name: string) {
    const target = q<HTMLElement>(`[data-error-for="${name}"]`);
    if (target) {
      target.textContent = "";
      target.hidden = true;
    }
    focusTargetFor(name)?.removeAttribute("aria-invalid");
    if (name === "phone") q("#phoneDialCode")?.removeAttribute("aria-invalid");
  }

  function clearErrorsIn(scope: ParentNode) {
    for (const element of scope.querySelectorAll<HTMLElement>("[data-error-for]")) clearError(element.dataset.errorFor!);
  }

  const rangeMessage = (min: number, max: number) => i18n.errors.range.replace("{min}", String(min)).replace("{max}", String(max));

  function parseDecimal(raw: string): number | undefined {
    const normalized = raw.trim().replace(",", ".");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return undefined;
    return Number(normalized);
  }

  function isHttpUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
    } catch {
      return false;
    }
  }

  function computeAge(iso: string): number | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return undefined;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const birth = new Date(Date.UTC(y, m - 1, d));
    if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== m - 1 || birth.getUTCDate() !== d) return undefined;
    const today = new Date();
    let age = today.getUTCFullYear() - y;
    if (today.getUTCMonth() < m - 1 || (today.getUTCMonth() === m - 1 && today.getUTCDate() < d)) age -= 1;
    return age;
  }

  // --- Navigation ---------------------------------------------------------------

  function showStep(step: number, focusTitle = true) {
    currentStep = step;
    for (const fieldset of steps) fieldset.hidden = Number(fieldset.dataset.step) !== step;
    progressEl.textContent = i18n.progress.replace("{n}", String(step));
    titleEl.textContent = i18n.stepTitles[step - 1] ?? "";
    barEl.style.width = `${(step / TOTAL_STEPS) * 100}%`;
    backBtn.hidden = step === 1;
    continueBtn.textContent = step === TOTAL_STEPS ? i18n.navSubmit : i18n.navContinue;
    statusEl.textContent = "";
    if (step === TOTAL_STEPS) buildReview();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focusTitle) titleEl.focus({ preventScroll: true });
  }

  const stepOf = (element: Element | null): number => Number(element?.closest<HTMLElement>("fieldset[data-step]")?.dataset.step ?? 0);

  // --- Étape 1 : profil -----------------------------------------------------------

  const birthInput = q<HTMLInputElement>("#birthDate")!;
  const minorBlock = q<HTMLElement>("[data-minor-block]")!;
  const minorGated = q<HTMLElement>("[data-minor-gated]")!;
  const guardianFields = q<HTMLElement>("[data-guardian-fields]")!;
  // La date du jour bornant le sélecteur : une naissance ne peut pas être future.
  birthInput.max = new Date().toISOString().slice(0, 10);

  const isMinor = () => {
    const age = computeAge(birthInput.value);
    return typeof age === "number" && age >= 0 && age < 18;
  };

  function updateMinorUi() {
    const minor = isMinor();
    const blocked = minor && !config.minorsAllowed;
    minorBlock.hidden = !blocked;
    minorBlock.textContent = blocked ? config.minorsMessage : "";
    minorGated.hidden = blocked;
    continueBtn.disabled = blocked;
    guardianFields.hidden = !(minor && config.minorsAllowed);
  }
  birthInput.addEventListener("change", updateMinorUi);
  birthInput.addEventListener("input", updateMinorUi);

  const countrySearch = q<HTMLInputElement>("[data-country-search]")!;
  const countryCode = q<HTMLInputElement>("[data-country-code]")!;
  const dialInput = q<HTMLInputElement>("[data-dial-code]")!;
  const countryOptions = Array.from(form.querySelectorAll<HTMLOptionElement>("#country-options option"));

  function syncCountry() {
    const typed = countrySearch.value.trim().toLocaleLowerCase(config.lang);
    const match = countryOptions.find((option) => option.value.toLocaleLowerCase(config.lang) === typed);
    countryCode.value = match?.dataset.code ?? "";
    const dial = match ? config.dialCodes[match.dataset.code!] : undefined;
    // L'indicatif n'est proposé que s'il est certain, et jamais par-dessus
    // une saisie de la personne : seul un indicatif lui-même proposé est remplacé.
    if (dial && (dialInput.value === "" || dialInput.dataset.auto === "true")) {
      dialInput.value = `+${dial}`;
      dialInput.dataset.auto = "true";
    }
  }
  countrySearch.addEventListener("input", syncCountry);
  countrySearch.addEventListener("change", syncCountry);
  dialInput.addEventListener("input", () => (dialInput.dataset.auto = "false"));

  function phoneValue(dialEl: HTMLInputElement | null, numberEl: HTMLInputElement | null): string {
    const number = (numberEl?.value ?? "").trim();
    if (number.startsWith("+")) return number.replace(/[\s.\-()]/g, "");
    const dialDigits = (dialEl?.value ?? "").replace(/\D/g, "");
    const numberDigits = number.replace(/\D/g, "");
    return dialDigits && numberDigits ? `+${dialDigits}${numberDigits}` : "";
  }

  function validateStep1(): string[] {
    const invalid: string[] = [];
    const fail = (name: string, message: string) => {
      setError(name, message);
      invalid.push(name);
    };
    for (const name of ["firstName", "lastName"]) if (!value(name)) fail(name, i18n.errors.required);
    if (!birthInput.value) fail("birthDate", i18n.errors.required);
    else {
      const age = computeAge(birthInput.value);
      if (age === undefined || age < 0 || age > 100) fail("birthDate", i18n.errors.date);
      else if (age < 18 && !config.minorsAllowed) fail("birthDate", config.minorsMessage);
    }
    if (minorGated.hidden) return invalid;
    if (!value("city")) fail("city", i18n.errors.required);
    syncCountry();
    if (!countrySearch.value.trim()) fail("country", i18n.errors.required);
    else if (!countryCode.value) fail("country", i18n.errors.country);
    const email = value("email");
    if (!email) fail("email", i18n.errors.required);
    else if (!EMAIL_RE.test(email)) fail("email", i18n.errors.email);
    const phoneNumber = q<HTMLInputElement>("#phoneNumber")!;
    if (!phoneNumber.value.trim()) fail("phone", i18n.errors.required);
    else if (!E164_RE.test(phoneValue(dialInput, phoneNumber))) fail("phone", i18n.errors.phone);
    if (!guardianFields.hidden) {
      if (!value("legalGuardianName")) fail("legalGuardianName", i18n.errors.required);
      if (!EMAIL_RE.test(value("legalGuardianEmail"))) fail("legalGuardianEmail", i18n.errors.email);
      if (!E164_RE.test(value("legalGuardianPhone").replace(/[\s.\-()]/g, ""))) fail("legalGuardianPhone", i18n.errors.phone);
    }
    return invalid;
  }

  // --- Étape 2 : profil professionnel --------------------------------------------

  const categorySelect = q<HTMLSelectElement>("[data-category]")!;
  const categoryOtherBlock = q<HTMLElement>("[data-category-other]")!;
  const isModelCategory = () => config.modelCategories.includes(categorySelect.value);

  function updateCategoryUi() {
    categoryOtherBlock.hidden = categorySelect.value !== "other";
    // Mensurations complètes seulement là où elles servent un casting ; pour
    // un talent créatif, la taille, les yeux et les cheveux suffisent.
    const limited = categorySelect.value !== "" && !isModelCategory();
    for (const block of form.querySelectorAll<HTMLElement>('[data-measure="model"]')) block.hidden = limited;
    q<HTMLElement>("[data-measurements-limited]")!.hidden = !limited;
  }
  categorySelect.addEventListener("change", updateCategoryUi);

  function portfolioLinks(): string[] {
    return value("portfolioLinks")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function validateStep2(): string[] {
    const invalid: string[] = [];
    const fail = (name: string, message: string) => {
      setError(name, message);
      invalid.push(name);
    };
    if (!categorySelect.value) fail("category", i18n.errors.required);
    if (categorySelect.value === "other" && !value("categoryOther")) fail("categoryOther", i18n.errors.required);
    if (!value("experienceLevel")) fail("experienceLevel", i18n.errors.required);
    if (!value("experienceDuration")) fail("experienceDuration", i18n.errors.required);
    const links = portfolioLinks();
    if (links.length > config.textLimits.portfolioLinksCount! || !links.every((link) => link.length <= config.textLimits.portfolioLink! && isHttpUrl(link))) {
      fail("portfolioLinks", i18n.errors.url);
    }
    const instagram = value("instagram");
    if (instagram && !INSTAGRAM_RE.test(instagram)) fail("instagram", i18n.errors.instagram);
    return invalid;
  }

  // --- Étape 3 : mensurations -------------------------------------------------------

  function validateStep3(): string[] {
    const invalid: string[] = [];
    for (const input of form.querySelectorAll<HTMLInputElement>("[data-decimal]")) {
      if (input.closest<HTMLElement>("[hidden]") || input.value.trim() === "") continue;
      const parsed = parseDecimal(input.value);
      const min = Number(input.dataset.min);
      const max = Number(input.dataset.max);
      const shoeStep = input.name === "shoeSize" && parsed !== undefined && (parsed * 2) % 1 !== 0;
      if (parsed === undefined || parsed < min || parsed > max || shoeStep) {
        setError(input.name, rangeMessage(min, max));
        invalid.push(input.name);
      }
    }
    if (isModelCategory() && value("shoeSize") && !value("shoeSystem")) {
      setError("shoeSystem", i18n.errors.shoeSystem);
      invalid.push("shoeSystem");
    }
    return invalid;
  }

  // --- Étape 4 : photos ----------------------------------------------------------------

  async function reencodeToJpeg(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, config.upload.maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", JPEG_QUALITY),
    );
  }

  function uploadWithProgress(blob: Blob, role: string, onProgress: (pct: number) => void): Promise<{ ok: boolean; photoId?: string; reason?: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/talent-application/upload");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as { ok: boolean; photoId?: string; reason?: string };
          resolve(xhr.status === 200 && data.ok ? { ok: true, photoId: data.photoId } : { ok: false, reason: data.reason });
        } catch {
          resolve({ ok: false });
        }
      };
      xhr.onerror = () => resolve({ ok: false });
      xhr.onabort = () => resolve({ ok: false });
      const body = new FormData();
      body.set("role", role);
      body.set("photo", blob, "photo.jpg");
      xhr.send(body);
    });
  }

  const photoFiles = new Map<HTMLElement, File>();

  function initPhotoSlot(slot: HTMLElement) {
    const role = slot.dataset.photoRole || "extra";
    const input = slot.querySelector<HTMLInputElement>("[data-photo-input]")!;
    const idField = slot.querySelector<HTMLInputElement>("[data-photo-id-field]")!;
    const trigger = slot.querySelector<HTMLButtonElement>("[data-photo-trigger]")!;
    const preview = slot.querySelector<HTMLElement>("[data-photo-preview]")!;
    const status = slot.querySelector<HTMLElement>("[data-photo-status]")!;

    trigger.addEventListener("click", () => {
      const lastFile = photoFiles.get(slot);
      if (lastFile && status.dataset.failed === "true") void runUpload(lastFile);
      else input.click();
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      photoFiles.set(slot, file);
      void runUpload(file);
    });

    async function runUpload(file: File) {
      if (role !== "extra") clearError(`photo.${role}`);
      status.dataset.failed = "false";
      idField.value = "";
      if (!config.upload.acceptedTypes.includes(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
        status.textContent = i18n.photoInvalidType;
        status.dataset.failed = "true";
        return;
      }
      if (file.size > config.upload.originalMaxBytes) {
        status.textContent = i18n.photoTooLarge;
        status.dataset.failed = "true";
        return;
      }
      pendingUploads += 1;
      try {
        status.textContent = i18n.photoUploading;
        let blob: Blob;
        try {
          // Réencodage systématique : format uniforme (y compris HEIC
          // d'iPhone), taille maîtrisée, et aucune métadonnée conservée
          // — un canvas ne porte pas d'EXIF.
          blob = await reencodeToJpeg(file);
        } catch {
          status.textContent = i18n.photoInvalidType;
          status.dataset.failed = "true";
          return;
        }
        // data: et non blob: — la CSP du site n'autorise que data: en img-src.
        const previewUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
        preview.style.backgroundImage = `url(${previewUrl})`;
        preview.style.backgroundSize = "cover";
        preview.style.backgroundPosition = "center";

        const result = await uploadWithProgress(blob, role, (pct) => (status.textContent = `${i18n.photoUploading} ${pct}%`));
        if (result.ok && result.photoId) {
          idField.value = result.photoId;
          status.textContent = i18n.photoUploaded;
          trigger.textContent = i18n.photoReplace;
        } else {
          status.textContent = result.reason === "invalid_type" ? i18n.photoInvalidType : `${i18n.photoError} ${i18n.photoRetry}`;
          status.dataset.failed = "true";
          trigger.textContent = i18n.photoRetry;
        }
      } finally {
        pendingUploads -= 1;
      }
    }
  }

  for (const slot of form.querySelectorAll<HTMLElement>(".photo-slot[data-photo-role]")) initPhotoSlot(slot);

  const extraContainer = q<HTMLElement>("[data-extra-photos-container]")!;
  const extraTemplate = q<HTMLTemplateElement>("[data-extra-photo-template]")!;
  const addExtraBtn = q<HTMLButtonElement>("[data-add-extra-photo]")!;
  addExtraBtn.addEventListener("click", () => {
    if (extraContainer.children.length >= 3) return;
    const fragment = extraTemplate.content.cloneNode(true) as DocumentFragment;
    const entry = fragment.querySelector<HTMLElement>("[data-extra-entry]")!;
    initPhotoSlot(entry);
    entry.querySelector<HTMLButtonElement>("[data-remove-extra]")!.addEventListener("click", () => {
      photoFiles.delete(entry);
      entry.remove();
      addExtraBtn.hidden = extraContainer.children.length >= 3;
    });
    extraContainer.append(fragment);
    addExtraBtn.hidden = extraContainer.children.length >= 3;
    entry.querySelector<HTMLButtonElement>("[data-photo-trigger]")!.focus();
  });

  const photoIdOf = (role: string) => q<HTMLInputElement>(`.photo-slot[data-photo-role="${role}"]:not([data-extra-entry]) [data-photo-id-field]`)?.value ?? "";
  const extraPhotoIds = () =>
    Array.from(extraContainer.querySelectorAll<HTMLInputElement>("[data-photo-id-field]"))
      .map((field) => field.value)
      .filter(Boolean);

  function validateStep4(): string[] {
    if (pendingUploads > 0) {
      statusEl.textContent = i18n.errors.photoPending;
      return ["photoPending"];
    }
    const invalid: string[] = [];
    for (const role of ["portrait", "profile", "full_length"]) {
      if (!photoIdOf(role)) {
        setError(`photo.${role}`, i18n.errors.photoRequired);
        invalid.push(`photo.${role}`);
      }
    }
    return invalid;
  }

  // --- Étape 5 : disponibilités et confirmation ---------------------------------------

  const languagesSearch = q<HTMLInputElement>("[data-languages-search]")!;
  const languagesCount = q<HTMLElement>("[data-languages-count]")!;
  languagesSearch.addEventListener("input", () => {
    const term = languagesSearch.value.trim().toLocaleLowerCase(config.lang);
    for (const option of form.querySelectorAll<HTMLElement>("[data-language-option]")) {
      option.hidden = term !== "" && !option.dataset.search!.includes(term);
    }
  });
  const updateLanguagesCount = () => {
    const count = checkedValues("languages").length;
    languagesCount.textContent = count ? `${count} ${i18n.languagesSelected}` : "";
  };
  q<HTMLElement>("[data-languages-list]")!.addEventListener("change", updateLanguagesCount);

  const motivation = q<HTMLTextAreaElement>("#motivation")!;
  const motivationCount = q<HTMLElement>("[data-motivation-count]")!;
  const updateMotivationCount = () => {
    const left = config.textLimits.motivation! - motivation.value.length;
    motivationCount.textContent = `${left} ${i18n.charactersLeft}`;
  };
  motivation.addEventListener("input", updateMotivationCount);
  updateMotivationCount();

  function validateStep5(): string[] {
    const invalid: string[] = [];
    const fail = (name: string, message: string) => {
      setError(name, message);
      invalid.push(name);
    };
    if (checkedValues("languages").length === 0 && !value("languagesOther")) fail("languages", i18n.errors.languages);
    if (!value("mobility")) fail("mobility", i18n.errors.required);
    if (motivation.value.length > config.textLimits.motivation!) fail("motivation", i18n.errors.tooLong);
    if (!(control("accuracyConfirmed") as HTMLInputElement).checked) fail("accuracyConfirmed", i18n.errors.required);
    if (!(control("privacyNoticeAccepted") as HTMLInputElement).checked) fail("privacyNoticeAccepted", i18n.errors.required);
    return invalid;
  }

  // --- Récapitulatif ------------------------------------------------------------------

  /** Libellé visible d'un champ, lu dans le DOM — aucune seconde copie des traductions. */
  function labelText(name: string): string {
    const element = q<HTMLElement>(`label[for="${name}"]`) ?? q<HTMLElement>(`#${name}-label`);
    if (!element) return name;
    const clone = element.cloneNode(true) as HTMLElement;
    for (const extra of clone.querySelectorAll("[data-label-extra]")) extra.remove();
    return (clone.textContent ?? "").trim();
  }

  /** Un bloc de mensuration masqué parce que la catégorie ne l'utilise pas — distinct d'une étape simplement non affichée. */
  const isMeasureHidden = (element: Element | null) => Boolean(element?.closest<HTMLElement>("[data-measure]")?.hidden);

  function selectedText(name: string): string {
    const select = control(name);
    return select instanceof HTMLSelectElement && select.value ? (select.selectedOptions[0]?.textContent ?? "") : "";
  }

  function checkedLabels(name: string): string[] {
    return Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)).map(
      (input) => input.closest("label")?.querySelector("span")?.textContent?.trim() ?? input.value,
    );
  }

  function buildReview() {
    const container = q<HTMLElement>("[data-review]")!;
    container.replaceChildren();
    const sections: { step: number; rows: [string, string][] }[] = [
      {
        step: 1,
        rows: [
          [labelText("firstName"), `${value("firstName")} ${value("lastName")}`.trim()],
          [labelText("birthDate"), birthInput.value ? new Date(`${birthInput.value}T00:00:00Z`).toLocaleDateString(config.lang, { timeZone: "UTC" }) : ""],
          [labelText("city"), [value("city"), countrySearch.value.trim()].filter(Boolean).join(", ")],
          [labelText("email"), value("email")],
          [labelText("phone"), phoneValue(dialInput, q("#phoneNumber"))],
        ],
      },
      {
        step: 2,
        rows: [
          [labelText("category"), [selectedText("category"), value("categoryOther")].filter(Boolean).join(" — ")],
          [labelText("experienceLevel"), selectedText("experienceLevel")],
          [labelText("experienceDuration"), selectedText("experienceDuration")],
          [labelText("portfolioLinks"), portfolioLinks().join(", ")],
          [labelText("instagram"), value("instagram")],
        ],
      },
      {
        step: 3,
        rows: ["heightCm", "chestCm", "waistCm", "hipsCm", "inseamCm"]
          .filter((name) => !isMeasureHidden(control(name)))
          .map((name): [string, string] => [labelText(name), value(name)])
          .concat([
            [labelText("shoeSize"), isMeasureHidden(control("shoeSize")) ? "" : [value("shoeSize"), value("shoeSystem")].filter(Boolean).join(" ")],
            [labelText("eyeColor"), selectedText("eyeColor")],
            [labelText("hairColor"), selectedText("hairColor")],
          ]),
      },
      {
        step: 4,
        rows: [[i18n.stepTitles[3] ?? "", `${[photoIdOf("portrait"), photoIdOf("profile"), photoIdOf("full_length"), ...extraPhotoIds()].filter(Boolean).length} ${i18n.reviewPhotos}`]],
      },
      {
        step: 5,
        rows: [
          [labelText("languages"), [...checkedLabels("languages"), value("languagesOther")].filter(Boolean).join(", ")],
          [labelText("mobility"), checkedLabels("mobility").join("")],
          [labelText("projects"), checkedLabels("desiredProjects").join(", ")],
        ],
      },
    ];

    for (const section of sections) {
      const rows = section.rows.filter(([, text]) => text);
      if (!rows.length) continue;
      const block = document.createElement("div");
      const header = document.createElement("div");
      header.className = "flex items-baseline justify-between gap-4";
      const heading = document.createElement("p");
      heading.className = "label-tracked text-(--color-paper)/60";
      heading.textContent = i18n.stepTitles[section.step - 1] ?? "";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "min-h-11 text-sm text-(--color-gold) underline underline-offset-4";
      edit.textContent = i18n.reviewEdit;
      edit.addEventListener("click", () => showStep(section.step));
      header.append(heading, edit);
      const list = document.createElement("dl");
      list.className = "mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2";
      for (const [label, text] of rows) {
        const dt = document.createElement("dt");
        dt.className = "text-sm text-(--color-paper)/40";
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.className = "text-(--color-paper) break-words";
        dd.textContent = text;
        list.append(dt, dd);
      }
      block.append(header, list);
      container.append(block);
    }
  }

  // --- Validation par étape -----------------------------------------------------------

  const validators: Record<number, () => string[]> = { 1: validateStep1, 2: validateStep2, 3: validateStep3, 4: validateStep4, 5: validateStep5 };

  function validateCurrentStep(): boolean {
    const fieldset = steps.find((s) => Number(s.dataset.step) === currentStep);
    if (fieldset) clearErrorsIn(fieldset);
    const invalid = validators[currentStep]?.() ?? [];
    if (invalid.length === 0) return true;
    focusTargetFor(invalid[0]!)?.focus();
    if (invalid[0] !== "photoPending") statusEl.textContent = i18n.errors.validation;
    return false;
  }

  // Une correction efface son message d'erreur au fil de la saisie.
  form.addEventListener("input", (event) => {
    dirty = true;
    const target = event.target as FieldControl;
    const name = target.name || (target.id === "phoneNumber" || target.id === "phoneDialCode" ? "phone" : target.id === "countrySearch" ? "country" : "");
    if (name) clearError(name);
  });
  form.addEventListener("change", (event) => {
    dirty = true;
    const target = event.target as HTMLInputElement;
    if (target.name) clearError(target.name);
  });

  // --- Payload et envoi ---------------------------------------------------------------

  const numberOrUndefined = (name: string) => {
    const element = control(name);
    if (!element || isMeasureHidden(element) || !element.value.trim()) return undefined;
    return parseDecimal(element.value);
  };
  const textOrUndefined = (name: string) => value(name) || undefined;

  function buildPayload() {
    const minor = isMinor();
    const model = isModelCategory();
    return {
      honeypot: value("company"),
      submissionId,
      lang: config.lang,
      firstName: value("firstName"),
      lastName: value("lastName"),
      birthDate: birthInput.value,
      city: value("city"),
      country: countryCode.value,
      email: value("email"),
      phone: phoneValue(dialInput, q("#phoneNumber")),
      legalGuardianName: minor ? value("legalGuardianName") : undefined,
      legalGuardianEmail: minor ? value("legalGuardianEmail") : undefined,
      legalGuardianPhone: minor ? value("legalGuardianPhone") : undefined,
      category: categorySelect.value,
      categoryOther: categorySelect.value === "other" ? value("categoryOther") : undefined,
      experienceLevel: value("experienceLevel"),
      experienceDuration: value("experienceDuration"),
      portfolioLinks: portfolioLinks(),
      instagram: textOrUndefined("instagram"),
      currentAgency: textOrUndefined("currentAgency"),
      exclusivity: textOrUndefined("exclusivity"),
      heightCm: numberOrUndefined("heightCm"),
      chestCm: model ? numberOrUndefined("chestCm") : undefined,
      waistCm: model ? numberOrUndefined("waistCm") : undefined,
      hipsCm: model ? numberOrUndefined("hipsCm") : undefined,
      inseamCm: model ? numberOrUndefined("inseamCm") : undefined,
      shoeSize: model ? numberOrUndefined("shoeSize") : undefined,
      shoeSystem: model ? textOrUndefined("shoeSystem") : undefined,
      clothingSize: model ? textOrUndefined("clothingSize") : undefined,
      eyeColor: textOrUndefined("eyeColor"),
      hairColor: textOrUndefined("hairColor"),
      photoIds: {
        portrait: [photoIdOf("portrait")].filter(Boolean),
        profile: [photoIdOf("profile")].filter(Boolean),
        full_length: [photoIdOf("full_length")].filter(Boolean),
        extra: extraPhotoIds(),
      },
      languages: checkedValues("languages"),
      languagesOther: textOrUndefined("languagesOther"),
      mobility: value("mobility"),
      desiredProjects: checkedValues("desiredProjects"),
      motivation: textOrUndefined("motivation"),
      accuracyConfirmed: (control("accuracyConfirmed") as HTMLInputElement).checked,
      privacyNoticeAccepted: (control("privacyNoticeAccepted") as HTMLInputElement).checked,
      privacyNoticeVersion: config.privacyNoticeVersion,
    };
  }

  /** Message localisé pour une erreur renvoyée par le serveur — jamais le texte brut de l'API. */
  function serverMessage(field: string, reason: string): string {
    if (reason === "minors_not_accepted") return config.minorsMessage;
    if (reason === "required") return field.startsWith("photo.") ? i18n.errors.photoRequired : i18n.errors.required;
    if (reason === "too_long") return i18n.errors.tooLong;
    if (reason === "out_of_range") {
      const limits = field === "shoeSize" ? config.shoeSizeLimits : config.measurementLimits[field];
      return limits ? rangeMessage(limits[0], limits[1]) : i18n.errors.validation;
    }
    if (reason === "format" || reason === "implausible" || reason === "too_many") {
      if (field === "email" || field === "legalGuardianEmail") return i18n.errors.email;
      if (field === "phone" || field === "legalGuardianPhone") return i18n.errors.phone;
      if (field === "birthDate") return i18n.errors.date;
      if (field === "portfolioLinks") return i18n.errors.url;
      if (field === "instagram") return i18n.errors.instagram;
    }
    if (field === "country") return i18n.errors.country;
    if (reason === "invalid" || reason === "duplicate") return i18n.errors.invalidChoice;
    return i18n.errors.validation;
  }

  let sending = false;

  async function submitApplication() {
    // Un seul envoi à la fois : le bouton est désactivé, et ce verrou couvre
    // aussi un double déclenchement avant que le navigateur ait repeint.
    if (sending) return;
    sending = true;
    continueBtn.disabled = true;
    continueBtn.setAttribute("aria-busy", "true");
    continueBtn.textContent = i18n.navSubmitting;
    statusEl.textContent = "";
    let data:
      | { ok: boolean; reference?: string; reason?: string; confirmationEmail?: string; errors?: { field: string; reason: string }[] }
      | undefined;
    let networkFailure = false;
    try {
      const response = await fetch("/api/talent-application/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
        // Une requête qui ne répond jamais ne doit pas bloquer l'écran : le
        // candidat peut réessayer, le même submissionId évite tout doublon.
        signal: AbortSignal.timeout(45_000),
      });
      data = await response.json();
    } catch {
      networkFailure = true;
      data = undefined;
    } finally {
      sending = false;
      continueBtn.removeAttribute("aria-busy");
    }

    // Le succès n'est affiché que sur la confirmation explicite du serveur,
    // référence comprise — jamais sur une simple absence d'erreur réseau.
    if (data?.ok && data.reference) {
      submitted = true;
      navControls.hidden = true;
      for (const fieldset of steps) fieldset.hidden = true;
      progressEl.textContent = "";
      titleEl.textContent = "";
      barEl.style.width = "100%";
      const panel = q<HTMLElement>("[data-success-panel]")!;
      panel.hidden = false;
      q<HTMLElement>("[data-success-message]")!.textContent = config.confirmationMessage || i18n.successDefault;
      q<HTMLElement>("[data-success-reference]")!.textContent = data.reference;
      // Le navigateur ne dit « e-mail envoyé » que si le fournisseur l'a accepté.
      q<HTMLElement>("[data-success-email]")!.textContent =
        data.confirmationEmail === "sent" ? i18n.successEmailSent : i18n.successEmailPending;
      panel.focus();
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    continueBtn.disabled = false;
    continueBtn.textContent = i18n.navRetry;

    if (data?.reason === "validation" && data.errors?.length) {
      for (const error of data.errors) setError(error.field, serverMessage(error.field, error.reason));
      // Retour à l'étape qui porte la première erreur, focus sur le champ.
      const first = data.errors.find((error) => focusTargetFor(error.field)) ?? data.errors[0]!;
      const target = focusTargetFor(first.field);
      const step = stepOf(target);
      if (step && step !== currentStep) {
        showStep(step, false);
        for (const error of data.errors) setError(error.field, serverMessage(error.field, error.reason));
      }
      target?.focus();
      statusEl.textContent = i18n.errors.validation;
      return;
    }
    if (data?.reason === "photo_missing_or_expired") {
      showStep(4, false);
      statusEl.textContent = i18n.errors.photoExpired;
      return;
    }
    if (data?.reason === "photo_already_used") {
      showStep(4, false);
      statusEl.textContent = i18n.errors.photoReused;
      return;
    }
    const messages: Record<string, string> = {
      closed: i18n.errors.closed,
      rate_limited: i18n.errors.rateLimited,
      unavailable: i18n.errors.unavailable,
    };
    statusEl.textContent = networkFailure ? i18n.errors.network : (messages[data?.reason ?? ""] ?? i18n.errors.generic);
  }

  // --- Câblage --------------------------------------------------------------------------

  backBtn.addEventListener("click", () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });
  continueBtn.addEventListener("click", () => {
    if (!validateCurrentStep()) return;
    if (currentStep < TOTAL_STEPS) showStep(currentStep + 1);
    else void submitApplication();
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  // Changer de langue ou quitter la page recharge le formulaire : sans
  // stockage local (exclu volontairement), seule une confirmation évite de
  // perdre des réponses saisies.
  window.addEventListener("beforeunload", (event) => {
    if (!dirty || submitted) return;
    event.preventDefault();
  });

  updateMinorUi();
  updateCategoryUi();
  showStep(1, false);
}
