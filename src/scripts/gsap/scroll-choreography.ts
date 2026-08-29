let initialized = false;

export async function initScrollChoreography() {
  if (initialized) return;
  initialized = true;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const reveals = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!reveals.length) return;

  if (reduceMotion) {
    reveals.forEach((el) => {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
    const locale = document.documentElement.lang || "fr";
    document.querySelectorAll<HTMLElement>("[data-counter]").forEach((el) => {
      const numeric = parseFloat(el.dataset.counter || "0");
      const suffix = el.dataset.counterSuffix ?? "";
      if (!Number.isNaN(numeric)) el.textContent = `${numeric.toLocaleString(locale)}${suffix}`;
    });
    return;
  }

  const [{ gsap }, ScrollTriggerModule] = await Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger"),
  ]);
  const ScrollTrigger = ScrollTriggerModule.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  reveals.forEach((el) => {
    const delay = Number(el.dataset.revealDelay || 0);
    gsap.fromTo(
      el,
      { opacity: 0, y: 28 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        delay,
        ease: "power3.out",
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          once: true,
        },
      },
    );
  });

  const counters = document.querySelectorAll<HTMLElement>("[data-counter]");
  counters.forEach((el) => {
    const numeric = parseFloat(el.dataset.counter || "0");
    if (Number.isNaN(numeric)) return;
    const suffix = el.dataset.counterSuffix ?? "";
    const locale = document.documentElement.lang || "fr";
    const counterObj = { value: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: "top 90%",
      once: true,
      onEnter: () => {
        gsap.to(counterObj, {
          value: numeric,
          duration: 1.4,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = `${Math.round(counterObj.value).toLocaleString(locale)}${suffix}`;
          },
        });
      },
    });
  });
}
