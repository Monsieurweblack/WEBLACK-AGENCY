/**
 * Formulaire de candidature Talent — une seule page, 5 étapes
 * affichées/masquées en JS. Rien n'est jamais retiré du DOM entre deux
 * étapes : c'est ce qui permet de conserver les réponses sans jamais
 * recourir à localStorage (interdit par le cahier des charges) — tant que
 * l'onglet reste ouvert, les valeurs survivent nativement dans les champs.
 *
 * Chaque photo est réencodée via <canvas> avant l'envoi : au-delà de
 * garantir un format uniforme et une taille raisonnable, cela retire déjà
 * toute métadonnée EXIF côté client (aucun canal de métadonnées sur des
 * pixels de canvas). Le serveur revérifie quand même (functions/lib/
 * exif.ts) — jamais de confiance aveugle dans ce que le client affirme.
 */

const TOTAL_STEPS = 5;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

interface ClientStrings {
  progress: string;
  stepTitles: string[];
  navBack: string;
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
  errorGeneric: string;
  errorValidation: string;
  errorClosed: string;
  reviewEdit: string;
}

let initialized = false;

export function initTalentApplicationForm() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("talent-application-form") as HTMLFormElement | null;
  if (!form) return;

  const i18n = JSON.parse(form.dataset.i18n || "{}") as ClientStrings;
  const minorsAllowed = form.dataset.minorsAllowed === "true";
  const minorsMessage = form.dataset.minorsMessage || "";
  const confirmationMessage = form.dataset.confirmationMessage || "";
  const privacyNoticeVersion = form.dataset.privacyNoticeVersion || "";

  const steps = Array.from(form.querySelectorAll<HTMLFieldSetElement>("fieldset[data-step]"));
  const progressEl = form.querySelector<HTMLElement>("[data-step-progress]");
  const barEl = form.querySelector<HTMLElement>("[data-step-bar]");
  const titleEl = form.querySelector<HTMLElement>("[data-step-title]");
  const backBtn = form.querySelector<HTMLButtonElement>("[data-nav-back]");
  const continueBtn = form.querySelector<HTMLButtonElement>("[data-nav-continue]");
  const statusEl = form.querySelector<HTMLElement>("[data-form-status]");
  const successPanel = form.querySelector<HTMLElement>("[data-success-panel]");
  const successMessageEl = form.querySelector<HTMLElement>("[data-success-message]");
  const successReferenceEl = form.querySelector<HTMLElement>("[data-success-reference]");
  const navControls = form.querySelector<HTMLElement>("[data-nav-controls]");
  if (!progressEl || !barEl || !titleEl || !backBtn || !continueBtn || !statusEl) return;

  let currentStep = 1;
  const photoFiles = new Map<HTMLElement, File>();

  // --- Navigation entre étapes --------------------------------------------

  function showStep(step: number) {
    currentStep = step;
    for (const fieldset of steps) {
      const n = Number(fieldset.dataset.step);
      fieldset.hidden = n !== step;
    }
    progressEl!.textContent = i18n.progress.replace("{n}", String(step));
    titleEl!.textContent = i18n.stepTitles[step - 1] ?? "";
    barEl!.style.width = `${(step / TOTAL_STEPS) * 100}%`;
    backBtn!.hidden = step === 1;
    continueBtn!.textContent = step === TOTAL_STEPS ? i18n.navSubmit : i18n.navContinue;
    statusEl!.textContent = "";
    if (step === TOTAL_STEPS) buildReview();
    form!.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function currentFieldset(): HTMLFieldSetElement | undefined {
    return steps.find((s) => Number(s.dataset.step) === currentStep);
  }

  /** Validation native scopée à l'étape visible — les champs requis des autres étapes, masqués, ne bloquent jamais ceci. */
  function validateCurrentStep(): boolean {
    const fieldset = currentFieldset();
    if (!fieldset) return true;
    const fields = Array.from(fieldset.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"));
    for (const field of fields) {
      if (field.closest("[hidden]") && field.closest("[hidden]") !== fieldset) continue; // champ dans une section repliée (ex. représentant légal masqué)
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    if (currentStep === 1 && !validateMinorGate()) return false;
    if (currentStep === 2 && !validateDecimalFields()) return false;
    if (currentStep === 4 && !validateRequiredPhotos()) return false;
    return true;
  }

  // --- Étape 1 : mineur ----------------------------------------------------

  const birthDateInput = form.querySelector<HTMLInputElement>("[data-birth-date]");
  const minorBlock = form.querySelector<HTMLElement>("[data-minor-block]");
  const minorGated = form.querySelector<HTMLElement>("[data-minor-gated]");
  const guardianFields = form.querySelector<HTMLElement>("[data-guardian-fields]");

  function computeAgeClient(iso: string): number | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return undefined;
    const [, y, m, d] = match.map(Number) as unknown as [number, number, number, number];
    const birth = new Date(y, m - 1, d);
    if (birth.getFullYear() !== y || birth.getMonth() !== m - 1 || birth.getDate() !== d) return undefined;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
    return age;
  }

  function isMinor(): boolean {
    const age = birthDateInput ? computeAgeClient(birthDateInput.value) : undefined;
    return typeof age === "number" && age >= 0 && age < 18;
  }

  function updateMinorUi() {
    if (!birthDateInput || !minorBlock || !minorGated) return;
    const minor = isMinor();
    if (minor && !minorsAllowed) {
      minorBlock.hidden = false;
      minorBlock.textContent = minorsMessage;
      minorGated.hidden = true;
    } else {
      minorBlock.hidden = true;
      minorGated.hidden = false;
      if (guardianFields) guardianFields.hidden = !minor;
      for (const field of guardianFields?.querySelectorAll<HTMLInputElement>("[data-guardian-required]") ?? []) {
        field.required = minor;
      }
    }
  }

  birthDateInput?.addEventListener("change", updateMinorUi);

  function validateMinorGate(): boolean {
    if (!birthDateInput) return true;
    return !(isMinor() && !minorsAllowed);
  }

  // --- Étape 2 : mensurations décimales ------------------------------------

  function validateDecimalFields(): boolean {
    const fields = form!.querySelectorAll<HTMLInputElement>("[data-decimal]");
    for (const field of fields) {
      const raw = field.value.trim();
      if (raw === "") {
        field.setCustomValidity("");
        continue;
      }
      const normalized = raw.replace(",", ".");
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) {
        field.setCustomValidity(i18n.errorValidation);
        field.reportValidity();
        return false;
      }
      field.setCustomValidity("");
    }
    return true;
  }

  function parseDecimalClient(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const value = Number(trimmed.replace(",", "."));
    return Number.isFinite(value) ? value : undefined;
  }

  // --- Étape 3 : projets (répétable, jusqu'à 3) ----------------------------

  const projectsContainer = form.querySelector<HTMLElement>("[data-projects-container]");
  const projectTemplate = form.querySelector<HTMLTemplateElement>("[data-project-template]");
  const addProjectBtn = form.querySelector<HTMLButtonElement>("[data-add-project]");

  addProjectBtn?.addEventListener("click", () => {
    if (!projectsContainer || !projectTemplate) return;
    if (projectsContainer.children.length >= 3) return;
    const clone = projectTemplate.content.cloneNode(true) as DocumentFragment;
    const entry = clone.querySelector<HTMLElement>("[data-project-entry]");
    entry?.querySelector<HTMLButtonElement>("[data-remove-project]")?.addEventListener("click", () => entry.remove());
    projectsContainer.append(clone);
    if (projectsContainer.children.length >= 3) addProjectBtn.hidden = true;
  });

  // --- Étape 4 : photos -----------------------------------------------------

  function sniffClientType(bytes: Uint8Array): string | undefined {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    return undefined;
  }

  async function reencodeToJpeg(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode_failed"))), "image/jpeg", JPEG_QUALITY);
    });
  }

  function uploadWithProgress(blob: Blob, role: string, onProgress: (pct: number) => void): Promise<{ ok: boolean; photoId?: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/talent-application/upload");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as { ok: boolean; photoId?: string };
          resolve(xhr.status === 200 && data.ok ? { ok: true, photoId: data.photoId } : { ok: false });
        } catch {
          resolve({ ok: false });
        }
      };
      xhr.onerror = () => resolve({ ok: false });
      const body = new FormData();
      body.set("role", role);
      body.set("photo", blob, "photo.jpg");
      xhr.send(body);
    });
  }

  function initPhotoSlot(slot: HTMLElement) {
    const role = (slot.dataset.photoRole || "extra") as string;
    const input = slot.querySelector<HTMLInputElement>("[data-photo-input]");
    const idField = slot.querySelector<HTMLInputElement>("[data-photo-id-field]");
    const trigger = slot.querySelector<HTMLButtonElement>("[data-photo-trigger]");
    const preview = slot.querySelector<HTMLElement>("[data-photo-preview]");
    const statusText = slot.querySelector<HTMLElement>("[data-photo-status]");
    if (!input || !idField || !trigger || !preview || !statusText) return;
    // Rebinding nécessaire : une déclaration `function` imbriquée (runUpload
    // ci-dessous) ne conserve pas le rétrécissement de type de la garde
    // ci-dessus sur les variables d'origine — voir product-gallery.ts pour
    // la même situation déjà rencontrée dans ce projet.
    const inputEl = input;
    const idFieldEl = idField;
    const triggerEl = trigger;
    const previewEl = preview;
    const photoStatusEl = statusText;

    triggerEl.addEventListener("click", () => {
      const existing = photoFiles.get(slot);
      if (existing && photoStatusEl.dataset.failed === "true") {
        void runUpload(existing);
      } else {
        inputEl.click();
      }
    });

    inputEl.addEventListener("change", () => {
      const file = inputEl.files?.[0];
      if (!file) return;
      photoFiles.set(slot, file);
      void runUpload(file);
    });

    async function runUpload(file: File) {
      photoStatusEl.dataset.failed = "false";
      idFieldEl.value = "";
      const buffer = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (!sniffClientType(buffer) && !file.type.startsWith("image/")) {
        photoStatusEl.textContent = i18n.photoInvalidType;
        photoStatusEl.dataset.failed = "true";
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        photoStatusEl.textContent = i18n.photoTooLarge;
        photoStatusEl.dataset.failed = "true";
        return;
      }

      photoStatusEl.textContent = i18n.photoUploading;
      let blob: Blob;
      try {
        blob = await reencodeToJpeg(file);
      } catch {
        photoStatusEl.textContent = i18n.photoError;
        photoStatusEl.dataset.failed = "true";
        return;
      }

      // data: plutôt que blob: — la CSP du site (public/_headers, img-src)
      // n'autorise pas le schéma blob:, confirmé par un vrai test navigateur
      // (violation CSP observée, aperçu resté vide) ; data: y figure déjà.
      const previewUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      previewEl.style.backgroundImage = `url(${previewUrl})`;
      previewEl.style.backgroundSize = "cover";
      previewEl.style.backgroundPosition = "center";

      const result = await uploadWithProgress(blob, role, (pct) => {
        photoStatusEl.textContent = `${i18n.photoUploading} ${pct}%`;
      });

      if (result.ok && result.photoId) {
        idFieldEl.value = result.photoId;
        photoStatusEl.textContent = i18n.photoUploaded;
        photoStatusEl.dataset.failed = "false";
        triggerEl.textContent = i18n.photoReplace;
      } else {
        photoStatusEl.textContent = `${i18n.photoError} ${i18n.photoRetry}`;
        photoStatusEl.dataset.failed = "true";
      }
    }
  }

  for (const slot of form.querySelectorAll<HTMLElement>(".photo-slot[data-photo-role]")) initPhotoSlot(slot);

  const extraContainer = form.querySelector<HTMLElement>("[data-extra-photos-container]");
  const extraTemplate = form.querySelector<HTMLTemplateElement>("[data-extra-photo-template]");
  const addExtraBtn = form.querySelector<HTMLButtonElement>("[data-add-extra-photo]");

  addExtraBtn?.addEventListener("click", () => {
    if (!extraContainer || !extraTemplate) return;
    if (extraContainer.children.length >= 3) return;
    const clone = extraTemplate.content.cloneNode(true) as DocumentFragment;
    const entry = clone.querySelector<HTMLElement>("[data-extra-entry]");
    if (entry) {
      initPhotoSlot(entry);
      entry.querySelector<HTMLButtonElement>("[data-remove-extra]")?.addEventListener("click", () => {
        photoFiles.delete(entry);
        entry.remove();
        if (extraContainer.children.length < 3 && addExtraBtn) addExtraBtn.hidden = false;
      });
    }
    extraContainer.append(clone);
    if (extraContainer.children.length >= 3) addExtraBtn.hidden = true;
  });

  function validateRequiredPhotos(): boolean {
    for (const role of ["portrait", "profile", "full_length"]) {
      const slot = form!.querySelector<HTMLElement>(`.photo-slot[data-photo-role="${role}"]`);
      const idField = slot?.querySelector<HTMLInputElement>("[data-photo-id-field]");
      if (!idField?.value) {
        const statusText = slot?.querySelector<HTMLElement>("[data-photo-status]");
        if (statusText) statusText.textContent = i18n.errorValidation;
        return false;
      }
    }
    return true;
  }

  // --- Étape 5 : récapitulatif ----------------------------------------------

  const REVIEW_FIELD_IDS = [
    "firstName",
    "lastName",
    "birthDate",
    "city",
    "country",
    "email",
    "phone",
    "instagram",
    "languages",
    "experienceLevel",
    "currentAgency",
    "availability",
    "mobility",
  ];

  function buildReview() {
    const list = form!.querySelector<HTMLElement>("[data-review-list]");
    if (!list) return;
    list.innerHTML = "";
    for (const id of REVIEW_FIELD_IDS) {
      const field = form!.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
      const label = form!.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      if (!field || !label || !field.value) continue;
      const value = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent ?? field.value : field.value;
      const dt = document.createElement("dt");
      dt.className = "label-tracked text-(--color-paper)/40";
      dt.textContent = label.textContent ?? "";
      const dd = document.createElement("dd");
      dd.className = "mt-1 text-(--color-paper)";
      dd.textContent = value;
      list.append(dt, dd);
    }
  }

  // --- Collecte du payload et envoi -----------------------------------------

  function collectPhotoIds(role: string): string[] {
    const slot = form!.querySelector<HTMLElement>(`.photo-slot[data-photo-role="${role}"]`);
    const value = slot?.querySelector<HTMLInputElement>("[data-photo-id-field]")?.value;
    return value ? [value] : [];
  }

  function collectExtraPhotoIds(): string[] {
    return Array.from(extraContainer?.querySelectorAll<HTMLInputElement>("[data-photo-id-field]") ?? [])
      .map((f) => f.value)
      .filter(Boolean);
  }

  function collectProjects(): { name: string; role: string; year: string }[] {
    return Array.from(projectsContainer?.querySelectorAll<HTMLElement>("[data-project-entry]") ?? [])
      .map((entry) => ({
        name: entry.querySelector<HTMLInputElement>("[data-project-name]")?.value ?? "",
        role: entry.querySelector<HTMLInputElement>("[data-project-role]")?.value ?? "",
        year: entry.querySelector<HTMLInputElement>("[data-project-year]")?.value ?? "",
      }))
      .filter((p) => p.name || p.role || p.year);
  }

  function field(name: string): string {
    return (form!.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
  }

  function checked(name: string): boolean {
    return (form!.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;
  }

  function buildPayload() {
    const minor = isMinor();
    return {
      honeypot: field("company"),
      firstName: field("firstName"),
      lastName: field("lastName"),
      birthDate: field("birthDate"),
      city: field("city"),
      country: field("country"),
      email: field("email"),
      phone: field("phone"),
      instagram: field("instagram") || undefined,
      languages: field("languages") || undefined,
      legalGuardianName: minor ? field("legalGuardianName") : undefined,
      legalGuardianEmail: minor ? field("legalGuardianEmail") : undefined,
      legalGuardianPhone: minor ? field("legalGuardianPhone") : undefined,
      heightCm: parseDecimalClient(field("heightCm")),
      chestCm: parseDecimalClient(field("chestCm")),
      waistCm: parseDecimalClient(field("waistCm")),
      hipsCm: parseDecimalClient(field("hipsCm")),
      shoeSize: field("shoeSize") || undefined,
      shoeSystem: field("shoeSystem") || undefined,
      clothingSize: field("clothingSize") || undefined,
      inseamCm: parseDecimalClient(field("inseamCm")),
      hairColor: field("hairColor") || undefined,
      eyeColor: field("eyeColor") || undefined,
      experienceLevel: field("experienceLevel"),
      pastMissions: field("pastMissions") || undefined,
      projects: collectProjects(),
      currentAgency: field("currentAgency") || undefined,
      exclusivity: field("exclusivity") || undefined,
      portfolioLinks: field("portfolioLinks") || undefined,
      skills: field("skills") || undefined,
      training: field("training") || undefined,
      photoIds: {
        portrait: collectPhotoIds("portrait"),
        profile: collectPhotoIds("profile"),
        full_length: collectPhotoIds("full_length"),
        extra: collectExtraPhotoIds(),
      },
      availability: field("availability") || undefined,
      mobility: field("mobility") || undefined,
      desiredProjects: field("desiredProjects") || undefined,
      motivation: field("motivation") || undefined,
      accuracyConfirmed: checked("accuracyConfirmed"),
      privacyNoticeAccepted: checked("privacyNoticeAccepted"),
      privacyNoticeVersion,
    };
  }

  async function submitApplication() {
    continueBtn!.disabled = true;
    continueBtn!.textContent = i18n.navSubmitting;
    statusEl!.textContent = "";

    try {
      const response = await fetch("/api/talent-application/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = (await response.json()) as { ok: boolean; reference?: string; reason?: string };

      if (data.ok) {
        navControls!.hidden = true;
        for (const fieldset of steps) fieldset.hidden = true;
        progressEl!.textContent = "";
        titleEl!.textContent = "";
        if (successPanel && successReferenceEl) {
          successPanel.hidden = false;
          if (successMessageEl) successMessageEl.textContent = confirmationMessage;
          successReferenceEl.textContent = data.reference ?? "";
        }
        return;
      }

      statusEl!.textContent = data.reason === "closed" ? i18n.errorClosed : data.reason === "validation" ? i18n.errorValidation : i18n.errorGeneric;
      continueBtn!.disabled = false;
      continueBtn!.textContent = i18n.navRetry;
    } catch {
      statusEl!.textContent = i18n.errorGeneric;
      continueBtn!.disabled = false;
      continueBtn!.textContent = i18n.navRetry;
    }
  }

  // --- Câblage des boutons ---------------------------------------------------

  backBtn.addEventListener("click", () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });

  continueBtn.addEventListener("click", () => {
    if (!validateCurrentStep()) return;
    if (currentStep < TOTAL_STEPS) {
      showStep(currentStep + 1);
    } else {
      void submitApplication();
    }
  });

  form.addEventListener("submit", (event) => event.preventDefault());

  showStep(1);
}
