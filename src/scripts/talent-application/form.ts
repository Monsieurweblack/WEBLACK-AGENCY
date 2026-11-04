/**
 * Formulaire de candidature Talent — une seule page : cinq étapes puis un
 * écran de vérification, affichés et masqués en JS. Rien n'est retiré du DOM
 * entre deux étapes : les réponses (et les photos déjà envoyées) survivent
 * nativement dans les champs, sans localStorage ni sessionStorage — aucune
 * donnée personnelle n'est écrite dans le navigateur. Seul un départ de la
 * page les perdrait : une confirmation est alors demandée (beforeunload).
 *
 * Progression honnête : une étape n'est « validée » que lorsque ses contrôles
 * ont réellement réussi, et redevient « à compléter » dès qu'un de ses champs
 * change. L'écran de vérification n'est accessible qu'une fois les cinq
 * étapes validées.
 *
 * Les messages d'erreur sont écrits ici, dans la langue de la page — jamais
 * par la bulle de validation native du navigateur, qui suit la langue du
 * système et mélangerait français et anglais. Ce contrôle guide la saisie ;
 * la validation qui fait foi reste celle du serveur (functions/lib/validation.ts),
 * dont les erreurs sont reprises champ par champ.
 */

import { SIGNATURE_EASING } from "../motion/tokens";

interface Config {
  lang: "fr" | "en";
  minorsMessage: string;
  confirmationMessage: string;
  privacyNoticeVersion: string;
  dialCodes: Record<string, string>;
  modelCategories: string[];
  measurementLimits: Record<string, [number, number]>;
  shoeSizeLimits: [number, number];
  textLimits: Record<string, number>;
  upload: { originalMaxBytes: number; maxDimension: number; acceptedTypes: string[]; maxExtraPhotos: number };
}

type PhotoRoleKey = "portrait" | "profile" | "full_length" | "extra";
type ReviewSectionKey = "identity" | "contact" | "professional" | "measurements" | "photos" | "languages" | "presentation";

interface Strings {
  progress: string;
  progressValidated: string;
  stepTitles: string[];
  stepperDone: string;
  stepperCurrent: string;
  stepperTodo: string;
  errorSummary: string;
  navContinue: string;
  navReview: string;
  navBackToReview: string;
  navSubmit: string;
  navSubmitting: string;
  navRetry: string;
  photoChoose: string;
  photoReplace: string;
  photoPreparing: string;
  photoUploading: string;
  photoUploaded: string;
  photoRetry: string;
  photoError: string;
  photoInvalidType: string;
  photoTooLarge: string;
  photoDropInvalid: string;
  reviewEdit: string;
  reviewEmpty: string;
  reviewSections: Record<ReviewSectionKey, string>;
  photoRoles: Record<PhotoRoleKey, string>;
  languagesSelected: string;
  languagesRemove: string;
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
const REVIEW_STEP = 6;
const JPEG_QUALITY = 0.85;
/** Aperçu local : une vignette légère, jamais l'image envoyée relue en entier. */
const PREVIEW_MAX = 480;
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
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const q = <T extends Element>(selector: string) => form.querySelector<T>(selector);
  const steps = Array.from(form.querySelectorAll<HTMLFieldSetElement>("fieldset[data-step]"));
  const progressEl = q<HTMLElement>("[data-step-progress]")!;
  const titleEl = q<HTMLElement>("[data-step-title]")!;
  const requiredNote = q<HTMLElement>("[data-required-note]")!;
  const backBtn = q<HTMLButtonElement>("[data-nav-back]")!;
  const toReviewBtn = q<HTMLButtonElement>("[data-nav-to-review]")!;
  const continueBtn = q<HTMLButtonElement>("[data-nav-continue]")!;
  const statusEl = q<HTMLElement>("[data-form-status]")!;
  const navControls = q<HTMLElement>("[data-nav-controls]")!;
  const summaryEl = q<HTMLElement>("[data-error-summary]")!;
  const summaryTitle = q<HTMLElement>("[data-error-summary-title]")!;
  const summaryList = q<HTMLElement>("[data-error-summary-list]")!;
  const stepperButtons = Array.from(form.querySelectorAll<HTMLButtonElement>("[data-stepper-go]"));
  const validatedEl = q<HTMLElement>("[data-progress-validated]")!;

  let currentStep = 1;
  let dirty = false;
  let submitted = false;
  let pendingUploads = 0;
  /** Étapes dont les contrôles ont réussi, et qui n'ont pas été modifiées depuis. */
  const validated = new Set<number>();
  /** Vrai quand on modifie une section depuis l'écran de vérification : « Retour à la vérification » est proposé. */
  let editingFromReview = false;
  // Tiré une fois pour ce formulaire : chaque nouvel essai d'envoi porte le
  // même identifiant, le serveur reconnaît un dossier déjà enregistré.
  const submissionId = crypto.randomUUID();

