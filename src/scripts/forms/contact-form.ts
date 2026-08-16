let initialized = false;

export function initContactForm() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("contact-form") as HTMLFormElement | null;
  const status = document.getElementById("form-status");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = submitButton?.querySelector("[data-submit-label]");
  if (!form || !status || !submitButton || !submitLabel) return;

  const contactEmail = form.dataset.contactEmail || "";
  const submittingText = status.dataset.submittingText || "";
  const successText = status.dataset.successText || "";
  const errorText = status.dataset.errorText || "";
  const labelName = form.dataset.labelName || "Nom";
  const labelEmail = form.dataset.labelEmail || "E-mail";
  const labelOrganisation = form.dataset.labelOrganisation || "Organisation";
  const labelRole = form.dataset.labelRole || "Fonction";
  const labelCountry = form.dataset.labelCountry || "Pays";
  const labelProfile = form.dataset.labelProfile || "Profil";
  const labelInterest = form.dataset.labelInterest || "Intérêt";
  const labelTimeline = form.dataset.labelTimeline || "Calendrier";
  const labelBudget = form.dataset.labelBudget || "Budget";

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
    const name = String(data.get("name") || "");
    const email = String(data.get("email") || "");
    const organisation = String(data.get("organisation") || "");
    const role = String(data.get("role") || "");
    const country = String(data.get("country") || "");
    const profileLabel = String(data.get("profileLabel") || "");
    const interest = String(data.get("interest") || "");
    const timeline = String(data.get("timeline") || "");
    const budget = String(data.get("budget") || "");
    const message = String(data.get("message") || "");

    const subject = `[WEBLACK] ${profileLabel} — ${name}`;
    const bodyLines = [
      `${labelName}: ${name}`,
      `${labelEmail}: ${email}`,
      organisation ? `${labelOrganisation}: ${organisation}` : null,
      role ? `${labelRole}: ${role}` : null,
      country ? `${labelCountry}: ${country}` : null,
      profileLabel ? `${labelProfile}: ${profileLabel}` : null,
      interest ? `${labelInterest}: ${interest}` : null,
      timeline ? `${labelTimeline}: ${timeline}` : null,
      budget ? `${labelBudget}: ${budget}` : null,
      "",
      message,
    ].filter((line): line is string => line !== null);

    const params = new URLSearchParams({ subject, body: bodyLines.join("\n") });
    return `mailto:${contactEmail}?${params.toString().replace(/\+/g, "%20")}`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    // Honeypot: a filled hidden field means a bot filled every input blindly.
    // Real visitors never see or touch it — silently drop the submission.
    const honeypot = form.querySelector<HTMLInputElement>('input[name="website"]');
    if (honeypot?.value) return;

    if (!form.checkValidity() || !contactEmail) {
      form.reportValidity();
      setStatus("error");
      return;
    }

    setStatus("submitting");
    const data = new FormData(form);
    const profileField = document.getElementById("contact-profile") as HTMLInputElement | null;
    data.set("profileLabel", profileField?.dataset.label || "");
    const mailtoUrl = buildMailtoUrl(data);
    window.location.href = mailtoUrl;
    setStatus("success");
  });
}
