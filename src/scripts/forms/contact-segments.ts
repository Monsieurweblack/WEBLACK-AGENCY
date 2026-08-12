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
}