  // --- Utilitaires de champ ---------------------------------------------------

  /**
   * Toujours un élément, jamais une RadioNodeList : pour un groupe de cases
   * (catégorie, langues, mobilité…), namedItem() renvoie la liste entière,
   * qui n'a ni focus() ni setAttribute() — on prend alors sa première case.
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

  const checkedInputs = (name: string) => Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`));
  const checkedValues = (name: string): string[] => checkedInputs(name).map((input) => input.value);
  /** Libellé visible d'une case cochée (carte de choix ou case simple). */
  const choiceLabel = (input: HTMLInputElement) =>
    (input.closest("label")?.querySelector(".choice-label, span:not([aria-hidden])")?.textContent ?? input.value).trim();
  const checkedLabels = (name: string): string[] => checkedInputs(name).map(choiceLabel);

  /** L'élément qui reçoit le focus et aria-invalid pour un nom d'erreur donné. */
  function focusTargetFor(name: string): HTMLElement | null {
    if (name === "phone") return q("#phoneNumber");
    if (name === "country") return q("#countrySearch");
    if (name === "languages") return q("#languagesSearch");
    if (name.startsWith("photo.")) return q(`.photo-slot[data-photo-role="${name.slice(6)}"] [data-photo-trigger]`);
    return control(name);
  }

  function setError(name: string, message: string) {
    const target = q<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
    if (target) {
      target.textContent = message;
      target.hidden = false;
    }
    focusTargetFor(name)?.setAttribute("aria-invalid", "true");
    if (name === "phone") q("#phoneDialCode")?.setAttribute("aria-invalid", "true");
  }

  function clearError(name: string) {
    const target = q<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
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

  // --- Progression et navigation -----------------------------------------------

  /** Une étape est accessible si toutes celles qui la précèdent sont validées. */
  const reachable = (step: number) => Array.from({ length: step - 1 }, (_, i) => i + 1).every((n) => validated.has(n));

  function renderStepper() {
    for (const button of stepperButtons) {
      const n = Number(button.dataset.stepperGo);
      const state = n === currentStep && !submitted ? "current" : validated.has(n) || (submitted && n === REVIEW_STEP) ? "done" : "todo";
      button.dataset.state = state;
      button.toggleAttribute("aria-current", state === "current");
      if (state === "current") button.setAttribute("aria-current", "step");
      button.disabled = submitted || (n !== currentStep && !reachable(n));
      button.querySelector<HTMLElement>("[data-stepper-state]")!.textContent =
        state === "done" ? i18n.stepperDone : state === "current" ? i18n.stepperCurrent : i18n.stepperTodo;
    }
    const count = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).filter((n) => validated.has(n)).length;
    validatedEl.textContent = i18n.progressValidated.replace("{n}", String(count));
  }

  function hideSummary() {
    summaryEl.hidden = true;
    summaryList.replaceChildren();
  }

