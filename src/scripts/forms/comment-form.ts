let initialized = false;

export function initCommentForm() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("comment-form") as HTMLFormElement | null;
  const status = document.getElementById("comment-form-status");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !status || !submitButton) return;

  const contactEmail = form.dataset.contactEmail || "";
  const articleTitle = form.dataset.articleTitle || "";
  const articleUrl = form.dataset.articleUrl || "";
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
    const name = String(data.get("name") || "");
    const text = String(data.get("text") || "");

    const subject = `[WEBLACK Journal] Commentaire — ${articleTitle}`;
    const bodyLines = [`Article : ${articleTitle}`, articleUrl, "", `Nom : ${name}`, "", text];

    const params = new URLSearchParams({ subject, body: bodyLines.join("\n") });
    return `mailto:${contactEmail}?${params.toString().replace(/\+/g, "%20")}`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    // Honeypot: a filled hidden field means a bot filled every input blindly.
    const honeypot = form.querySelector<HTMLInputElement>('input[name="website"]');
    if (honeypot?.value) return;

    if (!form.checkValidity() || !contactEmail) {
      form.reportValidity();
      setStatus("error");
      return;
    }

    setStatus("submitting");
    const data = new FormData(form);
    const mailtoUrl = buildMailtoUrl(data);
    window.location.href = mailtoUrl;
    setStatus("success");
    form.reset();
  });
}
