let initialized = false;

export function initNav() {
  if (initialized) return;
  initialized = true;

  const header = document.querySelector<HTMLElement>("[data-header]");
  const trigger = document.getElementById("menu-trigger");
  const panel = document.getElementById("site-menu");
  const menuLabel = trigger?.querySelector("[data-menu-label]");
  const barTop = trigger?.querySelector<HTMLElement>("[data-menu-bar-top]");
  const barBottom = trigger?.querySelector<HTMLElement>("[data-menu-bar-bottom]");
  const links = panel?.querySelectorAll<HTMLAnchorElement>(".menu-link");
  if (!header || !trigger || !panel) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let isOpen = false;

  /**
   * The fullscreen menu's content must start exactly where the real header
   * ends, on every device — not at a guessed pixel value (see the comment
   * on `.menu-content` in Header.astro for what a guess broke). Measuring
   * the header's actual rendered height and re-measuring on resize covers
   * font-swap reflows, orientation changes, and breakpoint changes without
   * any hardcoded number.
   */
  const setHeaderHeightVar = () => {
    document.documentElement.style.setProperty("--header-h", `${header.getBoundingClientRect().height}px`);
  };
  setHeaderHeightVar();
  window.addEventListener("resize", setHeaderHeightVar);
  new ResizeObserver(setHeaderHeightVar).observe(header);

  const setHeaderSolid = (solid: boolean) => {
    header.classList.toggle("bg-(--color-ink)/90", solid);
    header.classList.toggle("backdrop-blur-md", solid);
    header.classList.toggle("border-b", solid);
    header.classList.toggle("border-(--color-line)", solid);
  };

  const onScroll = () => setHeaderSolid(window.scrollY > 24 || isOpen);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  async function openMenu() {
    isOpen = true;
    trigger!.setAttribute("aria-expanded", "true");
    panel!.setAttribute("aria-hidden", "false");
    panel!.removeAttribute("inert");
    if (menuLabel) menuLabel.textContent = trigger!.dataset.closeLabel || "Fermer";
    barTop?.style.setProperty("transform", "translateY(6px) rotate(45deg)");
    barBottom?.style.setProperty("transform", "translateY(-6px) rotate(-45deg)");
    panel!.classList.remove("pointer-events-none");
    document.body.style.overflow = "hidden";
    setHeaderSolid(true);

    if (prefersReducedMotion) {
      panel!.style.opacity = "1";
      links?.forEach((link) => {
        link.style.opacity = "1";
        link.style.transform = "none";
      });
      return;
    }

    const { gsap } = await import("gsap");
    gsap.to(panel, { opacity: 1, duration: 0.4, ease: "power2.out" });
    if (links?.length) {
      gsap.to(links, {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: "power3.out",
        delay: 0.1,
      });
    }
  }

  async function closeMenu() {
    isOpen = false;
    trigger!.setAttribute("aria-expanded", "false");
    panel!.setAttribute("aria-hidden", "true");
    panel!.setAttribute("inert", "");
    if (menuLabel) menuLabel.textContent = trigger!.dataset.openLabel || "Menu";
    barTop?.style.setProperty("transform", "none");
    barBottom?.style.setProperty("transform", "none");
    document.body.style.overflow = "";
    setHeaderSolid(window.scrollY > 24);

    if (prefersReducedMotion) {
      panel!.style.opacity = "0";
      panel!.classList.add("pointer-events-none");
      return;
    }

    const { gsap } = await import("gsap");
    gsap.to(panel, {
      opacity: 0,
      duration: 0.3,
      ease: "power2.in",
      onComplete: () => panel!.classList.add("pointer-events-none"),
    });
  }

  trigger.dataset.openLabel = menuLabel?.textContent ?? "Menu";
  trigger.dataset.closeLabel = trigger.dataset.closeLabel || "Fermer";

  trigger.addEventListener("click", () => (isOpen ? closeMenu() : openMenu()));

  links?.forEach((link) => link.addEventListener("click", () => closeMenu()));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) closeMenu();
  });
}