  function showStep(step: number, { focusTitle = true, fromReview = false, scroll = true } = {}) {
    const previous = currentStep;
    currentStep = step;
    editingFromReview = fromReview || (editingFromReview && step !== REVIEW_STEP);
    if (step === REVIEW_STEP) editingFromReview = false;
    for (const fieldset of steps) fieldset.hidden = Number(fieldset.dataset.step) !== step;
    progressEl.textContent = step === REVIEW_STEP ? "" : i18n.progress.replace("{n}", String(step));
    titleEl.textContent = i18n.stepTitles[step - 1] ?? "";
    backBtn.hidden = step === 1;
    toReviewBtn.hidden = !(editingFromReview && step !== REVIEW_STEP);
    continueBtn.textContent = step === REVIEW_STEP ? i18n.navSubmit : step === TOTAL_STEPS ? i18n.navReview : i18n.navContinue;
    statusEl.textContent = "";
    hideSummary();
    if (step === REVIEW_STEP) buildReview();
    renderStepper();
    // Transition entre étapes : un glissé court, dans le sens du parcours.
    // Jamais d'opacité nulle maintenue : le contenu est lisible à chaque image.
    const shown = steps.find((s) => Number(s.dataset.step) === step);
    if (shown && !reducedMotion && previous !== step) {
      shown.animate(
        [
          { opacity: 0.35, transform: `translateX(${step > previous ? 18 : -18}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: 420, easing: SIGNATURE_EASING },
      );
    }
    if (scroll) form.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    if (focusTitle) titleEl.focus({ preventScroll: true });
  }

  const stepOf = (element: Element | null): number => Number(element?.closest<HTMLElement>("fieldset[data-step]")?.dataset.step ?? 0);

  // --- Étape 1 : identité et coordonnées -------------------------------------------

  const birthInput = q<HTMLInputElement>("#birthDate")!;
  const minorBlock = q<HTMLElement>("[data-minor-block]")!;
  const minorGated = q<HTMLElement>("[data-minor-gated]")!;
  // La date du jour bornant le sélecteur : une naissance ne peut pas être future.
  birthInput.max = new Date().toISOString().slice(0, 10);

  const isMinor = () => {
    const age = computeAge(birthInput.value);
    return typeof age === "number" && age >= 0 && age < 18;
  };

  // Programme réservé aux 18 ans et plus : un âge mineur ferme la suite du
  // parcours dans le navigateur ; le serveur le refuse de toute façon.
  function updateMinorUi() {
    const minor = isMinor();
    minorBlock.hidden = !minor;
    minorBlock.textContent = minor ? config.minorsMessage : "";
    minorGated.hidden = minor;
    if (currentStep === 1) continueBtn.disabled = minor;
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

  function validateStep1(fail: (name: string, message: string) => void) {
    for (const name of ["firstName", "lastName"]) if (!value(name)) fail(name, i18n.errors.required);
    if (!birthInput.value) fail("birthDate", i18n.errors.required);
    else {
      const age = computeAge(birthInput.value);
      if (age === undefined || age < 0 || age > 100) fail("birthDate", i18n.errors.date);
      else if (age < 18) fail("birthDate", config.minorsMessage);
    }
    if (minorGated.hidden) return;
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
  }

  // --- Étape 2 : profil et expérience ------------------------------------------------

  const categoryOtherBlock = q<HTMLElement>("[data-category-other]")!;
  const category = () => value("category");
  const isModelCategory = () => config.modelCategories.includes(category());

  function updateCategoryUi() {
    categoryOtherBlock.hidden = category() !== "other";
    // Mensurations complètes seulement là où elles servent un casting ; pour
    // un talent créatif, la taille, les yeux et les cheveux suffisent.
    const limited = category() !== "" && !isModelCategory();
    for (const block of form.querySelectorAll<HTMLElement>('[data-measure="model"]')) block.hidden = limited;
    q<HTMLElement>("[data-measurements-limited]")!.hidden = !limited;
  }
  for (const radio of form.querySelectorAll<HTMLInputElement>("[data-category]")) radio.addEventListener("change", updateCategoryUi);

  function portfolioLinks(): string[] {
    return value("portfolioLinks")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function validateStep2(fail: (name: string, message: string) => void) {
    if (!category()) fail("category", i18n.errors.required);
    if (category() === "other" && !value("categoryOther")) fail("categoryOther", i18n.errors.required);
    if (!value("experienceLevel")) fail("experienceLevel", i18n.errors.required);
    if (!value("experienceDuration")) fail("experienceDuration", i18n.errors.required);
    const links = portfolioLinks();
    if (links.length > config.textLimits.portfolioLinksCount! || !links.every((link) => link.length <= config.textLimits.portfolioLink! && isHttpUrl(link))) {
      fail("portfolioLinks", i18n.errors.url);
    }
    const instagram = value("instagram");
    if (instagram && !INSTAGRAM_RE.test(instagram)) fail("instagram", i18n.errors.instagram);
  }

  // --- Étape 3 : mensurations (facultatives, jamais éliminatoires) --------------------

  function validateStep3(fail: (name: string, message: string) => void) {
    for (const input of form.querySelectorAll<HTMLInputElement>("[data-decimal]")) {
      if (input.closest<HTMLElement>("[hidden]:not(fieldset)") || input.value.trim() === "") continue;
      const parsed = parseDecimal(input.value);
      const min = Number(input.dataset.min);
      const max = Number(input.dataset.max);
      const shoeStep = input.name === "shoeSize" && parsed !== undefined && (parsed * 2) % 1 !== 0;
      if (parsed === undefined || parsed < min || parsed > max || shoeStep) fail(input.name, rangeMessage(min, max));
    }
    if (isModelCategory() && value("shoeSize") && !value("shoeSystem")) fail("shoeSystem", i18n.errors.shoeSystem);
  }

  // --- Étape 4 : photographies ---------------------------------------------------------

  /**
   * Une seule lecture du fichier : il est décodé une fois (createImageBitmap),
   * puis dessiné deux fois — en JPEG ≤ 1600 px pour l'envoi (format uniforme,
   * HEIC d'iPhone compris, aucune métadonnée : un canvas ne porte pas d'EXIF),
   * et en vignette ≤ 480 px pour l'aperçu. Aucun filtre, aucune retouche.
   */
  async function prepareImage(file: File): Promise<{ upload: Blob; preview: string }> {
    const bitmap = await createImageBitmap(file);
    try {
      const draw = (max: number) => {
        const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas;
      };
      const uploadCanvas = draw(config.upload.maxDimension);
      const upload = await new Promise<Blob>((resolve, reject) =>
        uploadCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", JPEG_QUALITY),
      );
      uploadCanvas.width = uploadCanvas.height = 0; // libère la mémoire du canvas plein format
      // data: et non blob: — la CSP du site n'autorise que data: en img-src.
      const preview = draw(PREVIEW_MAX).toDataURL("image/jpeg", 0.8);
      return { upload, preview };
    } finally {
      bitmap.close();
    }
  }

  function uploadWithProgress(blob: Blob, role: string, onProgress: (ratio: number) => void): Promise<{ ok: boolean; photoId?: string; reason?: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/talent-application/upload");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
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
    const removeBtn = slot.querySelector<HTMLButtonElement>("[data-photo-remove]");
    const preview = slot.querySelector<HTMLImageElement>("[data-photo-preview]")!;
    const status = slot.querySelector<HTMLElement>("[data-photo-status]")!;
    const nameEl = slot.querySelector<HTMLElement>("[data-photo-name]")!;
    const bar = slot.querySelector<HTMLElement>("[data-photo-bar]")!;
    const drop = slot.querySelector<HTMLElement>("[data-photo-drop]")!;
    let generation = 0;

    const setState = (state: "empty" | "preparing" | "uploading" | "done" | "error") => (slot.dataset.state = state);
    const setProgress = (ratio: number) => bar.style.setProperty("--progress", ratio.toFixed(3));

    const fail = (message: string, retryable: boolean) => {
      setState("error");
      status.textContent = message;
      status.dataset.failed = retryable ? "true" : "false";
      trigger.textContent = retryable ? i18n.photoRetry : i18n.photoChoose;
    };

    trigger.addEventListener("click", () => {
      const lastFile = photoFiles.get(slot);
      if (lastFile && status.dataset.failed === "true") void runUpload(lastFile);
      else input.click();
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = ""; // le même fichier peut être choisi de nouveau après une suppression
      if (file) void runUpload(file);
    });

    // Glisser-déposer (souris) : un seul fichier image par emplacement.
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.dataset.drag = "";
    });
    drop.addEventListener("dragleave", () => delete slot.dataset.drag);
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      delete slot.dataset.drag;
      const files = event.dataTransfer?.files;
      if (!files || files.length !== 1) {
        fail(i18n.photoDropInvalid, false);
        return;
      }
      void runUpload(files[0]!);
    });

    removeBtn?.addEventListener("click", () => {
      generation += 1; // un envoi encore en cours ne réécrira plus cet emplacement
      photoFiles.delete(slot);
      idField.value = "";
      preview.hidden = true;
      preview.removeAttribute("src");
      nameEl.textContent = "";
      status.textContent = "";
      status.dataset.failed = "false";
      trigger.textContent = i18n.photoChoose;
      removeBtn.hidden = true;
      setProgress(0);
      setState("empty");
      invalidate(4);
      trigger.focus();
    });

    async function runUpload(file: File) {
      const run = ++generation;
      photoFiles.set(slot, file);
      invalidate(4);
      if (role !== "extra") clearError(`photo.${role}`);
      status.dataset.failed = "false";
      idField.value = "";
      nameEl.textContent = file.name;
      if (!config.upload.acceptedTypes.includes(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
        fail(i18n.photoInvalidType, false);
        return;
      }
      if (file.size > config.upload.originalMaxBytes) {
        fail(i18n.photoTooLarge, false);
        return;
      }
      pendingUploads += 1;
      try {
        setState("preparing");
        setProgress(0);
        status.textContent = i18n.photoPreparing;
        let prepared: { upload: Blob; preview: string };
        try {
          prepared = await prepareImage(file);
        } catch {
          if (run === generation) fail(i18n.photoInvalidType, false);
          return;
        }
        if (run !== generation) return;
        preview.src = prepared.preview;
        preview.hidden = false;
        setState("uploading");
        status.textContent = `${i18n.photoUploading} 0 %`;
        const result = await uploadWithProgress(prepared.upload, role, (ratio) => {
          if (run !== generation) return;
          setProgress(ratio);
          status.textContent = `${i18n.photoUploading} ${Math.round(ratio * 100)} %`;
        });
        if (run !== generation) return;
        if (result.ok && result.photoId) {
          idField.value = result.photoId;
          setProgress(1);
          setState("done");
          status.textContent = i18n.photoUploaded;
          trigger.textContent = i18n.photoReplace;
          if (removeBtn) removeBtn.hidden = false;
        } else {
          fail(result.reason === "invalid_type" ? i18n.photoInvalidType : i18n.photoError, result.reason !== "invalid_type");
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
  const maxExtra = config.upload.maxExtraPhotos ?? 3;
  addExtraBtn.addEventListener("click", () => {
    if (extraContainer.children.length >= maxExtra) return;
    const fragment = extraTemplate.content.cloneNode(true) as DocumentFragment;
    const entry = fragment.querySelector<HTMLElement>("[data-extra-entry]")!;
    initPhotoSlot(entry);
    entry.querySelector<HTMLButtonElement>("[data-remove-extra]")!.addEventListener("click", () => {
      photoFiles.delete(entry);
      entry.remove();
      addExtraBtn.hidden = extraContainer.children.length >= maxExtra;
      addExtraBtn.focus();
    });
    extraContainer.append(fragment);
    addExtraBtn.hidden = extraContainer.children.length >= maxExtra;
    entry.querySelector<HTMLButtonElement>("[data-photo-trigger]")!.focus();
  });

  const photoIdOf = (role: string) => q<HTMLInputElement>(`.photo-slot[data-photo-role="${role}"]:not([data-extra-entry]) [data-photo-id-field]`)?.value ?? "";
  const extraPhotoIds = () =>
    Array.from(extraContainer.querySelectorAll<HTMLInputElement>("[data-photo-id-field]"))
      .map((field) => field.value)
      .filter(Boolean);

  function validateStep4(fail: (name: string, message: string) => void) {
    if (pendingUploads > 0) {
      fail("photoPending", i18n.errors.photoPending);
      return;
    }
    for (const role of ["portrait", "profile", "full_length"]) {
      if (!photoIdOf(role)) fail(`photo.${role}`, i18n.errors.photoRequired);
    }
  }

  // --- Étape 5 : langues, mobilité et finalisation ---------------------------------

  const languagesSearch = q<HTMLInputElement>("[data-languages-search]")!;
  const languagesCount = q<HTMLElement>("[data-languages-count]")!;
  const languagesChips = q<HTMLElement>("[data-languages-chips]")!;
  const languagesEmpty = q<HTMLElement>("[data-languages-empty]")!;
  const languageOptions = Array.from(form.querySelectorAll<HTMLElement>("[data-language-option]"));
  languagesSearch.addEventListener("input", () => {
    const term = languagesSearch.value.trim().toLocaleLowerCase(config.lang);
    let visible = 0;
    for (const option of languageOptions) {
      option.hidden = term !== "" && !option.dataset.search!.includes(term);
      if (!option.hidden) visible += 1;
    }
    languagesEmpty.hidden = visible > 0;
  });
  // Entrée dans la recherche : coche la première langue proposée, sans envoyer le formulaire.
  languagesSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = languageOptions.find((option) => !option.hidden)?.querySelector<HTMLInputElement>("input");
    if (first && !first.checked) {
      first.checked = true;
      first.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const updateLanguages = () => {
    const checked = checkedInputs("languages");
    languagesCount.textContent = checked.length ? `${checked.length} ${i18n.languagesSelected}` : "";
    languagesChips.replaceChildren(
      ...checked.map((input) => {
        const name = choiceLabel(input);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className =
          "inline-flex min-h-9 items-center gap-2 border border-(--color-gold)/60 px-3 text-sm text-(--color-paper) transition-colors hover:border-(--color-gold) focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-gold)";
        chip.setAttribute("aria-label", i18n.languagesRemove.replace("{name}", name));
        chip.append(name, Object.assign(document.createElement("span"), { textContent: "×", ariaHidden: "true", className: "text-(--color-gold)" }));
        chip.addEventListener("click", () => {
          input.checked = false;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          languagesSearch.focus();
        });
        return chip;
      }),
    );
  };
  q<HTMLElement>("[data-languages-list]")!.addEventListener("change", updateLanguages);

  const motivation = q<HTMLTextAreaElement>("#motivation")!;
  const motivationCount = q<HTMLElement>("[data-motivation-count]")!;
  const updateMotivationCount = () => {
    const left = config.textLimits.motivation! - motivation.value.length;
    motivationCount.textContent = `${left} ${i18n.charactersLeft}`;
  };
  motivation.addEventListener("input", updateMotivationCount);
  updateMotivationCount();

  function validateStep5(fail: (name: string, message: string) => void) {
    if (checkedValues("languages").length === 0 && !value("languagesOther")) fail("languages", i18n.errors.languages);
    if (!value("mobility")) fail("mobility", i18n.errors.required);
    if (motivation.value.length > config.textLimits.motivation!) fail("motivation", i18n.errors.tooLong);
  }

  function validateReview(fail: (name: string, message: string) => void) {
    if (!(control("accuracyConfirmed") as HTMLInputElement).checked) fail("accuracyConfirmed", i18n.errors.required);
    if (!(control("privacyNoticeAccepted") as HTMLInputElement).checked) fail("privacyNoticeAccepted", i18n.errors.required);
  }

  // --- Écran de vérification ---------------------------------------------------------

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

  function buildReview() {
    const container = q<HTMLElement>("[data-review]")!;
    container.replaceChildren();
    const birth = birthInput.value ? new Date(`${birthInput.value}T00:00:00Z`).toLocaleDateString(config.lang, { timeZone: "UTC", dateStyle: "long" }) : "";
    const sections: { key: ReviewSectionKey; step: number; rows?: [string, string][]; photos?: boolean }[] = [
      { key: "identity", step: 1, rows: [[labelText("firstName"), value("firstName")], [labelText("lastName"), value("lastName")], [labelText("birthDate"), birth]] },
      {
        key: "contact",
        step: 1,
        rows: [
          [labelText("city"), value("city")],
          [labelText("countrySearch"), countrySearch.value.trim()],
          [labelText("email"), value("email")],
          [labelText("phone"), phoneValue(dialInput, q("#phoneNumber"))],
        ],
      },
      {
        key: "professional",
        step: 2,
        rows: [
          [labelText("category"), [checkedLabels("category").join(""), category() === "other" ? value("categoryOther") : ""].filter(Boolean).join(" — ")],
          [labelText("experienceLevel"), checkedLabels("experienceLevel").join("")],
          [labelText("experienceDuration"), checkedLabels("experienceDuration").join("")],
          [labelText("portfolioLinks"), portfolioLinks().join("\n")],
          [labelText("instagram"), value("instagram")],
          [labelText("currentAgency"), value("currentAgency")],
          [labelText("exclusivity"), value("exclusivity")],
        ],
      },
      {
        key: "measurements",
        step: 3,
        rows: ["heightCm", "chestCm", "waistCm", "hipsCm", "inseamCm"]
          .filter((name) => !isMeasureHidden(control(name)))
          .map((name): [string, string] => [labelText(name), value(name)])
          .concat(
            isMeasureHidden(control("shoeSize"))
              ? []
              : [
                  [labelText("shoeSize"), [value("shoeSize"), value("shoeSystem")].filter(Boolean).join(" ")],
                  [labelText("clothingSize"), value("clothingSize")],
                ],
          )
          .concat([
            [labelText("eyeColor"), selectedText("eyeColor")],
            [labelText("hairColor"), selectedText("hairColor")],
          ]),
      },
      { key: "photos", step: 4, photos: true },
      {
        key: "languages",
        step: 5,
        rows: [
          [labelText("languages"), [...checkedLabels("languages"), value("languagesOther")].filter(Boolean).join(", ")],
          [labelText("mobility"), checkedLabels("mobility").join("")],
          [labelText("projects"), checkedLabels("desiredProjects").join(", ")],
        ],
      },
      { key: "presentation", step: 5, rows: [[labelText("motivation"), motivation.value.trim()]] },
    ];

    for (const section of sections) {
      const block = document.createElement("section");
      block.className = "grid grid-cols-1 gap-4 border-b border-(--color-line) py-8 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:gap-8";
      const heading = document.createElement("h3");
      heading.className = "label-tracked text-(--color-gold)";
      heading.textContent = i18n.reviewSections[section.key];
      const body = document.createElement("div");
      if (section.photos) {
        const grid = document.createElement("ul");
        grid.className = "m-0 grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-6";
        for (const slot of form.querySelectorAll<HTMLElement>(".photo-slot")) {
          const id = slot.querySelector<HTMLInputElement>("[data-photo-id-field]")?.value;
          const src = slot.querySelector<HTMLImageElement>("[data-photo-preview]")?.getAttribute("src");
          if (!id || !src) continue;
          const item = document.createElement("li");
          const img = document.createElement("img");
          img.src = src;
          img.alt = i18n.photoRoles[(slot.dataset.photoRole as PhotoRoleKey) ?? "extra"];
          img.className = "aspect-[3/4] w-full object-cover";
          const caption = document.createElement("span");
          caption.className = "mt-1 block truncate text-xs text-(--color-paper)/50";
          caption.textContent = img.alt;
          item.append(img, caption);
          grid.append(item);
        }
        body.append(grid);
      } else {
        const list = document.createElement("dl");
        list.className = "m-0 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2";
        for (const [label, text] of section.rows ?? []) {
          const row = document.createElement("div");
          const dt = document.createElement("dt");
          dt.className = "text-sm text-(--color-paper)/55";
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.className = text ? "m-0 whitespace-pre-line break-words text-(--color-paper)" : "m-0 text-(--color-paper)/55";
          dd.textContent = text || i18n.reviewEmpty;
          row.append(dt, dd);
          list.append(row);
        }
        body.append(list);
      }
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "min-h-11 justify-self-start text-sm text-(--color-gold) underline underline-offset-4 sm:justify-self-end";
      edit.textContent = i18n.reviewEdit;
      edit.setAttribute("aria-label", `${i18n.reviewEdit} — ${i18n.reviewSections[section.key]}`);
      edit.addEventListener("click", () => showStep(section.step, { fromReview: true }));
      block.append(heading, body, edit);
      container.append(block);
    }
  }

  // --- Validation par étape -----------------------------------------------------------

  const validators: Record<number, (fail: (name: string, message: string) => void) => void> = {
    1: validateStep1,
    2: validateStep2,
    3: validateStep3,
    4: validateStep4,
    5: validateStep5,
    6: validateReview,
  };

  /** Contrôle une étape ; en silence, ne touche ni aux messages ni au focus. */
  function runValidator(step: number, silent = false): { name: string; message: string }[] {
    const fieldset = steps.find((s) => Number(s.dataset.step) === step);
    const invalid: { name: string; message: string }[] = [];
    if (fieldset && !silent) clearErrorsIn(fieldset);
    validators[step]?.((name, message) => {
      invalid.push({ name, message });
      if (!silent && name !== "photoPending") setError(name, message);
    });
    return invalid;
  }

  function showErrors(invalid: { name: string; message: string }[]) {
    if (invalid.length === 1 && invalid[0]!.name === "photoPending") {
      statusEl.textContent = i18n.errors.photoPending;
      return;
    }
    summaryTitle.textContent = i18n.errorSummary.replace("{n}", String(invalid.length));
    summaryList.replaceChildren(
      ...invalid.map(({ name, message }) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${focusTargetFor(name)?.id ?? ""}`;
        link.className = "text-red-200 underline underline-offset-4";
        const label = name.startsWith("photo.") ? i18n.photoRoles[name.slice(6) as PhotoRoleKey] : labelText(name === "country" ? "countrySearch" : name);
        link.textContent = `${label} — ${message}`;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          const target = focusTargetFor(name);
          target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
          target?.focus({ preventScroll: true });
        });
        item.append(link);
        return item;
      }),
    );
    summaryEl.hidden = false;
    statusEl.textContent = i18n.errors.validation;
    // Premier champ invalide : focus et défilement jusqu'à lui ; le résumé est annoncé (role="alert").
    const first = focusTargetFor(invalid[0]!.name);
    first?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    first?.focus({ preventScroll: true });
  }

  function validateCurrentStep(): boolean {
    hideSummary();
    statusEl.textContent = "";
    const invalid = runValidator(currentStep);
    if (invalid.length === 0) {
      if (currentStep <= TOTAL_STEPS) validated.add(currentStep);
      return true;
    }
    validated.delete(currentStep);
    showErrors(invalid);
    renderStepper();
    return false;
  }

  /** Avant la vérification : toutes les étapes, dans l'ordre ; la première en défaut est rouverte avec ses erreurs. */
  function goToReview() {
    for (let n = 1; n <= TOTAL_STEPS; n++) {
      if (runValidator(n, true).length === 0) {
        validated.add(n);
        continue;
      }
      validated.delete(n);
      showStep(n, { focusTitle: false });
      showErrors(runValidator(n));
      return;
    }
    showStep(REVIEW_STEP);
  }

  /** Une étape modifiée redevient « à compléter » jusqu'à son prochain contrôle. */
  function invalidate(step: number) {
    if (step >= 1 && step <= TOTAL_STEPS && validated.delete(step)) renderStepper();
  }

  // Une correction efface son message d'erreur au fil de la saisie.
  form.addEventListener("input", (event) => {
    dirty = true;
    const target = event.target as FieldControl;
    if (target.type === "search") return; // filtrer les langues ne modifie pas le dossier
    invalidate(stepOf(target));
    const name = target.name || (target.id === "phoneNumber" || target.id === "phoneDialCode" ? "phone" : target.id === "countrySearch" ? "country" : "");
    if (name) clearError(name);
  });
  form.addEventListener("change", (event) => {
    dirty = true;
    const target = event.target as HTMLInputElement;
    if (target.type !== "search") invalidate(stepOf(target));
    if (target.name) clearError(target.name);
  });
  // État valide visible : un champ rempli, conforme à son type, et sans erreur.
  form.addEventListener("focusout", (event) => {
    const target = event.target as FieldControl;
    if (!target.classList?.contains("form-input") || target.type === "search") return;
    const ok = target.value.trim() !== "" && target.checkValidity() && target.getAttribute("aria-invalid") !== "true";
    target.toggleAttribute("data-valid", ok);
  });

  // --- Payload et envoi ---------------------------------------------------------------

  const numberOrUndefined = (name: string) => {
    const element = control(name);
    if (!element || isMeasureHidden(element) || !element.value.trim()) return undefined;
    return parseDecimal(element.value);
  };
  const textOrUndefined = (name: string) => value(name) || undefined;

  function buildPayload() {
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
      category: category(),
      categoryOther: category() === "other" ? value("categoryOther") : undefined,
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
      if (field === "email") return i18n.errors.email;
      if (field === "phone") return i18n.errors.phone;
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
    backBtn.disabled = true;
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
      backBtn.disabled = false;
    }

    // Le succès n'est affiché que sur la confirmation explicite du serveur,
    // référence comprise — jamais sur une simple absence d'erreur réseau.
    if (data?.ok && data.reference) {
      submitted = true;
      navControls.hidden = true;
      for (const fieldset of steps) fieldset.hidden = true;
      progressEl.textContent = "";
      titleEl.textContent = "";
      requiredNote.hidden = true;
      hideSummary();
      for (let n = 1; n <= TOTAL_STEPS; n++) validated.add(n);
      renderStepper();
      const panel = q<HTMLElement>("[data-success-panel]")!;
      panel.hidden = false;
      q<HTMLElement>("[data-success-message]")!.textContent = config.confirmationMessage || i18n.successDefault;
      q<HTMLElement>("[data-success-reference]")!.textContent = data.reference;
      // Le navigateur ne dit « e-mail envoyé » que si le fournisseur l'a accepté.
      q<HTMLElement>("[data-success-email]")!.textContent =
        data.confirmationEmail === "sent" ? i18n.successEmailSent : i18n.successEmailPending;
      panel.focus({ preventScroll: true });
      form.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      return;
    }

    continueBtn.disabled = false;
    continueBtn.textContent = i18n.navRetry;

    if (data?.reason === "validation" && data.errors?.length) {
      // Retour à l'étape qui porte la première erreur, avec ses messages et le focus.
      const first = data.errors.find((error) => focusTargetFor(error.field)) ?? data.errors[0]!;
      const step = stepOf(focusTargetFor(first.field));
      if (step) validated.delete(step);
      if (step && step !== currentStep) showStep(step, { focusTitle: false, fromReview: true });
      const onStep = data.errors.filter((error) => !step || stepOf(focusTargetFor(error.field)) === step);
      for (const error of data.errors) setError(error.field, serverMessage(error.field, error.reason));
      showErrors(onStep.map((error) => ({ name: error.field, message: serverMessage(error.field, error.reason) })));
      return;
    }
    if (data?.reason === "photo_missing_or_expired" || data?.reason === "photo_already_used") {
      validated.delete(4);
      showStep(4, { focusTitle: false, fromReview: true });
      statusEl.textContent = data.reason === "photo_missing_or_expired" ? i18n.errors.photoExpired : i18n.errors.photoReused;
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
  toReviewBtn.addEventListener("click", () => {
    if (validateCurrentStep()) goToReview();
  });
  continueBtn.addEventListener("click", () => {
    if (currentStep === REVIEW_STEP) {
      if (validateCurrentStep()) void submitApplication();
      return;
    }
    if (!validateCurrentStep()) return;
    if (currentStep < TOTAL_STEPS) showStep(currentStep + 1);
    else goToReview();
  });
  for (const button of stepperButtons) {
    button.addEventListener("click", () => {
      const target = Number(button.dataset.stepperGo);
      if (target === currentStep) return;
      // En avant : l'étape quittée doit d'abord passer ses contrôles.
      if (target > currentStep && currentStep <= TOTAL_STEPS && !validateCurrentStep()) return;
      if (target === REVIEW_STEP) goToReview();
      else if (target < currentStep || reachable(target)) showStep(target);
    });
  }
  form.addEventListener("submit", (event) => event.preventDefault());

  // L'appel « Commencer ma candidature » de l'écran d'accueil amène au titre de l'étape 1.
  document.querySelector<HTMLAnchorElement>("[data-application-start]")?.addEventListener("click", (event) => {
    event.preventDefault();
    form.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    titleEl.focus({ preventScroll: true });
  });

  // Changer de langue ou quitter la page recharge le formulaire : sans
  // stockage local (exclu volontairement), seule une confirmation évite de
  // perdre des réponses saisies.
  window.addEventListener("beforeunload", (event) => {
    if (!dirty || submitted) return;
    event.preventDefault();
  });

  updateMinorUi();
  updateCategoryUi();
  updateLanguages();
  showStep(1, { focusTitle: false, scroll: false });
}
