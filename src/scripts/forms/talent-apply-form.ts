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
      ["Email", String(data.get("email") || "")],
      ["Phone", String(data.get("phone") || "")],
      ["Category", String(data.get("category") || "")],
      ["Location", String(data.get("location") || "")],
      ["Portfolio", String(data.get("portfolio") || "")],
      ["Socials", String(data.get("socials") || "")],
      ["Experience", String(data.get("experience") || "")],
      ["Languages", String(data.get("languages") || "")],
      ["Availability", String(data.get("availability") || "")],
      ["Mobility", String(data.get("mobility") || "")],
      ["Message", String(data.get("message") || "")],
    ];

    const subject = `[WEBLACK — Talent Application] ${fullName}`;
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
