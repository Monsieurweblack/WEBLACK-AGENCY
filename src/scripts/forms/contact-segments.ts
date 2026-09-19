let initialized = false;

export function initContactSegments() {
  if (initialized) return;
  initialized = true;

  const picker = document.getElementById("segment-picker");
  const formWrap = document.getElementById("contact-form-wrap");
  const backButton = document.getElementById("contact-back");
  const profileLabelEl = document.getElementById("contact-form-profile-label");
  const profileField = document.getElementById("contact-profile") as HTMLInputElement | null;
  if (!picker || !formWrap || !backButton || !profileLabelEl || !profileField) return;

  const buttons = picker.querySelectorAll<HTMLButtonElement>("[data-segment]");

  function selectSegment(button: HTMLButtonElement) {
    const label = button.dataset.label || "";
    if (!profileField || !profileLabelEl || !picker || !formWrap) return;
    profileField.value = button.dataset.segment || "";
    profileField.dataset.label = label;
    profileLabelEl.textContent = label;
    picker.classList.add("hidden");
    formWrap.classList.remove("hidden");
    const firstInput = formWrap.querySelector<HTMLInputElement>("#name");
    firstInput?.focus();
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => selectSegment(button));
  });

  backButton.addEventListener("click", () => {
    formWrap.classList.add("hidden");
    picker.classList.remove("hidden");
  });

  /**
   * Un visiteur arrivant depuis le sélecteur du header (WorkWithPicker) ou
   * un lien externe porte déjà son profil dans l'URL — ?profile=<segment>.
   * On rejoue exactement le clic qu'il aurait fait sur cette page : même
   * fonction, même bouton, rien de nouveau. S'il n'y avait pas de bouton
   * correspondant (valeur absente ou mal formée), l'écran de sélection
   * reste affiché — un profil qu'on ne reconnaît pas ne doit jamais
   * ouvrir un formulaire à l'aveugle.
   */
  const requestedProfile = new URLSearchParams(window.location.search).get("profile");
  if (requestedProfile) {
    const match = Array.from(buttons).find((button) => button.dataset.segment === requestedProfile);
    if (match) selectSegment(match);
  }
}
