let initialized = false;

export function initTalentFilter() {
  if (initialized) return;
  initialized = true;

  const filterBar = document.getElementById("talent-filter");
  const grid = document.getElementById("talent-grid");
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
      button.classList.toggle("text-(--color-gold)", isActive);
      button.classList.toggle("text-(--color-paper)/50", !isActive);
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.filter || "all"));
  });
}
