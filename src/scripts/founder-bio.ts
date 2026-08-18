let initialized = false;

export function initFounderBio() {
  if (initialized) return;
  initialized = true;

  const panel = document.getElementById("founder-bio-panel");
  const closeBtn = panel?.querySelector<HTMLButtonElement>("[data-founder-bio-close]");
  const triggers = document.querySelectorAll<HTMLElement>("[data-founder-bio-trigger]");
  if (!panel || !closeBtn || triggers.length === 0) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let isOpen = false;
  let lastFocused: HTMLElement | null = null;

  async function openBio(trigger: HTMLElement) {
    isOpen = true;
    lastFocused = trigger;
    panel!.setAttribute("aria-hidden", "false");
    panel!.removeAttribute("inert");
    panel!.classList.remove("pointer-events-none");
    panel!.scrollTop = 0;
    document.body.style.overflow = "hidden";

    if (prefersReducedMotion) {
      panel!.style.opacity = "1";
    } else {
      const { gsap } = await import("gsap");
      gsap.to(panel, { opacity: 1, duration: 0.4, ease: "power2.out" });
    }
    closeBtn!.focus();
  }

  async function closeBio() {
    isOpen = false;
    panel!.setAttribute("aria-hidden", "true");
    panel!.setAttribute("inert", "");
    document.body.style.overflow = "";

    if (prefersReducedMotion) {
      panel!.style.opacity = "0";
      panel!.classList.add("pointer-events-none");
    } else {
      const { gsap } = await import("gsap");
      gsap.to(panel, {
        opacity: 0,
        duration: 0.3,
        ease: "power2.in",
        onComplete: () => panel!.classList.add("pointer-events-none"),
      });
    }
    lastFocused?.focus();
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => openBio(trigger));
  });

  closeBtn.addEventListener("click", () => closeBio());

  panel.addEventListener("click", (event) => {
    if (event.target === panel) closeBio();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) closeBio();
  });
}
