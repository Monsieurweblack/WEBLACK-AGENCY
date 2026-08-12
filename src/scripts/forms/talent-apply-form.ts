let initialized = false;

export function initTalentApplyForm() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("talent-apply-form") as HTMLFormElement | null;
  const status = document.getElementById("form-status");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = submitButton?.querySelector("[data-submit-label]");
  if (!form || !status || !submitButton || !submitLabel) return;

  const contactEmail = form.dataset.contactEmail || "";
  const submittingText = status.dataset.submittingText || "";
  const successText = status.dataset.successText || "";
  const errorText = status.dataset.errorText || "";

  function setStatus(kind: "idle" | "submitting" | "success" | "error") {
    if (!status) return;
    status.classList.remove("hidden");
    status.classList.toggle("text-(--color-gold)", kind === "success");
    status.classList.toggle("text-red-400", kind === "error");
    status.classList.toggle("text-(--color-paper)/60", kind === "submitting");
    if (kind === "submitting") status.textContent = submittingText;
    else if (kind === "success") status.textContent = successText;
    else if (kind === "error") status.textContent = errorText;
    else status.textContent = "";
  }

  function buildMailtoUrl(data: FormData): string {
    const firstName = String(data.get("firstName") || "");
    const lastName = String(data.get("lastName") || "");
    const fullName = `${firstName} ${lastName}`.trim();

    const fields: [string, string][] = [
      [form?.dataset.labelEmail || "E-mail", String(data.get("email") || "")],
      [form?.dataset.labelPhone || "Téléphone", String(data.get("phone") || "")],
      [form?.dataset.labelCategory || "Catégorie", String(data.get("category") || "")],
      [form?.dataset.labelLocation || "Ville / Pays", String(data.get("location") || "")],
      [form?.dataset.labelPortfolio || "Portfolio", String(data.get("portfolio") || "")],
      [form?.dataset.labelSocials || "Réseaux sociaux", String(data.get("socials") || "")],
      [form?.dataset.labelExperience || "Expérience", String(data.get("experience") || "")],
      [form?.dataset.labelLanguages || "Langues parlées", String(data.get("languages") || "")],
      [form?.dataset.labelAvailability || "Disponibilité", String(data.get("availability") || "")],
      [form?.dataset.labelMobility || "Mobilité", String(data.get("mobility") || "")],
      [form?.dataset.labelMessage || "Message", String(data.get("message") || "")],
    ];

    const subjectPrefix = form?.dataset.subjectPrefix || "Talent Application";
    const subject = `[WEBLACK — ${subjectPrefix}] ${fullName}`;
    const bodyLines = fields
      .filter(([, value]) => value.trim().length > 0)
      .map(([label, value]) => `${label}: ${value}`);

    const params = new URLSearchParams({ subject, body: bodyLines.join("\n") });
    return `mailto:${contactEmail}?${params.toString().replace(/\+/g, "%20")}`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.checkValidity() || !contactEmail) {
      form.reportValidity();
      setStatus("error");
      return;
    }

    setStatus("submitting");
    const mailtoUrl = buildMailtoUrl(new FormData(form));
    window.location.href = mailtoUrl;
    setStatus("success");
  });
}
