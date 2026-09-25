let initialized = false;

/** Même principe que agenda-filter.ts : tout est déjà dans la page, le filtre ne fait que masquer. */
export function initLiveArchiveFilter() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("live-archive-filter") as HTMLFormElement | null;
  const list = document.getElementById("live-archive-list");
  const emptyMessage = document.getElementById("live-archive-empty");
  if (!form || !list) return;

  const items = Array.from(list.querySelectorAll<HTMLElement>("[data-live-archive-item]"));

  function valueOf(name: string): string {
    const field = form!.elements.namedItem(name);
    return field instanceof HTMLSelectElement ? field.value : "all";
  }

  function matches(item: HTMLElement): boolean {
    for (const [name, key] of [
      ["year", "year"],
      ["discipline", "discipline"],
    ] as const) {
      const selected = valueOf(name);
      if (selected !== "all" && item.dataset[key] !== selected) return false;
    }
    return true;
  }

  function apply() {
    let visible = 0;
    items.forEach((item) => {
      const shown = matches(item);
      item.hidden = !shown;
      if (shown) visible++;
    });
    if (emptyMessage) emptyMessage.hidden = visible > 0;
  }

  form.addEventListener("change", apply);
  form.addEventListener("reset", () => window.setTimeout(apply, 0));
}
