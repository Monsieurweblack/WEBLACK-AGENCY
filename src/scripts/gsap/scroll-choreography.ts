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

  /**
   * gsap + ScrollTrigger (~110KB combined) is real weight to fetch and parse
   * on every single page purely for a scroll-reveal effect nobody sees until
   * they scroll. Elements start at their normal opacity (no CSS pre-hides
   * them), so deferring this to idle time costs nothing visually — at worst
   * a very fast scroll before the browser goes idle shows content without
   * its fade-in, which reads as a bonus (content available sooner), not a
   * regression. requestIdleCallback isn't in Safari; the timeout fallback
   * still gets this off the critical initial-load path.
   */
  const runWhenIdle =
    window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 200));

  await new Promise<void>((resolve) => runWhenIdle(() => resolve()));

  const [{ gsap }, ScrollTriggerModule] = await Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger"),
  ]);
  const ScrollTrigger = ScrollTriggerModule.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  /**
   * gsap.fromTo()'s "from" state (opacity: 0) renders immediately on
   * creation (immediateRender defaults to true for .fromTo, unlike .to) —
   * confirmed via real Playwright measurement: an element already visible
   * and painted at page load was observed dropping to opacity ~0.2 right
   * when this idle-deferred script ran, then fading back in over ~800ms.
   * ScrollTrigger's own "start: top 85%" would fire onEnter immediately for
   * these same already-in-view elements anyway, so this isn't a difference
   * in *what* gets revealed — only in whether already-visible content is
   * allowed to flash invisible first. Elements still below that threshold
   * keep the exact same scroll-triggered fade-in as before.
   */
  reveals.forEach((el) => {
    const alreadyInView = el.getBoundingClientRect().top < window.innerHeight * 0.85;
    if (alreadyInView) return;

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
