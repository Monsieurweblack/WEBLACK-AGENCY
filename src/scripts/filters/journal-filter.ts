let initialized = false;

export function initJournalFilter() {
  if (initialized) return;
  initialized = true;

  const filterBar = document.getElementById("journal-filter");
  const grid = document.getElementById("journal-grid");
  if (!filterBar || !grid) return;

  const buttons = filterBar.querySelectorAll<HTMLButtonElement>("[data-filter]");
  const cards = grid.querySelectorAll<HTMLElement>("[data-category]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function applyFilter(category: string) {
    const revealed: HTMLElement[] = [];
    cards.forEach((card) => {
      const match = category === "all" || card.dataset.category === category;
      const wasHidden = card.classList.contains("hidden");
      card.classList.toggle("hidden", !match);
      if (match && wasHidden) revealed.push(card);
    });

    if (revealed.length && !reduceMotion) {
      import("gsap").then(({ gsap }) => {
        gsap.fromTo(
          revealed,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.5, stagger: 0.04, ease: "power2.out" },
        );
      });
    }

    buttons.forEach((button) => {
      const isActive = button.dataset.filter === category;
      button.classList.toggle("border-(--color-gold)", isActive);
      button.classList.toggle("text-(--color-gold)", isActive);
      button.classList.toggle("border-transparent", !isActive);
      button.classList.toggle("text-(--color-paper)/50", !isActive);
      button.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.filter || "all"));
  });
}
