let initialized = false;

/**
 * Inscription à la newsletter, côté navigateur.
 *
 * Trois principes tiennent tout ce fichier.
 *
 * La validation ne bloque jamais la saisie. Le champ n'est signalé comme
 * invalide qu'après que l'utilisateur l'a quitté, et le signalement
 * disparaît dès qu'il reprend la frappe : corriger quelqu'un pendant qu'il
 * écrit son adresse est la façon la plus sûre de le faire abandonner.
 *
 * Rien n'est annoncé comme réussi qui ne le soit. Si le service n'est pas
 * configuré ou refuse, le message le dit — une fausse confirmation
 * laisserait l'abonné croire qu'il recevra quelque chose.
 *
 * Sans JavaScript, le formulaire reste un formulaire : il poste vers
 * /api/newsletter et la page se recharge. Ce script ne fait que supprimer
 * ce rechargement.
 */
export function initNewsletterForm() {
  if (initialized) return;
  initialized = true;

  document.querySelectorAll<HTMLFormElement>("[data-newsletter-form]").forEach(setUp);
}

function setUp(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('input[name="email"]');
  const status = form.querySelector<HTMLElement>("[data-newsletter-status]");
  const submit = form.querySelector<HTMLButtonElement>("[data-newsletter-submit]");
  const label = form.querySelector<HTMLElement>("[data-newsletter-label]");
  if (!input || !status || !submit || !label) return;

  const copy = {
    invalid: form.dataset.copyInvalid ?? "",
    sending: form.dataset.copySending ?? "",
    success: form.dataset.copySuccess ?? "",
    already: form.dataset.copyAlready ?? "",
    unconfigured: form.dataset.copyUnconfigured ?? "",
    error: form.dataset.copyError ?? "",
  };
  const initialLabel = label.textContent ?? "";

  function say(message: string, tone: "success" | "error" | "") {
    status!.textContent = message;
    if (tone) status!.dataset.tone = tone;
    else delete status!.dataset.tone;
  }

  const valid = () => input!.validity.valid && input!.value.trim() !== "";

  // Le verdict n'arrive qu'à la sortie du champ.
  input.addEventListener("blur", () => {
    if (input.value.trim() === "") return;
    if (valid()) {
      input.removeAttribute("aria-invalid");
      say("", "");
    } else {
      input.setAttribute("aria-invalid", "true");
      say(copy.invalid, "error");
    }
  });

  // Et il se retire dès la première correction.
  input.addEventListener("input", () => {
    if (input.hasAttribute("aria-invalid") && valid()) {
      input.removeAttribute("aria-invalid");
      say("", "");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!valid()) {
      input.setAttribute("aria-invalid", "true");
      say(copy.invalid, "error");
      input.focus();
      return;
    }

    submit.disabled = true;
    label.textContent = copy.sending;
    say("", "");

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: input.value.trim(),
          company: (form.querySelector<HTMLInputElement>('input[name="company"]')?.value ?? ""),
          lang: document.documentElement.lang || "fr",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; already?: boolean; reason?: string };

      if (data.ok) {
        form.dataset.state = "success";
        say(data.already ? copy.already : copy.success, "success");
        // Le champ disparaît une fois l'inscription prise : le laisser
        // rempli invite à recommencer.
        input.value = "";
        input.blur();
        label.textContent = initialLabel;
        submit.disabled = false;
        return;
      }

      say(data.reason === "unconfigured" ? copy.unconfigured : data.reason === "invalid" ? copy.invalid : copy.error, "error");
    } catch {
      // Réseau coupé, requête interrompue : on ne prétend pas savoir.
      say(copy.error, "error");
    }

    label.textContent = initialLabel;
    submit.disabled = false;
  });
}
