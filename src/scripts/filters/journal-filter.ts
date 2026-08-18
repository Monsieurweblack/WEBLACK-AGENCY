let initialized = false;

export function initJournalFilter() {
  if (initialized) return;
  initialized = true;

  const filterBar = document.getElementById("journal-filter");
  const grid = document.getElementById("journal-grid");
  if (!filterBar || !grid) return;

  const buttons = filterBar.querySelectorAll<HTMLButtonElement>("[data-filter]");
  const cards = grid.querySelectorAll<HTMLElement>("[data-category]");

  function applyFilter(category: string) {
    cards.forEach((card) => {
      const match = category === "all" || card.dataset.category === category;
      card.classList.toggle("hidden", !match);
    });
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
